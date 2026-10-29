#!/bin/sh
# Языковые плагины lang-ru и lang-en (plugins/): словари каркаса, словари Andromeda, отдача словаря бэкендом.
#
#   1. Словарь каркаса (i18n/core/<язык>.json) покрывает ВСЕ строки strings.json и не несёт лишних; подстановки {имя}
#      в переводе те же, что в ключе (перевод с потерянной подстановкой показал бы человеку «{name}» или пустоту).
#   2. Словарь Andromeda (i18n/host/<язык>.json) — тот же набор ключей, что у русского (lang-ru), и строка в каждом
#      ключе (совпадение со строками самой Andromeda, ui/src/copy, проверяет её репозиторий: tests/frame-sync.sh); подстановки {0}, {1} совпадают с русской исходной строкой.
#   3. Манифест: type language, словарь хоста заявлен и лежит в плагине; сборка `plugins/build.sh` с `s2p lint --official`.
#   4. Настоящий метод i18n_get отдаёт словарь включённого плагина языка и не отдаёт выключенного.
#
# Запуск: sh tests/langmatch.sh (нужен python3; сборка — Go из plugin-sdk или s2p в PATH, иначе шаг пропускается вслух).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/files/usr/libexec/rpcd/splify2"
CORE="$ROOT/luci/htdocs/luci-static/resources/view/splify2/core"
T="$(mktemp -d /tmp/langmatch.XXXXXX)"
trap 'rm -rf "$T"' EXIT INT TERM

fails=0
check() {  # ОПИСАНИЕ ОЖИДАЕМОЕ ПОЛУЧЕННОЕ
    if [ "$2" = "$3" ]; then
        printf '%-76s ok\n' "$1"
    else
        printf '%-76s ПРОВАЛ\n    ожидалось: %s\n    получено:  %s\n' "$1" "$2" "$3"
        fails=$((fails + 1))
    fi
}
pj() {  # ВЫРАЖЕНИЕ < JSON
    python3 -c 'import json,sys
try: d = json.load(sys.stdin)
except Exception: print("НЕ JSON"); raise SystemExit
try: v = eval(sys.argv[1])
except Exception: v = "НЕТ ПОЛЯ"
print(v if isinstance(v, str) else json.dumps(v, ensure_ascii=False))' "$1"
}

# Проверка файлов плагина одного языка: печатает объект JSON с находками.
cat > "$T/files.py" <<'PY'
import json, re, sys
p, lang, strings, ru_host = sys.argv[1:5]
man = json.load(open(f"{p}/plugin.json"))
core = json.load(open(f"{p}/i18n/core/{lang}.json"))
keys = json.load(open(strings))
host = json.load(open(f"{p}/i18n/host/{lang}.json"))
ru = json.load(open(ru_host))
subst = lambda s: sorted(re.findall(r"\{[A-Za-z0-9_]+\}", s))
num = lambda s: sorted(re.findall(r"\{\d+\}", s))
r = {}
r["type"] = man.get("type")
r["manifest-host"] = man["i18n"]["host"][lang]["file"] == f"i18n/host/{lang}.json"
r["core-missing"] = sorted(set(keys) - set(core))
r["core-extra"] = sorted(set(core) - set(keys))
r["core-empty"] = [k for k, v in core.items() if not isinstance(v, str) or not v]
r["core-subst"] = [k for k, v in core.items() if subst(k) != subst(v)]
r["host-keys-as-ru"] = sorted(set(host) ^ set(ru))[:5]
r["host-empty"] = [k for k, v in host.items() if not isinstance(v, str) or not v][:5]
r["host-subst"] = [k for k in host if k in ru and num(host[k]) != num(ru[k])][:5]
print(json.dumps(r, ensure_ascii=False))
PY

for lang in ru en; do
    P="$ROOT/plugins/lang-$lang"
    out="$(python3 "$T/files.py" "$P" "$lang" "$CORE/strings.json" "$ROOT/plugins/lang-ru/i18n/host/ru.json")"
    check "lang-$lang: type language" "language" "$(printf '%s' "$out" | pj 'd["type"]')"
    check "lang-$lang: словарь хоста заявлен в манифесте" "true" "$(printf '%s' "$out" | pj 'd["manifest-host"]')"
    check "lang-$lang: словарь каркаса покрывает strings.json" "[]" "$(printf '%s' "$out" | pj 'd["core-missing"]')"
    check "lang-$lang: в словаре каркаса нет лишних ключей" "[]" "$(printf '%s' "$out" | pj 'd["core-extra"]')"
    check "lang-$lang: в словаре каркаса нет пустых переводов" "[]" "$(printf '%s' "$out" | pj 'd["core-empty"]')"
    check "lang-$lang: подстановки {имя} перевода те же, что у ключа" "[]" "$(printf '%s' "$out" | pj 'd["core-subst"]')"
    check "lang-$lang: ключи Andromeda те же, что у русского" "[]" "$(printf '%s' "$out" | pj 'd["host-keys-as-ru"]')"
    check "lang-$lang: в словаре Andromeda нет пустых строк" "[]" "$(printf '%s' "$out" | pj 'd["host-empty"]')"
    check "lang-$lang: подстановки {0}.. те же, что у русской строки" "[]" "$(printf '%s' "$out" | pj 'd["host-subst"]')"
