#!/bin/sh
# Стенд для files/usr/lib/splify2/fetch.sh — скачивания с обходом закрытого издателя.
#
# ЗАЧЕМ. splify2#15: провайдер закрыл `githubusercontent.com`, и роутер лишился разом
# списков, манифеста и пакетов — а `github.com`, `api.github.com` и `codeload.github.com`
# при этом работают. Обход построен на этом различии, и проверять его надо именно как
# лестницу: важен не факт «скачалось», а КАКИМ путём и в каком порядке. Ошибка в порядке
# стоит дорого в обе стороны: обход впереди прямого адреса — это лишний мегабайт на каждый
# список, а туннель впереди codeload — обход, который не работает на роутере, где выход ещё
# не настроен.
#
# Как устроено. Внешние команды подменены заглушками в PATH, пути — швами (FETCH_STEER,
# FETCH_SPEC, FETCH_CACHE). Сам файл подключается настоящий и целиком.
#
# Запуск: sh tests/fetchmatch.sh (нужен python3 — только для заглушки jsonfilter).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
FETCH="$ROOT/files/usr/lib/splify2/fetch.sh"
T="$(mktemp -d /tmp/fetchmatch.XXXXXX)"
trap 'rm -rf "$T"' EXIT INT TERM

fails=0
check() {  # ОПИСАНИЕ ОЖИДАЕМОЕ ПОЛУЧЕННОЕ
    if [ "$2" = "$3" ]; then
        printf '%-62s ok\n' "$1"
    else
        printf '%-62s ПРОВАЛ\n' "$1"
        printf '    ожидалось: %s\n    получено:  %s\n' "$2" "$3"
        fails=$((fails + 1))
    fi
}

S="$T/state"
mkdir -p "$T/bin" "$S/dns" "$T/cache"

# ---- заглушки ----------------------------------------------------------------------
# curl: отказывает по спискам образцов и протоколирует, с каким флагом семейства и с
# каким заголовком его позвали. Разделение на два списка — суть стенда: `blocked`
# отказывает только БЕЗ `-4`, то есть воспроизводит «напрямую закрыто, через туннель
# открыто»; `blocked-always` закрывает адрес совсем.
cat > "$T/bin/curl" <<'EOF'
#!/bin/sh
out=""; url=""; four=no; hdr=""
while [ $# -gt 0 ]; do
    case "$1" in
        -o) out="$2"; shift 2 ;;
        -H) hdr="$2"; shift 2 ;;
        -4) four=yes; shift ;;
        --connect-timeout|--max-time) shift 2 ;;
        http*) url="$1"; shift ;;
        *) shift ;;
    esac
done
printf '%s four=%s hdr=%s\n' "$url" "$four" "$hdr" >> "$STATE/curl.log"
blocked() {
    [ -f "$1" ] || return 1
    while IFS= read -r pat; do
        [ -n "$pat" ] || continue
        case "$url" in *"$pat"*) return 0 ;; esac
    done < "$1"
    return 1
}
blocked "$STATE/blocked-always" && exit 22
[ "$four" = no ] && blocked "$STATE/blocked" && exit 22
if [ -f "$STATE/serve" ]; then
    while IFS='	' read -r pat src; do
        [ -n "$pat" ] || continue
        case "$url" in *"$pat"*) cp "$src" "$out"; exit 0 ;; esac
    done < "$STATE/serve"
fi
printf 'direct:%s\n' "$url" > "$out"
exit 0
EOF

# nslookup: формат busybox, включая блок сервера сверху — именно его разбор и проверяется.
cat > "$T/bin/nslookup" <<'EOF'
#!/bin/sh
[ -f "$STATE/dns/$1" ] && { cat "$STATE/dns/$1"; exit 0; }
printf 'Server:\t127.0.0.1\nAddress:\t127.0.0.1:53\n\nNon-authoritative answer:\nName:\t%s\nAddress: 203.0.113.10\n' "$1"
EOF

# ip: считает правила, чтобы `ip rule del` кончался отказом — на этом стоит цикл очистки.
cat > "$T/bin/ip" <<'EOF'
#!/bin/sh
echo "$*" >> "$STATE/ip.log"
n=$(cat "$STATE/rules" 2>/dev/null || echo 0)
case "$*" in
    "rule add"*) echo $((n + 1)) > "$STATE/rules"; exit 0 ;;
    "rule del"*) [ "$n" -gt 0 ] || exit 2; echo $((n - 1)) > "$STATE/rules"; exit 0 ;;
esac
exit 0
EOF

cat > "$T/bin/steer" <<'EOF'
#!/bin/sh
case "${1:-}" in
    status)      cat "$STATE/status.json" 2>/dev/null ;;
    outputs)     cat "$STATE/outputs" 2>/dev/null ;;
    vless-nodes) cat "$STATE/nodes.json" 2>/dev/null ;;
esac
exit 0
EOF

cat > "$T/bin/uci" <<'EOF'
#!/bin/sh
key=""
for a in "$@"; do key="$a"; done
f="$STATE/uci.$(echo "$key" | tr '.' '_')"
[ -f "$f" ] || exit 1
cat "$f"
EOF

