# Отклик для счётчика роутеров на splify2.github.io: общее для команды отправки
# (/usr/sbin/splify2-ping) и объекта rpcd (m-telemetry.sh). Описание — docs/TELEMETRY.md.
#
# Уезжают ДВА поля — идентификатор роутера и его публичный адрес (`ip`, если он известен).
# Город сервер находит по адресу, а когда трафик роутера идёт через туннель, у соединения адрес
# выхода, и город по нему был бы чужим. Адрес сервер использует только для города и не хранит.
# Здесь согласие, идентификатор, отметка последнего отклика и разбор адреса: решение «отправлять
# ли» одно на весь продукт, и экран обязан показывать ровно то, что делает расписание.
#
# `set -u` не ставится: файл подключает и объект rpcd, а он живёт с необъявленными
# переменными законно.

STEER=${STEER:-/usr/sbin/steer}
# Чем спрашивать адрес у сервера (curl: к устройству привязывается только он) и откуда брать
# данные netifd; на стенде подставляются свои.
PING_CURL=${PING_CURL:-curl}
PING_NETWORK_SH=${PING_NETWORK_SH:-/lib/functions/network.sh}
# Отметка в /tmp, а не во флеше: запись раз в сутки во флеш ради счётчика не нужна, а после
# перезагрузки отклик и так уходит на ближайшем такте.
PING_STATE=${PING_STATE:-/tmp/splify2-ping}
UCI_SPLIFY2=${UCI_SPLIFY2:-/etc/config/splify2}

# Без файла настройки и секции main `uci set` молча ничего не пишет. В объекте rpcd функция
# своя (common.sh), у команды отправки её нет — тогда идентификатор считался бы ядром каждый
# раз заново.
command -v uci_file >/dev/null 2>&1 || uci_file() {
    if [ ! -f "$UCI_SPLIFY2" ]; then
        mkdir -p "$(dirname "$UCI_SPLIFY2")" 2>/dev/null
        touch "$UCI_SPLIFY2" 2>/dev/null
        [ -f "$UCI_SPLIFY2" ] || return 1
    fi
    uci -q get splify2.main >/dev/null 2>&1 || uci -q set splify2.main=splify2
}

# Согласие: ключа нет или 1 — включено, 0 — выключено. Непонятное значение — тоже отказ:
# читать невнятное как «да» в вопросе про отправку наружу нельзя.
ping_consent() {  # -> unset | on | off
    case "$(uci -q get splify2.main.telemetry 2>/dev/null)" in
        1|on|yes|true) printf 'on' ;;
        '')            printf 'unset' ;;
        *)             printf 'off' ;;
    esac
}

ping_allowed() { [ "$(ping_consent)" != off ]; }

ping_int() {  # ЗНАЧЕНИЕ -> число или 0
    case "${1:-}" in
        ''|*[!0-9]*) printf '0' ;;
        *)           printf '%s' "$1" ;;
    esac
}

# Отметка — строки `ключ=значение`: `at` — когда отклик последний раз считался сделанным
# (по нему расписание), `ok` — когда сайт последний раз принял отклик, `err` — слово причины
# последнего сбоя (пусто, если сбоя нет).
ping_get() {  # КЛЮЧ -> значение
    [ -s "$PING_STATE" ] || return 0
    sed -n "s/^${1:-}=//p" "$PING_STATE" 2>/dev/null | tail -n1
}

ping_put() {  # AT OK ERR
    _pp="$PING_STATE.$$"
    printf 'at=%s\nok=%s\nerr=%s\n' "$1" "$2" "$3" > "$_pp" 2>/dev/null &&
        mv -f "$_pp" "$PING_STATE" 2>/dev/null || { rm -f "$_pp" 2>/dev/null; return 1; }
}

# Идентификатор: `steer dev-id` → поле `tid`, `sp-` и 32 шестнадцатеричных знака. Ядро
# считает его медленно (PBKDF2, 600 000 проходов), поэтому ответ запоминается в настройке.
# Счёт детерминирован — после сброса роутер посчитает то же значение.
ping_id_ok() {  # СТРОКА -> 0, если это идентификатор
    case "${1:-}" in sp-*) ;; *) return 1 ;; esac
    _pi="${1#sp-}"
    [ "${#_pi}" -eq 32 ] || return 1
    case "$_pi" in *[!0-9a-f]*) return 1 ;; esac
    return 0
}

ping_id() {
    _ti="$(uci -q get splify2.main.telemetry_id 2>/dev/null)"
    ping_id_ok "$_ti" && { printf '%s' "$_ti"; return 0; }
    [ -x "$STEER" ] || return 1
    _ti="$("$STEER" dev-id 2>/dev/null | sed -n 's/.*"tid":"\(sp-[0-9a-f]*\)".*/\1/p')"
    ping_id_ok "$_ti" || return 1
    uci_file 2>/dev/null || true
    uci -q set "splify2.main.telemetry_id=$_ti" 2>/dev/null
    uci -q commit splify2 2>/dev/null
    printf '%s' "$_ti"
}

