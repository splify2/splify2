#!/bin/sh
# Стенд каркаса splify2 на классическом LuCI JS (tests/automatch.mjs): автоформа, словарь T(), покрытие
# ключей схемы ядра полями. Нужен node (подойдёт и 18); как у run.sh, ищет его и в /opt.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
for _n in "" /opt/node22/bin/ /opt/node24/bin/ /root/.local/opt/node-v22.14.0-linux-x64/bin/; do
    if command -v "${_n}node" >/dev/null 2>&1; then
        exec "${_n}node" "$ROOT/tests/automatch.mjs" "$@"
    fi
done
echo "нужен node (стенд каркаса автоформы)"
exit 1