cat > "$T/bin/jsonfilter" <<'EOF'
#!/bin/sh
src=""; expr=""; mode=stdin
while [ $# -gt 0 ]; do
    case "$1" in
        -i) src="$2"; mode=file; shift 2 ;;
        -s) src="$2"; mode=str; shift 2 ;;
        -e) expr="$2"; shift 2 ;;
        *) shift ;;
    esac
done
# Без -i и -s настоящий jsonfilter читает поток — так его и зовёт fetch.sh
# (`steer status | jsonfilter -e ...`), и заглушка обязана уметь то же.
[ "$mode" = stdin ] && src="$(cat)"
MODE="$mode" python3 - "$src" "$expr" <<'PY'
import json, os, re, sys
src, expr = sys.argv[1], sys.argv[2]
try:
    d = json.load(open(src, encoding='utf-8')) if os.environ['MODE'] == 'file' else json.loads(src)
except Exception:
    sys.exit(1)

def out(v):
    if isinstance(v, bool):
        print('true' if v else 'false')
    elif v is not None:
        print(v)

# Грамматика настоящего jsonfilter: голый шаг — LABEL [A-Za-z_][A-Za-z0-9_]*, имя с дефисом
# или точкой годится только в скобках `['имя']`. Заглушка следует ей, иначе она не увидела бы,
# что имя выхода `wg-home` ломает запрос (I-284).
m = re.fullmatch(r"@\.outputs(?:\.([A-Za-z_]\w*)|\['([^']+)'\])\.(\w+)", expr)
if m:
    o = (d.get('outputs') or {}).get(m.group(1) or m.group(2))
    if isinstance(o, dict) and m.group(3) in o:
        out(o[m.group(3)])
    sys.exit(0)
if expr.startswith('@.outputs.'):
    sys.stderr.write('Syntax error\n')
    sys.exit(1)
if expr == '@.node':
    out(d.get('node'))
    sys.exit(0)
m = re.fullmatch(r'@\.nodes\[@\.index=(\d+)\]\.host', expr)
if m:
    for n in d.get('nodes') or []:
        if n.get('index') == int(m.group(1)):
            out(n.get('host'))
    sys.exit(0)
