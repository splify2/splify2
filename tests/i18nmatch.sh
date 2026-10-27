#!/bin/sh
# Тексты бэкенда: каркас отвечает по-английски, языковые плагины переводят (files/usr/lib/splify2/i18n.sh).
#
#   1. Отказ несёт code и args, текст error — английский по умолчанию, без языкового плагина.
#   2. Язык берётся из S2_LANG, затем из luci.main.lang; «auto» — английский. Словарь lang-ru даёт русский текст, {имя}
#      подставляются, args остаются значениями (клиент с собственным переводом берёт code и args).
#   3. Выключенный плагин словарь не отдаёт; pt-br берёт словарь pt; словарь стороннего плагина со своими кодами работает.
#   4. plugin_fail: code — вид отказа (интерфейс выбирает по нему), msg — код текста.
#   5. Программа плагина (lib.sh): s2_fail_code и s2_t говорят то же самое.
#   6. Словари lang-ru и lang-en покрывают ровно те коды, что есть в коде, подстановки совпадают, английский текст вызова
#      равен словарю lang-en (иначе английский каркас разошёлся бы со словарём). Ключи steer.* (отказы ядра) в коде не
#      стоят: у них только пары языков и подстановки.
#   7. Отказы ядра steer: код и args доходят до ответа с приставкой steer., текст переводится по словарю; приставки
#      места {in}: {path}: ; без кода или без перевода — текст ядра дословно (spec_check, spec_set, менеджер плагинов,
#      xsteer_link).
#
# Запуск: sh tests/i18nmatch.sh (нужен python3).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/files/usr/libexec/rpcd/splify2"
T="$(mktemp -d /tmp/i18nmatch.XXXXXX)"
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

PLUG="$T/plug"
mkdir -p "$T/bin" "$T/lock" "$PLUG/lib"
cp "$ROOT/tests/stub/jsonfilter" "$T/bin/jsonfilter"; cp "$ROOT/tests/stub/uci" "$T/bin/uci"; chmod +x "$T/bin/jsonfilter" "$T/bin/uci"
: > "$T/uci.db"
state() {  # ID=СОСТОЯНИЕ...
    python3 - "$PLUG/state.json" "$@" <<'PY'
import json, sys
st = {"schema": 1, "plugins": {}}
for a in sys.argv[2:]:
    i, s = a.split("=")
    st["plugins"][i] = {"state": s, "version": "1.0.0"}
json.dump(st, open(sys.argv[1], "w"))
PY
}
envs() {
    env PATH="$T/bin:$PATH" UCI_STUB_DB="$T/uci.db" JSHN_SH="$ROOT/tests/stub/jshn.sh" RPCD_LIB="$ROOT/files/usr/lib/splify2/rpcd" \
        FAST_SH="$ROOT/files/usr/lib/splify2/fast.sh" FETCH_SH="$ROOT/files/usr/lib/splify2/fetch.sh" \
        SPLIFY2_LOCK_DIR="$T/lock" PLUGIN_SH="$ROOT/files/usr/lib/splify2/plugin.sh" \
        PLUGIN_ROOT="$PLUG/lib" PLUGIN_STATE="$PLUG/state.json" PLUGIN_JOBS="$T/jobs" \
        EXT_REG="$PLUG/run/ext.reg" EXT_SAFE_FILE="$PLUG/safe" EXT_METHODS_TSV="$ROOT/files/usr/lib/splify2/methods.tsv" \
        SPLIFY2_LIBDIR="$ROOT/files/usr/lib/splify2" "$@"
}
rpcd() { printf '%s\n' "${2:-}" | envs sh "$SCRIPT" call "$1" 2>"$T/stderr"; }

