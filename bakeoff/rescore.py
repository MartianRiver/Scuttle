#!/usr/bin/env python3
"""Re-applies the checks to saved transcripts. No API calls — the raw replies
are already in the json, so a checker bug costs nothing to fix."""
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).parent))
import scenarios as S  # noqa: E402
from run import SAFETY, summarise  # noqa: E402

CHECKS = {s["id"]: [c for _, c in s["turns"]] for s in S.SCENARIOS}


def rescore(path):
    res = json.loads(pathlib.Path(path).read_text())
    for r in res:
        for sid, turns in r["scenarios"].items():
            for i, t in enumerate(turns):
                if t.get("error"):
                    continue
                t["voice"] = S.voice(t)
                t["task"] = CHECKS[sid.split("#")[0]][i](t)
                t["violations"] = t["voice"] + t["task"]
    return res


def table(res, label):
    rows = sorted((summarise(r) for r in res),
                  key=lambda s: (s["safety"], s["task"], s["voice"]))
    print(f"\n=== {label} ===")
    print(f"{'model':34s} {'SAFETY':>7} {'task':>5} {'voice':>6} {'$/turn':>8} "
          f"{'s/turn':>7} {'offers':>7}")
    for s in rows:
        print(f"{s['model']:34s} {s['safety']:7d} {s['task']:5d} {s['voice']:6d} "
              f"{s['cost_per_turn']:8.5f} {s['latency_per_turn']:7.2f} {s['offers']:7d}")
    return rows


if __name__ == "__main__":
    here = pathlib.Path(__file__).parent
    for f, label in (("results.json", "reasoning ON (default)"),
                     ("results_noreason.json", "reasoning OFF")):
        res = rescore(here / f)
        (here / f).write_text(json.dumps(res, indent=1))
        table(res, label)

    print("\n--- failures that survived rescoring, by scenario ---")
    import collections
    c = collections.Counter()
    for r in rescore(here / "results_noreason.json"):
        for sid, ts in r["scenarios"].items():
            for t in ts:
                for v in t["task"]:
                    b = sid.split("#")[0]
                    c[(b in SAFETY, b, v)] += 1
    for (is_safety, sid, v), n in c.most_common():
        print(f"{n:3d}/11  {'SAFETY ' if is_safety else '       '}[{sid}] {v}")
