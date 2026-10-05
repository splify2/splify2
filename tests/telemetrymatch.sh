#!/bin/sh
# Отклик для счётчика роутеров на splify2.github.io: команда splify2-ping, её расписание и
# объект rpcd. Описание — docs/TELEMETRY.md.
#
# Главный вопрос стенда — «не уехало ли лишнее»: тело запроса обязано быть РОВНО
# `{"v":1,"id":"sp-…"}` и, когда известен публичный адрес роутера, ещё `"ip"` — без других
# ключей, заголовков с секретами и прочих полей. Дальше — откуда берётся этот адрес (netifd,
# а у частного адреса — ответ нашего же сервера по внешнему устройству), лестница путей
# (напрямую по внешнему устройству → поднятые выходы ядра по очереди → обычный путь), 23 часа
# между откликами, ответы сайта (204/400/429/503/сеть), выключенный учёт и отправка через
# uclient-fetch, когда curl нет. Сеть не нужна: curl и uclient-fetch подменены, данные netifd и
# состояние выходов — файлы.
#
# Запуск: sh tests/telemetrymatch.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 2

pass=0 fail=0
check() {
    if [ "$2" = "$3" ]; then pass=$((pass + 1)); else
        fail=$((fail + 1))
        printf 'FAIL %s\n  ожидалось: %s\n  получено:  %s\n' "$1" "$2" "$3"
    fi
}
T="$(mktemp -d /tmp/telemetrymatch.XXXXXX)"
trap 'rm -rf "$T"' EXIT INT TERM
mkdir -p "$T/bin" "$T/etc"

ID=sp-0123456789abcdef0123456789abcdef
ID2=sp-fedcba9876543210fedcba9876543210
URL_DEF=https://dns.yo1nk.app/api/ping

# ---- песочница ------------------------------------------------------------------------
cat > "$T/bin/uci" <<EOF
#!/bin/sh
db="$T/uci.db"
case "\$1" in -q) shift ;; esac
case "\$1" in
    get)    v="\$(sed -n "s|^\$2=||p" "\$db" 2>/dev/null | tail -n1)"
            [ -n "\$v" ] || exit 1
            printf '%s\n' "\$v" ;;
    set)    k="\${2%%=*}"; sed -i "\\|^\$k=|d" "\$db" 2>/dev/null; printf '%s\n' "\$2" >> "\$db" ;;
    delete) sed -i "\\|^\$2=|d" "\$db" 2>/dev/null ;;
    commit) : ;;
    *) exit 1 ;;
esac
EOF
# Ядро: `steer dev-id` печатает tid. Сколько раз его звали — в файле: счёт дорогой, и после
# первого раза идентификатор обязан браться из настройки. `status` и `outputs` — состояние
# выходов (их читает fetch.sh при обходе путей); в счёт dev-id они не входят.
cat > "$T/bin/steer" <<EOF
#!/bin/sh
case "\$1" in
    dev-id)  echo x >> "$T/steer.calls"
             printf '{"tid":"%s"}\n' "\$(cat "$T/steer.tid" 2>/dev/null)" ;;
    status)  cat "$T/steer.status" 2>/dev/null ;;
    outputs) cat "$T/steer.outputs" 2>/dev/null ;;
    *) exit 1 ;;
esac
EOF
# curl: аргументы — по одному в строке (последний вызов — в curl.argv), каждый вызов — строкой в
# curl.log: `GET`/`POST`, устройство (`--interface`, «-» — без привязки), адрес и тело. Ответ:
# спрос адреса (GET) — тело из echo.body, отказ — выходом echo.rc; отклик (POST) — код из файла
# `code@<устройство>` (`code@plain` — без привязки), а нет такого — из общего `code`.
{ printf '#!/bin/sh\nT=%s\n' "$T"; cat <<'EOF'
: > "$T/curl.argv"
for a in "$@"; do printf '%s\n' "$a" >> "$T/curl.argv"; done
echo x >> "$T/curl.calls"
iface=-; body=; url=; post=no
while [ $# -gt 0 ]; do
    case "$1" in
        --interface) iface="$2"; shift 2 ;;
        --data-binary) post=yes; body="$2"; shift 2 ;;
        --connect-timeout|--max-time|-H|-o|-w) shift 2 ;;
        http*) url="$1"; shift ;;
        *) shift ;;
    esac
done
if [ "$post" = no ]; then
    printf 'GET iface=%s url=%s\n' "$iface" "$url" >> "$T/curl.log"
    rc="$(cat "$T/echo.rc" 2>/dev/null || echo 0)"
    [ "$rc" = 0 ] || exit "$rc"
    cat "$T/echo.body" 2>/dev/null
    exit 0
fi
printf 'POST iface=%s url=%s body=%s\n' "$iface" "$url" "$body" >> "$T/curl.log"
if [ "$iface" = - ]; then f="$T/code@plain"; else f="$T/code@$iface"; fi
[ -f "$f" ] || f="$T/code"
c="$(cat "$f")"
printf '%s' "$c"
[ "$c" = 000 ] && exit 7
exit 0
EOF
} > "$T/bin/curl"
# uclient-fetch: кода не печатает; 200/204 — выход 0, прочее — «HTTP error N» в stderr.
cat > "$T/bin/uclient-fetch" <<EOF
#!/bin/sh
: > "$T/fetch.argv"
for a in "\$@"; do printf '%s\n' "\$a" >> "$T/fetch.argv"; done
echo x >> "$T/fetch.calls"
c="\$(cat "$T/code")"
echo "Downloading '\$*'" >&2
case "\$c" in
    200|204) exit 0 ;;
    000) echo "Connection error: Connection refused" >&2; exit 4 ;;
    *) echo "HTTP error \$c" >&2; exit 8 ;;
