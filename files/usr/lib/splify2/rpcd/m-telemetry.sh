# Отклик для счётчика на splify2.github.io: состояние и переключатель. Описание —
# docs/TELEMETRY.md. Отправки здесь нет: её делает /usr/sbin/splify2-ping по расписанию.

case "$2" in

    telemetry_state)
        need_ping
        json_init
        # `consent` — три состояния (по умолчанию, включил сам, выключил); `on` — уйдёт ли
        # отклик, и считается это той же функцией, что у команды отправки.
        json_add_string consent "$(ping_consent)"
        json_add_boolean on "$(ping_allowed && echo 1 || echo 0)"
        json_add_int last_at "$(ping_int "$(ping_get ok)")"
        json_add_string last_error "$(ping_get err)"
        json_dump
        ;;

    telemetry_set)
        need_ping
        read -r input 2>/dev/null
        [ -n "$input" ] || input='{}'
        json_load "$input" 2>/dev/null
        json_get_var on on 2>/dev/null
        case "${on:-}" in
            1|0|true|false) ;;
            *) fail "on: 1 — включить, 0 — выключить" ;;
        esac
        uci_file || fail "не удалось подготовить /etc/config/splify2"
        case "$on" in
            1|true) uci -q set splify2.main.telemetry=1 || fail "не удалось записать согласие" ;;
            *)      uci -q set splify2.main.telemetry=0 || fail "не удалось записать отказ" ;;
        esac
        # Выключение убирает идентификатор и отметку: хранить их после «нет» незачем. Включение
        # вернёт тот же идентификатор — счёт детерминирован.
        case "$on" in
            1|true) ;;
            *) uci -q delete splify2.main.telemetry_id 2>/dev/null
               rm -f "$PING_STATE" 2>/dev/null ;;
        esac
        uci -q commit splify2 || fail "настройка не записалась — кончилось место на флеше?"
        json_init; json_add_boolean ok 1; json_add_string consent "$(ping_consent)"; json_dump
        ;;

    *) fail "неизвестный метод" ;;
esac
