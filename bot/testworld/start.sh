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
# JAVA overrides; else JAVA_HOME, then the Homebrew JDK, then whatever "java" is on the path
java_bin="${JAVA:-}"
if [[ -z "$java_bin" && -n "${JAVA_HOME:-}" ]]; then java_bin="$JAVA_HOME/bin/java"; fi
if [[ -z "$java_bin" && -x /opt/homebrew/opt/openjdk/bin/java ]]; then java_bin=/opt/homebrew/opt/openjdk/bin/java; fi
java_bin="${java_bin:-java}"
major="$("$java_bin" -version 2>&1 | sed -n '1s/[^0-9]*\([0-9][0-9]*\).*/\1/p')"
if [[ -z "$major" || "$major" -lt 25 ]]; then
  echo "Paper 26.x needs Java 25 or newer; $java_bin is ${major:-not usable}. Set JAVA=/path/to/java (or JAVA_HOME)." >&2
  exit 1
fi
# keep a Mac awake while the server runs; other systems skip it
keep_awake=()
if command -v caffeinate >/dev/null 2>&1; then keep_awake=(caffeinate -i); fi
exec ${keep_awake[@]+"${keep_awake[@]}"} "$java_bin" -Xms1G -Xmx2G -jar paper-26.3-257.jar --nogui
