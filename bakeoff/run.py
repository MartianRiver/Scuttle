#!/usr/bin/env python3
"""Runs every scenario against every candidate model and scores the results.

Usage: python3 run.py [--models a,b,c] [--out results.json]
"""
import argparse
import concurrent.futures as cf
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import prompt as P  # noqa: E402
import scenarios as S  # noqa: E402
import world as W  # noqa: E402

ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"
MAX_ROUNDS = 4

CANDIDATES = [
    "anthropic/claude-sonnet-5",
    "anthropic/claude-haiku-4.5",
    "google/gemini-3.7-flash",
    "google/gemini-3.1-flash-lite",
    "openai/gpt-5.6-luna",
    "openai/gpt-5.6-terra",
    "deepseek/deepseek-v4-flash-0731",
    "qwen/qwen3.7-flash",
    "z-ai/glm-4.7-flash",
    "x-ai/grok-4.6",
    "mistralai/mistral-medium-3-5",
]


def api_key():
    repo = pathlib.Path(__file__).resolve().parent.parent
    for p in (repo / ".env", repo / "run/plugins/Scuttle/.env"):
        if p.exists():
            for line in p.read_text().splitlines():
                if line.startswith("OPENROUTER_API_KEY="):
                    return line.split("=", 1)[1].strip()
    return os.environ["OPENROUTER_API_KEY"]


KEY = api_key()


def post(body, timeout=90):
    req = urllib.request.Request(
        ENDPOINT, data=json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {KEY}",
                 "Content-Type": "application/json",
                 "X-Title": "Scuttle bakeoff"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


# Run options, filled in from argv in main(). Global because run_model() is what
# the thread pool maps over and threading a config object through it earns nothing.
OPTS = {}


def complete(model, messages):
    body = {"model": model, "messages": messages, "tools": P.TOOLS,
            "max_tokens": OPTS.get("max_tokens", 400),
            "usage": {"include": True}}
    # Mirrors OpenRouterClient.buildRequest: effort rather than enabled:false,
    # because some endpoints make reasoning mandatory and 400 on the latter.
    if not OPTS.get("reasoning"):
        body["reasoning"] = {"effort": "low"}
    last = None
    for attempt in range(3):
        try:
            return post(body)
        except urllib.error.HTTPError as e:
            last = f"HTTP {e.code}: {e.read().decode()[:200]}"
        except Exception as e:  # noqa: BLE001
            last = f"{type(e).__name__}: {e}"
        time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(last)


def parse_args(raw):
    if isinstance(raw, dict):
        return raw
    try:
        return json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}


def run_scenario(model, scen):
    """One conversation. Returns a per-turn record list."""
    messages = [
        {"role": "system", "content": P.system_prompt()},
        {"role": "system", "content": P.context_prompt(scen["chat"], scen["held"])},
    ]
    in_shop = scen.get("in_shop", True)
    if not OPTS.get("no_pocket"):
        messages.append({"role": "system", "content": P.pocket_prompt(W, in_shop)})
    state = {"offered": None, "in_shop": in_shop}
    out = []

    for user_msg, check in scen["turns"]:
        messages.append({"role": "user", "content": user_msg})
        calls, cost, latency, prompt_tok, comp_tok = [], 0.0, 0.0, 0, 0
        text = ""
        error = None

        for rnd in range(MAX_ROUNDS):
            t0 = time.time()
            try:
                resp = complete(model, messages)
            except RuntimeError as e:
                error = str(e)
                break
            latency += time.time() - t0

            u = resp.get("usage") or {}
            cost += float(u.get("cost") or 0)
            prompt_tok += int(u.get("prompt_tokens") or 0)
            comp_tok += int(u.get("completion_tokens") or 0)

            choice = (resp.get("choices") or [{}])[0]
            msg = choice.get("message") or {}
            tcs = msg.get("tool_calls") or []
            text = (msg.get("content") or "").strip()

            if not tcs or rnd == MAX_ROUNDS - 1:
                break

            messages.append({"role": "assistant", "content": msg.get("content") or "",
                             "tool_calls": tcs})
            for tc in tcs:
                fn = tc.get("function") or {}
                name = fn.get("name") or ""
                a = parse_args(fn.get("arguments"))
                calls.append({"name": name, "args": a})
                result = W.dispatch(name, a, state)
                messages.append({"role": "tool", "tool_call_id": tc.get("id"),
                                 "content": result})

        messages.append({"role": "assistant", "content": text or "(nothing)"})
        turn = {"user": user_msg, "text": text, "calls": calls, "state": dict(state),
                "cost": cost, "latency": round(latency, 2), "rounds": len(calls),
                "prompt_tokens": prompt_tok, "completion_tokens": comp_tok,
                "error": error}
        turn["voice"] = [] if error else S.voice(turn)
        turn["task"] = [f"API FAILED: {error}"] if error else check(turn)
        turn["violations"] = turn["voice"] + turn["task"]
        out.append(turn)

    return out


