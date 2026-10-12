#!/bin/sh
# Загрузчик установщика (setup.c) и сборка итогового установщика:
#   sh installer/build.sh <Setup.exe Squirrel> <итоговый .exe>
# Компилятор — mingw-w64 в docker (образ собирается один раз: splify2-mingw). Всё, что docker
# пишет в дерево, отдаётся владельцу каталога (сборка обязана проходить и не от root).
set -eu
cd "$(dirname "$0")"
SQUIRREL=$1
OUT=$2
IMAGE=splify2-mingw:1
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    printf 'FROM ubuntu:24.04\nRUN apt-get update && apt-get install -y --no-install-recommends gcc-mingw-w64-x86-64 binutils-mingw-w64-x86-64 && rm -rf /var/lib/apt/lists/*\n' |
        docker build -q -t "$IMAGE" - >/dev/null
fi
owner="$(stat -c %u:%g .)"
docker run --rm -v "$PWD/..":/d -w /d/installer "$IMAGE" sh -c "
    x86_64-w64-mingw32-windres -c 65001 setup.rc -O coff -o setup.res &&
    x86_64-w64-mingw32-gcc -O2 -s -municode -mwindows -std=c11 -Wall -Wextra -o setup-stub.exe setup.c setup.res \
        -lgdiplus -lole32 -lshell32 -luser32 -lgdi32 -static-libgcc;
    rc=\$?; rm -f setup.res; chown $owner setup-stub.exe 2>/dev/null; exit \$rc"
# [загрузчик][Setup.exe Squirrel][длина: 8 байт LE][«SPLFY2S1»]
python3 - "$SQUIRREL" "$OUT" <<'PY'
import os, struct, sys
stub = open('setup-stub.exe', 'rb').read()
payload = open(sys.argv[1], 'rb').read()
with open(sys.argv[2], 'wb') as f:
    f.write(stub); f.write(payload); f.write(struct.pack('<Q', len(payload))); f.write(b'SPLFY2S1')
print(f'установщик: {sys.argv[2]} — загрузчик {len(stub)} байт + Squirrel {len(payload)} байт')
PY
rm -f setup-stub.exe
