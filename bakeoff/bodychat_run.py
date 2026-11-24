"""Runner for the body-chat suite: the tool loop, the spend guard, the scoreboard.

The model client is passed in (`complete(model, messages) -> response dict`) so
the whole thing runs offline against a fake. run.py supplies the real one.
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import pathlib
import statistics
import threading
import time
import urllib.error

import bodychat_prompt as BP
import bodychat_scenarios as BS
import bodychat_world as W

MAX_ROUNDS = 6
DEFAULT_CAP = 2.0
DEFAULT_OUT = "bodychat-results.json"
TEXT_OUT = "bodychat-results-text.json"
DEFAULT_MODELS = ["openai/gpt-5.6-luna", "google/gemini-3.7-flash",
                  "anthropic/claude-haiku-4.5", "deepseek/deepseek-v4-flash-0731",
                  "qwen/qwen3.7-flash", "mistralai/mistral-medium-3-5"]
# Used only when a response has tokens but no usage.cost. Deliberately high, so the
# guard errs towards stopping early.
FALLBACK_IN, FALLBACK_OUT = 5e-6, 25e-6


class SpendGuard:
    """Stops new calls once the reported total reaches the cap. With N threads up to
    N-1 calls are already in flight when it trips, so the final total can overshoot
    by about (jobs - 1) x the dearest single call."""

    def __init__(self, cap):
        self.cap, self.total, self.estimated = cap, 0.0, 0
        self._lock = threading.Lock()

    def allow(self):
        with self._lock:
            return self.total < self.cap

    def add(self, cost, estimated=False):
        with self._lock:
            self.total += cost
            self.estimated += 1 if estimated else 0


def usage_cost(usage):
    """(cost in USD, was it estimated from tokens because OpenRouter gave no cost)."""
    u = usage or {}
    cost = float(u.get("cost") or 0)
    ptok, ctok = int(u.get("prompt_tokens") or 0), int(u.get("completion_tokens") or 0)
    if cost <= 0 and (ptok or ctok):
        return ptok * FALLBACK_IN + ctok * FALLBACK_OUT, True
    return cost, False


def parse_args(raw):
    if isinstance(raw, dict):
        return raw
    try:
        out = json.loads(raw or "{}")
        return out if isinstance(out, dict) else {}
    except json.JSONDecodeError:
        return {}


def blank_turn(lines):
    return {"lines": lines, "text": "", "preamble": [], "calls": [], "cost": 0.0, "latencies": [],
            "prompt_tokens": 0, "completion_tokens": 0, "estimated_cost": False}


def run_scenario(model, scen, complete, guard, speech="tool"):
    """One conversation. Returns the run record, scored unless the cap cut it short.

    speech="text": there is no say tool; the text of the model's last reply in a turn is its
    one spoken line (empty = silent). It is recorded as a synthetic say call so the same
    scorers and contract checks apply. Text written alongside tool calls is not spoken."""
    messages = BP.messages(scen, speech)
    state = W.new_state(scen)
    run = {"turns": [], "error": None, "skipped": False, "speech": speech}
    ncalls = 0

    for lines in scen["turns"]:
        messages.append({"role": "user", "content": "\n".join(lines)})
        turn = blank_turn(lines)
        run["turns"].append(turn)
        for _ in range(MAX_ROUNDS):
            if not guard.allow():
                run["skipped"] = True
                break
            t0 = time.time()
            try:
                resp = complete(model, messages)
            except RuntimeError as e:
                run["error"] = str(e)
                break
            turn["latencies"].append(round(time.time() - t0, 2))
            cost, est = usage_cost(resp.get("usage"))
            guard.add(cost, est)
            u = resp.get("usage") or {}
            turn["cost"] += cost
            turn["estimated_cost"] = turn["estimated_cost"] or est
            turn["prompt_tokens"] += int(u.get("prompt_tokens") or 0)
            turn["completion_tokens"] += int(u.get("completion_tokens") or 0)

            msg = ((resp.get("choices") or [{}])[0].get("message")) or {}
            turn["text"] = (msg.get("content") or "").strip()
            tcs = msg.get("tool_calls") or []
            content = msg.get("content") or ""
            # "(nothing)" rather than "": some providers refuse an empty assistant message
            # in the middle of a conversation (the plugin suite does the same). In text mode
            # that placeholder would read as speech, so a silent reply is left out instead.
            if tcs or content or speech == "tool":
                messages.append({"role": "assistant", "content": content or ("" if tcs else "(nothing)"),
                                 **({"tool_calls": tcs} if tcs else {})})
            if tcs and content.strip():
                turn["preamble"].append(content.strip())
            if not tcs:
                break
            for tc in tcs:
                fn = tc.get("function") or {}
                name, args = fn.get("name") or "", parse_args(fn.get("arguments"))
                ncalls += 1
                if ncalls > W.MAX_CALLS:
                    result = "not executed: tool-call cap"
                elif speech == "text" and name == "say":
                    result = "rejected bad_intent"  # no such tool in this mode
                else:
                    result = W.dispatch(name, args, state)
                turn["calls"].append({"name": name, "args": args, "result": result})
                messages.append({"role": "tool", "tool_call_id": tc.get("id"),
                                 "content": result})
            if ncalls > W.MAX_CALLS:
                break
        if run["skipped"] or run["error"]:
            break

    if speech == "text":
        for t in run["turns"]:
            if t["text"]:
                a = {"text": t["text"]}
                t["calls"].append({"name": "say", "args": a, "synthetic": True,
                                   "result": W.dispatch("say", a, state)})
    run["cost"] = round(sum(t["cost"] for t in run["turns"]), 6)
    run["state"] = {k: state[k] for k in ("doing", "inv", "spoken")}
    if not run["skipped"]:
        BS.score(scen, run)
    return run


def crashed(e):
    msg = f"CRASHED: {e!r}"
    return {"turns": [], "error": msg, "skipped": False, "cost": 0, "state": {},
            "contract": [], "universal": [], "task": [msg], "violations": [msg],
            "diag": [], "passed": False}


def run_all(models, scenarios, reps, complete, guard, jobs=3, log=print, speech="tool"):
    """Rep-major, then scenario, then model, so a spend cap leaves coverage even."""
    tasks = [(m, s, r) for r in range(reps) for s in scenarios for m in models]
    results = {m: {"model": m, "scenarios": {}} for m in models}

    def one(task):
        m, s, r = task
        sid = s["id"] if reps == 1 else f"{s['id']}#{r + 1}"
        try:
            run = run_scenario(m, s, complete, guard, speech)
        except Exception as e:  # noqa: BLE001
            run = crashed(e)
        return m, sid, run

    with cf.ThreadPoolExecutor(max_workers=jobs) as ex:
        for m, sid, run in ex.map(one, tasks):
            results[m]["scenarios"][sid] = run
            log(f"  {m:34s} {sid:22s} " + ("CUT (spend cap)" if run["skipped"] else
                ("pass" if run["passed"] else "FAIL")), flush=True)
    return [results[m] for m in models]


def unrun(results):
    return [(r["model"], sid) for r in results for sid, run in r["scenarios"].items()
            if run["skipped"]]


def summarise(rec):
    runs = list(rec["scenarios"].values())
    ran = [r for r in runs if not r["skipped"]]
    turns = [t for r in ran for t in r["turns"]]
    lat = [x for t in turns for x in t["latencies"]]
    return {
        "model": rec["model"], "ran": len(ran), "cut": len(runs) - len(ran),
        "passed": sum(1 for r in ran if r["passed"]),
        "contract": sum(len(r["contract"]) for r in ran),
        "calls": sum(len(t["calls"]) for t in turns),
        "cost": round(sum(r["cost"] for r in runs), 5),
        "p50": round(statistics.median(lat), 2) if lat else 0.0,
        "errors": sum(1 for r in ran if r["error"]),
        "plain_text": sum(1 for r in ran if r["diag"]),
        "ignored": sum(1 for r in ran if r.get("ignored_text")),
    }


def print_table(results):
    rows = sorted((summarise(r) for r in results),
                  key=lambda s: (-s["passed"] / max(1, s["ran"]), s["contract"]))
    print(f"\n{'model':34s} {'passed':>9} {'contract':>8} {'calls':>6} {'$':>8} "
          f"{'p50 s':>6} {'err':>4} {'plain':>5} {'ign':>4} {'cut':>4}")
    for s in rows:
        print(f"{s['model']:34s} {s['passed']:4d}/{s['ran']:<4d} {s['contract']:8d} "
              f"{s['calls']:6d} {s['cost']:8.4f} {s['p50']:6.2f} {s['errors']:4d} "
              f"{s['plain_text']:5d} {s['ignored']:4d} {s['cut']:4d}")
    print("(plain = tool mode: failed runs answered in text without a say call; "
          "ign = text mode: runs with text written alongside tool calls, which is not spoken)")


def failures(results):
    for r in results:
        for sid, run in r["scenarios"].items():
            if run["skipped"] or run["passed"]:
                continue
            print(f"  {r['model']} {sid}: {run['violations'][:3]}")


def write(path, results, guard, cap, stopped, speech="tool"):
    out = {"suite": "bodychat", "speech": speech, "cap_usd": cap, "spent_usd": round(guard.total, 5),
           "estimated_cost_calls": guard.estimated, "stopped_on_cap": stopped,
           "unrun": [f"{m} {sid}" for m, sid in unrun(results)], "results": results}
    pathlib.Path(path).write_text(json.dumps(out, indent=1))


def rescore(path):
    """Re-applies the scorers to saved transcripts. No API calls."""
    data = json.loads(pathlib.Path(path).read_text())
    for r in data["results"]:
        for sid, run in r["scenarios"].items():
            if run.get("skipped") or sid.split("#")[0] not in BS.BY_ID:
                continue
            BS.score(BS.BY_ID[sid.split("#")[0]], run)
    return data


def make_complete(post, opts):
    """Real client: `post(body)` is run.py's. Failed attempts are retried; they cost nothing."""
    def complete(model, messages):
        body = {"model": model, "messages": messages, "tools": BP.tools(opts.get("speech", "tool")),
                "max_tokens": opts.get("max_tokens", 400), "usage": {"include": True}}
        if not opts.get("reasoning"):
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
    return complete


