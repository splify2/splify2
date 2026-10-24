# ReCheck — обход DPI на прямом трафике, самостоятельная часть splify2 (служба
# /etc/init.d/splify2-recheck, помощники /usr/lib/splify2/recheck.sh). Движок — отдельный пакет
# recheck; без него методы отвечают installed=false, а настройки всё равно пишутся.

. "${RECHECK_SH:-/usr/lib/splify2/recheck.sh}"

RECHECK_INIT=${RECHECK_INIT:-/etc/init.d/splify2-recheck}
RECHECK_KEEP=/etc/splify2/recheck.cache

# Версия пакета recheck из базы apk (вызывать сам apk — сотни миллисекунд).
recheck_version() {
    awk '/^P:recheck$/ { f = 1; next } f && /^V:/ { sub(/^V:/, ""); print; exit } /^$/ { f = 0 }' \
        /lib/apk/db/installed 2>/dev/null
}

case "$2" in

    recheck_info)
        json_init
        json_add_boolean installed "$([ -x "$RECHECK_BIN" ] && echo 1 || echo 0)"
        json_add_string version "$(recheck_version)"
        _pid="$(pidof steer-dpi-live 2>/dev/null | cut -d' ' -f1)"
        json_add_boolean running "$([ -n "$_pid" ] && echo 1 || echo 0)"
        json_add_boolean enabled "$([ "$(recheck_get enabled 0)" = 1 ] && echo 1 || echo 0)"
        json_add_string interface "$(recheck_get interface)"
        json_add_string wan "$(recheck_wan)"
        json_add_int epoch "$(recheck_get epoch 1)"
        _state="$(recheck_get state /tmp/recheck.cache)"
        json_add_boolean persist "$([ "$_state" = "$RECHECK_KEEP" ] && echo 1 || echo 0)"
        json_add_boolean watch_active "$(recheck_flag watch-active && echo 1 || echo 0)"
        json_add_array resources
        for _r in $(sed -n 's/^probe-resource=//p' "$RECHECK_CONF" 2>/dev/null | head -4); do json_add_string '' "$_r"; done
        json_close_array
        # Сколько пакетов ушло движку с запуска таблицы: первые пакеты соединений и наблюдение.
        _cnt="$(nft list table inet "$RECHECK_TABLE" 2>/dev/null | awk -v q="$RECHECK_QUEUE" -v w="$RECHECK_WATCH" '
            / counter packets / { for (i = 1; i < NF; i++) if ($i == "packets") n = $(i + 1)
                if ($NF == q) a += n; else if ($NF == w) b += n }
            END { printf "%d %d", a, b }')"
        json_add_int queued "${_cnt% *}"
        json_add_int watched "${_cnt#* }"
        # Изученное — файл памяти движка как есть (до 64 адресов и 8 семейств, разбирает экран);
        # движок пишет его раз в 5 минут, если что-то изменилось, и при остановке.
        if [ -s "$_state" ] && own_file "$_state"; then
            json_add_string state "$(head -c 262144 "$_state")"
        else
            json_add_string state ""
        fi
        # Последние события движка из журнала, строкой «ЧЧ:ММ:СС event=… host=… ip=… port=…»: что
        # проверялось и чем кончилось. Время — журнала: у движка в событии только монотонные часы.
        json_add_string events "$(logread -e steer-dpi-live 2>/dev/null |
            sed -n 's/^[A-Za-z]* [A-Za-z]* *[0-9]* \([0-9:]*\) .*: \(event=[a-z-]* .*host=[^ ]* ip=[^ ]* port=[0-9]*\).*/\1 \2/p' | tail -80)"
        json_dump
        ;;

    recheck_set)
        read -r input
        json_load "$input" 2>/dev/null || fail "неразбираемый запрос"
        json_get_var enabled enabled
        json_get_var iface interface
        json_get_var persist persist
        json_get_var watch watch_active
        json_get_var bump epoch_bump
        json_get_var forget forget
        case "${iface:-}" in *[!A-Za-z0-9._@-]*) fail "недопустимое имя устройства" ;; esac
        [ "${#iface}" -le 15 ] || fail "недопустимое имя устройства"
        # Прежние значения — для полей, которых в запросе нет.
        [ -n "${enabled:-}" ] || enabled="$(recheck_get enabled 0)"
        json_get_type _t interface; [ -n "${_t:-}" ] || iface="$(recheck_get interface)"
        _state="$(recheck_get state /tmp/recheck.cache)"
        if [ -n "${persist:-}" ]; then
            case "$persist" in 1|true) _new="$RECHECK_KEEP" ;; *) _new=/tmp/recheck.cache ;; esac
        else
            _new="$_state"
        fi
        [ -n "${watch:-}" ] || { recheck_flag watch-active && watch=1 || watch=0; }
        _epoch="$(recheck_get epoch 1)"
        case "$_epoch" in ''|*[!0-9]*) _epoch=1 ;; esac
        case "${bump:-}" in 1|true) _epoch=$((_epoch + 1)) ;; esac
        set --
        if json_is_a resources array; then
            json_select resources
            _i=1
            while json_is_a "$_i" string; do
                json_get_var _u "$_i"
                case "$_u" in https://*) ;; *) fail "адрес проверки — только https://" ;; esac
                case "$_u" in *[!A-Za-z0-9:/._~%?=\&+@!\$\'\(\)*,\;#-]*) fail "недопустимый адрес проверки" ;; esac
                [ "${#_u}" -le 500 ] || fail "адрес проверки длиннее 500 знаков"
                set -- "$@" "$_u"
                _i=$((_i + 1))
            done
            json_select ..
            [ "$#" -le 4 ] || fail "адресов проверки — не больше 4: столько принимает движок"
        else
            for _r in $(sed -n 's/^probe-resource=//p' "$RECHECK_CONF" 2>/dev/null | head -4); do set -- "$@" "$_r"; done
        fi
        mkdir -p "${RECHECK_CONF%/*}"
        _tmp="$RECHECK_CONF.$$"
        {
            echo "enabled=$(case "$enabled" in 1|true) echo 1 ;; *) echo 0 ;; esac)"
            [ -n "$iface" ] && echo "interface=$iface"
            echo "epoch=$_epoch"
            echo "state=$_new"
            for _u in "$@"; do echo "probe-resource=$_u"; done
            case "$watch" in 1|true) echo watch-active ;; esac
        } > "$_tmp" && mv "$_tmp" "$RECHECK_CONF" || { rm -f "$_tmp"; fail "настройки не записались — кончилось место на флеше?"; }
        # Остановка — до переноса памяти: движок дописывает её при выходе.
        "$RECHECK_INIT" stop >/dev/null 2>&1
        case "${forget:-}" in 1|true) rm -f "$_state" "$_new" ;; esac
        [ "$_new" != "$_state" ] && [ -s "$_state" ] && own_file "$_state" && cp "$_state" "$_new" 2>/dev/null && rm -f "$_state"
        if grep -qx enabled=1 "$RECHECK_CONF"; then
            "$RECHECK_INIT" enable >/dev/null 2>&1
            "$RECHECK_INIT" start >/dev/null 2>&1
        else
            "$RECHECK_INIT" disable >/dev/null 2>&1
        fi
        json_init; json_add_boolean ok 1; json_dump
        ;;

    *) fail "неизвестный метод" ;;
esac
