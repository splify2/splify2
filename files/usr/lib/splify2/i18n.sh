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

# The whole refusal document, nothing else is done: s2_fail_doc CODE DEFAULT [NAME VALUE]...
s2_fail_doc() {
    _s2f_c="$1"; _s2f_d="$2"; shift 2
    _s2f_x="$(s2_t "$_s2f_c" "$_s2f_d" "$@")"
    json_init
    json_add_boolean ok 0
    json_add_string error "$_s2f_x"
    json_add_string code "$_s2f_c"
    s2_args_add "$@"
    json_dump
}
