# Отклик для счётчика роутеров на splify2.github.io: общее для команды отправки
# (/usr/sbin/splify2-ping) и объекта rpcd (m-telemetry.sh). Описание — docs/TELEMETRY.md.
#
# Уезжает ОДНО поле — идентификатор роутера. Город сервер узнаёт сам по соединению; адрес
# роутера не хранится. Здесь согласие, идентификатор и отметка последнего отклика: решение
# «отправлять ли» одно на весь продукт, и экран обязан показывать ровно то, что делает
# расписание.
#
# `set -u` не ставится: файл подключает и объект rpcd, а он живёт с необъявленными
# переменными законно.

STEER=${STEER:-/usr/sbin/steer}
# Отметка в /tmp, а не во флеше: запись раз в сутки во флеш ради счётчика не нужна, а после
# перезагрузки отклик и так уходит на ближайшем такте.
PING_STATE=${PING_STATE:-/tmp/splify2-ping}
UCI_SPLIFY2=${UCI_SPLIFY2:-/etc/config/splify2}

# Без файла настройки `uci set` молча ничего не пишет. В объекте rpcd функция своя (common.sh),
# у команды отправки её нет — тогда идентификатор считался бы ядром каждый раз заново.
command -v uci_file >/dev/null 2>&1 || uci_file() {
    [ -f "$UCI_SPLIFY2" ] && return 0
    mkdir -p "$(dirname "$UCI_SPLIFY2")" 2>/dev/null
    touch "$UCI_SPLIFY2" 2>/dev/null
    [ -f "$UCI_SPLIFY2" ]
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
