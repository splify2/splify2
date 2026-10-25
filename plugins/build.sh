#!/bin/sh
# Сборка плагинов каркаса (plugins/<id>) в .s2p инструментом SDK: `s2p lint --official`, затем `s2p build`.
#
#   sh plugins/build.sh                       lint и сборка всех плагинов в plugins/dist, без подписи
#   S2P_KEY=ключ.sec sh plugins/build.sh      с подписью (так собирает выпуск)
#   sh plugins/build.sh backup                один плагин
#
# s2p ищется в PATH, затем в $PLUGIN_SDK/bin (по умолчанию соседний каталог plugin-sdk); если его нет, собирается
# из исходников SDK: `sh build.sh` (Go 1.21+). Плагины на shell и без машинного кода: один архив `-all.s2p`.
# Позже каталог plugins/ уедет в репозиторий splify2-core-plugins вместе с этим скриптом.
set -eu
HERE="$(cd "$(dirname "$0")" && pwd)"
SDK="${PLUGIN_SDK:-$HERE/../../plugin-sdk}"
if command -v s2p >/dev/null 2>&1; then S2P="$(command -v s2p)"
elif [ -x "$SDK/bin/s2p" ]; then S2P="$SDK/bin/s2p"
elif [ -f "$SDK/build.sh" ]; then
    (cd "$SDK" && S2P_OUT="${TMPDIR:-/tmp}/s2p-bin.$$" sh build.sh >/dev/null) || exit 1
    S2P="${TMPDIR:-/tmp}/s2p-bin.$$/s2p"
else
    echo "нет инструмента s2p: положите его в PATH или задайте PLUGIN_SDK (каталог plugin-sdk)" >&2; exit 1
fi
OUT="${S2P_OUT_DIR:-$HERE/dist}"
mkdir -p "$OUT"
[ $# -gt 0 ] || set -- $(cd "$HERE" && for d in */; do [ -f "$d/plugin.json" ] && echo "${d%/}"; done)
for id in "$@"; do
    # --official: плагины каркаса — образец и пользуются платформой только через её API (splify2-api, раздел 9); обращение
    # к внутренностям каркаса здесь — отказ, а не предупреждение.
    "$S2P" lint --official "$HERE/$id"
    if [ -n "${S2P_KEY:-}" ]; then "$S2P" build "$HERE/$id" --key "$S2P_KEY" -o "$OUT"
    else "$S2P" build "$HERE/$id" --unsigned -o "$OUT"; fi
done
