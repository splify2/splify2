#!/bin/sh
# Набор каталога, который списком не выражается, — подключается самим файлом `.srs`.
#
# Обращение splify2-lists#1: в форк каталога добавлен фильтр AdGuard в .srs (jinndi/
# adguard-filter-list-srs). Ядро такой набор понимает, но `steer srs-read` отвечает кодом 2:
# исключения `@@` плоским списком не выражаются. Прежде splify2 на этом останавливался («такой
# список нам пока не подходит»), и список из каталога было не включить никак.
#
# Решение владельца: на код 2 splify2 кладёт на роутер сам набор, а правило ссылается на него
# ключом `srs` списка спеки v2. Выразимые наборы идут прежним путём. Стенд проходит весь путь
# файла: скачивание по кнопке (list_fetch), что лежит на диске (local_lists), сохранение спеки
# с таким правилом (spec_set, настоящий движок), доскачивание пропавшего файла, ночное
# обновление и удаление.
#
# Движок — настоящий: разбор набора и проверка спеки должны быть его, а не заглушки. Без
# движка (../steer/build/steer или STEER_BIN) стенд пропускается вслух. Набор с исключениями —
# tests/srs/adguard.srs дерева steer (собран настоящим sing-box), путь — SRS_FIXTURES.
#
# Запуск: sh tests/srsmatch.sh
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STEER_BIN="${STEER_BIN:-$ROOT/../steer/build/steer}"
SRS_FIXTURES="${SRS_FIXTURES:-$(dirname "$STEER_BIN")/../tests/srs}"
if [ ! -x "$STEER_BIN" ]; then
    echo "ПРОПУЩЕН: нет движка $STEER_BIN — соберите: make -C ../steer all"
    exit 0
fi
if [ ! -s "$SRS_FIXTURES/adguard.srs" ]; then
    echo "ПРОПУЩЕН: нет набора $SRS_FIXTURES/adguard.srs — нужен steer с tests/srs/adguard.srs"
    exit 0
fi
# Набор с исключениями понимает только ядро, которое читает adguard_domain целиком: старое
# снимало его кодом 1 («испорчен»), и проверять тогда нечего.
"$STEER_BIN" srs-read "$SRS_FIXTURES/adguard.srs" --out /dev/null >/dev/null 2>&1
if [ "$?" != 2 ]; then
    echo "ПРОПУЩЕН: движок $STEER_BIN не отвечает на набор с исключениями кодом 2 — нужен steer с чтением adguard_domain"
    exit 0
fi

T="$(mktemp -d /tmp/srsmatch.XXXXXX)"
trap '[ -n "${KEEP:-}" ] || rm -rf "$T"' EXIT INT TERM
mkdir -p "$T/etc" "$T/lists" "$T/bin" "$T/srv" "$T/var"
pass=0; fail=0
check() {  # ИМЯ ОЖИДАЛОСЬ ПОЛУЧЕНО
    if [ "$2" = "$3" ]; then pass=$((pass + 1)); printf '%-66s ok\n' "$1"
    else fail=$((fail + 1)); printf '%-66s ПРОВАЛ\n    ожидалось: %s\n    получено:  %s\n' "$1" "$2" "$3"; fi
}
jget() { python3 -c 'import json,sys
v=json.load(sys.stdin).get(sys.argv[1], "")
print(str(v).lower() if isinstance(v, bool) else v)' "$1"; }

# curl: отдаёт файл из $T/srv по последнему слову ссылки и записывает, за чем ходили.
cat > "$T/bin/curl" <<'EOF'
#!/bin/sh
out=""; url=""
while [ $# -gt 0 ]; do
    case "$1" in
        -o) out="$2"; shift ;;
        -H|--connect-timeout|--max-time) shift ;;
        -*) ;;
        *) url="$1" ;;
    esac
    shift
