#!/bin/bash
# Starts the disposable test server on 127.0.0.1:25566 (offline mode). World lives in ../../run, wiped by reset.sh.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
run="$here/../../run"
python3 "$here/fetch.py"
cd "$run"
[[ -f .rcon ]] || openssl rand -hex 16 > .rcon
{ cat "$here/server.properties"; echo "rcon.password=$(cat .rcon)"; } > server.properties
echo "eula=true" > eula.txt
exec caffeinate -i /opt/homebrew/opt/openjdk/bin/java -Xms1G -Xmx2G -jar paper-26.3-257.jar --nogui
