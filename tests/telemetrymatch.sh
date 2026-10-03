#!/bin/sh
# Отклик для счётчика роутеров на splify2.github.io: команда splify2-ping, её расписание и
# объект rpcd. Описание — docs/TELEMETRY.md.
#
# Главный вопрос стенда — «не уехало ли лишнее»: тело запроса обязано быть РОВНО
# `{"v":1,"id":"sp-…"}`, без ключей, заголовков с секретами и прочих полей. Дальше — 23 часа
# между откликами, ответы сайта (204/400/429/503/сеть), выключенный учёт и отправка через
# uclient-fetch, когда curl нет. Сеть не нужна: curl и uclient-fetch подменены.
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
# первого раза идентификатор обязан браться из настройки.
cat > "$T/bin/steer" <<EOF
#!/bin/sh
[ "\$1" = dev-id ] || exit 1
echo x >> "$T/steer.calls"
printf '{"tid":"%s"}\n' "\$(cat "$T/steer.tid" 2>/dev/null)"
EOF
# curl: аргументы — по одному в строке, код ответа — из файла.
cat > "$T/bin/curl" <<EOF
#!/bin/sh
: > "$T/curl.argv"
for a in "\$@"; do printf '%s\n' "\$a" >> "$T/curl.argv"; done
echo x >> "$T/curl.calls"
c="\$(cat "$T/code")"
printf '%s' "\$c"
[ "\$c" = 000 ] && exit 7
exit 0
EOF
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
printf '#!/bin/sh\nexit 0\n' > "$T/bin/logger"
chmod +x "$T/bin/uci" "$T/bin/steer" "$T/bin/curl" "$T/bin/uclient-fetch" "$T/bin/logger"

uset() { "$T/bin/uci" set "$1=$2"; }
uget() { "$T/bin/uci" -q get "$1" 2>/dev/null; }
st()   { sed -n "s/^$1=//p" "$T/state" 2>/dev/null | tail -n1; }
calls() { [ -f "$T/$1.calls" ] && grep -c . "$T/$1.calls" || echo 0; }
reset() { : > "$T/uci.db"; rm -f "$T/state" "$T"/*.calls "$T"/*.argv; printf '%s' "$ID" > "$T/steer.tid"; echo 204 > "$T/code"; }

ping_run() {  # [ПЕРЕМЕННЫЕ=…] — вызов настоящей команды; код возврата в $rc
    env PATH="$T/bin:$PATH" \
        PING_SH="$ROOT/files/usr/lib/splify2/ping.sh" \
        PING_STATE="$T/state" STEER="$T/bin/steer" UCI_SPLIFY2="$T/etc/config-splify2" \
        "$@" sh "$ROOT/files/usr/sbin/splify2-ping" > "$T/out" 2>&1
    rc=$?
}

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
for _k in telemetry_url telemetry_key telemetry_at telemetry_error; do uset "splify2.main.$_k" x; done
uset splify2.main.telemetry 0; uset splify2.main.telemetry_id "$ID"
sed -n '/^# Ключи прежнего отчёта/,/^\[ -n "\$_old" \]/p' files/etc/uci-defaults/99-splify2 > "$T/olds.sh"
check "блок чистки прежних ключей найден в uci-defaults" "yes" "$([ -s "$T/olds.sh" ] && echo yes || echo no)"
PATH="$T/bin:$PATH" sh "$T/olds.sh"
check "прежние ключи сняты" "" "$(grep -E '^splify2.main.telemetry_(url|key|at|error)=' "$T/uci.db")"
check "согласие осталось" "0" "$(uget splify2.main.telemetry)"
check "идентификатор остался" "$ID" "$(uget splify2.main.telemetry_id)"

printf '\n%d проверок пройдено, %d ПРОВАЛЕНО\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
