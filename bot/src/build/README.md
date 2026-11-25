# build/

Data and planning for builds. Nothing here touches the world: placing goes through the place door later, with a
`nameAt` injected for anything that reads blocks.

## The format

A blueprint is JSON, never code:

```json
{
  "name": "pad",
  "size": { "x": 3, "y": 2, "z": 2 },
  "palette": { "a": "cobblestone", "t": "torch" },
  "cells": [{ "x": 0, "y": 0, "z": 0, "p": "a" }, { "x": 0, "y": 1, "z": 0, "p": "t" }],
  "facing": "north"
}
```

- Cells are relative to an origin the plan picks, `0 <= x < size.x` and so on. x is across, z is along, y is up,
  north is -z, east is +x. A world position anywhere in the file is refused by name.
- `facing` (optional) is where the front of the build points. A plan turns the build from its facing (north when
  absent) to the one asked for; the origin is then the lowest corner of the turned footprint.
- Defaults: 32 on a side, 4096 cells, 32 palette entries. A job (`plan.ts`) is capped lower, 1024 blocks, and the
  build runner has to live with `policy.ts`'s smaller placing budget on top of that.
- Unknown keys are refused at every level. `parseBlueprint(unknown)` returns `{ok, value}` or `{ok: false,
  problems}` (at most 20), and never throws.
- `rotate(bp, turns)` is clockwise from above, `mirror` flips left and right, `faceTo` is what the plan uses.

## The allowlist

`PALETTE_ALLOWLIST` in `blueprint.ts`: planks, logs, fences and fence gates of nine woods (bamboo has no log),
stone, cobblestone, mossy cobblestone, stone bricks, mossy stone bricks, smooth stone, glass, torch.

Left out, for a reason each: slabs and stairs (half and facing per cell), wall torches, panes, doors, beds, chests
(own intents), sand and gravel (fall), liquids, redstone, the nether woods, poplar (new in 26.3, untried), air (a
blueprint never clears).

What the format does not carry, so the placer has to settle it:
- **Fence gate facing.** Face across the line: the axis its two fence neighbours are not on.
- **Log axis.** A log is a post unless the placer is told otherwise; the audit compares names only, so a log on its
  side reads as right.
- **Torches.** Placed on top; one hung on a wall reads back as `wall_torch`, which the audit accepts.

## Plan and audit

`makePlan(bp, origin, facing)` gives `cells` in build order (lowest layer first; on a layer, cells on the origin
layer or on a holding block first, then outward through neighbours), `materials` (`{block: count}`), and
`unsupported` (cells with no chain of blocks down to the origin layer; these need scaffolding). The order depends
only on the cell set, so a resumed job takes `remaining(plan, nameAt)`, the same order with the finished cells
skipped. `audit(plan, nameAt)` lists the cells still wrong, and apart from them the ones in unloaded chunks.

The origin layer is assumed to sit on solid ground; the plan can't know that, the runner has to check.

## Adding a generator

A function in `generators.ts` that checks its integer arguments (`ints`) and its material family (`material`),
builds a plain object, and returns `parseBlueprint(obj)`. Never return a blueprint that skipped the parser: the
caps and the allowlist live there. Add its cell count and shape to `test/generators.test.ts`. If it needs a block
that is not on the allowlist, that is a decision about what Scuttle may build with, made in `blueprint.ts` and
tested against the game data.