# ---- 1. без языкового плагина: английский, code и args ----------------------------------------------------
state
out="$(rpcd no_such_method '{}')"
check "без плагина: error по-английски" "Unknown method" "$(printf '%s' "$out" | pj 'd["error"]')"
check "  code — машинное слово" "req.unknown_method" "$(printf '%s' "$out" | pj 'd["code"]')"
check "  args есть и пуст" "{}" "$(printf '%s' "$out" | pj 'd["args"]')"
check "  ok:false" "false" "$(printf '%s' "$out" | pj 'd["ok"]')"
out="$(rpcd prefs_set '{"interface":"Bad Name"}')"
check "отказ prefs_set: код и текст" "prefs.bad_interface" "$(printf '%s' "$out" | pj 'd["code"]')"

# ---- 2. язык и словарь lang-ru ---------------------------------------------------------------------------
cp -r "$ROOT/plugins/lang-ru" "$ROOT/plugins/lang-en" "$PLUG/lib/"
state lang-ru=enabled lang-en=enabled zz-demo=enabled
out="$(S2_LANG=ru rpcd no_such_method '{}')"
check "S2_LANG=ru: русский текст из lang-ru" "неизвестный метод;req.unknown_method" "$(printf '%s' "$out" | pj 'd["error"]');$(printf '%s' "$out" | pj 'd["code"]')"
out="$(rpcd no_such_method '{}')"
check "язык не задан: английский" "Unknown method" "$(printf '%s' "$out" | pj 'd["error"]')"
printf 'luci.main.lang=ru\n' > "$T/uci.db"
check "luci.main.lang=ru берётся из настроек" "неизвестный метод" "$(rpcd no_such_method '{}' | pj 'd["error"]')"
printf 'luci.main.lang=auto\n' > "$T/uci.db"
check "luci.main.lang=auto — английский (браузер бэкенду не виден)" "Unknown method" "$(rpcd no_such_method '{}' | pj 'd["error"]')"
printf 'luci.main.lang=RU\n' > "$T/uci.db"
check "регистр кода языка не важен" "неизвестный метод" "$(rpcd no_such_method '{}' | pj 'd["error"]')"
: > "$T/uci.db"
out="$(S2_LANG=en rpcd no_such_method '{}')"
check "S2_LANG=en: словарь lang-en" "Unknown method" "$(printf '%s' "$out" | pj 'd["error"]')"
out="$(S2_LANG=de rpcd no_such_method '{}')"
check "язык без словаря: английский" "Unknown method" "$(printf '%s' "$out" | pj 'd["error"]')"
# Подстановки: текст на языке, args — значения как есть.
out="$(S2_LANG=ru rpcd steer_module_add '{"module":"bogus"}')"
check "подстановка {name}: русский текст" "неизвестный модуль: bogus;module.unknown;bogus" \
    "$(printf '%s' "$out" | pj 'd["error"]');$(printf '%s' "$out" | pj 'd["code"]');$(printf '%s' "$out" | pj 'd["args"]["name"]')"
out="$(rpcd steer_module_add '{"module":"bogus"}')"
check "подстановка {name}: английский текст" "Unknown module: bogus" "$(printf '%s' "$out" | pj 'd["error"]')"
out="$(S2_LANG=ru rpcd steer_module_add '{"module":"a&b|c\\d"}')"
check "значение со знаками &, |, \\ подставляется как есть" 'неизвестный модуль: a&b|c\d' "$(printf '%s' "$out" | pj 'd["error"]')"

# ---- 3. выключенный плагин, запасной язык, словарь стороннего плагина ---------------------------------------
state lang-ru=disabled lang-en=enabled
check "выключенный lang-ru словарь не отдаёт" "Unknown method" "$(S2_LANG=ru rpcd no_such_method '{}' | pj 'd["error"]')"
mkdir -p "$PLUG/lib/lang-pt/i18n/backend"
printf '{"req.unknown_method": "método desconhecido"}\n' > "$PLUG/lib/lang-pt/i18n/backend/pt.json"
state lang-ru=disabled lang-en=enabled lang-pt=enabled
check "pt-br без своего словаря берёт pt" "método desconhecido" "$(S2_LANG=pt-br rpcd no_such_method '{}' | pj 'd["error"]')"
printf '{"req.unknown_method": "método desconhecido (br)"}\n' > "$PLUG/lib/lang-pt/i18n/backend/pt-br.json"
check "pt-br со своим словарём берёт его" "método desconhecido (br)" "$(S2_LANG=pt-br rpcd no_such_method '{}' | pj 'd["error"]')"
mkdir -p "$PLUG/lib/zz-demo/i18n/backend"
printf '{"x.demo": "демо {what}", "req.unknown_method": "метод неизвестен"}\n' > "$PLUG/lib/zz-demo/i18n/backend/ru.json"
state lang-ru=enabled lang-en=enabled lang-pt=enabled zz-demo=enabled
check "первое найденное слово побеждает (порядок каталогов)" "неизвестный метод" "$(S2_LANG=ru rpcd no_such_method '{}' | pj 'd["error"]')"

