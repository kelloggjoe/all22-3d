#!/bin/zsh
# tools/shot.sh <out.png> <query>  — a frame from headless Chrome (the game steps itself with ?adv=…&freeze=1)
C="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
"$C" --headless=new --use-angle=metal --hide-scrollbars --window-size=${SIZE:-1280,720} --user-data-dir=${TMPDIR:-/tmp}/all22-shot-prof --timeout=${BUDGET:-15000} --screenshot="$1" "http://localhost:5180/?$2" >/dev/null 2>&1
echo "$1"
