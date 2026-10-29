#!/bin/sh
# Граница API официальных плагинов (plugin-sdk/docs/splify2-api.md, раздел 9): плагины каркаса — образец для сообщества и
# пользуются платформой ТОЛЬКО через её API (манифест, хуки, задачи, схема настроек, службы хоста `$SPLIFY2_HOST`), а не
# файлами, переменными и функциями каркаса.
#
# Два слоя:
#   1. grep по запретным путям и именам — работает всегда, без инструментов SDK; ловит то, что назвал владелец:
#      `/usr/lib/splify2`, `common.sh`, `/etc/splify2`, `/var/run/splify2`, `/etc/steer`, переменные-швы каркаса;
#   2. `s2p lint --official` — полный список запретного (пути, файлы, переменные, функции, uci каркаса) и разбор команд.
#      Нужен s2p (в PATH, в plugin-sdk/bin или собирается из исходников SDK, если есть Go); иначе слой пропускается вслух.
#
# Каждый слой доказан обратным опытом: в копию плагина подкладывается нарушение, и стенд обязан его поймать, иначе
# зелёный результат ничего не стоит.
#
# Запуск: sh tests/pluginhygiene.sh   (PLUGIN_SDK=каталог plugin-sdk, если он не рядом)
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d "${TMPDIR:-/tmp}/pluginhygiene.XXXXXX")"
trap 'rm -rf "$T"' EXIT INT TERM
fails=0
check() {  # ОПИСАНИЕ ОЖИДАЕМОЕ ПОЛУЧЕННОЕ
    if [ "$2" = "$3" ]; then printf '%-72s ok\n' "$1"
    else printf '%-72s ПРОВАЛ\n    ожидалось: %s\n    получено:  %s\n' "$1" "$2" "$3"; fails=$((fails + 1)); fi
}

PLUGINS="$(cd "$ROOT/plugins" && for d in */; do [ -f "$d/plugin.json" ] && echo "${d%/}"; done)"

# Слой 1: запретное, без комментариев. Регулярное выражение — то, что назвал владелец, плюс файлы и швы каркаса.
FORBID='/usr/lib/splify2|/usr/share/splify2|/usr/libexec/rpcd/splify2|/etc/splify2|/var/run/splify2|/var/lib/splify2|/var/lock/splify2|/etc/steer/|/etc/config/splify2|(^|[^A-Za-z0-9_.-])(common|env|fetch|spec|ext|plugin|fast)\.sh([^A-Za-z0-9_]|$)|(\$|\$\{|^|[[:space:];|(:])(SPEC|SUB|SUBS_DIR|LISTS|APPLIED|MANIFEST|UCI_SPLIFY2|XSTEER_DIR|RPCD_LIB|JSHN_SH|FETCH_SH|SPEC_SH|ENV_SH|PLUGIN_ROOT|PLUGIN_STATE|PLUGIN_CONF_DIR|SPLIFY2_LIBDIR)([^A-Za-z0-9_]|$)'
scan() {  # КАТАЛОГ_ПЛАГИНА — строки с нарушением (файл:номер:строка), комментарии пропущены
    ( cd "$1" && find . -type f ! -name '*.json' ! -name '*.md' | sort | while read -r f; do
        awk -v f="$f" '{ s = $0; sub(/^[ \t]+/, "", s); if (substr(s, 1, 1) == "#") next; print f ":" NR ":" $0 }' "$f"
      done | grep -E -- "$FORBID" )
}

for id in $PLUGINS; do
    check "плагин $id: обращений к внутренностям каркаса нет (grep)" "" "$(scan "$ROOT/plugins/$id")"
done

# Обратный опыт слоя 1: каждый вид нарушения в копии плагина ловится.
probe() {  # ОПИСАНИЕ СТРОКА
    rm -rf "$T/p"; cp -R "$ROOT/plugins/lists-catalog" "$T/p"
    printf '%s\n' "$2" >> "$T/p/bin/lists"
    check "grep ловит: $1" "yes" "$(scan "$T/p" | grep -q 'bin/lists' && echo yes || echo no)"
}
probe "подключение файла каркаса" '. /usr/lib/splify2/rpcd/common.sh'
probe "common.sh" '. "$dir/common.sh"'
probe "каталог настроек каркаса" 'cat /etc/splify2/manifest.json'
probe "состояние каркаса" 'ls /var/run/splify2'
probe "спека и списки ядра" 'cat /etc/steer/spec.json'
probe "шов SPEC" 'cat "$SPEC"'
probe "шов LISTS" 'ls ${LISTS}/x'
probe "шов в присваивании" 'MANIFEST=/x'

# Слой 2: s2p lint --official.
SDK="${PLUGIN_SDK:-$ROOT/../plugin-sdk}"
[ -d "$SDK" ] || SDK="$ROOT/../../plugin-sdk"
[ -d "$SDK" ] || SDK=/home/yo1nk/splicicd/plugin-sdk
S2P=""
if command -v s2p >/dev/null 2>&1; then S2P="$(command -v s2p)"
elif [ -x "$SDK/bin/s2p" ]; then S2P="$SDK/bin/s2p"
elif [ -f "$SDK/build.sh" ] && command -v go >/dev/null 2>&1; then
    S2P_OUT="$T/s2p-bin" sh "$SDK/build.sh" >/dev/null 2>&1 && S2P="$T/s2p-bin/s2p"
fi
if [ -n "$S2P" ] && "$S2P" lint --help 2>&1 | grep -q official; then
    for id in $PLUGINS; do
        out="$("$S2P" lint --official "$ROOT/plugins/$id" 2>&1)"; rc=$?
        check "плагин $id: s2p lint --official" "0" "$rc"
        [ "$rc" = 0 ] || printf '%s\n' "$out" | head -8
    done
    probe2() {  # ОПИСАНИЕ СТРОКА РЕГУЛЯРКА_ОТКАЗА
        rm -rf "$T/p"; cp -R "$ROOT/plugins/backup" "$T/p"
        printf '%s\n' "$2" >> "$T/p/bin/backup"
        out="$("$S2P" lint --official "$T/p" 2>&1)"; rc=$?
        check "s2p lint --official ловит: $1" "1;yes" "$rc;$(printf '%s' "$out" | grep -Eq -- "$3" && echo yes || echo no)"
    }
    probe2 "функцию каркаса" 'call_lock state' 'функция каркаса call_lock'
    probe2 "функцию спеки" 'x="$(spec_json)"' 'функция каркаса spec_json'
    probe2 "uci каркаса" 'uci -q get splify2.main.sub_url' 'uci каркаса'
    probe2 "путь ядра" 'cat /etc/steer/sub.txt' 'путь каркаса /etc/steer'
    probe2 "init-скрипт ядра" '/etc/init.d/steer reload' 'путь каркаса /etc/init.d/steer'
    probe2 "переменную-шов" 'cat "$SUBS_DIR/x.txt"' 'переменная каркаса SUBS_DIR'
    probe2 "скачивание в обход хоста" 'download "$u" "$f"' 'функция каркаса download'
else
    echo "ПРОПУЩЕНО: нет s2p с флагом --official (PLUGIN_SDK=каталог plugin-sdk, нужен Go для сборки)"
fi

[ "$fails" = 0 ] && echo "все проверки прошли" || { echo "ПРОВАЛОВ: $fails"; exit 1; }