done

# Русский перевод не копия ключа: без перевода остаются только имена и аббревиатуры.
same="$(python3 -c 'import json,sys
d = json.load(open(sys.argv[1]))
print(json.dumps(sorted(k for k, v in d.items() if k == v)))' "$ROOT/plugins/lang-ru/i18n/core/ru.json")"
check "lang-ru: без перевода только имена и аббревиатуры" '["Andromeda", "DNS", "LAN", "splify2", "steer {version}"]' "$same"

# Сборка и lint --official.
SDK="${PLUGIN_SDK:-$ROOT/../../plugin-sdk}"
if command -v s2p >/dev/null 2>&1 || [ -x "$SDK/bin/s2p" ] || { [ -f "$SDK/build.sh" ] && command -v go >/dev/null 2>&1; }; then
    if S2P_OUT_DIR="$T/dist" sh "$ROOT/plugins/build.sh" lang-ru lang-en >"$T/build.log" 2>&1; then rc=ok; else rc=fail; fi
    check "plugins/build.sh lang-ru lang-en: lint --official и сборка" "ok" "$rc"
    [ "$rc" = ok ] || cat "$T/build.log"
    check "  собраны два архива" "2" "$(ls "$T/dist" 2>/dev/null | grep -c '\.s2p$')"
else
    echo "сборка ПРОПУЩЕНА: нет s2p (задайте PLUGIN_SDK)"
fi

# ---- i18n_get настоящим диспетчером ----------------------------------------------------------------------
PLUG="$T/plug"
mkdir -p "$T/bin" "$T/lock" "$PLUG/lib"
cp "$ROOT/tests/stub/jsonfilter" "$T/bin/jsonfilter"; chmod +x "$T/bin/jsonfilter"
cp -r "$ROOT/plugins/lang-ru" "$ROOT/plugins/lang-en" "$PLUG/lib/"
printf '%s\n' '{"schema":1,"plugins":{"lang-ru":{"state":"enabled","version":"1.0.0"},"lang-en":{"state":"disabled","version":"1.0.0"}}}' > "$PLUG/state.json"
envs() {
    env PATH="$T/bin:$PATH" JSHN_SH="$ROOT/tests/stub/jshn.sh" RPCD_LIB="$ROOT/files/usr/lib/splify2/rpcd" \
        FAST_SH="$ROOT/files/usr/lib/splify2/fast.sh" FETCH_SH="$ROOT/files/usr/lib/splify2/fetch.sh" \
        SPLIFY2_LOCK_DIR="$T/lock" PLUGIN_SH="$ROOT/files/usr/lib/splify2/plugin.sh" \
        PLUGIN_ROOT="$PLUG/lib" PLUGIN_STATE="$PLUG/state.json" \
        EXT_REG="$PLUG/run/ext.reg" EXT_SAFE_FILE="$PLUG/safe" EXT_METHODS_TSV="$ROOT/files/usr/lib/splify2/methods.tsv" \
        SPLIFY2_LIBDIR="$ROOT/files/usr/lib/splify2" "$@"
}
rpcd() { printf '%s\n' "${2:-}" | envs sh "$SCRIPT" call "$1" 2>"$T/stderr"; }
out="$(rpcd i18n_get '{"lang":"ru"}')"
check "i18n_get ru: словарь плагина lang-ru" "true;lang-ru;1" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["dicts"][0]["plugin"]');$(printf '%s' "$out" | pj 'len(d["dicts"])')"
check "  в словаре перевод строки каркаса" "Применить" "$(printf '%s' "$out" | pj 'd["dicts"][0]["dict"]["Apply"]')"
check "i18n_get en: выключенный lang-en не отдаётся" "[]" "$(rpcd i18n_get '{"lang":"en"}' | pj 'd["dicts"]')"
printf '%s\n' '{"schema":1,"plugins":{"lang-ru":{"state":"enabled","version":"1.0.0"},"lang-en":{"state":"enabled","version":"1.0.0"}}}' > "$PLUG/state.json"
check "i18n_get en: включённый lang-en отдаёт словарь" "lang-en;Apply" \
    "$(rpcd i18n_get '{"lang":"en"}' | pj 'd["dicts"][0]["plugin"]');$(rpcd i18n_get '{"lang":"en"}' | pj 'd["dicts"][0]["dict"]["Apply"]')"

echo
if [ "$fails" -ne 0 ]; then echo "ЕСТЬ ПРОВАЛЫ: $fails"; exit 1; fi
echo "все проверки прошли"
