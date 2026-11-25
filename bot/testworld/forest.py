#!/usr/bin/env python3
# Plants full-grown trees around a player with /place feature: scattered, clumped by species, never
# in or touching existing trees, never in keep-out boxes. Dry run by default; --go places.
#   SCUTTLE_SLOT=2 python3 forest.py --around Steve --radius 24 --keep=-285,-100,-270,-84
# (negative numbers need the = form, or argparse reads them as flags)
#   SCUTTLE_SLOT=2 python3 forest.py --watch Steve --keep=...   then say !forest, !forest 30, !forest go in game
# Needs SCUTTLE_SLOT set on purpose: the default slot is somebody else's server. The scan and the
# plan are seeded, so the species zones stay put from one run to the next as you walk around.
import argparse, math, os, random, re, sys, time

STEP = 2  # scan grid, blocks

# zone mixes: species weights. Zone picked by noise, so each patch leans one way
ZONES = [
    {"oak": 6, "fancy_oak": 2, "birch": 2},
    {"birch": 6, "oak": 3, "fancy_oak": 1},
    {"oak": 4, "spruce": 3, "pine": 2, "birch": 1},
    {"oak": 5, "fancy_oak": 3, "dark_oak": 2},
]
GLYPH = {"oak": "o", "fancy_oak": "O", "birch": "b", "spruce": "s", "pine": "p", "dark_oak": "d"}
UNDERGROWTH = ["fern", "short_grass", "short_grass", "poppy", "dandelion", "cornflower"]


def noise(seed, salt, x, z, cell):
    # bilinear value noise, 0..1
    def corner(ix, iz):
        return random.Random(f"{seed}/{salt}/{ix}/{iz}").random()
    fx, fz = x / cell, z / cell
    ix, iz = math.floor(fx), math.floor(fz)
    tx, tz = fx - ix, fz - iz
    tx, tz = tx * tx * (3 - 2 * tx), tz * tz * (3 - 2 * tz)
    a = corner(ix, iz) * (1 - tx) + corner(ix + 1, iz) * tx
    b = corner(ix, iz + 1) * (1 - tx) + corner(ix + 1, iz + 1) * tx
    return a * (1 - tz) + b * tz


def pick_species(seed, rng, x, z):
    zone = ZONES[min(int(noise(seed, "zone", x, z, 28) * len(ZONES)), len(ZONES) - 1)]
    names = list(zone)
    return rng.choices(names, [zone[n] for n in names])[0]


def parse_box(text):
    x1, z1, x2, z2 = (int(float(v)) for v in text.split(","))
    return min(x1, x2), min(z1, z2), max(x1, x2), max(z1, z2)


def box_dist(box, x, z):
    dx = max(box[0] - x, 0, x - box[2])
    dz = max(box[1] - z, 0, z - box[3])
    return math.hypot(dx, dz)


def plan(seed, center, radius, spacing, blocked, keeps, rng):
    # dart throwing; spacing grows with a density noise and near keep-out edges, so edges thin out
    # blocked(x, z) -> True if the cell can't hold a trunk
    cx, cz = center
    placed = []
    attempts = int(radius * radius * 6)
    for _ in range(attempts):
        ang, rad = rng.random() * math.tau, radius * math.sqrt(rng.random())
        x, z = round(cx + rad * math.cos(ang)), round(cz + rad * math.sin(ang))
        if blocked(x, z):
            continue
        near = min((box_dist(k, x, z) for k in keeps), default=99)
        if near < 2:
            continue
        need = spacing + noise(seed, "dens", x, z, 20) * 3 + max(0, 8 - near) * 0.4
        if any(math.hypot(x - px, z - pz) < max(need, pneed) for px, pz, _, pneed in placed):
            continue
        placed.append((x, z, pick_species(seed, rng, x, z), need))
    return placed


class World:
    def __init__(self, rcon):
        self.r = rcon
        self.cache = {}

    def passed(self, cmd):
        out = self.r.run(cmd).lower()
        if "not loaded" in out:
            raise SystemExit("that area isn't loaded: stand in it (or forceload it) and run again")
        return "passed" in out

    def cell(self, x, z):
        # 'G' open ground, 'T' a tree is on top, '~' anything else (water, stone, built)
        key = (x, z)
        if key not in self.cache:
            base = f"execute positioned {x} 0 {z} positioned over"
            if self.passed(f"{base} world_surface if block ~ ~-1 ~ #minecraft:leaves") or \
               self.passed(f"{base} world_surface if block ~ ~-1 ~ #minecraft:logs") or \
               self.passed(f"{base} motion_blocking_no_leaves if block ~ ~-1 ~ #minecraft:logs"):
                self.cache[key] = "T"
            elif self.passed(f"{base} motion_blocking_no_leaves if block ~ ~-1 ~ grass_block") or \
                 self.passed(f"{base} motion_blocking_no_leaves if block ~ ~-1 ~ #minecraft:dirt"):
                self.cache[key] = "G"
            else:
                self.cache[key] = "~"
        return self.cache[key]

    def scan(self, x0, z0, x1, z1):
        for z in range(z0, z1 + 1, STEP):
            for x in range(x0, x1 + 1, STEP):
                self.cell(x, z)


