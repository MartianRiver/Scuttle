#!/usr/bin/env python3
# Dumps the test server's own registries and compares item ids and block state ids with the
# minecraft-data 26.3 files the bot loaded. Exits 1 on any mismatch. Needs start.sh run once (the jar).
import json, subprocess, sys, tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
RUN = HERE.parents[1] / "run"
DATA = HERE.parent / "node_modules/minecraft-data/minecraft-data/data/pc/26.3"
JAVA = "/opt/homebrew/opt/openjdk/bin/java"


def main():
    jar = next(RUN.glob("paper-26.3-*.jar"), None)
    if not jar:
        sys.exit("no server jar in run/, start.sh fetches it")
    with tempfile.TemporaryDirectory() as out:
        subprocess.run([JAVA, "-DbundlerMainClass=net.minecraft.data.Main", "-jar", str(jar),
                        "--reports", "--output", out], check=True, capture_output=True, cwd=out)
        reports = Path(out) / "reports"
        server_items = {k.split(":")[1]: v["protocol_id"]
                        for k, v in json.loads((reports / "registries.json").read_text())["minecraft:item"]["entries"].items()}
        server_blocks = {k.split(":")[1]: min(s["id"] for s in v["states"])
                         for k, v in json.loads((reports / "blocks.json").read_text()).items()}

    items = {i["name"]: i["id"] for i in json.loads((DATA / "items.json").read_text())}
    blocks = {b["name"]: b["minStateId"] for b in json.loads((DATA / "blocks.json").read_text())}
    bad_items = [n for n in server_items if items.get(n) != server_items[n]]
    bad_blocks = [n for n in server_blocks if blocks.get(n) != server_blocks[n]]
    print(f"items {len(server_items)} server / {len(items)} data, {len(bad_items)} mismatched")
    print(f"blocks {len(server_blocks)} server / {len(blocks)} data, {len(bad_blocks)} mismatched state ids")
    for n in (bad_items + bad_blocks)[:10]:
        print("  e.g.", n)
    sys.exit(1 if bad_items or bad_blocks else 0)


main()
