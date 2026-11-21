#!/bin/bash
# Start the Central Hub background monitor (plug schedules + recovery watchdog). Safe to run repeatedly: a lock keeps one instance.
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PHPBIN="$(command -v php || echo /usr/bin/php)"
RUN="$PHPBIN $DIR/monitor.php"
if [ "$(id -u)" = "0" ] && id fpp >/dev/null 2>&1; then
    RUN="sudo -u fpp -H $RUN"
fi
(cd "$DIR" && setsid $RUN >/dev/null 2>&1 &)
exit 0