esac
EOF
# ip: отклик маршрутов не трогает; заглушка нужна, чтобы это можно было проверить (и чтобы
# случайный вызов не дошёл до настоящего ip машины разработчика).
printf '#!/bin/sh\necho "$*" >> "%s"\nexit 0\n' "$T/ip.log" > "$T/bin/ip"
chmod +x "$T/bin/ip"
# Журнал: что роутер написал в syslog (по строке на вызов).
printf '#!/bin/sh\nprintf "%%s\\n" "$*" >> "%s"\n' "$T/logger.log" > "$T/bin/logger"
# jsonfilter: ровно те выражения, которыми fetch.sh читает ответ `steer status` — состояние,
# таблицу и устройство выхода. Настоящего jsonfilter на машине разработчика нет.
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
[ "$mode" = stdin ] && src="$(cat)"
MODE="$mode" python3 - "$src" "$expr" <<'PY'
import json, os, re, sys
src, expr = sys.argv[1], sys.argv[2]
try:
    d = json.load(open(src, encoding='utf-8')) if os.environ['MODE'] == 'file' else json.loads(src)
except Exception:
    sys.exit(1)
m = re.fullmatch(r"@\.outputs\['([^']+)'\]\.(\w+)", expr)
if m:
    o = (d.get('outputs') or {}).get(m.group(1))
    if isinstance(o, dict) and m.group(2) in o:
        v = o[m.group(2)]
        print(('true' if v else 'false') if isinstance(v, bool) else v)
    sys.exit(0)
sys.exit(1)
PY
EOF
# netifd для ping_wan: подмена /lib/functions/network.sh с теми же именами и тем же поведением
# (значение — в переменную; нет значения — unset и код 1), данные — файлы в $T/net. Как и в
# настоящем файле, `$__NETWORK_CACHE` читается без объявления: под `set -u` это обрывает
# вызывающего, и ping_wan обязан от этого защищаться (подоболочка с `set +u`).
{ printf 'NETD=%s\n' "$T/net"; cat <<'EOF'
network_flush_cache() { unset __NETWORK_CACHE; }
__nget() {
    [ -z "$__NETWORK_CACHE" ] || :
    __nv="$(cat "$NETD/$2" 2>/dev/null)"
    if [ -n "$__nv" ]; then eval "$1=\$__nv"; return 0; fi
    unset "$1"; return 1
}
network_is_up() { [ "$(cat "$NETD/$1.up" 2>/dev/null)" = 1 ]; }
network_find_wan() { __nget "$1" defroute; }
network_get_device() { __nget "$1" "$2.dev"; }
network_get_ipaddr() { __nget "$1" "$2.ip"; }
EOF
} > "$T/net.sh"
chmod +x "$T/bin/uci" "$T/bin/steer" "$T/bin/curl" "$T/bin/uclient-fetch" "$T/bin/logger" "$T/bin/jsonfilter"

