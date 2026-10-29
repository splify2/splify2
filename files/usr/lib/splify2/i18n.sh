#!/bin/sh
# Message texts of the backend: the frame speaks English, language plugins translate it.
#
# A refusal or a note for the person is written in the code as a CODE (a dictionary key), an English
# default text with {name} placeholders and the values of the placeholders:
#
#     fail_code plugin.bad_version "Invalid version: {version}" version "$PL_VER"
#
# The reply carries the text in the language of the frame, the machine word and the values, so a client
# can show its own wording:  {"ok":false,"error":"<text>","code":"plugin.bad_version","args":{"version":"x y"}}
#
# The language is the one of the frame (LuCI `luci.main.lang`; S2_LANG overrides it - tests, plugin
# programs). "auto" means the browser's language, which the backend cannot see, so the reply is in
# English then and the client translates by `code` and `args` if it wishes. The text comes from
# `i18n/backend/<lang>.json` of ENABLED plugins (a flat object "code" -> text with {name} placeholders;
# a language plugin carries the texts of the frame and of the official plugins, any plugin may carry
# its own); a language like pt-br falls back to pt. No dictionary or no code in it - the default text.
#
# The file does not print and does not end the process when sourced.

PLUGIN_ROOT="${PLUGIN_ROOT:-/usr/lib/steer/plugins}"
PLUGIN_STATE="${PLUGIN_STATE:-/etc/steer/plugins/state.json}"

# Language of this process: S2_LANG_NOW, set once.
s2_lang_init() {
    [ -z "${S2_LANG_NOW+x}" ] || return 0
    S2_LANG_NOW="${S2_LANG:-}"
    [ -n "$S2_LANG_NOW" ] || S2_LANG_NOW="$(uci -q get luci.main.lang 2>/dev/null)"
    # Язык LuCI — auto или не задан: браузер бэкенду не виден, но язык, выбранный в интерфейсе (prefs_set ui_lang), — да.
    case "$S2_LANG_NOW" in ''|auto) S2_LANG_NOW="$(uci -q get splify2.main.ui_lang 2>/dev/null)" ;; esac
    case "$S2_LANG_NOW" in ''|auto|*[!A-Za-z0-9_-]*) S2_LANG_NOW=en ;; esac
    S2_LANG_NOW="$(printf '%s' "$S2_LANG_NOW" | tr 'A-Z_' 'a-z-')"
}

# The text of a code in the language of the frame (without substitutions); code 1 - there is none.
s2_lookup() {  # CODE
    case "$1" in ''|*[!A-Za-z0-9._-]*) return 1 ;; esac
    s2_lang_init
    _s2l_base="${S2_LANG_NOW%%-*}"
    for _s2l_lg in "$S2_LANG_NOW" "$_s2l_base"; do
        for _s2l_f in "$PLUGIN_ROOT"/*/i18n/backend/"$_s2l_lg".json; do
            [ -r "$_s2l_f" ] || continue
            _s2l_id="${_s2l_f%/i18n/backend/*}"; _s2l_id="${_s2l_id##*/}"
            [ "$(jsonfilter -i "$PLUGIN_STATE" -e "@.plugins['$_s2l_id'].state" 2>/dev/null)" = enabled ] || continue
            _s2l_v="$(jsonfilter -i "$_s2l_f" -e "@['$1']" 2>/dev/null)"
            [ -n "$_s2l_v" ] && { printf '%s' "$_s2l_v"; return 0; }
        done
        # Шов стенда: каталог со словарями <язык>.json сверх плагинов (на роутере не задаётся никогда).
        if [ -n "${S2_DICT_EXTRA:-}" ] && [ -r "$S2_DICT_EXTRA/$_s2l_lg.json" ]; then
            _s2l_v="$(jsonfilter -i "$S2_DICT_EXTRA/$_s2l_lg.json" -e "@['$1']" 2>/dev/null)"
            [ -n "$_s2l_v" ] && { printf '%s' "$_s2l_v"; return 0; }
        fi
        [ "$_s2l_base" != "$S2_LANG_NOW" ] || break
    done
    return 1
}

