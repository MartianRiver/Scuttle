#!/usr/bin/env python3
# Builds the bot's home area, a small grove and the protection regions in the running test world.
# Coordinates mirror bot/src/lib/home.ts. Default is the visitor gate with the bot NOT a member of
# __global__, as the family server is configured; --member adds a gathering region around the grove
# with the bot as a member instead (members of __global__ itself don't unlock its deny flags here).
import hashlib, sys, uuid
from rcon import Rcon, RUN

BOT = "ScuttleTest"


def offline_uuid(name):
    b = bytearray(hashlib.md5(f"OfflinePlayer:{name}".encode()).digest())
    b[6] = (b[6] & 0x0F) | 0x30
    b[8] = (b[8] & 0x3F) | 0x80
    return uuid.UUID(bytes=bytes(b))

R = Rcon()


def run(cmd):
    out = R.run(cmd).strip()
    print(f"> {cmd}\n  {out}" if out else f"> {cmd}")
    return out


run("forceload add -40 -56 40 24")
# flat shelf from y62 to y67, air above, so the home coordinates hold whatever the seed generated
for z0, z1 in ((-44, -17), (-16, 10)):
    run(f"fill -24 62 {z0} 24 66 {z1} dirt")
    run(f"fill -24 67 {z0} 24 67 {z1} grass_block")
    run(f"fill -24 68 {z0} 24 90 {z1} air")

run("setblock 0 68 -23 crafting_table")
run("setblock 1 68 -23 furnace[facing=south]")
run("setblock -1 68 -23 furnace[facing=south]")
run("setblock -4 68 -28 chest[facing=south]")
run("setblock 4 68 -25 chest[facing=west,type=left]")
run("setblock 4 68 -24 chest[facing=west,type=right]")
run("setblock 4 68 -28 red_bed[facing=west,part=foot]")
run("setblock 3 68 -28 red_bed[facing=west,part=head]")

# oak trees outside the home region
for tx, tz in ((12, 4), (17, -3), (20, 5), (-14, 3)):
    run(f"fill {tx-2} 70 {tz-2} {tx+2} 71 {tz+2} oak_leaves")
    run(f"fill {tx-1} 72 {tz-1} {tx+1} 73 {tz+1} oak_leaves")
    run(f"fill {tx} 68 {tz} {tx} 72 {tz} oak_log")

run("setworldspawn 0 68 -10")
run("time set day")
run("gamerule advance_time false")

# the console has no WorldEdit selection for rg define, so write the region file and reload it
bot_uuid = offline_uuid(BOT)
grove = f"""    scuttle-grove:
        min: {{x: -18, y: 60, z: -8}}
        max: {{x: 26, y: 100, z: 10}}
        members:
            unique-ids:
            - {bot_uuid}
        flags: {{}}
        owners: {{}}
        type: cuboid
        priority: 1
""" if "--member" in sys.argv else ""
regions = f"""regions:
    __global__:
        members: {{}}
        flags: {{build: deny, use: deny}}
        owners: {{}}
        type: global
        priority: 0
    scuttle-home:
        min: {{x: -8, y: 60, z: -32}}
        max: {{x: 8, y: 100, z: -20}}
        members: {{}}
        flags: {{}}
        owners:
            unique-ids:
            - {bot_uuid}
        type: cuboid
        priority: 0
{grove}"""
(RUN / "plugins/WorldGuard/worlds/world/regions.yml").write_text(regions)
run("rg load -w world")
run("rg info -w world scuttle-home")
R.close()