uset() { "$T/bin/uci" set "$1=$2"; }
uget() { "$T/bin/uci" -q get "$1" 2>/dev/null; }
st()   { sed -n "s/^$1=//p" "$T/state" 2>/dev/null | tail -n1; }
calls() { [ -f "$T/$1.calls" ] && grep -c . "$T/$1.calls" || echo 0; }
reset() {
    : > "$T/uci.db"
    rm -rf "$T/state" "$T"/*.calls "$T"/*.argv "$T/curl.log" "$T/logger.log" "$T/ip.log" "$T/net" \
           "$T"/code@* "$T"/echo.* "$T/steer.status" "$T/steer.outputs"
    mkdir -p "$T/net"
    printf '%s' "$ID" > "$T/steer.tid"; echo 204 > "$T/code"
}

# По умолчанию данных netifd нет (PING_NETWORK_SH указывает в никуда): роутер, про сеть которого
# ничего не известно, шлёт обычный отклик без адреса и без привязки к устройству.
ping_run() {  # [ПЕРЕМЕННЫЕ=…] — вызов настоящей команды; код возврата в $rc
    env PATH="$T/bin:$PATH" \
        PING_SH="$ROOT/files/usr/lib/splify2/ping.sh" \
        PING_STATE="$T/state" STEER="$T/bin/steer" UCI_SPLIFY2="$T/etc/config-splify2" \
        PING_NETWORK_SH="$T/нет-network.sh" FETCH_SH="$ROOT/files/usr/lib/splify2/fetch.sh" \
        FETCH_STEER="$T/bin/steer" FETCH_SPEC="$T/spec.json" \
        "$@" sh "$ROOT/files/usr/sbin/splify2-ping" > "$T/out" 2>&1
    rc=$?
}
pingw() { ping_run PING_NETWORK_SH="$T/net.sh" "$@"; }   # то же, с данными netifd из $T/net

# Интерфейс в данных netifd: ИМЯ UP(1|0) УСТРОЙСТВО АДРЕС; пустое — «нет».
wan() {
    printf '%s' "$2" > "$T/net/$1.up"
    [ -z "$3" ] || printf '%s' "$3" > "$T/net/$1.dev"
    [ -z "$4" ] || printf '%s' "$4" > "$T/net/$1.ip"
}
defroute() { printf '%s' "$1" > "$T/net/defroute"; }
# Выходы ядра: ИМЯ:УСТРОЙСТВО:up|down… (в порядке `steer outputs`); у каждого своя таблица.
outs() {
    _j='{"schema":1,"outputs":{"direct":{"kind":"direct"}'; _n=''; _t=300
    for _o in "$@"; do
        _nm="${_o%%:*}"; _r="${_o#*:}"; _dv="${_r%%:*}"; _st="${_r#*:}"
        _up=true; [ "$_st" = up ] || _up=false
        _j="$_j,\"$_nm\":{\"kind\":\"vless\",\"device\":\"$_dv\",\"up\":$_up,\"table\":$_t}"
        _n="$_n$_nm
"
        _t=$((_t + 1))
    done
    printf '%s},"channels":[]}\n' "$_j" > "$T/steer.status"
    printf 'direct\n%s' "$_n" > "$T/steer.outputs"
}
# Вызовы curl по журналу: сколько начинается с ШАБЛОНА, и N-й вызов целиком.
logn() { [ -f "$T/curl.log" ] || { echo 0; return; }; grep -c "^$1" "$T/curl.log" || true; }
logl() { sed -n "${1}p" "$T/curl.log" 2>/dev/null; }
# Тело N-го отклика (POST) и его устройство.
postbody() { grep '^POST ' "$T/curl.log" | sed -n "${1}p" | sed 's/.* body=//'; }
postdev() { grep '^POST ' "$T/curl.log" | sed -n "${1}p" | sed 's/^POST iface=\([^ ]*\) .*/\1/'; }

rpcd() {  # МЕТОД [JSON]
    printf '%s\n' "${2:-}" | env PATH="$T/bin:$PATH" \
        JSHN_SH="$ROOT/tests/stub/jshn.sh" RPCD_LIB="$ROOT/files/usr/lib/splify2/rpcd" \
        PING_SH="$ROOT/files/usr/lib/splify2/ping.sh" PING_STATE="$T/state" \
        STEER="$T/bin/steer" UCI_SPLIFY2="$T/etc/config-splify2" \
        sh "$ROOT/files/usr/libexec/rpcd/splify2" call "$1" 2>/dev/null
}
jget() { python3 -c 'import json,sys; d=json.load(sys.stdin); v=d.get(sys.argv[1]); print(str(v).lower() if isinstance(v,bool) else v)' "$1"; }

# ---- пакет: что в нём есть, а чего уже нет --------------------------------------------
check "команда отклика есть и исполняема" "yes" \
      "$([ -x files/usr/sbin/splify2-ping ] && echo yes || echo no)"
for _gone in files/usr/sbin/splify2-telemetry files/usr/lib/splify2/telemetry.sh \
             files/etc/hotplug.d/iface/96-splify2; do
    check "прежнего $_gone нет" "no" "$([ -e "$_gone" ] && echo yes || echo no)"
done
check "сборщика пакета и обращений к ipinfo нигде нет" "0" \
      "$(grep -rl 'ipinfo\|tm_build\|telemetry_preview' files luci ui/src build.sh 2>/dev/null | grep -c .)"

# ---- первый отклик: тело, адрес, заголовки -------------------------------------------
reset
ping_run
check "первый запуск отправляет" "0" "$rc"
check "curl позван один раз" "1" "$(calls curl)"
check "тело — ровно v и id" "{\"v\":1,\"id\":\"$ID\"}" \
      "$(sed -n '/^--data-binary$/{n;p;}' "$T/curl.argv")"
check "адрес по умолчанию" "1" "$(grep -cx "$URL_DEF" "$T/curl.argv")"
check "заголовок типа содержимого" "1" "$(grep -cx 'Content-Type: application/json' "$T/curl.argv")"
check "других заголовков нет" "1" "$(grep -cx -- '-H' "$T/curl.argv")"
check "других тел нет" "1" "$(grep -cE -- '^(-d|--data.*)$' "$T/curl.argv")"
check "отметка расписания записана" "yes" "$([ "$(st at)" -gt 1700000000 ] 2>/dev/null && echo yes || echo no)"
check "время принятого отклика записано" "$(st at)" "$(st ok)"
check "причины сбоя нет" "" "$(st err)"
check "идентификатор посчитан ядром и запомнен" "$ID" "$(uget splify2.main.telemetry_id)"

# ---- расписание: 23 часа ---------------------------------------------------------------
ping_run
check "сразу после отклика — не отправляет" "1" "$(calls curl)"
check "и выходит без ошибки" "0" "$rc"
now="$(date +%s)"
printf 'at=%s\nok=%s\nerr=\n' "$((now - 22 * 3600))" "$((now - 22 * 3600))" > "$T/state"
ping_run
check "через 22 часа — не отправляет" "1" "$(calls curl)"
printf 'at=%s\nok=%s\nerr=\n' "$((now - 23 * 3600 + 300))" "$((now - 23 * 3600))" > "$T/state"
ping_run
check "за пять минут до 23 часов (такт крона плывёт) — отправляет" "2" "$(calls curl)"
printf 'at=%s\nok=%s\nerr=\n' "$((now - 23 * 3600))" 0 > "$T/state"
ping_run
check "через 23 часа — отправляет" "3" "$(calls curl)"
check "идентификатор взят из настройки, ядро звали один раз" "1" "$(calls steer)"
printf 'at=%s\nok=0\nerr=\n' "$((now + 3600))" > "$T/state"
ping_run
check "отметка из будущего (часы перевели) — отправляет" "4" "$(calls curl)"
rm -f "$T/state"
ping_run
check "отметки нет (перезагрузка) — отправляет" "5" "$(calls curl)"

# ---- ответы сайта ----------------------------------------------------------------------
resp() {  # КОД — свежая отметка, один запуск
    rm -f "$T/state"; echo "$1" > "$T/code"
    printf 'at=0\nok=1757000000\nerr=\n' > "$T/state"
    ping_run
}
reset
resp 200
check "200 — принято" "" "$(st err)"
check "200 — время принятого обновлено" "yes" "$([ "$(st ok)" -gt 1757000000 ] && echo yes || echo no)"
resp 400
check "400 — выход с ошибкой" "1" "$rc"
check "400 — причина rejected" "rejected" "$(st err)"
check "400 — отметка расписания есть (не долбить)" "yes" "$([ "$(st at)" -gt 0 ] && echo yes || echo no)"
check "400 — время принятого прежнее" "1757000000" "$(st ok)"
n="$(calls curl)"; ping_run
check "400 — следующий такт не отправляет" "$n" "$(calls curl)"
resp 429
check "429 — причина toomany" "toomany" "$(st err)"
check "429 — отметка расписания есть" "yes" "$([ "$(st at)" -gt 0 ] && echo yes || echo no)"
n="$(calls curl)"; ping_run
check "429 — следующий такт не отправляет" "$n" "$(calls curl)"
resp 503
check "503 — выход с ошибкой" "1" "$rc"
check "503 — причина unavailable" "unavailable" "$(st err)"
check "503 — отметки расписания нет" "0" "$(st at)"
check "503 — время принятого прежнее" "1757000000" "$(st ok)"
n="$(calls curl)"; ping_run
check "503 — следующий такт повторяет" "$((n + 1))" "$(calls curl)"
resp 500
check "500 — тоже повтор (unavailable)" "unavailable" "$(st err)"
resp 000
check "нет ответа — причина network" "network" "$(st err)"
check "нет ответа — отметки расписания нет" "0" "$(st at)"
echo 204 > "$T/code"; ping_run
check "после сбоя 204 стирает причину" "" "$(st err)"

# ---- адрес для стендов -----------------------------------------------------------------
reset
uset splify2.main.ping_url https://stand.example/api/ping
ping_run
check "splify2.main.ping_url переопределяет адрес" "1" "$(grep -cx https://stand.example/api/ping "$T/curl.argv")"
check "и адрес по умолчанию не тронут" "0" "$(grep -cx "$URL_DEF" "$T/curl.argv")"

# ---- согласие --------------------------------------------------------------------------
reset; uset splify2.main.telemetry 0
ping_run
check "выключено — запросов нет" "0" "$(calls curl)"
check "выключено — ядро не звали" "0" "$(calls steer)"
check "выключено — отметки нет" "no" "$([ -e "$T/state" ] && echo yes || echo no)"
check "выключено — выход без ошибки" "0" "$rc"
reset; uset splify2.main.telemetry невнятно
ping_run
check "невнятное значение — тоже выключено" "0" "$(calls curl)"
reset; uset splify2.main.telemetry 1
ping_run
check "1 — отправляет" "1" "$(calls curl)"

# ---- идентификатор ---------------------------------------------------------------------
reset; uset splify2.main.telemetry_id "$ID2"
ping_run
check "запомненный идентификатор уходит как есть" "{\"v\":1,\"id\":\"$ID2\"}" \
      "$(sed -n '/^--data-binary$/{n;p;}' "$T/curl.argv")"
check "и ядро не звали" "0" "$(calls steer)"
reset; uset splify2.main.telemetry_id "sp-кривой"
ping_run
check "кривой запомненный — посчитан заново" "$ID" "$(uget splify2.main.telemetry_id)"
reset; printf '' > "$T/steer.tid"
ping_run
check "ядро не дало идентификатор — запроса нет" "0" "$(calls curl)"
check "причина noid" "noid" "$(st err)"
check "и выход с ошибкой" "1" "$rc"
reset; printf 'sp-0123' > "$T/steer.tid"
ping_run
check "короткий tid от ядра не уходит" "0" "$(calls curl)"
reset
ping_run STEER="$T/нет-ядра"
check "нет ядра — запроса нет" "0" "$(calls curl)"

# ---- uclient-fetch, когда curl нет -----------------------------------------------------
reset
ping_run PING_CURL="$T/нет-curl"
check "без curl — отправляет uclient-fetch" "1" "$(calls fetch)"
check "тело то же" "--post-data={\"v\":1,\"id\":\"$ID\"}" "$(grep -- '^--post-data=' "$T/fetch.argv")"
check "заголовок типа содержимого" "1" "$(grep -cx -- '--header=Content-Type: application/json' "$T/fetch.argv")"
check "ответ не пишется на диск" "1" "$(grep -cx /dev/null "$T/fetch.argv")"
check "успех uclient-fetch — отметка" "" "$(st err)"
check "успех uclient-fetch — время принятого" "yes" "$([ "$(st ok)" -gt 1700000000 ] && echo yes || echo no)"
for _c in 400:rejected 429:toomany 503:unavailable 000:network; do
    rm -f "$T/state"; echo "${_c%%:*}" > "$T/code"
    ping_run PING_CURL="$T/нет-curl"
    check "uclient-fetch, ответ ${_c%%:*} — причина ${_c#*:}" "${_c#*:}" "$(st err)"
done
reset
ping_run PING_CURL="$T/нет-curl" PING_FETCH="$T/нет-fetch"
check "нечем отправить — причина nosender" "nosender" "$(st err)"

# ---- публичный адрес: что считается публичным ------------------------------------------
# Сама проверка — ping_ip4_global из ping.sh; её же зовут и для адреса от netifd, и для ответа
# сервера. Границы диапазонов — там, где ошибиться проще всего.
ip4() {  # АДРЕС -> yes|no
    sh -c '. "$1"; if ping_ip4_global "$2"; then echo yes; else echo no; fi' _ \
        "$ROOT/files/usr/lib/splify2/ping.sh" "$1"
}
for _a in 1.0.0.0 8.8.8.8 77.88.8.8 85.26.14.7 100.63.255.255 100.128.0.0 126.255.255.255 128.0.0.1 \
          169.253.255.255 169.255.0.0 172.15.255.255 172.32.0.0 192.0.1.1 192.167.255.255 192.169.0.0 \
          198.17.255.255 198.20.0.0 198.51.99.255 198.51.101.0 203.0.112.255 203.0.114.0 223.255.255.254; do
    check "публичный: $_a" yes "$(ip4 $_a)"
done
for _a in 0.0.0.0 0.1.2.3 10.0.0.1 10.255.255.255 100.64.0.0 100.100.100.100 100.127.255.255 127.0.0.1 \
          169.254.0.1 169.254.255.254 172.16.0.1 172.31.255.255 192.168.0.1 192.168.255.255 192.0.0.2 \
          192.0.2.7 198.18.0.1 198.19.255.255 198.51.100.7 203.0.113.9 224.0.0.1 239.255.255.250 \
          240.0.0.1 255.255.255.255; do
    check "не публичный: $_a" no "$(ip4 $_a)"
done
for _a in '' abc 1.2.3 1.2.3.4.5 256.1.1.1 1.2.3.256 01.2.3.4 1.2.3.04 1.2.3.-4 ' 1.2.3.4' '1.2.3.4 ' \
          1..2.3 .1.2.3 1.2.3. 1.2.3.4/32 1.2.3.4:80 0x8.8.8.8 ::1 2606:4700:4700::1111 8.8.8.8%eth0; do
    check "не адрес IPv4: '$_a'" no "$(ip4 "$_a")"
done

# ---- публичный адрес роутера: откуда берётся и как уходит -------------------------------
# WAN от netifd — публичный: он и уходит, сервера спрашивать незачем.
reset; wan wan 1 eth1 85.26.14.7
pingw
check "WAN публичный: отклик ушёл" "0" "$rc"
check "WAN публичный: адрес у сервера не спрашивали — запрос один" "1" "$(calls curl)"
check "WAN публичный: тело — v, id и ip" "{\"v\":1,\"id\":\"$ID\",\"ip\":\"85.26.14.7\"}" "$(postbody 1)"
check "WAN публичный: тело то же и в argv curl" "{\"v\":1,\"id\":\"$ID\",\"ip\":\"85.26.14.7\"}" \
      "$(sed -n '/^--data-binary$/{n;p;}' "$T/curl.argv")"
check "WAN публичный: других ключей нет" "id ip v" \
      "$(postbody 1 | python3 -c 'import json,sys; print(" ".join(sorted(json.load(sys.stdin))))')"
check "WAN публичный: отклик привязан к внешнему устройству" "eth1" "$(postdev 1)"
check "WAN публичный: отметка записана" "yes" "$([ "$(st ok)" -gt 1700000000 ] 2>/dev/null && echo yes || echo no)"

# WAN с частным адресом, CGNAT или link-local: публичный адрес — у оператора, роутер спрашивает
# его у нашего сервера ПО ВНЕШНЕМУ УСТРОЙСТВУ (иначе за туннелем он узнал бы адрес выхода).
for _a in 10.20.30.40 192.168.1.2 172.16.0.9 172.31.255.254 100.64.1.1 100.127.0.5 169.254.7.7; do
    reset; wan wan 1 eth1 "$_a"; printf '{"ip":"85.26.14.7"}' > "$T/echo.body"
    pingw
    check "WAN $_a: сначала спрошен наш сервер по внешнему устройству" \
          "GET iface=eth1 url=https://dns.yo1nk.app/api/ip" "$(logl 1)"
    check "WAN $_a: потом отклик — с адресом из ответа" \
          "{\"v\":1,\"id\":\"$ID\",\"ip\":\"85.26.14.7\"}" "$(postbody 1)"
    check "WAN $_a: отклик — по тому же устройству" "eth1" "$(postdev 1)"
    check "WAN $_a: вызовов два" "2" "$(calls curl)"
done
# Ответ с пробелами и лишними полями — всё равно ответ.
reset; wan wan 1 eth1 192.168.1.2; printf '{ "ip" : "85.26.14.7", "x": 1 }\n' > "$T/echo.body"
pingw
check "ответ сервера с пробелами и лишним полем читается" "{\"v\":1,\"id\":\"$ID\",\"ip\":\"85.26.14.7\"}" "$(postbody 1)"

# Сервер не ответил или ответил не адресом — отклик уходит без ip, и это не мешает ему дойти.
reset; wan wan 1 eth1 192.168.1.2; echo 22 > "$T/echo.rc"
pingw
check "сервер адрес не дал: отклик всё равно ушёл" "0" "$rc"
check "сервер адрес не дал: тело без ip" "{\"v\":1,\"id\":\"$ID\"}" "$(postbody 1)"
check "сервер адрес не дал: спрашивали один раз" "1" "$(logn GET)"
for _b in '<html>captive portal</html>' '{"ip":"10.1.2.3"}' '{"ip":"100.64.9.9"}' '{"ip":"203.0.113.9"}' \
          '{"ip":""}' '{"error":"нет такого адреса"}' '{"ip":"85.26.14.7.9"}' '{"ip":"::1"}' ''; do
    reset; wan wan 1 eth1 192.168.1.2; printf '%s' "$_b" > "$T/echo.body"
    pingw
    check "ответ '$_b' не адрес: тело без ip" "{\"v\":1,\"id\":\"$ID\"}" "$(postbody 1)"
done

# Адрес для вопроса — тот же сервер, что принимает отклик.
reset; wan wan 1 eth1 192.168.1.2; printf '{"ip":"85.26.14.7"}' > "$T/echo.body"
uset splify2.main.ping_url https://stand.example/api/ping
pingw
check "ping_url стенда: спрошен тот же сервер" "GET iface=eth1 url=https://stand.example/api/ip" "$(logl 1)"
reset; wan wan 1 eth1 192.168.1.2; printf '{"ip":"85.26.14.7"}' > "$T/echo.body"
uset splify2.main.ping_url https://stand.example/hook
pingw
check "ping_url не на /ping: спрашивать адрес негде — запрос один" "1" "$(calls curl)"
check "ping_url не на /ping: тело без ip" "{\"v\":1,\"id\":\"$ID\"}" "$(postbody 1)"

# Данных netifd нет вовсе: отклик прежний — без адреса и без привязки.
reset
ping_run
check "netifd нет: тело без ip" "{\"v\":1,\"id\":\"$ID\"}" "$(postbody 1)"
check "netifd нет: без привязки к устройству" "-" "$(postdev 1)"
check "netifd нет: запрос один" "1" "$(calls curl)"
reset; wan wan 0 "" ""
pingw
check "wan не поднят и маршрута по умолчанию нет: как без netifd" "-" "$(postdev 1)"

# Имя внешнего интерфейса — не обязательно wan: берётся тот, что держит маршрут по умолчанию.
reset; wan wan 0 "" ""; wan wwan 1 wwan0 85.26.14.7; defroute wwan
pingw
check "wan не поднят: взят интерфейс с маршрутом по умолчанию" \
      "{\"v\":1,\"id\":\"$ID\",\"ip\":\"85.26.14.7\"}" "$(postbody 1)"
check "и устройство — его" "wwan0" "$(postdev 1)"
reset; wan wan 1 eth1 85.1.1.1; wan wwan 1 wwan0 85.2.2.2; defroute wwan
pingw
check "wan поднят — берётся он, а не тот, что держит маршрут" "eth1 85.1.1.1" \
      "$(postdev 1) $(postbody 1 | sed 's/.*"ip":"\([^"]*\)".*/\1/')"
# У внешнего интерфейса нет адреса IPv4 (только устройство): адрес спрашивается у сервера.
reset; wan wan 1 eth1 ""; printf '{"ip":"85.26.14.7"}' > "$T/echo.body"
pingw
check "адреса IPv4 у wan нет: спрошен сервер" "GET iface=eth1 url=https://dns.yo1nk.app/api/ip" "$(logl 1)"
check "и адрес из ответа ушёл" "{\"v\":1,\"id\":\"$ID\",\"ip\":\"85.26.14.7\"}" "$(postbody 1)"

# (Под `set -u` настоящий network.sh читает свою переменную без объявления; подмена это повторяет,
# а команда живёт с `set -u`: стоит убрать `set +u` из ping_wan — адреса не станет ни в одной из
# проверок выше.)

# Без curl адрес берёт только netifd: uclient-fetch к устройству не привязывается.
reset; wan wan 1 eth1 85.26.14.7
pingw PING_CURL="$T/нет-curl"
check "без curl, WAN публичный: ip в теле" "--post-data={\"v\":1,\"id\":\"$ID\",\"ip\":\"85.26.14.7\"}" \
      "$(grep -- '^--post-data=' "$T/fetch.argv")"
check "без curl: к устройству не привязывались" "0" "$(grep -c -- '--interface' "$T/fetch.argv")"
reset; wan wan 1 eth1 192.168.1.2; printf '{"ip":"85.26.14.7"}' > "$T/echo.body"
pingw PING_CURL="$T/нет-curl"
check "без curl, WAN частный: сервера не спрашивали" "0" "$(logn GET)"
check "без curl, WAN частный: тело без ip" "--post-data={\"v\":1,\"id\":\"$ID\"}" \
      "$(grep -- '^--post-data=' "$T/fetch.argv")"

# ---- лестница путей ------------------------------------------------------------------------
# Отклик должен дойти ЛЮБЫМ рабочим путём: напрямую по внешнему устройству → через поднятые выходы
# ядра по очереди → обычным путём. Ответ сайта с любым кодом кончает обход. Переключатель
# «скачивать через туннель» к отклику не относится.
body0="{\"v\":1,\"id\":\"$ID\",\"ip\":\"85.26.14.7\"}"
ladder() {  # подготовка: WAN с публичным адресом и два поднятых выхода
    reset; wan wan 1 eth1 85.26.14.7
    outs vl:vl:up wg:wg0:up
}

ladder
pingw
check "напрямую ответили: отклик один" "1" "$(logn POST)"
check "напрямую: по внешнему устройству" "eth1" "$(postdev 1)"
check "напрямую: выходы не трогали" "0" "$(logn 'POST iface=vl')"
check "напрямую: отметка" "" "$(st err)"
check "напрямую: в syslog о путях ничего" "" "$(cat "$T/logger.log" 2>/dev/null)"

# Напрямую молчат (провайдер закрыл TLS до сайта) — первый поднятый выход.
ladder; echo 000 > "$T/code@eth1"
pingw
check "напрямую молчат, выход vl ответил: успех" "0" "$rc"
check "отклики по порядку: внешнее устройство, выход vl" "eth1 vl" "$(postdev 1) $(postdev 2)"
check "второго выхода не трогали" "2" "$(logn POST)"
check "обычного пути не пробовали" "0" "$(logn 'POST iface=-')"
check "тело на каждой попытке одно и то же, с ip" "$body0 $body0" "$(postbody 1) $(postbody 2)"
check "отметка принятого отклика" "yes" "$([ "$(st ok)" -gt 1700000000 ] 2>/dev/null && echo yes || echo no)"
check "причины сбоя нет" "" "$(st err)"
check "в syslog названо, через какой выход" "yes" \
      "$(grep -q 'напрямую не ответил.*выход vl' "$T/logger.log" && echo yes || echo no)"
n="$(logn POST)"
ping_run PING_NETWORK_SH="$T/net.sh"
check "отклик через выход принят как обычный: следующий такт не отправляет" "$n" "$(logn POST)"

# Первый выход молчит — следующий.
ladder; echo 000 > "$T/code@eth1"; echo 000 > "$T/code@vl"
pingw
check "vl молчит, wg0 ответил: успех" "0" "$rc"
check "отклики по порядку: eth1, vl, wg0" "eth1 vl wg0" "$(postdev 1) $(postdev 2) $(postdev 3)"
check "обычного пути не пробовали" "0" "$(logn 'POST iface=-')"

# Выход не поднят — пропускается, а не пробуется.
ladder; outs vl:vl:down wg:wg0:up; echo 000 > "$T/code@eth1"
pingw
check "vl не поднят: пропущен, ответил wg0" "eth1 wg0" "$(postdev 1) $(postdev 2)"
check "к неподнятому выходу не обращались" "0" "$(logn 'POST iface=vl')"

# Выход на том же устройстве, что внешний интерфейс, второй раз не пробуется.
ladder; outs same:eth1:up wg:wg0:up; echo 000 > "$T/code@eth1"
pingw
check "выход на внешнем устройстве не повторяется" "eth1 wg0" "$(postdev 1) $(postdev 2)"

# Никто не ответил: последним — обычный путь; сайт не ответил.
ladder; echo 000 > "$T/code"
pingw
check "никто не ответил: выход с ошибкой" "1" "$rc"
check "все пути по порядку, обычный — последним" "eth1 vl wg0 -" \
      "$(postdev 1) $(postdev 2) $(postdev 3) $(postdev 4)"
check "и ничего сверх этого" "4" "$(logn POST)"
check "причина — сайт не ответил (network)" "network" "$(st err)"
check "отметки расписания нет — повтор на следующем такте" "0" "$(st at)"
check "сказано словами" "yes" "$(grep -q 'сайт не ответил — повтор через час' "$T/out" && echo yes || echo no)"
n="$(logn POST)"; ping_run PING_NETWORK_SH="$T/net.sh"
check "следующий такт повторяет весь обход" "$((n + 4))" "$(logn POST)"

# Обычный путь выручает, когда все привязанные молчат (весь трафик роутера — в netifd-туннель).
ladder; echo 000 > "$T/code@eth1"; echo 000 > "$T/code@vl"; echo 000 > "$T/code@wg0"
pingw
check "привязанные молчат, обычный ответил: успех" "0" "$rc"
check "обычный путь — последний, один раз" "eth1 vl wg0 -" \
      "$(postdev 1) $(postdev 2) $(postdev 3) $(postdev 4)"
check "обычный путь назван в syslog" "yes" \
      "$(grep -q 'обычным путём' "$T/logger.log" && echo yes || echo no)"

# Ответ сайта любого кода — это ответ: дальше не идём.
for _c in 503:unavailable 500:unavailable 400:rejected 429:toomany; do
    ladder; echo "${_c%%:*}" > "$T/code@eth1"
    pingw
    check "ответ ${_c%%:*} напрямую: больше путей не пробуется" "1" "$(logn POST)"
    check "ответ ${_c%%:*}: причина ${_c#*:}" "${_c#*:}" "$(st err)"
done
ladder; echo 000 > "$T/code@eth1"; echo 503 > "$T/code@vl"
pingw
check "через выход ответили 503: это ответ сайта, дальше не идём" "2" "$(logn POST)"
check "503 через выход: причина unavailable" "unavailable" "$(st err)"

# Прогон ограничен по времени: PING_BUDGET секунд с начала, а не числом выходов.
ladder; echo 000 > "$T/code@eth1"
pingw PING_BUDGET=0
check "бюджет вышел: выходы не пробуются" "eth1 -" "$(postdev 1) $(postdev 2)"
check "бюджет вышел: попыток две" "2" "$(logn POST)"
ladder; echo 000 > "$T/code@eth1"
pingw PING_BUDGET=1000
check "бюджет большой: выходы пробуются" "eth1 vl" "$(postdev 1) $(postdev 2)"

# Выходов нет вовсе (ядро не отвечает на status) — внешнее устройство и обычный путь.
reset; wan wan 1 eth1 85.26.14.7; echo 000 > "$T/code"
pingw
check "ядро выходов не дало: eth1, затем обычный" "eth1 -" "$(postdev 1) $(postdev 2)"
check "ядро выходов не дало: сайт не ответил" "network" "$(st err)"
reset; wan wan 1 eth1 85.26.14.7; echo 000 > "$T/code"
pingw FETCH_SH="$T/нет-fetch.sh"
check "нет fetch.sh: выходы не пробуются, остальное работает" "eth1 -" "$(postdev 1) $(postdev 2)"

# Переключатель «скачивать через туннель» отклику не указ — ни во включённом, ни в выключенном.
for _m in 0 always; do
    ladder; echo 000 > "$T/code@eth1"; uset splify2.main.fetch_via_tunnel "$_m"
    pingw
    check "fetch_via_tunnel=$_m: выход всё равно пробуется" "eth1 vl" "$(postdev 1) $(postdev 2)"
done
# Выходы пробуются привязкой к устройству, а не правилами маршрутизации: `ip` не зовётся вовсе.
check "маршрутов и правил не трогали ни разу" "0" "$(grep -c . "$T/ip.log" 2>/dev/null || echo 0)"

# Данных netifd нет, но выходы есть: первым идёт обычный заход, затем выходы; последнего обычного нет.
reset; outs vl:vl:up wg:wg0:up; echo 000 > "$T/code@plain"
ping_run
check "netifd нет: обычный, затем выходы по очереди" "- vl" "$(postdev 1) $(postdev 2)"
check "netifd нет: обычный не повторяется" "0" "$(grep '^POST ' "$T/curl.log" | sed -n '3,$p' | grep -c 'iface=-')"
reset; outs vl:vl:up wg:wg0:up; echo 000 > "$T/code"
ping_run
check "netifd нет, все молчат: обычный, vl, wg0" "- vl wg0" "$(postdev 1) $(postdev 2) $(postdev 3)"

# Без curl привязаться некуда: один обычный заход uclient-fetch, выходы не пробуются.
ladder; echo 000 > "$T/code"
pingw PING_CURL="$T/нет-curl"
check "без curl: заход один" "1" "$(calls fetch)"
check "без curl: к устройству не привязывались" "0" "$(grep -c -- '--interface' "$T/fetch.argv")"
check "без curl: сайт не ответил" "network" "$(st err)"

# ---- объект rpcd -----------------------------------------------------------------------
reset
out="$(rpcd telemetry_state)"
check "rpcd: по умолчанию включено" "true" "$(printf '%s' "$out" | jget on)"
check "rpcd: согласие unset" "unset" "$(printf '%s' "$out" | jget consent)"
check "rpcd: отклика ещё не было" "0" "$(printf '%s' "$out" | jget last_at)"
printf 'at=1757000100\nok=1757000000\nerr=toomany\n' > "$T/state"
out="$(rpcd telemetry_state)"
check "rpcd: last_at — время принятого отклика" "1757000000" "$(printf '%s' "$out" | jget last_at)"
check "rpcd: last_error — слово причины" "toomany" "$(printf '%s' "$out" | jget last_error)"
check "rpcd: лишних полей нет" "consent last_at last_error on" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; print(" ".join(sorted(json.load(sys.stdin))))')"
uset splify2.main.telemetry_id "$ID"
out="$(rpcd telemetry_set '{"on":0}')"
check "rpcd: выключение отвечает ok" "true" "$(printf '%s' "$out" | jget ok)"
check "rpcd: выключение записано" "0" "$(uget splify2.main.telemetry)"
check "rpcd: выключение убирает идентификатор" "" "$(uget splify2.main.telemetry_id)"
check "rpcd: выключение убирает отметку" "no" "$([ -e "$T/state" ] && echo yes || echo no)"
out="$(rpcd telemetry_state)"
check "rpcd: после выключения on=false" "false" "$(printf '%s' "$out" | jget on)"
out="$(rpcd telemetry_set '{"on":1}')"
check "rpcd: включение записано" "1" "$(uget splify2.main.telemetry)"
check "rpcd: согласие on" "on" "$(printf '%s' "$out" | jget consent)"
out="$(rpcd telemetry_set '{"on":"да"}')"
check "rpcd: невнятный ввод — отказ" "false" "$(printf '%s' "$out" | jget ok)"
out="$(rpcd telemetry_preview)"
check "rpcd: предпросмотра пакета больше нет" "false" "$(printf '%s' "$out" | jget ok)"
check "ACL: предпросмотра нет" "0" "$(grep -c telemetry_preview luci/root/usr/share/rpcd/acl.d/luci-app-splify2.json)"

# ---- установка: прежние ключи отчёта убираются -----------------------------------------
reset
for _k in telemetry_url telemetry_key telemetry_at telemetry_error geo_city_url; do uset "splify2.main.$_k" x; done
uset splify2.main.telemetry 0; uset splify2.main.telemetry_id "$ID"
# Файлы прежнего отчёта в /var (26.9.x): город провайдера, счётчики, отметки, пакет в /tmp.
R="$T/root"
mkdir -p "$R/var/lib/splify2" "$R/var/run" "$R/tmp"
OLD_FILES="var/lib/splify2/net var/run/splify2-boot-id var/run/splify2-events var/run/splify2-crash \
var/run/splify2-telemetry-now tmp/splify2-telemetry.4242"
for _f in $OLD_FILES; do echo x > "$R/$_f"; done
# Соседи, которые живы и сейчас: замер внешнего адреса выхода и отметка отклика.
echo x > "$R/var/lib/splify2/geo-wg0"; echo x > "$R/tmp/splify2-ping"
sed -n '/^# Ключи прежнего отчёта/,/^\[ -n "\$_old" \]/p' files/etc/uci-defaults/99-splify2 > "$T/olds.sh"
check "блок чистки прежних ключей найден в uci-defaults" "yes" "$([ -s "$T/olds.sh" ] && echo yes || echo no)"
PATH="$T/bin:$PATH" SPLIFY2_TEST_ROOT="$R" sh "$T/olds.sh"
check "прежние ключи сняты" "" "$(grep -E '^splify2.main.(telemetry_(url|key|at|error)|geo_city_url)=' "$T/uci.db")"
for _f in $OLD_FILES; do check "прежний файл /$_f убран" "no" "$([ -e "$R/$_f" ] && echo yes || echo no)"; done
check "замер внешнего адреса не тронут" "yes" "$([ -e "$R/var/lib/splify2/geo-wg0" ] && echo yes || echo no)"
check "отметка отклика не тронута" "yes" "$([ -e "$R/tmp/splify2-ping" ] && echo yes || echo no)"
check "согласие осталось" "0" "$(uget splify2.main.telemetry)"
check "идентификатор остался" "$ID" "$(uget splify2.main.telemetry_id)"

printf '\n%d проверок пройдено, %d ПРОВАЛЕНО\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