# ---- 4. plugin_fail: code — вид отказа, msg — код текста -----------------------------------------------------
state lang-ru=enabled lang-en=enabled zz-demo=enabled
out="$(S2_LANG=ru rpcd plugin_status '{"id":"Bad Name"}')"
check "plugin_status: code — вид отказа" "bad_request" "$(printf '%s' "$out" | pj 'd["code"]')"
check "  msg — код текста" "plugin.bad_name" "$(printf '%s' "$out" | pj 'd["msg"]')"
check "  error на языке каркаса" "Недопустимое имя плагина" "$(printf '%s' "$out" | pj 'd["error"]')"
out="$(rpcd plugin_status '{"id":"Bad Name"}')"
check "  без языка — английский" "Invalid plugin name" "$(printf '%s' "$out" | pj 'd["error"]')"
out="$(S2_LANG=ru rpcd plugin_install '{"id":"demo","version":"1 2"}')"
check "plugin_install: подстановка {version}" "Недопустимая версия: 1 2;1 2" "$(printf '%s' "$out" | pj 'd["error"]');$(printf '%s' "$out" | pj 'd["args"]["version"]')"

# ---- 5. программа плагина: lib.sh --------------------------------------------------------------------------
cat > "$T/prog.sh" <<EOT
. "$ROOT/files/usr/lib/splify2/lib.sh"
case "\$1" in
    fail) s2_fail_code lists.too_big "The list is larger than {kb} KB: that much is not put on the router" kb 64 ;;
    own)  s2_fail_code x.demo "demo {what}" what "a b" ;;
    text) s2_t lists.empty "The list is empty" ;;
    raw)  s2_fail "готовый текст" ;;
esac
EOT
prog() { env PATH="$T/bin:$PATH" UCI_STUB_DB="$T/uci.db" JSHN_SH="$ROOT/tests/stub/jshn.sh" SPLIFY2_LIB="$ROOT/files/usr/lib/splify2/lib.sh" \
    PLUGIN_ROOT="$PLUG/lib" PLUGIN_STATE="$PLUG/state.json" "$@"; }
out="$(S2_LANG=ru prog sh "$T/prog.sh" fail)"
check "s2_fail_code: русский текст, code, args" "список больше 64 КБ — столько на роутер не кладём;lists.too_big;64" \
    "$(printf '%s' "$out" | pj 'd["error"]');$(printf '%s' "$out" | pj 'd["code"]');$(printf '%s' "$out" | pj 'd["args"]["kb"]')"
check "  без языка — английский" "The list is larger than 64 KB: that much is not put on the router" "$(prog sh "$T/prog.sh" fail | pj 'd["error"]')"
check "  свой код плагина: словарь стороннего плагина" "демо a b" "$(S2_LANG=ru prog sh "$T/prog.sh" own | pj 'd["error"]')"
check "  код без словаря — английский текст вызова" "demo a b" "$(S2_LANG=de prog sh "$T/prog.sh" own | pj 'd["error"]')"
check "s2_t печатает текст, не отказывая" "пустой список" "$(S2_LANG=ru prog sh "$T/prog.sh" text)"
check "s2_fail — готовый текст без code" "готовый текст;НЕТ ПОЛЯ" "$(prog sh "$T/prog.sh" raw | pj 'd["error"]');$(prog sh "$T/prog.sh" raw | pj 'd["code"]')"
check "программа плагина: код возврата 0 при отказе" "0" "$(prog sh "$T/prog.sh" fail >/dev/null; echo $?)"