def snap(v):
    return int(math.floor(v / STEP)) * STEP


def make_blocked(world, clearance, keeps):
    # trunk cell is blocked if it or any scan cell within clearance isn't open ground
    def blocked(x, z):
        gx, gz = snap(x), snap(z)
        reach = clearance // STEP + 1
        for dz in range(-reach, reach + 1):
            for dx in range(-reach, reach + 1):
                if math.hypot(dx * STEP, dz * STEP) > clearance + 1:
                    continue
                c = world.cache.get((gx + dx * STEP, gz + dz * STEP), "T")
                if c == "T" or (c == "~" and math.hypot(dx * STEP, dz * STEP) <= 2):
                    return True
        return any(k[0] <= x <= k[2] and k[1] <= z <= k[3] for k in keeps)
    return blocked


def draw(world, trees, keeps, x0, z0, x1, z1):
    at = {(x, z): GLYPH[s] for x, z, s, _ in trees}
    for z in range(z0, z1 + 1):
        row = ""
        for x in range(x0, x1 + 1):
            if (x, z) in at:
                row += at[(x, z)]
            elif any(k[0] <= x <= k[2] and k[1] <= z <= k[3] for k in keeps):
                row += "X"
            else:
                row += {"G": ".", "T": "#", "~": " "}.get(world.cache.get((snap(x), snap(z)), " "), " ")
        print(row)


def player_pos(rcon, name):
    out = rcon.run(f"data get entity {name} Pos")
    nums = re.findall(r"-?\d+\.?\d*(?=d)", out)
    if len(nums) != 3:
        raise SystemExit(f"can't read {name}'s position: {out.strip()}")
    return float(nums[0]), float(nums[2])


def place(rcon, x, z, species):
    # grass_block isn't in #dirt on 26.3; a false condition prints nothing, so empty means try the next
    for ground in ("grass_block", "#minecraft:dirt"):
        out = rcon.run(
            f"execute positioned {x} 0 {z} positioned over motion_blocking_no_leaves "
            f"if block ~ ~-1 ~ {ground} run place feature minecraft:{species} ~ ~ ~").strip().lower()
        if out:
            return "placed" in out
    return False


def undergrowth(rcon, x, z, rng, count):
    for _ in range(count):
        ox, oz = x + rng.randint(-3, 3), z + rng.randint(-3, 3)
        rcon.run(
            f"execute positioned {ox} 0 {oz} positioned over motion_blocking_no_leaves "
            f"if block ~ ~-1 ~ grass_block if block ~ ~ ~ air run setblock ~ ~ ~ {rng.choice(UNDERGROWTH)}")


def make_plan(rcon, args, center, keeps):
    cx, cz = round(center[0]), round(center[1])
    pad = args.clearance + 3
    world = World(rcon)
    world.scan(snap(cx - args.radius - pad), snap(cz - args.radius - pad), cx + args.radius + pad, cz + args.radius + pad)
    rng = random.Random(f"{args.seed}/{cx}/{cz}")
    trees = plan(args.seed, (cx, cz), args.radius, args.spacing,
                 make_blocked(world, args.clearance, keeps), keeps, rng)
    return world, trees, rng


def summary(trees):
    counts = {}
    for _, _, s, _ in trees:
        counts[s] = counts.get(s, 0) + 1
    return f"{len(trees)} trees: {counts}"


def plant(rcon, trees, rng, extras, say=print):
    ok = 0
    for x, z, s, _ in trees:
        if place(rcon, x, z, s):
            ok += 1
            if extras:
                undergrowth(rcon, x, z, rng, extras)
        else:
            say(f"failed at {x},{z} ({s})")
    return ok


def tell(rcon, name, text):
    rcon.run('tellraw %s {"text":"[forest] %s","color":"green"}' % (name, text))