def dry_run(models, scenarios, reps, speech="tool"):
    chars = sum(len(m["content"]) for m in BP.messages(scenarios[0], speech))
    chars += len(json.dumps(BP.tools(speech)))
    turns = sum(len(s["turns"]) for s in scenarios)
    per_rep = turns * 1.8  # most turns are a tool round plus a closing round; silence is one
    calls = per_rep * reps * len(models)
    tok = chars / 3  # ~3 chars per token for this prompt, per the first pilot's usage numbers
    print(f"speech={speech}: {len(scenarios)} scenarios, {turns} turns, {len(models)} models, "
          f"{reps} rep(s)")
    print(f"prompt: {chars} chars including tool schemas, about {int(tok)} tokens per call "
          f"(chars/3; a turn with a tool round is two calls)")
    print(f"about {int(calls)} calls, {int(calls * tok / 1000)}k input tokens, "
          f"~{int(calls * 70 / 1000)}k output tokens in all")
    print(f"per model and rep: about {int(per_rep)} calls, {int(per_rep * tok / 1000)}k input tokens")
    print("multiply by each model's price; nothing was called")


def main(args, post):
    speech = getattr(args, "speech", None) or "tool"
    cap = args.max_spend if args.max_spend is not None else DEFAULT_CAP
    models = [m.strip() for m in (args.models or ",".join(DEFAULT_MODELS)).split(",") if m.strip()]
    only = {s for s in args.only.split(",") if s}
    scenarios = [s for s in BS.SCENARIOS if not only or s["id"] in only]
    if not scenarios:
        raise SystemExit("no scenarios match --only")
    if args.dry_run:
        return dry_run(models, scenarios, args.repeat, speech)

    opts = {"reasoning": args.reasoning, "max_tokens": args.max_tokens, "speech": speech}
    guard = SpendGuard(cap)
    print(f"{len(models)} models x {len(scenarios)} scenarios x {args.repeat}, speech={speech}, "
          f"cap ${cap:.2f}\n")
    results = run_all(models, scenarios, args.repeat, make_complete(post, opts), guard,
                      jobs=args.jobs or 3, speech=speech)
    left = unrun(results)
    if left:
        print(f"\nSPEND CAP ${cap:.2f} reached at ${guard.total:.4f}: stopped starting calls; "
              f"{len(left)} scenario run(s) left unrun:")
        for m, sid in left:
            print(f"  {m} {sid}")
    if guard.estimated:
        print(f"\nWARNING: {guard.estimated} call(s) had no usage.cost; their cost was "
              f"estimated from tokens at a high flat rate")
    out = pathlib.Path(__file__).parent / (args.out or (TEXT_OUT if speech == "text" else DEFAULT_OUT))
    write(out, results, guard, cap, bool(left), speech)
    print_table(results)
    print("\nfailures:")
    failures(results)
    print(f"\nspent ${guard.total:.4f} of ${cap:.2f}; wrote {out}")