done
echo "$url" >> "$SANDBOX/curl.log"
f="$SANDBOX/srv/${url##*/}"
[ -f "$f" ] || exit 22
cp "$f" "$out"
EOF
# Ночное обновление применяет спеку настоящим `steer apply` — на машине разработки это
# правила ядра Linux. Обёртка пропускает к движку только разбор наборов, а применение пишет
# в журнал.
cat > "$T/bin/steer" <<EOF
#!/bin/sh
case "\$1" in
    srs-read|fit) exec "$STEER_BIN" "\$@" ;;
    apply) echo "apply \$*" >> "$T/steer.log"; exit 0 ;;
esac
exit 0
EOF
# jsonfilter: выражения, которые встречаются на проверяемых путях, — путь с [*] и выбор записи
# по полю (`@.domain_lists[@.url='…'].file`). Несколько -e печатают совпадения по всем.
cat > "$T/bin/jsonfilter" <<'EOF'
#!/bin/sh
file=""; str=""; exprs=""
while [ $# -gt 0 ]; do
    case "$1" in
        -i) file="$2"; shift 2 ;;
        -s) str="$2"; shift 2 ;;
        -e) exprs="$exprs$2
"; shift 2 ;;
        *) shift ;;
    esac
done
[ -z "$file" ] && [ -z "$str" ] && str="$(cat)"
EXPRS="$exprs" python3 - "$file" "$str" <<'PY'
import json, os, re, sys
path, raw = sys.argv[1], sys.argv[2]
try:
    d = json.loads(raw) if raw else json.load(open(path, encoding='utf-8'))
except Exception:
    sys.exit(1)
def render(v):
    if isinstance(v, bool): return 'true' if v else 'false'
    if isinstance(v, (dict, list)): return json.dumps(v, ensure_ascii=False)
    return str(v)
def walk(cur, parts):
    if not parts:
        if cur is not None: yield cur
        return
    p, rest = parts[0], parts[1:]
    if p == '*':
        items = cur if isinstance(cur, list) else list(cur.values()) if isinstance(cur, dict) else []
        for it in items: yield from walk(it, rest)
    elif isinstance(cur, dict) and p in cur:
        yield from walk(cur[p], rest)
for expr in os.environ.get('EXPRS', '').splitlines():
    if not expr: continue
    m = re.match(r"@\.(\w+)\[@\.(\w+)='([^']*)'\]\.(\w+)$", expr)
    if m:
        for e in d.get(m.group(1), []):
            if e.get(m.group(2)) == m.group(3) and m.group(4) in e: print(render(e[m.group(4)]))
        continue
    norm = expr.replace('@.', '', 1).replace('[*]', '.*')
    norm = re.sub(r"\[(['\"])([^'\"]*)\1\]", lambda m: '.' + m.group(2), norm)
    for v in walk(d, [x for x in norm.split('.') if x and x != '@']): print(render(v))
PY
EOF
chmod +x "$T/bin/jsonfilter"
printf '#!/bin/sh\necho "$*" >> "$SANDBOX/syslog"\n' > "$T/bin/logger"
printf '#!/bin/sh\nexit 0\n' > "$T/bin/initd"
chmod +x "$T/bin/curl" "$T/bin/steer" "$T/bin/logger" "$T/bin/initd"

cp "$SRS_FIXTURES/adguard.srs" "$T/srv/adguard.srs"
cp "$SRS_FIXTURES/telegram.srs" "$T/srv/telegram.srs"

U=https://github.com/example/srs/releases/download/2026-10-01
cat > "$T/etc/manifest.json" <<MF
{
  "base_url": "https://example.invalid/lists",
  "categories": [
    { "id": "ex:telegram", "file": "ex/telegram.srs.lst", "format": "srs", "url": "$U/telegram.srs" }
  ],
  "domain_lists": [
    { "id": "svc_ex_telegram", "kind": "domains", "file": "ex/domains/telegram.srs.lst", "format": "srs",
      "same_as_ip": ["ex:telegram"], "url": "$U/telegram.srs" },
    { "id": "jinndi:adguard", "kind": "domains", "file": "jinndi/domains/adguard.srs.lst", "format": "srs",
      "url": "$U/adguard.srs", "tag": "2026-10-01" }
  ]
}
MF