# ---- 7. отказы ядра steer: код и args доходят, текст переводится -------------------------------------------------
# Заглушка ядра: apply --dry-run отказывает кодом спеки, xsteer-link — кодом ссылки, plugin — готовым JSON менеджера.
mkdir -p "$T/mgr" "$T/etc"
cat > "$T/bin/steer" <<'EOS'
#!/bin/sh
case "$1" in
    apply)
        if [ -n "${CORE_NOCODE:-}" ]; then echo 'steer: spec.json:4:11: outputs.a: слова без кода' >&2; exit 2; fi
        echo 'steer: spec.json:4:11: outputs.a: неизвестный kind «bogus» (есть direct, block, interface, tunnel, awg, group)' >&2
        [ -n "${STEER_ERR_JSON:-}" ] && echo '{"ok":false,"error":"spec.json:4:11: outputs.a: неизвестный kind «bogus» (есть direct, block, interface, tunnel, awg, group)","code":"spec.unknown_kind","args":{"1":"outputs.a","2":"bogus","3":"","at":"spec.json:4:11","line":"4","col":"11"}}' >&2
        exit 2 ;;
    xsteer-link)
        echo 'steer: xs://: ссылка не разбирается' >&2
        [ -n "${STEER_ERR_JSON:-}" ] && echo '{"ok":false,"error":"xs://: ссылка не разбирается","code":"xslink.rejected","args":{"why":"bad xs link"}}' >&2
        exit 2 ;;
    plugin) shift; PLUG="$T_MGR" exec sh "$T_STUB" "$@" ;;