# Placeholders {name} of a text -> values.  s2_subst TEXT [NAME VALUE]...
s2_subst() {
    _s2s_t="$1"; shift
    while [ $# -ge 2 ]; do
        _s2s_n="{$1}"; _s2s_out=""
        while case "$_s2s_t" in *"$_s2s_n"*) true ;; *) false ;; esac; do
            _s2s_out="$_s2s_out${_s2s_t%%"$_s2s_n"*}$2"
            _s2s_t="${_s2s_t#*"$_s2s_n"}"
        done
        _s2s_t="$_s2s_out$_s2s_t"
        shift 2
    done
    printf '%s' "$_s2s_t"
}

# The text for the person: s2_t CODE DEFAULT [NAME VALUE]...
s2_t() {
    _s2t_c="$1"; _s2t_d="$2"; shift 2
    s2_lang_init    # до подоболочки: иначе язык определялся бы (uci) при каждом вызове
    _s2t_x="$(s2_lookup "$_s2t_c")" || _s2t_x=""
    [ -n "$_s2t_x" ] || _s2t_x="$_s2t_d"
    s2_subst "$_s2t_x" "$@"
}

# The part after ok/error/code of a refusal: "args" object of NAME VALUE pairs (always present).
s2_args_add() {
    json_add_object args
    while [ $# -ge 2 ]; do json_add_string "$1" "$2"; shift 2; done
    json_close_object
}

# The fields of a refusal in the document being built (error, code, args), for replies that carry more fields:
# s2_fail_fields CODE DEFAULT [NAME VALUE]...
s2_fail_fields() {
    _s2f_c="$1"; _s2f_d="$2"; shift 2
    _s2f_x="$(s2_t "$_s2f_c" "$_s2f_d" "$@")"
    json_add_string error "$_s2f_x"
    json_add_string code "$_s2f_c"
    s2_args_add "$@"
}

# The whole refusal document, nothing else is done: s2_fail_doc CODE DEFAULT [NAME VALUE]...
s2_fail_doc() {
    json_init
    json_add_boolean ok 0
    s2_fail_fields "$@"
    json_dump
}

# ---- Отказы ядра steer -----------------------------------------------------------------------------------------------
#
# Отказ ядра приходит как {"error":"<русский текст>","code":"spec.unknown_kind","args":{"1":"outputs.a",…}} (steer docs/errors.md).
# Каркас переводит его так же, как свои тексты: словарь ключом «steer.<код ядра>» (lang-ru, lang-en), подстановки {1}, {id}… из
# args; перед переводом — приставки {in}: {path}: (место в спеке: путь выхода и путь ключа; строка и столбец идут отдельно).
# В ответе код — «steer.<код ядра>», args — как у ядра. Нет кода, перевода или словаря — текст ядра дословно.

# Разобрать args ядра в переменные S2_CA_N, S2_CA_K_<i>, S2_CA_V_<i>. Зовут ДО json_init: json_load сбрасывает строящийся документ.
s2_core_load() {  # ARGS_JSON
    S2_CA_N=0
    [ -n "${1:-}" ] || return 0
    json_load "$1" 2>/dev/null || return 0
    _s2c_ks=""
    json_get_keys _s2c_ks 2>/dev/null
    for _s2c_k in $_s2c_ks; do
        _s2c_v=""
        json_get_var _s2c_v "$_s2c_k" 2>/dev/null
        S2_CA_N=$((S2_CA_N + 1))
        eval "S2_CA_K_$S2_CA_N=\$_s2c_k; S2_CA_V_$S2_CA_N=\$_s2c_v"
    done
}

# Значение подстановки по имени (после s2_core_load); пусто — нет.
s2_core_arg() {  # ИМЯ
    _s2a_i=0
    while [ "$_s2a_i" -lt "${S2_CA_N:-0}" ]; do
        _s2a_i=$((_s2a_i + 1))
        eval "_s2a_k=\$S2_CA_K_$_s2a_i"
        [ "$_s2a_k" = "$1" ] || continue
        eval "printf '%s' \"\$S2_CA_V_$_s2a_i\""
        return 0
    done
    return 1
}

# Текст отказа ядра на языке каркаса: s2_core_text КОД ТЕКСТ_ЯДРА. Нет перевода — ТЕКСТ_ЯДРА без изменений.
s2_core_text() {
    _s2x_t="$(s2_lookup "steer.$1")" || { printf '%s' "$2"; return 0; }
    set --  # чистые позиционные: пары имя-значение
    _s2x_i=0
    while [ "$_s2x_i" -lt "${S2_CA_N:-0}" ]; do
        _s2x_i=$((_s2x_i + 1))
        eval "set -- \"\$@\" \"\$S2_CA_K_$_s2x_i\" \"\$S2_CA_V_$_s2x_i\""
    done
    _s2x_t="$(s2_subst "$_s2x_t" "$@")"
    _s2x_p=""
    for _s2x_n in in path; do
        _s2x_v="$(s2_core_arg "$_s2x_n")" && [ -n "$_s2x_v" ] && _s2x_p="$_s2x_p$_s2x_v: "
    done
    printf '%s%s' "$_s2x_p" "$_s2x_t"
}

# Поля отказа ядра в строящийся документ: error (по-русски/по-английски), code «steer.КОД», args (с третьим словом — вид отказа плагинной части:
# code — оно, msg — «steer.КОД»). Перед json_init — s2_core_load.
# S2_CORE_PREFIX — слова, которые идут перед переводом (предупреждения хуков).
s2_core_fields() {  # КОД ТЕКСТ_ЯДРА [ВИД_ОТКАЗА]
    _s2y_c="$1"; _s2y_d="$2"
    if s2_lookup "steer.$_s2y_c" >/dev/null; then
        _s2y_x="${S2_CORE_PREFIX:-}$(s2_core_text "$_s2y_c" "$_s2y_d")"
    else
        _s2y_x="$_s2y_d"
    fi
    json_add_string error "$_s2y_x"
    if [ -n "${3:-}" ]; then
        # Ответ плагинной части: code — вид отказа ($3), msg — код текста.
        json_add_string code "$3"
        json_add_string msg "steer.$_s2y_c"
    else
        json_add_string code "steer.$_s2y_c"
    fi
    json_add_object args
    _s2y_i=0
    while [ "$_s2y_i" -lt "${S2_CA_N:-0}" ]; do
        _s2y_i=$((_s2y_i + 1))
        eval "json_add_string \"\$S2_CA_K_$_s2y_i\" \"\$S2_CA_V_$_s2y_i\""
    done
    json_close_object
}

# Отделить от вывода команды ядра (stdout и stderr вместе) строку отказа JSON, которую ядро печатает при STEER_ERR_JSON=1.
# После вызова: S2_CORE_TEXT — вывод без этой строки, S2_CORE_CODE и S2_CORE_ARGS — код и подстановки ('' — кода нет).
# Код возврата 0, если код есть.
s2_core_split() {  # ВЫВОД
    S2_CORE_TEXT="$1"; S2_CORE_CODE=""; S2_CORE_ARGS=""
    case "$1" in *'{"ok":false,"error":"'*) ;; *) return 1 ;; esac
    _s2k_j="$(printf '%s\n' "$1" | sed -n '/^{"ok":false,"error":"/h;${x;p}')"
    [ -n "$_s2k_j" ] || return 1
    S2_CORE_TEXT="$(printf '%s\n' "$1" | sed '/^{"ok":false,"error":"/d')"
    S2_CORE_CODE="$(jsonfilter -s "$_s2k_j" -e '@.code' 2>/dev/null)"
    S2_CORE_ARGS="$(jsonfilter -s "$_s2k_j" -e '@.args' 2>/dev/null)"
    [ -n "$S2_CORE_CODE" ]
}
