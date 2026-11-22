#!/usr/bin/env python3
# Downloads the pinned server jars into ../../run, checking each hash. 26.3: the version the live server moves to.
import hashlib, json, sys, urllib.request
from pathlib import Path

RUN = Path(__file__).resolve().parents[2] / "run"
UA = {"User-Agent": "generic-client"}

PAPER = ("paper-26.3-257.jar", "64a5bd44910cb982b2648e9a35036cc95a6de4d561e15812aecf5411f84f7b01",
         "https://fill-data.papermc.io/v1/objects/64a5bd44910cb982b2648e9a35036cc95a6de4d561e15812aecf5411f84f7b01/paper-26.3-257.jar")
# (modrinth project, version, sha512)
PLUGINS = [
    ("worldedit", "7.4.6", "1fe3975132857093f971fed9efc601299bfa76fa7885f52a542fee41e7a0165ca9cb3cbcf5ae244474887d774d650b0db6f8f79aa80f98b245dea44f1c1b4152"),
    ("worldguard", "7.0.21", "4253b97627f93ea007d91e977c15f5f4a3219865589083fa3b523d8b15a2cfe26d71076c8eb98c0122e7fde618ad3fc44cb986dbd40a222f09678b91a98245c2"),
]


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()


def save(path, data, algo, want):
    if getattr(hashlib, algo)(data).hexdigest() != want:
        sys.exit(f"hash mismatch for {path.name}, not written")
    path.write_bytes(data)
    print("ok", path.name)


def main():
    (RUN / "plugins").mkdir(parents=True, exist_ok=True)
    name, sha, url = PAPER
    if not (RUN / name).exists():
        save(RUN / name, get(url), "sha256", sha)
    for project, version, sha in PLUGINS:
        versions = json.loads(get(f"https://api.modrinth.com/v2/project/{project}/version"))
        v = next(v for v in versions if v["version_number"] == version and {"paper", "spigot", "bukkit"} & set(v["loaders"]))
        f = next(x for x in v["files"] if x["primary"])
        target = RUN / "plugins" / f["filename"]
        # an older pin of the same plugin would load twice
        for old in (RUN / "plugins").glob(f"{project}-*.jar"):
            if old != target:
                old.unlink()
                print("removed", old.name)
        if not target.exists():
            save(target, get(f["url"]), "sha512", sha)


main()
