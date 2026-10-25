#!/bin/sh
# Общее для программ плагина autoapply: настройки, «есть ли неприменённое», применение и запись исхода.
#
# Каркасу плагин принадлежит только через API: библиотека `$SPLIFY2_LIB` и службы хоста `$SPLIFY2_HOST` (`spec get
# [--applied]`, `apply`, `settings`). Применение — та же служба, что кнопка «Применить»: зоны фаервола, хуки, снимок
# применённого.
. "${SPLIFY2_LIB:?программа запускается хостом splify2 (нет SPLIFY2_LIB)}"

CONF_DIR="${STEER_PLUGIN_CONF:?нет STEER_PLUGIN_CONF}"
RUN_DIR="${STEER_PLUGIN_STATE:?нет STEER_PLUGIN_STATE}"
# Отложенное применение: «метка отсчёт» — метка последней правки и время; исход последнего применения; отпечаток спеки,
# которую ядро отвергло (её не повторяем, пока спека не изменится).
PENDING="$RUN_DIR/pending"
LAST="$RUN_DIR/last.json"
FAILED="$RUN_DIR/failed-sum"

num_or() { case "$1" in ''|*[!0-9]*) printf '%s' "$2" ;; *) printf '%s' "$1" ;; esac; }
is_on() { [ "$(s2_setting "$1" 2>/dev/null)" = true ]; }
pause_s() { num_or "$(s2_setting pause_s 2>/dev/null)" 2; }

# Неприменённое есть: спека и снимок применённого различаются. Копии — в рабочем каталоге (память, закрытый).
SPEC_CUR="$RUN_DIR/spec.cur"; SPEC_APP="$RUN_DIR/spec.app"
unapplied() {
    "$SPLIFY2_HOST" spec get "$SPEC_CUR" >/dev/null 2>&1 || return 1
    "$SPLIFY2_HOST" spec get --applied "$SPEC_APP" >/dev/null 2>&1 || return 1
    ! cmp -s "$SPEC_CUR" "$SPEC_APP"
}
# Отпечаток текущей спеки (после unapplied).
spec_sum() { cksum < "$SPEC_CUR" | cut -d' ' -f1; }

# Применить и записать исход. Код: 0 — применено, 1 — ядро отвергло, 3 — не состоялось (ядро занято, остановил плагин).
do_apply() {  # ИСТОЧНИК
    _da_out="$("$SPLIFY2_HOST" apply 2>/dev/null)"; _da_rc=$?
    _da_msg="$(jsonfilter -s "$_da_out" -e '@.error' 2>/dev/null | head -n 1)"
    [ -n "$_da_msg" ] || _da_msg="$(jsonfilter -s "$_da_out" -e '@.output' 2>/dev/null | head -n 1)"
    json_init
    json_add_boolean ok "$([ "$_da_rc" = 0 ] && echo 1 || echo 0)"
    json_add_int rc "$_da_rc"
    json_add_int at "$(date -u +%s)"
    json_add_string source "$1"
    json_add_string message "$_da_msg"
    json_dump > "$LAST"
    if [ "$_da_rc" = 1 ] && [ -s "$SPEC_CUR" ]; then spec_sum > "$FAILED"
    elif [ "$_da_rc" = 0 ]; then rm -f "$FAILED"; fi
    logger -t splify2-autoapply "применение ($1): код $_da_rc${_da_msg:+, $_da_msg}"
    return "$_da_rc"
}
