#!/bin/sh
# Общее для программ плагина group-check: настройки, обход групп спеки, проба члена, приговор и история.
#
# Каркасу плагин принадлежит только через его API: библиотека `$SPLIFY2_LIB` и службы хоста `$SPLIFY2_HOST`: `spec get`
# (группы и их члены), `call outbound_probe` (отклик одного выхода), `settings`. События ядра приходят хуком подписки.
. "${SPLIFY2_LIB:?программа запускается хостом splify2 (нет SPLIFY2_LIB)}"

CONF_DIR="${STEER_PLUGIN_CONF:?нет STEER_PLUGIN_CONF}"
RUN_DIR="${STEER_PLUGIN_STATE:?нет STEER_PLUGIN_STATE}"
# Состояние и история — в памяти: пишутся при каждой пробе и событии, и сто записей в сутки на флеш незачем; перезагрузка
# обнуляет и сами члены (узел мог смениться).
STATE_DIR="$RUN_DIR/groups"
SPEC_VIEW="$RUN_DIR/spec.view.json"

num_or() { case "$1" in ''|*[!0-9]*) printf '%s' "$2" ;; *) printf '%s' "$1" ;; esac; }
setting() { "$SPLIFY2_HOST" settings get "$1" 2>/dev/null; }
setting_num() { num_or "$(setting "$1")" "$2"; }
now() { date -u +%s; }
name_ok() { case "$1" in ''|*[!a-zA-Z0-9_.-]*) return 1 ;; esac; }

# Группы спеки: строки «группа член член …» (члены — выходы по порядку предпочтения). Вложенные группы в перечень членов
# входят как есть и пробой пропускаются: у группы нет своего устройства.
groups_of_spec() {
    "$SPLIFY2_HOST" spec get "$SPEC_VIEW" >/dev/null 2>&1 || return 1
    (
        json_load "$(cat "$SPEC_VIEW")" 2>/dev/null || exit 0
        json_select outputs 2>/dev/null || exit 0
        json_get_keys _gk
        for _g in $_gk; do
            json_select "$_g" 2>/dev/null || continue
            _kind=''; json_get_var _kind kind
            if [ "$_kind" = group ] && json_select members 2>/dev/null; then
                _line="$_g"
                json_get_keys _mk
                for _m in $_mk; do _v=''; json_get_var _v "$_m"; [ -n "$_v" ] && _line="$_line $_v"; done
                printf '%s\n' "$_line"
                json_select ..
            fi
            json_select ..
        done
    )
}

# История группы: «время вид текст» по строке; последние N (настройка history).
hist_add() {  # ГРУППА ВИД ТЕКСТ
    name_ok "$1" || return 0
    mkdir -p "$STATE_DIR/$1"
    _h="$STATE_DIR/$1/history"
    printf '%s\t%s\t%s\n' "$(now)" "$2" "$(printf '%s' "$3" | tr -d '\000-\037')" >> "$_h"
    _hn="$(setting_num history 200)"
    if [ "$(grep -c . "$_h")" -gt "$_hn" ]; then tail -n "$_hn" "$_h" > "$_h.new" && mv "$_h.new" "$_h"; fi
}

# Проба одного члена: отклик выхода методом каркаса. Печатает «ms» (число ≥ 0) или «-1». Группа-член и выход без устройства
# — «-2» (проверять нечем, это не отказ).
probe_member() {  # ВЫХОД
    name_ok "$1" || { printf '%s' -2; return; }
    _pa="$(printf '{"output":"%s"}\n' "$1" | "$SPLIFY2_HOST" call outbound_probe 2>/dev/null)" || { printf '%s' -2; return; }
    # `code` — машинное слово исхода (ok, no_answer, no_device); `state` — слова для человека, по ним не ветвятся.
    _ps="$(printf '%s' "$_pa" | jsonfilter -e '@.code' 2>/dev/null)"
    case "$_ps" in
        ok) _pm="$(num_or "$(printf '%s' "$_pa" | jsonfilter -e '@.ms' 2>/dev/null)" 0)"; printf '%s' "$_pm" ;;
        no_device) printf '%s' -2 ;;
        *) printf '%s' -1 ;;
    esac
}

# Записать пробу члена: серия отказов подряд, приговор, переход в истории. Состояние члена — файл «приговор ms серия с_какого».
member_note() {  # ГРУППА ЧЛЕН MS
    _d="$STATE_DIR/$1/members"; mkdir -p "$_d"
    _f="$_d/$2"
    _verdict=''; _lastms=''; _streak=0; _since=0
    [ -s "$_f" ] && read -r _verdict _lastms _streak _since < "$_f"
    _streak="$(num_or "$_streak" 0)"
    _dead_after="$(setting_num dead_after 3)"
    if [ "$3" = -2 ]; then _new=unknown; _streak=0
    elif [ "$3" -ge 0 ]; then _new=alive; _streak=0
    else
        _streak=$((_streak + 1))
        if [ "$_streak" -ge "$_dead_after" ]; then _new=dead; else _new=unstable; fi
    fi
    if [ "$_new" != "$_verdict" ]; then
        _since="$(now)"
        [ -n "$_verdict" ] && hist_add "$1" verdict "$2: $_verdict -> $_new"
        [ -z "$_verdict" ] && [ "$_new" != alive ] && [ "$_new" != unknown ] && hist_add "$1" verdict "$2: $_new"
    fi
    printf '%s %s %s %s\n' "$_new" "$3" "$_streak" "$_since" > "$_f"
}

# Проба всех членов одной группы («группа член …»).
check_group_line() {  # СТРОКА
    set -- $1
    _grp="$1"; shift
    name_ok "$_grp" || return 0
    for _mem in "$@"; do
        member_note "$_grp" "$_mem" "$(probe_member "$_mem")"
    done
    now > "$STATE_DIR/$_grp/checked"
}