def sparkle(rcon, trees):
    for x, z, _, _ in trees:
        rcon.run(f"execute positioned {x} 0 {z} positioned over motion_blocking_no_leaves "
                 f"run particle minecraft:end_rod ~ ~ ~ 0 2 0 0.01 10 force")


CHAT = re.compile(r"\]: (?:\[[^\]]*\] )?<(\w+)> !forest\b\s*(.*)$")


def follow(path):
    # yields new log lines; reopens when the server restarts and starts a fresh latest.log
    f, ino = open(path), os.stat(path).st_ino
    f.seek(0, 2)
    while True:
        line = f.readline()
        if line:
            yield line
            continue
        time.sleep(0.5)
        try:
            if os.stat(path).st_ino != ino:
                f, ino = open(path), os.stat(path).st_ino
        except FileNotFoundError:
            pass
        yield None


def watch(args, keeps):
    # !forest [radius]  previews with sparkles; !forest go plants the preview; !forest stop drops it
    from rcon import Rcon, RUN
    who = args.watch
    pending = None  # (trees, rng, until)
    print(f"watching {RUN}/logs/latest.log for !forest from {who}")
    for line in follow(RUN / "logs" / "latest.log"):
        if pending and time.time() > pending[2]:
            pending = None
        if line is None:
            if pending:
                try:
                    r = Rcon()
                    sparkle(r, pending[0])
                    r.close()
                except OSError:
                    pass
            continue
        m = CHAT.search(line)
        if not m or m.group(1) != who:
            continue
        word = m.group(2).strip().lower()
        r = Rcon()
        try:
            if word == "go":
                if not pending:
                    tell(r, who, "nothing previewed; say !forest first")
                else:
                    tell(r, who, "planting...")
                    ok = plant(r, pending[0], pending[1], args.undergrowth, lambda t: print(t))
                    tell(r, who, f"planted {ok} of {len(pending[0])}")
                    pending = None
            elif word == "stop":
                pending = None
                tell(r, who, "preview dropped")
            else:
                try:
                    args.radius = min(int(word), 48) if word else args.radius
                except ValueError:
                    tell(r, who, "say !forest, !forest 30, !forest go or !forest stop")
                    continue
                world, trees, rng = make_plan(r, args, player_pos(r, who), keeps)
                pending = (trees, rng, time.time() + 90)
                tell(r, who, f"{summary(trees)}; sparkles for 90 s. !forest go plants them")
                sparkle(r, trees)
        except SystemExit as e:
            tell(r, who, str(e))
        finally:
            r.close()


def main():
    if "SCUTTLE_SLOT" not in os.environ:
        sys.exit("set SCUTTLE_SLOT to the slot you mean (the default slot belongs to something else)")
    ap = argparse.ArgumentParser()
    ap.add_argument("--watch", help="player name: listen for !forest in that player's chat")
    ap.add_argument("--around", help="player name to centre on")
    ap.add_argument("--center", help="x,z instead of a player")
    ap.add_argument("--radius", type=int, default=24)
    ap.add_argument("--spacing", type=float, default=3.5, help="minimum blocks between trunks")
    ap.add_argument("--clearance", type=int, default=3, help="blocks kept clear of existing trees")
    ap.add_argument("--keep", action="append", default=[], help="x1,z1,x2,z2 box that stays empty")
    ap.add_argument("--seed", default="forest")
    ap.add_argument("--undergrowth", type=int, default=2, help="plants per tree, 0 for none")
    ap.add_argument("--go", action="store_true", help="place the trees (default is a dry run)")
    args = ap.parse_args()
    if args.radius > 48:
        sys.exit("radius over 48 is past what stays loaded around you")
    keeps = [parse_box(k) for k in args.keep]
    if args.watch:
        return watch(args, keeps)

    from rcon import Rcon
    rcon = Rcon()
    if args.center:
        center = tuple(float(v) for v in args.center.split(","))
    elif args.around:
        center = player_pos(rcon, args.around)
    else:
        sys.exit("give --watch NAME, --around NAME or --center x,z")
    world, trees, rng = make_plan(rcon, args, center, keeps)
    cx, cz = round(center[0]), round(center[1])
    draw(world, trees, keeps, cx - args.radius - 2, cz - args.radius - 2, cx + args.radius + 2, cz + args.radius + 2)
    print(f"\n{summary(trees)}   (. open  # tree  X keep-out  o/O oak  b birch  s spruce  p pine  d dark oak)")
    if not args.go:
        print("dry run; add --go to place")
        return
    print(f"placed {plant(rcon, trees, rng, args.undergrowth)} of {len(trees)}")


if __name__ == "__main__":
    main()