# ---- публичный адрес роутера ----------------------------------------------------------------
# Публичный ли это адрес IPv4: четыре числа без ведущих нулей, и не из тех диапазонов, что в
# интернете не маршрутизируются: «этот узел» 0/8, частные 10/8, 172.16/12, 192.168/16, CGNAT
# 100.64/10, loopback 127/8, link-local 169.254/16, блок протокольных назначений 192.0.0.0/24 (в
# нём адрес DS-Lite), документация 192.0.2/24, 198.51.100/24, 203.0.113/24, стенды 198.18/15,
# multicast и зарезервированное от 224. Сервер проверяет то же сам; здесь — чтобы не слать то, что
# он всё равно отбросит, и не принять за свой адрес чужой ответ.
ping_ip4_global() {  # АДРЕС -> 0, если это публичный IPv4
    case "${1:-}" in ''|*[!0-9.]*|.*|*.|*..*) return 1 ;; esac
    case "$1" in *.*.*.*.*) return 1 ;; *.*.*.*) ;; *) return 1 ;; esac
    _pg_a="${1%%.*}"; _pg_r="${1#*.}"
    _pg_b="${_pg_r%%.*}"; _pg_r="${_pg_r#*.}"
    _pg_c="${_pg_r%%.*}"; _pg_d="${_pg_r#*.}"
    for _pg_o in "$_pg_a" "$_pg_b" "$_pg_c" "$_pg_d"; do
        case "$_pg_o" in
            0|[1-9]|[1-9][0-9]|1[0-9][0-9]|2[0-4][0-9]|25[0-5]) ;;
            *) return 1 ;;
        esac
    done
    case "$_pg_a" in
        0|10|127) return 1 ;;
        100) [ "$_pg_b" -ge 64 ] && [ "$_pg_b" -le 127 ] && return 1 ;;
        169) [ "$_pg_b" = 254 ] && return 1 ;;
        172) [ "$_pg_b" -ge 16 ] && [ "$_pg_b" -le 31 ] && return 1 ;;
        192) case "$_pg_b.$_pg_c" in 168.*|0.0|0.2) return 1 ;; esac ;;
        198) case "$_pg_b.$_pg_c" in 18.*|19.*|51.100) return 1 ;; esac ;;
        203) [ "$_pg_b.$_pg_c" = 0.113 ] && return 1 ;;
    esac
    [ "$_pg_a" -lt 224 ]
}

# Внешний интерфейс по данным netifd: логический `wan`, если он поднят, иначе тот, за которым
# стоит маршрут по умолчанию (network_find_wan из /lib/functions/network.sh) — интерфейс
# называют и lan2, и internet, и wwan. Печатает «УСТРОЙСТВО АДРЕС»: устройство L3 (eth1,
# pppoe-wan) — по нему отклик идёт «напрямую», мимо туннеля; адрес — первый IPv4 интерфейса.
# Чего нет, вместо того «-». Интерфейса нет вовсе — код 1.
#
# В подоболочке и с `set +u`: network.sh читает свою переменную без объявления, и под `set -u`
# команды отправки первый же его вызов оборвал бы её.
ping_wan() {
    [ -r "$PING_NETWORK_SH" ] || return 1
    (
        set +u
        . "$PING_NETWORK_SH" 2>/dev/null || exit 1
        network_flush_cache
        _if=wan
        network_is_up "$_if" || { _if=''; network_find_wan _if; }
        [ -n "$_if" ] || exit 1
        _dev=''; _ip=''
        network_get_device _dev "$_if"
        network_get_ipaddr _ip "$_if"
        printf '%s %s\n' "${_dev:--}" "${_ip:--}"
    )
}

# Спросить наш же сервер, какой адрес он видит у соединения через внешнее устройство. Нужно, когда
# у внешнего интерфейса адрес частный (CGNAT, роутер за роутером): публичный адрес тогда у
# оператора. Запрос идёт именно ПО ВНЕШНЕМУ УСТРОЙСТВУ: спросив как придётся, роутер, чей трафик
# уходит в туннель, узнал бы адрес выхода и выдал бы его за свой. К устройству привязывается
# только curl; uclient-fetch не умеет, и без curl адрес берётся лишь у netifd.
ping_echo() {  # УСТРОЙСТВО URL -> публичный адрес
    command -v "$PING_CURL" >/dev/null 2>&1 || return 1
    _pe="$("$PING_CURL" -4 -fsS --interface "$1" --connect-timeout 5 --max-time 8 "$2" 2>/dev/null)" ||
        return 1
    # Ответ — `{"ip":"…"}`; чужая страница (перехват провайдера) адреса не даст.
    _pe="$(printf '%s' "$_pe" |
        sed -n 's/.*"ip"[[:space:]]*:[[:space:]]*"\([0-9.]*\)".*/\1/p' | head -n 1)"
    ping_ip4_global "$_pe" || return 1
    printf '%s' "$_pe"
}