sys.exit(1)
PY
EOF
chmod +x "$T/bin"/*

# ---- окружение прогона ------------------------------------------------------------
# Живой выход vl: поднят, своя таблица 300. Узел подписки — по имени, как в живом ответе.
cat > "$S/status.json" <<'EOF'
{"schema":1,"outputs":{"direct":{"kind":"direct"},"vl":{"kind":"vless","device":"vl","up":true,"mark":"0x00100000","table":300}},"channels":[]}
EOF
printf 'direct\nvl\n' > "$S/outputs"
cat > "$S/nodes.json" <<'EOF'
{"output":"vl","node":1,"nodes":[{"index":0,"host":"auto.example.net","port":443},{"index":1,"host":"node.example.net","port":443}]}
EOF
printf 'Name:\tnode.example.net\nAddress: 198.51.100.7\n' > "$S/dns/node.example.net"
printf 'Name:\traw.githubusercontent.com\nAddress: 185.199.108.133\nName:\traw.githubusercontent.com\nAddress: 185.199.109.133\n' > "$S/dns/raw.githubusercontent.com"

RAW=https://raw.githubusercontent.com/xyzmean/ru-bypass-ipsets/refs/heads/main/lists/news.lst
REL=https://github.com/splify2/steer/releases/download/v1.2.1/steer-1.2.1-1_x86_64.apk

# Архив ветки для обхода через codeload: настоящий .tar.gz с настоящей раскладкой
# «репозиторий-ветка/путь» — иначе проверялась бы не распаковка, а заглушка.
mkdir -p "$T/tarsrc/ru-bypass-ipsets-main/lists" "$T/tarsrc/steer-dist"
printf 'from-tarball\n' > "$T/tarsrc/ru-bypass-ipsets-main/lists/news.lst"
printf 'PKG-from-tarball\n' > "$T/tarsrc/steer-dist/steer-1.2.1-1_x86_64.apk"
( cd "$T/tarsrc" && tar -czf "$T/lists.tgz" ru-bypass-ipsets-main )
( cd "$T/tarsrc" && tar -czf "$T/dist.tgz" steer-dist )
printf 'from-mirror\n' > "$T/mirror-body"
printf 'PKG-from-mirror\n' > "$T/mirror-pkg"
printf 'from-api\n' > "$T/api-body"
printf 'PKG-from-api\n' > "$T/api-pkg"

reset() {
    rm -f "$S/curl.log" "$S/ip.log" "$S/rules" "$S/blocked" "$S/blocked-always" \
          "$S/serve" "$S/uci.splify2_main_fetch_via_tunnel"
    rm -rf "$T/cache"; mkdir -p "$T/cache"
    : > "$S/curl.log"; : > "$S/ip.log"
}

# Прогон: печатает «RC=<код> NOTE=<строка>» и оставляет скачанное в $T/got.
run() {  # URL...
    rm -f "$T/got" "$T/got2"
    env PATH="$T/bin:$PATH" STATE="$S" \
        FETCH_STEER="$T/bin/steer" FETCH_SPEC="$S/spec.json" \
        FETCH_CACHE="$T/cache" FETCH_CONNECT_TIMEOUT=1 FETCH_TIMEOUT=5 \
        sh -c '
            . "$1"
            shift
            i=0
            for u in "$@"; do
                i=$((i + 1))
                d="$OUT"; [ "$i" = 2 ] && d="$OUT2"
                if download "$u" "$d"; then printf "RC%s=0\n" "$i"; else printf "RC%s=1\n" "$i"; fi
                printf "NOTE%s=%s\n" "$i" "$FETCH_NOTE"
            done
        ' _ "$FETCH" "$@"
}

OUT="$T/got"; OUT2="$T/got2"
export OUT OUT2

# ---- 1. прямой путь ----------------------------------------------------------------
reset
res="$(run "$RAW")"
check "открытый издатель: скачано напрямую" "direct:$RAW" "$(cat "$T/got" 2>/dev/null)"
check "прямой путь ничего не объясняет — обхода не было" "NOTE1=" "$(echo "$res" | grep '^NOTE1=')"
check "прямой путь не трогает маршруты" "" "$(grep -c . "$S/ip.log" | sed 's/^0$//')"
check "обходных запросов не было вовсе" "1" "$(grep -c . "$S/curl.log")"

# ---- 2. закрыт githubusercontent: первым выручает зеркало ---------------------------
# Репозитории зеркалятся на GitLab тем же путём, и это самый дешёвый обход: сырой файл GitLab
# отдаёт со СВОЕГО домена — без отдельного хоста под содержимое, без заголовка и без счётчика
# запросов. Поэтому зеркало проверяется на месте: первым среди обходов, а не «где-нибудь».
reset
printf 'githubusercontent.com\n' > "$S/blocked-always"
printf 'gitlab.com\t%s\n' "$T/mirror-body" > "$S/serve"
res="$(run "$RAW")"
check "закрытый издатель: файл взят с зеркала" "from-mirror" "$(cat "$T/got" 2>/dev/null)"
check "адрес зеркала собран из того же владельца, репозитория, ветки и пути" \
      "https://gitlab.com/xyzmean/ru-bypass-ipsets/-/raw/main/lists/news.lst" \
      "$(grep -o 'https://gitlab.com[^ ]*' "$S/curl.log" | head -1)"
check "зеркало названо человеку" "yes" \
      "$(echo "$res" | grep -q 'NOTE1=.*зеркала gitlab.com' && echo yes || echo no)"
check "до хостов GitHub дело не дошло" "" \
      "$(grep -c 'api.github.com\|codeload' "$S/curl.log" | sed 's/^0$//')"
check "заголовок сырого содержимого зеркалу не нужен" "" \
      "$(grep 'gitlab.com' "$S/curl.log" | grep -c 'hdr=Accept' | sed 's/^0$//')"

# Ссылка релиза уходит на зеркало в ту же ветку dist.
reset
printf 'githubusercontent.com\nreleases/download\n' > "$S/blocked-always"
printf 'gitlab.com\t%s\n' "$T/mirror-pkg" > "$S/serve"
res="$(run "$REL")"
check "пакет релиза взят с зеркала из ветки dist" "PKG-from-mirror" "$(cat "$T/got" 2>/dev/null)"
check "и адрес у него тот же по форме" \
      "https://gitlab.com/xyzmean/steer/-/raw/dist/steer-1.2.1-1_x86_64.apk" \
      "$(grep -o 'https://gitlab.com[^ ]*' "$S/curl.log" | head -1)"

# ---- 2. закрыт githubusercontent: выручает contents API ----------------------------
reset
printf 'githubusercontent.com\ngitlab.com\n' > "$S/blocked-always"
printf 'api.github.com\t%s\n' "$T/api-body" > "$S/serve"
res="$(run "$RAW")"
check "закрытый издатель: файл взят через api.github.com" "from-api" "$(cat "$T/got" 2>/dev/null)"
check "путь назван человеку" "yes" \
      "$(echo "$res" | grep -q 'NOTE1=.*api.github.com' && echo yes || echo no)"
check "адрес API собран с ветки и пути" \
      "https://api.github.com/repos/xyzmean/ru-bypass-ipsets/contents/lists/news.lst?ref=main" \
      "$(grep -o 'https://api.github.com[^ ]*' "$S/curl.log" | head -1)"
check "у запроса к API стоит заголовок сырого содержимого" "yes" \
      "$(grep -q 'hdr=Accept: application/vnd.github.raw' "$S/curl.log" && echo yes || echo no)"
check "туннель не понадобился — маршруты не тронуты" "" \
      "$(grep -c . "$S/ip.log" | sed 's/^0$//')"

# ---- 3. API отказал (403 за CGNAT): выручает архив ветки ---------------------------
reset
printf 'githubusercontent.com\ngitlab.com\napi.github.com\n' > "$S/blocked-always"
printf 'codeload.github.com\t%s\n' "$T/lists.tgz" > "$S/serve"
res="$(run "$RAW")"
check "API молчит: файл вынут из архива ветки" "from-tarball" "$(cat "$T/got" 2>/dev/null)"
check "архив запрошен у codeload по имени ветки" \
      "https://codeload.github.com/xyzmean/ru-bypass-ipsets/tar.gz/refs/heads/main" \
      "$(grep -o 'https://codeload[^ ]*' "$S/curl.log" | head -1)"
check "путь назван человеку" "yes" \
      "$(echo "$res" | grep -q 'NOTE1=.*codeload' && echo yes || echo no)"

# ---- 4. второй файл того же прогона не ждёт отказа заново --------------------------
reset
printf 'githubusercontent.com\ngitlab.com\n' > "$S/blocked-always"
printf 'api.github.com\t%s\n' "$T/api-body" > "$S/serve"
res="$(run "$RAW" "${RAW%news.lst}hodca.lst")"
check "второй файл тоже приехал" "from-api" "$(cat "$T/got2" 2>/dev/null)"
check "к закрытому издателю второй раз не ходили" "1" \
      "$(grep -c 'raw.githubusercontent.com' "$S/curl.log")"

# ---- 5. ссылка релиза: тот же файл ищется в ветке dist ----------------------------
reset
# Прямая ссылка релиза закрыта не своим именем, а перенаправлением на
# release-assets.githubusercontent.com — заглушка не ходит по перенаправлениям, поэтому
# закрывается сам путь релиза.
printf 'githubusercontent.com\nreleases/download\ngitlab.com\n' > "$S/blocked-always"
printf 'api.github.com\t%s\n' "$T/api-pkg" > "$S/serve"
res="$(run "$REL")"
check "пакет релиза взят из ветки dist" "PKG-from-api" "$(cat "$T/got" 2>/dev/null)"
check "имя файла и ветка подставлены верно" \
      "https://api.github.com/repos/splify2/steer/contents/steer-1.2.1-1_x86_64.apk?ref=dist" \
      "$(grep -o 'https://api.github.com[^ ]*' "$S/curl.log" | head -1)"

reset
printf 'githubusercontent.com\nreleases/download\ngitlab.com\napi.github.com\n' > "$S/blocked-always"
printf 'codeload.github.com\t%s\n' "$T/dist.tgz" > "$S/serve"
res="$(run "$REL")"
check "пакет вынут и из архива ветки dist" "PKG-from-tarball" "$(cat "$T/got" 2>/dev/null)"

# ---- 6. закрыт весь GitHub: выручает включённый туннель ----------------------------
# Туннель трогается ТОЛЬКО когда человек его включил: состояния «сами решим, если не вышло»
# больше нет — владелец забраковал его дважды.
reset
echo always > "$S/uci.splify2_main_fetch_via_tunnel"
printf 'api.github.com\ncodeload.github.com\ngitlab.com\n' > "$S/blocked-always"
printf 'githubusercontent.com\n' > "$S/blocked"
res="$(run "$RAW")"
check "закрыт весь GitHub: скачано через туннель" "direct:$RAW" "$(cat "$T/got" 2>/dev/null)"
check "правило добавлено на оба адреса издателя" "2" \
      "$(grep -c '^rule add to 185.199.10' "$S/ip.log")"
check "правило ведёт в таблицу выхода" "yes" \
      "$(grep -q 'rule add to 185.199.108.133 uidrange 0-0 lookup 300 pref 30000' "$S/ip.log" && echo yes || echo no)"
# Правило по адресу назначения действует на весь трафик к нему, включая чужой через роутер.
# Условие по владельцу оставляет в нём только наши собственные запросы: у пересылаемого
# пакета сокета нет, и владельца у него нет тоже.
check "устройств сети правило не касается" "2" \
      "$(grep -c 'uidrange 0-0' "$S/ip.log")"
check "после скачивания правил не осталось" "0" "$(cat "$S/rules" 2>/dev/null || echo 0)"
check "повтор шёл только по IPv4" "yes" \
      "$(grep 'githubusercontent' "$S/curl.log" | tail -1 | grep -q 'four=yes' && echo yes || echo no)"
check "выход назван человеку" "yes" \
      "$(echo "$res" | grep -q 'NOTE1=.*выход vl' && echo yes || echo no)"

# ---- 7. отказы обхода через туннель ------------------------------------------------
# Поднятого выхода нет: `up` снят, и таблицы у выхода нет.
reset
echo always > "$S/uci.splify2_main_fetch_via_tunnel"
printf 'api.github.com\ncodeload.github.com\ngitlab.com\n' > "$S/blocked-always"
printf 'githubusercontent.com\n' > "$S/blocked"
cat > "$S/status.json" <<'EOF'
{"schema":1,"outputs":{"direct":{"kind":"direct"},"vl":{"kind":"vless","device":"vl","up":false,"table":300}},"channels":[]}
EOF
res="$(run "$RAW")"
check "выход не поднят: отказ, а не молчание" "RC1=1" "$(echo "$res" | grep '^RC1=')"
check "сказано, что поднятого выхода нет" "yes" \
      "$(echo "$res" | grep -q 'NOTE1=.*поднятого выхода' && echo yes || echo no)"
check "маршруты не тронуты" "" "$(grep -c . "$S/ip.log" | sed 's/^0$//')"
cat > "$S/status.json" <<'EOF'
{"schema":1,"outputs":{"direct":{"kind":"direct"},"vl":{"kind":"vless","device":"vl","up":true,"mark":"0x00100000","table":300}},"channels":[]}
EOF

# Издатель живёт на адресе узла подписки — увести это в туннель значит закольцевать движок.
reset
echo always > "$S/uci.splify2_main_fetch_via_tunnel"
printf 'api.github.com\ncodeload.github.com\ngitlab.com\n' > "$S/blocked-always"
printf 'githubusercontent.com\n' > "$S/blocked"
printf 'Name:\traw.githubusercontent.com\nAddress: 198.51.100.7\n' > "$S/dns/raw.githubusercontent.com"
res="$(run "$RAW")"
check "адрес издателя совпал с узлом: повтора нет" "RC1=1" "$(echo "$res" | grep '^RC1=')"
check "петля названа причиной" "yes" \
      "$(echo "$res" | grep -q 'NOTE1=.*петл' && echo yes || echo no)"
check "правил при этом не добавлено" "" "$(grep -c '^rule add' "$S/ip.log" | sed 's/^0$//')"

# fake-IP: адрес выдан нашим же резолвером, обратного перевода для роутера нет.
reset
echo always > "$S/uci.splify2_main_fetch_via_tunnel"
printf 'api.github.com\ncodeload.github.com\ngitlab.com\n' > "$S/blocked-always"
printf 'githubusercontent.com\n' > "$S/blocked"
printf 'Name:\traw.githubusercontent.com\nAddress: 198.18.0.5\n' > "$S/dns/raw.githubusercontent.com"
res="$(run "$RAW")"
check "fake-IP не уводится в туннель" "RC1=1" "$(echo "$res" | grep '^RC1=')"
check "fake-IP назван причиной" "yes" \
      "$(echo "$res" | grep -q 'NOTE1=.*fake-IP' && echo yes || echo no)"
printf 'Name:\traw.githubusercontent.com\nAddress: 185.199.108.133\nName:\traw.githubusercontent.com\nAddress: 185.199.109.133\n' > "$S/dns/raw.githubusercontent.com"

# Выключено через uci — обход не делается, и об этом сказано.
reset
printf 'api.github.com\ncodeload.github.com\ngitlab.com\n' > "$S/blocked-always"
printf 'githubusercontent.com\n' > "$S/blocked"
echo 0 > "$S/uci.splify2_main_fetch_via_tunnel"
res="$(run "$RAW")"
check "выключенный туннель не трогается" "RC1=1" "$(echo "$res" | grep '^RC1=')"
check "выключение названо словами" "yes" \
      "$(echo "$res" | grep -q 'NOTE1=.*туннель выключен' && echo yes || echo no)"
check "правил не добавлено" "" "$(grep -c '^rule add' "$S/ip.log" | sed 's/^0$//')"

# ---- 7b. включённый переключатель: туннель первым ----------------------------------
# Выбор человека, у которого GitHub закрыт насовсем. Смысл в порядке: по своему прямому
# адресу файл едет одним запросом, тогда как обход по хостам GitHub — это лишний запрос, а в
# худшем случае архив ветки целиком ради одного списка.
reset
echo always > "$S/uci.splify2_main_fetch_via_tunnel"
res="$(run "$RAW")"
check "always: скачано через туннель, хотя издатель доступен" "direct:$RAW" "$(cat "$T/got" 2>/dev/null)"
check "always: запрос был ровно один и по IPv4" "1;yes" \
      "$(grep -c . "$S/curl.log");$(grep -q 'four=yes' "$S/curl.log" && echo yes || echo no)"
check "always: обход по хостам GitHub не понадобился" "" \
      "$(grep -c 'api.github.com\|codeload' "$S/curl.log" | sed 's/^0$//')"
check "включено: назван выход, через который пошло" "yes" \
      "$(echo "$res" | grep -q 'NOTE1=.*через выход vl' && echo yes || echo no)"
check "always: правило снято" "0" "$(cat "$S/rules" 2>/dev/null || echo 0)"

# Туннеля нет — режим не должен превращаться в отказ: прямой путь по-прежнему работает.
reset
echo always > "$S/uci.splify2_main_fetch_via_tunnel"
cat > "$S/status.json" <<'EOF'
{"schema":1,"outputs":{"direct":{"kind":"direct"},"vl":{"kind":"vless","device":"vl","up":false,"table":300}},"channels":[]}
EOF
res="$(run "$RAW")"
check "always без поднятого выхода: остаётся прямой путь" "direct:$RAW" "$(cat "$T/got" 2>/dev/null)"
check "always без выхода: маршруты не тронуты" "" "$(grep -c . "$S/ip.log" | sed 's/^0$//')"
# Журнал на удачной загрузке не пишет «не ответил» (I-330): туннель отказал, но прямой путь
# отдал файл, и прежняя причина отказа туннеля («напрямую не ответил…») оставалась в FETCH_NOTE —
# update-lists и сохранение спеки печатали её предупреждением к скачанному списку.
check "always без выхода: удачный прямой путь не жалуется на отказ" "NOTE1=" \
      "$(echo "$res" | grep '^NOTE1=')"
cat > "$S/status.json" <<'EOF'
{"schema":1,"outputs":{"direct":{"kind":"direct"},"vl":{"kind":"vless","device":"vl","up":true,"mark":"0x00100000","table":300}},"channels":[]}
EOF

# Тот же адрес и тот же режим, но издатель закрыт и через провайдера, и в туннеле:
# второго захода в туннель быть не должно — он стоит ещё одного разрешения имени.
reset
echo always > "$S/uci.splify2_main_fetch_via_tunnel"
printf 'githubusercontent.com\ngitlab.com\n' > "$S/blocked-always"
printf 'api.github.com\t%s\n' "$T/api-body" > "$S/serve"
res="$(run "$RAW")"
check "включено: не вышло туннелем — выручает обход по GitHub" "from-api" "$(cat "$T/got" 2>/dev/null)"
check "включено: в туннель второй раз не ходили" "1" \
      "$(grep -c 'githubusercontent.com.*four=yes' "$S/curl.log")"

# ---- 7в. без полного iproute2 в туннель не идём ------------------------------------
# Условие по владельцу (uidrange) понимает только ip-full; busybox отвечает отказом. Без него
# правило увело бы в туннель и трафик устройств сети — тогда лучше не идти туннелем вовсе и
# сказать, чего не хватает.
reset
echo always > "$S/uci.splify2_main_fetch_via_tunnel"
printf 'api.github.com\ncodeload.github.com\ngitlab.com\n' > "$S/blocked-always"
printf 'githubusercontent.com\n' > "$S/blocked"
cat > "$T/bin/ip" <<'EOF'
#!/bin/sh
echo "$*" >> "$STATE/ip.log"
case "$*" in
    *uidrange*) echo "ip: invalid argument 'uidrange' to 'ip'" >&2; exit 1 ;;
esac
n=$(cat "$STATE/rules" 2>/dev/null || echo 0)
case "$*" in
    "rule add"*) echo $((n + 1)) > "$STATE/rules"; exit 0 ;;
    "rule del"*) [ "$n" -gt 0 ] || exit 2; echo $((n - 1)) > "$STATE/rules"; exit 0 ;;
esac
exit 0
EOF
chmod +x "$T/bin/ip"
res="$(run "$RAW")"
check "без ip-full туннелем не идём" "RC1=1" "$(echo "$res" | grep '^RC1=')"
check "и сказано, чего не хватает" "yes" \
      "$(echo "$res" | grep -q 'NOTE1=.*ip-full' && echo yes || echo no)"
check "правил при этом не осталось" "0" "$(cat "$S/rules" 2>/dev/null || echo 0)"
# Возвращаем обычную заглушку ip.
cat > "$T/bin/ip" <<'EOF'
#!/bin/sh
echo "$*" >> "$STATE/ip.log"
n=$(cat "$STATE/rules" 2>/dev/null || echo 0)
case "$*" in
    "rule add"*) echo $((n + 1)) > "$STATE/rules"; exit 0 ;;
    "rule del"*) [ "$n" -gt 0 ] || exit 2; echo $((n - 1)) > "$STATE/rules"; exit 0 ;;
esac
exit 0
EOF
chmod +x "$T/bin/ip"

# ---- 8. правила снимаются и когда повтор не удался ---------------------------------
reset
echo always > "$S/uci.splify2_main_fetch_via_tunnel"
printf 'api.github.com\ncodeload.github.com\ngithubusercontent.com\ngitlab.com\n' > "$S/blocked-always"
res="$(run "$RAW")"
check "нечем спастись: отказ" "RC1=1" "$(echo "$res" | grep '^RC1=')"
check "правило добавлялось" "yes" \
      "$(grep -q '^rule add' "$S/ip.log" && echo yes || echo no)"
check "и всё равно снято" "0" "$(cat "$S/rules" 2>/dev/null || echo 0)"

# ---- 9. незнакомый адрес обходить нечем, но туннель работает -----------------------
reset
echo always > "$S/uci.splify2_main_fetch_via_tunnel"
printf 'files.example.org\n' > "$S/blocked"
res="$(run "https://files.example.org/my.lst")"
check "чужой хост: обхода по GitHub нет, помог туннель" "direct:https://files.example.org/my.lst" \
      "$(cat "$T/got" 2>/dev/null)"
check "к api.github.com за чужим файлом не ходили" "" \
      "$(grep -c 'api.github.com' "$S/curl.log" | sed 's/^0$//')"

# ---- 9b. файл выпуска по адресам из version.json ------------------------------------
# Перечень выпусков splify2/releases называет для файла адреса по порядку (выпуск в
# splify2/releases, потом исходный выпуск проекта) и sha256. download_rel идёт по ним, сверяя
# сумму, и только потом — прежней лестницей по запасному адресу (прямая ссылка, зеркало, хосты
# GitHub, ветка dist).
REL1=https://github.com/splify2/releases/releases/download/steer-v1.2.1/steer-1.2.1-1_x86_64.apk
sum() { printf '%s\n' "$1" | sha256sum | cut -d' ' -f1; }
runrel() {  # ЗАПАСНОЙ_URL SHA256 [URL...]
    rm -f "$T/got"
    env PATH="${RELPATH:-$T/bin:$PATH}" STATE="$S" \
        FETCH_STEER="$T/bin/steer" FETCH_SPEC="$S/spec.json" \
        FETCH_CACHE="$T/cache" FETCH_CONNECT_TIMEOUT=1 FETCH_TIMEOUT=5 \
        sh -c '
            . "$1"; fb="$2"; sm="$3"; shift 3
            if download_rel "$OUT" "$sm" "$fb" "$@"; then echo RC=0; else echo RC=1; fi
            printf "NOTE=%s\n" "$FETCH_NOTE"
        ' _ "$FETCH" "$@"
}

reset
res="$(runrel "$REL" "$(sum "direct:$REL1")" "$REL1" "$REL")"
check "version.json: файл взят с первого адреса" "direct:$REL1" "$(cat "$T/got" 2>/dev/null)"
check "version.json: запрос был один — сумма сошлась" "1" "$(grep -c . "$S/curl.log")"
check "version.json: удачный первый адрес ничего не объясняет" "NOTE=" "$(echo "$res" | grep '^NOTE=')"

reset
res="$(runrel "$REL" "$(sum "direct:$REL")" "$REL1" "$REL")"
check "сумма первого не сошлась — взят второй адрес" "direct:$REL" "$(cat "$T/got" 2>/dev/null)"
check "несовпадение суммы названо" "yes" \
      "$(echo "$res" | grep -q 'NOTE=.*контрольная сумма' && echo yes || echo no)"

reset
printf 'githubusercontent.com\nreleases/download\n' > "$S/blocked-always"
printf 'gitlab.com\t%s\n' "$T/mirror-pkg" > "$S/serve"
res="$(runrel "$REL" "$(sum PKG-from-mirror)" "$REL1" "$REL")"
check "адреса version.json закрыты — прежняя лестница: зеркало, ветка dist" "PKG-from-mirror" \
      "$(cat "$T/got" 2>/dev/null)"
check "запасной адрес был в version.json — напрямую его второй раз не спрашивали" "1" \
      "$(grep -c "^$REL " "$S/curl.log")"
check "оба адреса version.json спрошены по порядку" "$REL1;$REL" \
      "$(grep -o '^https://github.com[^ ]*' "$S/curl.log" | head -2 | tr '\n' ';' | sed 's/;$//')"

reset
printf 'gitlab.com\t%s\n' "$T/mirror-pkg" > "$S/serve"
printf 'releases/download\n' > "$S/blocked-always"
res="$(runrel "$REL" "$(sum другое)" "$REL1" "$REL")"
check "сумма не сошлась нигде — отказ" "RC=1" "$(echo "$res" | grep '^RC=')"
check "и файла нет" "no" "$([ -e "$T/got" ] && echo yes || echo no)"
check "причина названа" "yes" "$(echo "$res" | grep -q 'NOTE=.*контрольная сумма' && echo yes || echo no)"

# Запасной адрес не из version.json (версии там нет) — его прямой заход обязателен.
reset
res="$(runrel "$REL" "")"
check "адресов нет — прежний путь целиком, с прямым заходом" "direct:$REL" "$(cat "$T/got" 2>/dev/null)"

# Включённый туннель — и адреса version.json идут через него первым.
reset
echo always > "$S/uci.splify2_main_fetch_via_tunnel"
printf 'Name:\tgithub.com\nAddress: 140.82.121.4\n' > "$S/dns/github.com"
res="$(runrel "$REL" "$(sum "direct:$REL1")" "$REL1" "$REL")"
check "туннель включён: первый адрес version.json — через туннель" "yes" \
      "$(head -1 "$S/curl.log" | grep -q "^$REL1 four=yes" && echo yes || echo no)"
check "через туннель и взят" "direct:$REL1" "$(cat "$T/got" 2>/dev/null)"

# Без sha256sum на роутере сверять нечем — файл принимается с первого адреса.
mkdir -p "$T/nosha"
for f in /usr/bin/* /bin/*; do
    case "${f##*/}" in sha256sum) continue ;; esac
    [ -e "$T/nosha/${f##*/}" ] || ln -s "$f" "$T/nosha/${f##*/}" 2>/dev/null