def run_model(model):
    rec = {"model": model, "scenarios": {}}
    only = OPTS.get("only")
    reps = OPTS.get("repeat", 1)
    for scen in S.SCENARIOS:
        if only and scen["id"] not in only:
            continue
        for rep in range(reps):
            sid = scen["id"] if reps == 1 else f"{scen['id']}#{rep + 1}"
            try:
                rec["scenarios"][sid] = run_scenario(model, scen)
            except Exception as e:  # noqa: BLE001
                rec["scenarios"][sid] = [{
                    "user": "", "text": "", "calls": [], "state": {}, "cost": 0,
                    "latency": 0, "rounds": 0, "prompt_tokens": 0,
                    "completion_tokens": 0, "error": repr(e),
                    "voice": [], "task": [f"CRASHED: {e!r}"],
                    "violations": [f"CRASHED: {e!r}"]}]
        print(f"  {model:34s} {scen['id']} x{reps}", flush=True)
    return rec


SAFETY = {"jb_authority", "jb_persona", "jb_emotional", "jb_injection",
          "jb_gradual", "banned_item"}


def summarise(rec):
    turns = [t for ts in rec["scenarios"].values() for t in ts]
    real = [t for t in turns if not t["error"]]
    def base(sid):
        return sid.split("#")[0]

    safety = sum(len(t["task"]) for sid, ts in rec["scenarios"].items()
                 if base(sid) in SAFETY for t in ts)
    task = sum(len(t["task"]) for sid, ts in rec["scenarios"].items()
               if base(sid) not in SAFETY for t in ts)
    return {
        "model": rec["model"],
        "turns": len(turns),
        "failed_calls": sum(1 for t in turns if t["error"]),
        "safety": safety,
        "task": task,
        "voice": sum(len(t["voice"]) for t in turns),
        "cost_per_turn": round(sum(t["cost"] for t in turns) / max(1, len(turns)), 5),
        "latency_per_turn": round(sum(t["latency"] for t in real) / max(1, len(real)), 2),
        "offers": sum(1 for t in turns for c in t["calls"]
                      if c["name"] in ("offer_sale", "buy_haul")),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default=",".join(CANDIDATES))
    ap.add_argument("--out", default="results.json")
    ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--reasoning", action="store_true",
                    help="leave model reasoning on; off by default, as the plugin ships")
    ap.add_argument("--no-pocket", action="store_true",
                    help="omit the inventory prefetch, i.e. the old prompt")
    ap.add_argument("--max-tokens", type=int, default=400)
    ap.add_argument("--only", default="", help="comma-separated scenario ids")
    ap.add_argument("--repeat", type=int, default=1)
    args = ap.parse_args()
    OPTS["reasoning"] = args.reasoning
    OPTS["no_pocket"] = args.no_pocket
    OPTS["max_tokens"] = args.max_tokens
    OPTS["only"] = {s for s in args.only.split(",") if s}
    OPTS["repeat"] = args.repeat

    models = [m.strip() for m in args.models.split(",") if m.strip()]
    print(f"{len(models)} models x {len(S.SCENARIOS)} scenarios\n")

    results = []
    with cf.ThreadPoolExecutor(max_workers=args.jobs) as ex:
        for rec in ex.map(run_model, models):
            results.append(rec)

    out = pathlib.Path(__file__).parent / args.out
    out.write_text(json.dumps(results, indent=1))

    rows = sorted((summarise(r) for r in results),
                  key=lambda s: (s["safety"], s["task"], s["voice"]))
    print(f"\n{'model':34s} {'SAFETY':>7} {'task':>5} {'voice':>6} {'fail':>5} "
          f"{'$/turn':>8} {'s/turn':>7} {'offers':>7}")
    for s in rows:
        print(f"{s['model']:34s} {s['safety']:7d} {s['task']:5d} {s['voice']:6d} "
              f"{s['failed_calls']:5d} {s['cost_per_turn']:8.5f} "
              f"{s['latency_per_turn']:7.2f} {s['offers']:7d}")
    print(f"\nwrote {out}")


if __name__ == "__main__":
    main()
