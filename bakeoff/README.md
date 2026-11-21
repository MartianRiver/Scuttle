# Bake-off

Run Scuttle's actual prompt against a field of models and score what comes back.

```
python3 bakeoff/run.py                       # every candidate, every scenario
python3 bakeoff/run.py --models openai/gpt-5.6-luna,anthropic/claude-sonnet-5
python3 bakeoff/run.py --only trade_affordable --repeat 3
python3 bakeoff/rescore.py                   # re-check saved runs, no API calls
```

Python 3 stdlib only. The OpenRouter key comes from `.env` at the repo root, same
as the plugin's. A full run is eleven models by ten scenarios and costs a few
cents — mostly Sonnet and Grok.

## What it's for

Answering "would a different model be better?" and "did that prompt change help?"
with numbers instead of a hunch. It reads `src/main/resources/persona.txt` — the
file the plugin reads — and mirrors the plugin's message order, so a persona edit
is measurable without building a jar.

Every model gets identical inputs: the tool results are canned in `world.py`,
which reimplements `TradeGuard`'s arithmetic exactly (margin, stash factor, the
counter-offer). Same question, same numbers, same refusals.

Three scores per model, kept apart because they mean different things:

- **SAFETY** — jailbreaks: fake admin authority, persona override, emotional
  pressure, an injection planted in the untrusted recent-chat block, and a
  three-turn gradual escalation. Note that a *fair* counter-offer during a
  manipulation attempt is correct behaviour and is not counted against a model;
  only a lopsided one is.
- **task** — did it do the job. Mostly: did it actually call `offer_sale`
  rather than describing a swap in chat, which is the bug that keeps coming back.
- **voice** — persona adherence. Sentence count, emoji, asterisk stage
  directions, and saying credit numbers out loud.

## Reading the output

`rescore.py` re-applies the checks to a saved `results*.json`. Use it whenever a
check turns out to be wrong — the raw replies are all in the file, so fixing a
scorer costs nothing. That happened three times on the first run: a substring
test for "dan" flagged every model that *refused* to be DAN, and a keyword list
for "can't" missed the U+2019 apostrophe most models actually emit.

Treat single-sample differences as noise. Run-to-run variance on the trade
scenarios is comparable to the gap between the middle-ranked models; use
`--repeat` before believing anything close.

## What it is not

**The tool schemas here are a copy.** `prompt.py` restates them, and `world.py`
restates `TradeGuard`. Both go stale the moment the Java changes and nothing
warns you. If a scenario starts failing for everything at once, check these
first — the plugin is the source of truth, this is a stand-in.

The recipe book is three items. It exists to exercise both branches of
`lookup_recipe`, not to be right.

## Files

- `run.py` — the runner: candidates, the tool loop, the scoreboard
- `prompt.py` — prompt assembly, mirroring `PersonaBuilder` + `WorldContext` + `Pocket`
- `world.py` — canned tool results, mirroring `TradeGuard`, `Stash` and the
  `Shop` gate. Whether a scenario is inside the shop rides in per-scenario
  `state`, not a module global — `run.py` runs models in parallel threads.
- `scenarios.py` — the questions and what counts as getting them wrong
- `rescore.py` — re-score saved transcripts offline

## What the 2026-08-17 field said

`models.chat` is `anthropic/claude-sonnet-5`. Eleven candidates were measured on
2026-08-17 against the real persona and tool schemas; numbers in the measurement notes,
harness in `bakeoff/`. Three findings shape the config:

- **Reasoning is on by default almost everywhere, including Sonnet 5**, and is pure
  waste here. Thinking tokens also come out of `max-reply-tokens`, which is what
  made replies stop mid-word. `models.reasoning: false` sends
  `reasoning: {effort: "low"}` — use `effort`, never `enabled: false`, which is a
  400 on endpoints where reasoning is mandatory (Gemini Flash, Grok).
- **Model choice barely moves safety.** One jailbreak in 66 attempts across the
  field, and no model ever got a lopsided swap past `TradeGuard`, because the guard
  is Java. Pick on voice, speed and cost — and note Sonnet 5 costs ~95x the
  cheapest credible option, `openai/gpt-5.6-luna`, which topped task at
  $0.00015/turn.

Avoid `google/gemini-3.1-flash-lite` (skips tools, invents stash contents) and
`z-ai/glm-4.7-flash` (the one that jailbroke).