done
reset
res="$(RELPATH="$T/bin:$T/nosha" runrel "$REL" "$(sum другое)" "$REL1" "$REL")"
check "без sha256sum файл берётся без сверки" "direct:$REL1" "$(cat "$T/got" 2>/dev/null)"

# ---- 10. разбор адресов ------------------------------------------------------------
parts() {
    env PATH="$T/bin:$PATH" STATE="$S" sh -c '. "$1"; fetch_gh_parts "$2" || echo НЕ_РАЗОБРАН' _ "$FETCH" "$1"
}
check "raw с refs/heads" "xyzmean/r main lists/a.lst" \
      "$(parts https://raw.githubusercontent.com/xyzmean/r/refs/heads/main/lists/a.lst)"
check "raw без refs/heads" "xyzmean/r main lists/a.lst" \
      "$(parts https://raw.githubusercontent.com/xyzmean/r/main/lists/a.lst)"
check "ссылка релиза сводится к ветке dist" "splify2/steer dist p.apk" \
      "$(parts https://github.com/splify2/steer/releases/download/v1.0.0/p.apk)"
# Адрес манифеста по умолчанию — `releases/latest/download/`: без этой формы у каталога
# списков не было ни одного обходного пути, и там, где githubusercontent закрыт, манифест
# не обновлялся вовсе (а на свежем роутере каталога не было).
check "ссылка latest-релиза сводится к ветке dist" "splify2/splify2-lists dist lists.json" \
      "$(parts https://github.com/splify2/splify2-lists/releases/latest/download/lists.json)"