rpcd() {  # МЕТОД [ВХОД]
    printf '%s\n' "${2:-}" | env SANDBOX="$T" PATH="$T/bin:$PATH" \
        JSHN_SH="$ROOT/tests/stub/jshn.sh" FETCH_SH="$ROOT/files/usr/lib/splify2/fetch.sh" \
        FAST_SH="$ROOT/files/usr/lib/splify2/fast.sh" RPCD_LIB="$ROOT/files/usr/lib/splify2/rpcd" \
        AD_SH="$ROOT/files/usr/share/splify2/allow-domains.sh" AD_STAMP="$T/etc/allow-domains.tag" \
        LOCAL_LISTS_CACHE="$T/var/local_lists.json" \
        STEER="$STEER_BIN" SPEC="$T/etc/spec.json" APPLIED="$T/etc/spec.applied.json" \
        LISTS="$T/lists" MANIFEST="$T/etc/manifest.json" UCI_SPLIFY2="$T/etc/config-splify2" \
        INITD="$T/bin/initd" FW_OWNED="$T/etc/fw-owned" SUB="$T/etc/sub.txt" SUBS_DIR="$T/etc/subs" \
        sh "$ROOT/files/usr/libexec/rpcd/splify2" call "$1" 2>"$T/stderr"
}
req() { python3 -c 'import json,sys; print(json.dumps({"spec": sys.argv[1]}))' "$1"; }
nightly() {
    env SANDBOX="$T" PATH="$T/bin:$PATH" STEER="$T/bin/steer" SPEC="$T/etc/spec.json" \
        LISTS="$T/lists" MANIFEST="$T/etc/manifest.json" STAMP="$T/var/last-update" \
        LOCK="$T/var/update.lock" FETCH_SH="$ROOT/files/usr/lib/splify2/fetch.sh" \
        AD_SH="$ROOT/files/usr/share/splify2/allow-domains.sh" AD_STAMP="$T/etc/allow-domains.tag" \
        STEER_INIT="$T/bin/initd" RC_D="$T/no-rc.d" \
        sh "$ROOT/files/usr/sbin/splify2-update-lists" > "$T/nightly.out" 2>&1
}

AG="$T/lists/jinndi/domains/adguard.srs"

# ---- кнопка «Обновить»: list_fetch ---------------------------------------------------------
out="$(rpcd list_fetch '{"id":"jinndi:adguard","kind":"domains"}')"
check "набор с исключениями скачивается, а не отвергается" "true" "$(printf '%s' "$out" | jget ok)"
check "в ответе — путь самого набора (ключ srs)" "$AG" "$(printf '%s' "$out" | jget srs)"
check "набор лёг на диск байт в байт" "yes" "$(cmp -s "$AG" "$T/srv/adguard.srs" && echo yes || echo no)"
check "списка .lst из него не появилось" "no" \
      "$([ -e "$T/lists/jinndi/domains/adguard.srs.lst" ] && echo yes || echo no)"
check "временных файлов рядом с набором нет" "adguard.srs" "$(ls "$T/lists/jinndi/domains" 2>/dev/null | tr '\n' ' ' | sed 's/ $//')"

out="$(rpcd local_lists)"
check "local_lists видит лежащий набор" "yes" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; print("yes" if "jinndi/domains/adguard.srs" in json.load(sys.stdin)["files"] else "no")')"

# Выразимый набор — прежним путём: две половины .lst, самого набора на диске нет.
out="$(rpcd list_fetch '{"id":"ex:telegram","kind":"prefixes"}')"
check "выразимый набор: ok" "true" "$(printf '%s' "$out" | jget ok)"
check "выразимый набор: ключа srs в ответе нет" "" "$(printf '%s' "$out" | jget srs)"
check "выразимый набор: подсети в .lst" "yes" "$([ -s "$T/lists/ex/telegram.srs.lst" ] && echo yes || echo no)"
check "выразимый набор: домены в .lst" "yes" "$([ -s "$T/lists/ex/domains/telegram.srs.lst" ] && echo yes || echo no)"
check "выразимый набор: сам .srs не кладётся" "no" \
      "$([ -e "$T/lists/ex/telegram.srs" ] || [ -e "$T/lists/ex/domains/telegram.srs" ] && echo yes || echo no)"

