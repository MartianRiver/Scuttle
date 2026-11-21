#!/usr/bin/env python3
# Downloads the pinned server jars into ../../run, checking each hash. Versions match the live server.
import hashlib, json, sys, urllib.request
from pathlib import Path

RUN = Path(__file__).resolve().parents[2] / "run"
UA = {"User-Agent": "generic-client"}

PAPER = ("paper-26.2-112.jar", "bd3a58cf96874e5ea6643f5f6fe9b4f5bf9e34b795fa078c2f0ee8b98b2f907e",
         "https://fill-data.papermc.io/v1/objects/bd3a58cf96874e5ea6643f5f6fe9b4f5bf9e34b795fa078c2f0ee8b98b2f907e/paper-26.2-112.jar")
# (modrinth project, version, sha512)
PLUGINS = [
    ("worldedit", "7.4.5", "a383492fac6bfb4d43a257dfa7b5fc076aae503a71151b463de4fe80e6f3d5fc11209eaf4097baa115f3febf0adc40ca0a1ecda227b8439b429d0a4ba3a63a4f"),
    ("worldguard", "7.0.18", "9404a0eacebc5c85bdcf4a7d343330b4894dcd87246548adca75c43dbf2a3c0539f75bb15665cdd04d7f980e8d0d2a95d79e96861ba74fcd5636d685496f47f2"),
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
        f = next(v for v in versions if v["version_number"] == version)["files"][0]
        target = RUN / "plugins" / f["filename"]
        if not target.exists():
            save(target, get(f["url"]), "sha512", sha)


main()