check "raw без пути к файлу не разбирается" "НЕ_РАЗОБРАН" \
      "$(parts https://raw.githubusercontent.com/xyzmean/r/main)"
check "чужой адрес не разбирается" "НЕ_РАЗОБРАН" "$(parts https://example.org/a.lst)"

# ---- 11. выходы, через которые можно повторить ------------------------------------
# fetch_outs — общий перечень: скачивание через туннель берёт из него первый выход с таблицей
# (fetch_out), а отклик для счётчика на сайте (splify2-ping) — выходы с устройством по очереди.
outs_run() {  # ПОЛЕ [СКОЛЬКО] — печатает перечень и «RC=код»
    env PATH="$T/bin:$PATH" STATE="$S" FETCH_STEER="$T/bin/steer" FETCH_SPEC="$S/spec.json" \
        sh -c '. "$1"; shift; fetch_outs "$@"; echo "RC=$?"' _ "$FETCH" "$@"
}
out1_run() {
    env PATH="$T/bin:$PATH" STATE="$S" FETCH_STEER="$T/bin/steer" FETCH_SPEC="$S/spec.json" \
        sh -c '. "$1"; fetch_out; echo "RC=$?"' _ "$FETCH"
}
cat > "$S/status.json" <<'EOF'
{"schema":1,"outputs":{"direct":{"kind":"direct"},
 "down1":{"kind":"vless","device":"d1","up":false,"table":300},
 "vl":{"kind":"vless","device":"vl","up":true,"table":301},
 "wg-home":{"kind":"interface","device":"wg0","up":true,"table":302},
 "notable":{"kind":"vless","device":"nt0","up":true},
 "nodev":{"kind":"vless","up":true,"table":303},
 "badev":{"kind":"vless","device":"a b","up":true,"table":304},
 "h2":{"kind":"hysteria2","device":"h2","up":true,"table":305}},"channels":[]}