esac
exit 0
EOS
chmod +x "$T/bin/steer"
core() {  # [ПЕРЕМЕННЫЕ] МЕТОД ВХОД — метод rpcd с заглушкой ядра
    _c_vars=""
    while [ $# -gt 2 ]; do _c_vars="$_c_vars $1"; shift; done
    printf '%s\n' "$2" | envs env SPEC="$T/etc/spec.json" SPEC_VIEW="$T/etc/spec-view.json" APPLIED="$T/etc/spec.applied.json" STEER="$T/bin/steer" T_MGR="$T/mgr" T_STUB="$ROOT/tests/stub/steer-plugin" $_c_vars sh "$SCRIPT" call "$1"
}
SPECIN='{"spec":"{\"version\":2}"}'
out="$(core S2_LANG=ru spec_check "$SPECIN")"
check "spec_check: русский текст по коду ядра" "outputs.a: неизвестный kind «bogus» (есть direct, block, interface, tunnel, awg, group)" "$(printf '%s' "$out" | pj 'd["error"]')"
check "  code с приставкой steer." "steer.spec.unknown_kind" "$(printf '%s' "$out" | pj 'd["code"]')"
check "  args ядра (в том числе место) дошли" "outputs.a;bogus;4;11" "$(printf '%s' "$out" | pj 'd["args"]["1"]');$(printf '%s' "$out" | pj 'd["args"]["2"]');$(printf '%s' "$out" | pj 'd["args"]["line"]');$(printf '%s' "$out" | pj 'd["args"]["col"]')"
out="$(core spec_check "$SPECIN")"
check "spec_check: английский текст по коду ядра" 'outputs.a: unknown kind "bogus" (known: direct, block, interface, tunnel, awg, group)' "$(printf '%s' "$out" | pj 'd["error"]')"
out="$(core S2_LANG=ru CORE_NOCODE=1 spec_check "$SPECIN")"
check "spec_check: у отказа нет кода — слова ядра дословно, code нет" "outputs.a: слова без кода;НЕТ ПОЛЯ" "$(printf '%s' "$out" | pj 'd["error"]');$(printf '%s' "$out" | pj 'd["code"]')"
# Менеджер плагинов: code и args ядра идут в msg и args, code — вид отказа.
printf '%s\n' '{"ok":false,"error":"плагина vless нет ни в одном репозитории","code":"plugin.not_in_any_repo","args":{"id":"vless"}}' > "$T/mgr/failraw.list"
out="$(core S2_LANG=en plugins_list '{}' 2>/dev/null)"
check "plugins_list: английский текст по коду менеджера" "The plugin vless is in no repository" "$(printf '%s' "$out" | pj 'd["error"]')"
check "  code — вид отказа, msg — код ядра, args" "failed;steer.plugin.not_in_any_repo;vless" "$(printf '%s' "$out" | pj 'd["code"]');$(printf '%s' "$out" | pj 'd["msg"]');$(printf '%s' "$out" | pj 'd["args"]["id"]')"
out="$(core S2_LANG=ru plugins_list '{}' 2>/dev/null)"
check "plugins_list: русский текст по коду менеджера" "плагина vless нет ни в одном репозитории" "$(printf '%s' "$out" | pj 'd["error"]')"

out="$(core S2_LANG=en xsteer_link '{"link":"xs://x"}')"
check "xsteer_link: отказ ядра с кодом — code steer.xslink.rejected, текст по словарю" "steer.xslink.rejected;bad xs link;bad xs link" \
    "$(printf '%s' "$out" | pj 'd["code"]');$(printf '%s' "$out" | pj 'd["error"]');$(printf '%s' "$out" | pj 'd["args"]["why"]')"

# ---- 6. словари против кода -------------------------------------------------------------------------------
python3 - "$ROOT" <<'PY' > "$T/dict.out"
import glob, json, os, re, sys
root = sys.argv[1]
ru = json.load(open(root + "/plugins/lang-ru/i18n/backend/ru.json"))
en = json.load(open(root + "/plugins/lang-en/i18n/backend/en.json"))
rx = re.compile(r'(?:s2_t|fail_code|s2_fail_code|s2_fail_doc|s2_fail_fields|plugin_fail \S+|ext_err \S+) ([A-Za-z0-9_.-]+) "((?:[^"\\]|\\.)*)"')
used = {}
files = [f for pat in ("files/**/*", "plugins/*/bin/*", "plugins/*/lib/*", "plugins/*/hooks/*")
         for f in glob.glob(root + "/" + pat, recursive=True) if os.path.isfile(f) and "/i18n/" not in f and not f.endswith(".json")]
for f in files:
    try: t = open(f, encoding="utf-8").read()
    except Exception: continue
    t = "\n".join(l for l in t.split("\n") if not l.lstrip().startswith("#"))
    for m in rx.finditer(t):
        used.setdefault(m.group(1), set()).add(m.group(2).replace('\\"', '"').replace("\\$", "$"))
sub = lambda s: sorted(re.findall(r"\{(\w+)\}", s))
print("missing-en", sorted(k for k in used if k not in en))
print("missing-ru", sorted(k for k in used if k not in ru))
print("unused", sorted(k for k in set(en) | set(ru) if k not in used and not k.startswith("steer.")))
print("keys-differ", sorted(set(en) ^ set(ru)))
print("default-differs", sorted(k for k, ds in used.items() if k in en and any(d != en[k] for d in ds)))
print("placeholders", sorted(k for k in en if k in ru and sub(en[k]) != sub(ru[k])))
print("empty", sorted(k for d in (en, ru) for k, v in d.items() if not isinstance(v, str) or not v))
print("code-count", len(used) > 300)
print("steer-count", len([k for k in en if k.startswith("steer.")]) > 300)
PY
for k in missing-en missing-ru unused keys-differ default-differs placeholders empty; do
    check "словари: $k" "[]" "$(sed -n "s/^$k //p" "$T/dict.out")"
done
check "словари: кодов в коде больше трёхсот" "True" "$(sed -n 's/^code-count //p' "$T/dict.out")"
check "словари: отказов ядра (steer.*) больше трёхсот" "True" "$(sed -n 's/^steer-count //p' "$T/dict.out")"

echo
if [ "$fails" -ne 0 ]; then echo "ЕСТЬ ПРОВАЛЫ: $fails"; exit 1; fi
echo "все проверки прошли"