# ---- правило с таким списком: spec_set против настоящего движка ----------------------------
SPEC_AG='{"version":2,"outputs":{"direct":{"kind":"direct"},"wg0":{"kind":"interface","device":"wg0"}},"lists":{"ads":{"srs":["'"$AG"'"]}},"rules":[{"name":"Реклама","to":["ads"],"out":"direct","resolve":"fakeip"}]}'
out="$(rpcd spec_set "$(req "$SPEC_AG")")"
check "спека с srs проходит разбор движка" "true" "$(printf '%s' "$out" | jget ok)"
[ "$(printf '%s' "$out" | jget ok)" = true ] || printf '    ответ: %s\n' "$out"

# Файл пропал (уборка, восстановление из архива на чистый роутер) — доскачивается сам.
rm -f "$AG"; : > "$T/curl.log"
out="$(rpcd spec_set "$(req "$SPEC_AG")")"
check "пропавший набор доскачан при сохранении" "true" "$(printf '%s' "$out" | jget ok)"
check "и лёг на место" "yes" "$(cmp -s "$AG" "$T/srv/adguard.srs" && echo yes || echo no)"
check "за ним ходили по ссылке каталога" "1" "$(grep -c "^$U/adguard.srs$" "$T/curl.log")"

# ---- ночное обновление ----------------------------------------------------------------------
: > "$T/curl.log"; : > "$T/steer.log"
nightly
check "ночью: набор тот же — не переписан, apply не звали" "0" "$(grep -c . "$T/steer.log")"
check "ночью: за набором ходили" "1" "$(grep -c "^$U/adguard.srs$" "$T/curl.log")"

# Издатель выпустил новый набор — ложится на место и применяется.
cp "$SRS_FIXTURES/telegram.srs" "$T/srv/adguard.srs"
nightly
check "ночью: новый набор лёг на место" "yes" "$(cmp -s "$AG" "$T/srv/adguard.srs" && echo yes || echo no)"
check "ночью: и правила применены" "1" "$(grep -c '^apply' "$T/steer.log")"
check "ночью: копий .prev не осталось" "" "$(find "$T/lists" -name '*.prev' 2>/dev/null)"

# Скачалось не то — прежний остаётся.
cp "$AG" "$T/ag.before"
printf 'not an srs\n' > "$T/srv/adguard.srs"
nightly
check "ночью: испорченный набор не принят, прежний цел" "yes" "$(cmp -s "$AG" "$T/ag.before" && echo yes || echo no)"
check "ночью: об этом сказано" "yes" "$(grep -q 'adguard.srs' "$T/syslog" 2>/dev/null && echo yes || echo no)"
check "ночью: временных файлов в каталоге списков нет" "adguard.srs" "$(ls "$T/lists/jinndi/domains" | tr '\n' ' ' | sed 's/ $//')"

# ---- удаление -------------------------------------------------------------------------------
out="$(rpcd list_remove '{"id":"jinndi:adguard","kind":"domains"}')"
check "занятый правилом набор не удаляется" "false" "$(printf '%s' "$out" | jget ok)"
check "и лежит на месте" "yes" "$([ -s "$AG" ] && echo yes || echo no)"
printf '{"version":2,"outputs":{"direct":{"kind":"direct"}}}' > "$T/etc/spec.json"
out="$(rpcd list_remove '{"id":"jinndi:adguard","kind":"domains"}')"
check "свободный набор удаляется" "true" "$(printf '%s' "$out" | jget ok)"
check "и с диска ушёл" "no" "$([ -e "$AG" ] && echo yes || echo no)"

printf '\n%d проверок пройдено' "$pass"
if [ "$fail" -gt 0 ]; then printf ', %d ПРОВАЛЕНО\n' "$fail"; exit 1; fi
printf '\nвсе проверки прошли\n'