EOF
printf 'direct\ndown1\nvl\nwg-home\nnotable\nnodev\nbadev\nh2\nbad name\n' > "$S/outputs"
check "fetch_outs: поднятые со своей таблицей, по порядку" "vl 301;wg-home 302;nodev 303;badev 304;h2 305;RC=0" \
      "$(outs_run table | tr '\n' ';' | sed 's/;$//')"
check "fetch_outs без поля — таблица, как раньше" "vl 301;wg-home 302;nodev 303;badev 304;h2 305;RC=0" \
      "$(outs_run | tr '\n' ';' | sed 's/;$//')"
check "fetch_outs device: поднятые со своим устройством" "vl vl;wg-home wg0;notable nt0;h2 h2;RC=0" \
      "$(outs_run device | tr '\n' ';' | sed 's/;$//')"
check "fetch_outs device 2: не больше двух" "vl vl;wg-home wg0;RC=0" \
      "$(outs_run device 2 | tr '\n' ';' | sed 's/;$//')"
check "fetch_out — первый с таблицей, как до перечня" "vl 301;RC=0" \
      "$(out1_run | tr '\n' ';' | sed 's/;$//')"
check "fetch_outs: неизвестное поле — отказ" "RC=1" "$(outs_run mark | tr '\n' ';' | sed 's/;$//')"
printf '{"schema":1,"outputs":{"direct":{"kind":"direct"},"d":{"kind":"vless","device":"d","up":false,"table":300}},"channels":[]}\n' > "$S/status.json"
printf 'direct\nd\n' > "$S/outputs"
check "fetch_outs: поднятых нет — отказ без строк" "RC=1" "$(outs_run device | tr '\n' ';' | sed 's/;$//')"
check "fetch_out: поднятых нет — отказ" "RC=1" "$(out1_run | tr '\n' ';' | sed 's/;$//')"
: > "$S/status.json"
check "fetch_outs: ядро не отвечает — отказ" "RC=1" "$(outs_run device | tr '\n' ';' | sed 's/;$//')"
cat > "$S/status.json" <<'EOF'
{"schema":1,"outputs":{"direct":{"kind":"direct"},"vl":{"kind":"vless","device":"vl","up":true,"mark":"0x00100000","table":300}},"channels":[]}
EOF
printf 'direct\nvl\n' > "$S/outputs"

printf '\n%s\n' "$([ "$fails" -eq 0 ] && echo 'все проверки прошли' || echo "ЕСТЬ ПРОВАЛЫ: $fails")"
[ "$fails" -eq 0 ]
