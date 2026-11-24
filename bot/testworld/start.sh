#!/bin/bash
# Starts the disposable test server on 127.0.0.1:25566 (offline mode). World lives in ../../run, wiped by reset.sh.
# SCUTTLE_SLOT=N starts a second one on 25566+N in ../../run-N.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
source "$here/slot.sh"
python3 "$here/fetch.py"
cd "$RUN_DIR"
[[ -f .rcon ]] || openssl rand -hex 16 > .rcon
motd="scuttle test world"
[[ "$SLOT" == 0 ]] || motd="$motd, slot $SLOT"
{
  sed -e "s/^server-port=.*/server-port=$MC_PORT/" -e "s/^rcon.port=.*/rcon.port=$RCON_PORT/" -e "s/^motd=.*/motd=$motd/" "$here/server.properties"
  echo "rcon.password=$(cat .rcon)"
} > server.properties
echo "eula=true" > eula.txt
exec caffeinate -i /opt/homebrew/opt/openjdk/bin/java -Xms1G -Xmx2G -jar paper-26.3-257.jar --nogui
