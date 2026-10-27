#!/bin/sh
# Плагины в бэкенде splify2: общие помощники для методов вкладки «Плагины» (rpcd/m-plugin.sh), для
# диспетчера методов самих плагинов (plugin-rpcd) и для разбора состояния в m-engine.sh.
#
# ХОЗЯИН ПЛАГИНОВ — ЯДРО STEER. Менеджер (`steer plugin …`, методы plugin-* сокета ctl) ставит, снимает,
# включает и обновляет; бэкенд только зовёт его и показывает ответ (plugin-sdk/docs/steer-api.md, 4.2).
# Своей модели плагинов здесь нет: что стоит и включено — `state.json` менеджера, что плагин умеет —
# его `plugin.json`. Чужой пакет — чужая настройка: системные пакеты плагинов ставит и помнит
# менеджер, здесь их не трогают.
#
# Файл подключается точкой из трёх мест, поэтому у него нет своего `exit` и он ничего не печатает
# при подключении.

PLUGIN_ROOT="${PLUGIN_ROOT:-/usr/lib/steer/plugins}"
PLUGIN_STATE="${PLUGIN_STATE:-/etc/steer/plugins/state.json}"
PLUGIN_CONF_DIR="${PLUGIN_CONF_DIR:-/etc/steer/plugins/conf}"
# Объект ubus `splify2.p.<id>` — это файл с таким же именем в каталоге обработчиков rpcd: имя объекта
# rpcd берёт из имени файла. ACL — отдельный файл группы `splify2-p-<id>` (имя группы — любое).
PLUGIN_RPCD_DIR="${PLUGIN_RPCD_DIR:-/usr/libexec/rpcd}"
PLUGIN_ACL_DIR="${PLUGIN_ACL_DIR:-/usr/share/rpcd/acl.d}"
PLUGIN_DISPATCHER="${PLUGIN_DISPATCHER:-/usr/lib/splify2/plugin-rpcd}"
# Каталог интерфейса плагина раздаёт uhttpd: ссылка /www/luci-static/resources/splify2/plugins/<id> ->
# <каталог плагина>/ui (plugin-sdk/docs/s2p.md, «Раскладка»). Раздаётся ТОЛЬКО ui/, не весь плагин: рядом с
# ним лежат программы и манифест.
PLUGIN_UI_DIR="${PLUGIN_UI_DIR:-/www/luci-static/resources/splify2/plugins}"
PLUGIN_JOBS="${PLUGIN_JOBS:-/tmp/splify2-plugin-jobs}"
# Версия host API панели (plugin-sdk/docs/host-api.md). Её отдаёт plugins_list: плагин, которому
# нужен host-api новее, не грузится, а раздел «Плагины» называет причину.
PLUGIN_HOST_API="${PLUGIN_HOST_API:-1.0.0}"
# Срок rpc-метода плагина по умолчанию — manifest.md, раздел rpc.
PLUGIN_RPC_TIMEOUT=30
# Версия splify2-api (plugin-sdk/docs/splify2-api.md): хуки, задачи, события, псевдонимы и переопределения. Её
# отдаёт plugins_list рядом с host_api; плагин с compat.splify2-api другого major блок `splify2` не получает.
PLUGIN_SPLIFY2_API="${PLUGIN_SPLIFY2_API:-1.0.0}"
# Каталог библиотек: рядом с plugin.sh лежат lib.sh, env.sh, ext.sh и methods.tsv. Стенды подставляют PLUGIN_SH,
# и каталог выводится из него.
SPLIFY2_LIBDIR="${SPLIFY2_LIBDIR:-${PLUGIN_SH:+${PLUGIN_SH%/*}}}"
SPLIFY2_LIBDIR="${SPLIFY2_LIBDIR:-/usr/lib/splify2}"
EXT_SH="${EXT_SH:-$SPLIFY2_LIBDIR/ext.sh}"
SPLIFY2_LIB="${SPLIFY2_LIB:-$SPLIFY2_LIBDIR/lib.sh}"
# Службы хоста для программ плагинов (splify2-api, «Службы хоста») и каталог рабочих файлов плагина в памяти
# (steer-api: STEER_PLUGIN_STATE, <state>/plugin/<id>).
SPLIFY2_HOST="${SPLIFY2_HOST:-/usr/sbin/splify2-host}"
PLUGIN_STATE_DIR="${PLUGIN_STATE_DIR:-${STEER_STATE_DIR:-/var/lib/steer}/plugin}"

# Тексты для человека: s2_t, s2_fail_doc (i18n.sh); диспетчер плагинов подключает только этот файл.
command -v s2_t >/dev/null 2>&1 || . "${I18N_SH:-$SPLIFY2_LIBDIR/i18n.sh}"

# Расширения каркаса подключаются лениво: нужны plugin_sync, хукам и методам с псевдонимами.
plugin_need_ext() { command -v ext_rebuild >/dev/null 2>&1 || . "$EXT_SH"; }

# Окружение программы плагина: каталог, настройки, рабочий каталог в памяти, версия splify2-api, службы хоста и
# библиотека для shell-плагинов (lib.sh). Рабочий каталог создаётся закрытым (0700): в нём плагин держит то, что не
# должно пережить перезагрузку и чего не должен читать чужой процесс.
plugin_export_env() {  # ID
    export STEER_PLUGIN_ID="$1" STEER_PLUGIN_DIR="$PLUGIN_ROOT/$1" STEER_PLUGIN_CONF="$PLUGIN_CONF_DIR/$1" \
           STEER_PLUGIN_STATE="$PLUGIN_STATE_DIR/$1" SPLIFY2_API=1 SPLIFY2_LIB SPLIFY2_HOST \
           PLUGIN_ROOT PLUGIN_STATE
    ( umask 077; mkdir -p "$STEER_PLUGIN_STATE" ) 2>/dev/null
    mkdir -p "$STEER_PLUGIN_CONF" 2>/dev/null
}

# id плагина — [a-z0-9][a-z0-9-]* (manifest.md). Он становится именем файла и попадает в
# командную строку, поэтому всё остальное отвергается до любого использования.
plugin_id_ok() {  # ID
    case "$1" in
        '') return 1 ;;
        [!a-z0-9]*|*[!a-z0-9-]*) return 1 ;;
    esac
    [ "${#1}" -le 64 ]
}

# Версия для `steer plugin install <id> <версия>`: semver с суффиксами. Пробелов и слэшей нет.
plugin_ver_ok() {  # ВЕРСИЯ
    case "$1" in
        '') return 1 ;;
        [!0-9]*|*[!0-9A-Za-z.+~-]*) return 1 ;;
    esac
    return 0
}

# Метод плагина: [a-z][a-z0-9_]* — та же форма, что у схемы манифеста и у шлюза.
plugin_method_ok() {  # ИМЯ
    case "$1" in
        '') return 1 ;;
        [!a-z]*|*[!a-z0-9_]*) return 1 ;;
    esac
    [ "${#1}" -le 64 ]
}

# Ответ-отказ плагинной части: {ok:false, error, code, msg, args}. code — машинное слово вида отказа, по
# которому интерфейс выбирает его вид: bad_request, not_installed, disabled, no_method, unavailable, timeout,
# failed, busy. msg — код текста (ключ словаря i18n/backend/<язык>.json), args — подстановки {имя}; error —
# текст на языке каркаса (i18n.sh). Печатает и возвращает 1: вызывающий решает, выходить ли ему.
plugin_fail() {  # КОД КЛЮЧ ТЕКСТ [ИМЯ ЗНАЧЕНИЕ]...
    _pf_k="$1"; _pf_m="$2"; _pf_d="$3"; shift 3
    _pf_x="$(s2_t "$_pf_m" "$_pf_d" "$@")"
    json_init
    json_add_boolean ok 0
    json_add_string error "$_pf_x"
    json_add_string code "$_pf_k"
    json_add_string msg "$_pf_m"
    s2_args_add "$@"
    json_dump
    return 1
}

# То же с готовым текстом (слова менеджера плагинов ядра). Ядро назвало причину кодом (КОД_ЯДРА, ARGS_JSON его ответа) —
# текст переводится по словарю «steer.КОД», в ответе msg = steer.КОД и args; нет кода — текст ядра дословно.
plugin_fail_raw() {  # ВИД ТЕКСТ [КОД_ЯДРА [ARGS_JSON]]
    s2_core_load "${4:-}"    # до json_init: json_load сбрасывает документ
    json_init
    json_add_boolean ok 0
    if [ -n "${3:-}" ]; then
        s2_core_fields "$3" "$2" "$1"
    else
        json_add_string error "$2"
        json_add_string code "$1"
    fi
    json_dump
    return 1
}

# Код и подстановки отказа менеджера (поля code и args его ответа в PLUGIN_OUT): PLUGIN_ECODE, PLUGIN_EARGS; пусто — слова нет.
# Не в подоболочке: переменные нужны вызывающему.
plugin_manager_core() {
    PLUGIN_ECODE=""; PLUGIN_EARGS=""
    if _pmc_obj="$(plugin_json_obj "$PLUGIN_OUT")"; then
        PLUGIN_ECODE="$(jsonfilter -s "$_pmc_obj" -e '@.code' 2>/dev/null)"
        PLUGIN_EARGS="$(jsonfilter -s "$_pmc_obj" -e '@.args' 2>/dev/null)"
    fi
}

# Если $1 — объект JSON (по виду и по разбору), печатает его без внешних пробелов. Иначе возвращает 1.
plugin_json_obj() {  # ТЕКСТ
    _pj="$1"
    _pj="${_pj#"${_pj%%[![:space:]]*}"}"
    _pj="${_pj%"${_pj##*[![:space:]]}"}"
    case "$_pj" in '{'*'}') ;; *) return 1 ;; esac
    [ -n "$(jsonfilter -s "$_pj" -e '@' 2>/dev/null)" ] || return 1
    printf '%s' "$_pj"
}

# Массив JSON из ответа менеджера: поле KEY объекта либо сам ответ, если он массив. Нет поля —
# пустой массив: менеджер без плагинов печатает пустой список, и это не отказ.
plugin_json_array() {  # ТЕКСТ КЛЮЧ
    _pa="$1"
    _pa="${_pa#"${_pa%%[![:space:]]*}"}"
    case "$_pa" in
        '['*) printf '%s' "$_pa"; return 0 ;;
    esac
    _pa="$(jsonfilter -s "$_pa" -e "@.$2" 2>/dev/null)"
    case "$_pa" in '['*) printf '%s' "$_pa" ;; *) printf '[]' ;; esac
}

# Строка JSON в кавычках: \ " и переводы строк экранируются, прочие управляющие знаки выбрасываются.
# Склейка строк — `$!{N;ba}`, а не `N` с проверкой: у однострочного текста `N` на последней строке завершает sed
# до подстановок, и кавычки оставались неэкранированными.
plugin_jstr() {  # ТЕКСТ
    printf '"'
    printf '%s' "$1" | tr -d '\000-\010\013-\037' | sed -e ':a' -e '$!{N;ba' -e '}' \
        -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e "s/$(printf '\t')/\\\\t/g" -e 's/\n/\\n/g'
    printf '"'
}

# Ответ `{ok:true}` с добавленными сырыми полями JSON: пары «ключ значение» через аргументы.
# Значения — готовый JSON (объект, массив, строка в кавычках), ключи — наши слова.
plugin_ok_raw() {  # [КЛЮЧ СЫРОЕ_ЗНАЧЕНИЕ]...
    json_init
    json_add_boolean ok 1
    _por="$(json_dump)"
    _por="${_por%\}}"
    while [ $# -ge 2 ]; do
        _por="$_por,\"$1\":$2"
        shift 2
    done
    printf '%s}\n' "$_por"
}

# ---- вызов менеджера ------------------------------------------------------------------------

# Менеджер: `steer plugin <действие> … --json`. Итог: PLUGIN_OUT — stdout, PLUGIN_ERR — stderr,
# возврат — код менеджера. Stdin — как у вызывающего (тело ключа репозитория идёт им).
# Ответ ядра хранится в переменных, а не в файлах: плагинные ответы малы.
plugin_manager() {  # ДЕЙСТВИЕ [АРГУМЕНТЫ...]
    # Временный файл — только mktemp (предсказуемое имя в /tmp занимает чужой процесс заранее). Не вышло
    # (нет места) — stderr менеджера теряется, а его stdout и код остаются.
    _pm_err="$(mktemp 2>/dev/null)" || _pm_err=/dev/null
    PLUGIN_OUT="$("$STEER" plugin "$@" --json 2>"$_pm_err")"
    PLUGIN_RC=$?
    PLUGIN_ERR=""
    [ "$_pm_err" = /dev/null ] || { PLUGIN_ERR="$(cat "$_pm_err" 2>/dev/null)"; rm -f "$_pm_err"; }
    return $PLUGIN_RC
}

# ЯДРО БЕЗ МЕНЕДЖЕРА ПЛАГИНОВ. Менеджер — с ядра 2.1; на более старом `steer plugin` отвечает «нет такой
# команды», и эти слова человеку ничего не говорят. Приговор — по версии ядра (`steer version --json`, у
# ядер без --json — первая строка `steer X.Y.Z …`), а не по тексту отказа, и только когда менеджер отказал.
PLUGIN_CORE_MIN="${PLUGIN_CORE_MIN:-2.1}"

# Версия ядра — цифры и точки; пусто, если ядро не ответило.
plugin_core_version() {
    _cv="$("$STEER" version --json 2>/dev/null)"
    case "$_cv" in
        '{'*) _cv="$(jsonfilter -s "$_cv" -e '@.version' 2>/dev/null)" ;;
        *) _cv="$(printf '%s\n' "$_cv" | sed -n '1s/^steer \([0-9][0-9.]*\).*/\1/p')" ;;
    esac
    printf '%s' "$_cv" | sed -n 's/^v\{0,1\}\([0-9][0-9.]*\).*/\1/p'
}

# Версия $1 младше PLUGIN_CORE_MIN.
plugin_core_old() {  # ВЕРСИЯ
    [ -n "$1" ] || return 1
    [ "$(printf '%s\n%s\n' "$1" "$PLUGIN_CORE_MIN" | sort -V | head -n 1)" != "$PLUGIN_CORE_MIN" ]
}

# Текст отказа по итогам plugin_manager: поле `error` JSON-ответа, иначе stderr, иначе stdout, иначе
# слова про код. Менеджер называет причину числами и именами (место, совместимость, выходы) — они
# доходят до человека как есть.
plugin_manager_error() {
    _pe=""
    # 126 и 127 — ядра или команды `plugin` нет: слова оболочки о ненайденном файле человеку не нужны.
    case "$PLUGIN_RC" in
        126|127) printf '%s' "$(s2_t plugin.core_cannot "The core does not support plugins. Update steer.")"; return 0 ;;
    esac
    if _pe_obj="$(plugin_json_obj "$PLUGIN_OUT")"; then
        _pe="$(jsonfilter -s "$_pe_obj" -e '@.error' 2>/dev/null)"
    fi
    [ -n "$_pe" ] || _pe="$PLUGIN_ERR"
    [ -n "$_pe" ] || { case "$PLUGIN_OUT" in '{'*|'['*) ;; *) _pe="$PLUGIN_OUT" ;; esac; }
    if [ -z "$_pe" ]; then
        case "$PLUGIN_RC" in
            126|127) _pe="$(s2_t plugin.core_cannot "The core does not support plugins. Update steer.")" ;;
            *) _pe="$(s2_t plugin.manager_silent "The plugin manager did not answer (code {code})" code "$PLUGIN_RC")" ;;
        esac
    fi
    printf '%s' "$_pe"
}

# Отказ менеджера по-русски: ответ `{ok:false, error, code}`. Менеджер, ответивший «busy» (параллельный
# запрос под его замком), получает код busy.
plugin_manager_fail() {
    # Ядро старше 2.1: код core_too_old и числа — интерфейс говорит человеку своими словами.
    _pf_v="$(plugin_core_version)"
    if plugin_core_old "$_pf_v"; then
        json_init
        json_add_boolean ok 0
        json_add_string error "$(s2_t plugin.core_too_old "The core {installed} does not support plugins: {need} or newer is required" installed "$_pf_v" need "$PLUGIN_CORE_MIN")"
        json_add_string code core_too_old
        json_add_string installed "$_pf_v"
        json_add_string need "$PLUGIN_CORE_MIN"
        json_dump
        return 1
    fi
    _pf="$(plugin_manager_error)"
    _pf_code=failed
    case "$_pf" in busy|busy:*|*" busy"*) _pf_code=busy ;; esac
    plugin_manager_core
    plugin_fail_raw "$_pf_code" "$_pf" "$PLUGIN_ECODE" "$PLUGIN_EARGS"
}

# ---- состояние: файлы менеджера ---------------------------------------------------------------

# Слово состояния плагина из state.json менеджера (`enabled`, `disabled`, `failed`, `pending`,
# `installed`); пусто — менеджер о плагине не знает. Идентификатор — в скобках: имя с дефисом голым
# шагом пути jsonfilter не читается.
plugin_state_of() {  # ID
    [ -r "$PLUGIN_STATE" ] || return 0
    jsonfilter -i "$PLUGIN_STATE" -e "@.plugins['$1'].state" 2>/dev/null
}

# Версия плагина: из state.json, иначе из манифеста.
plugin_version_of() {  # ID
    _pv=""
    [ -r "$PLUGIN_STATE" ] && _pv="$(jsonfilter -i "$PLUGIN_STATE" -e "@.plugins['$1'].version" 2>/dev/null)"
    [ -n "$_pv" ] || _pv="$(jsonfilter -i "$PLUGIN_ROOT/$1/plugin.json" -e '@.version' 2>/dev/null)"
    printf '%s' "$_pv"
}

# Причина состояния (`why`) из state.json.
plugin_why_of() {  # ID
    [ -r "$PLUGIN_STATE" ] || return 0
    jsonfilter -i "$PLUGIN_STATE" -e "@.plugins['$1'].why" 2>/dev/null
}

# Стоит ли плагин: есть манифест в каталоге плагина (так же видит его ядро).
plugin_installed() {  # ID
    [ -f "$PLUGIN_ROOT/$1/plugin.json" ]
}

# ---- объекты ubus плагинов: ссылки и ACL ---------------------------------------------------------

# Методы rpc из манифеста: PLUGIN_RPC_READ и PLUGIN_RPC_WRITE — имена через пробел. Возврат 1 — у
# плагина нет `rpc` или манифест не читается. Читает через jshn, а потому ПОРТИТ текущий документ
# jshn: вызывать до того, как собран свой ответ.
plugin_rpc_methods() {  # ID
    PLUGIN_RPC_READ=""; PLUGIN_RPC_WRITE=""
    _prm_f="$PLUGIN_ROOT/$1/plugin.json"
    [ -r "$_prm_f" ] || return 1
    json_load "$(cat "$_prm_f")" 2>/dev/null || return 1
    json_select rpc 2>/dev/null || return 1
    json_select methods 2>/dev/null || return 1
    json_get_keys _prm_keys
    for _prm_k in $_prm_keys; do
        plugin_method_ok "$_prm_k" || continue
        json_select "$_prm_k" 2>/dev/null || continue
        _prm_a=""
        json_get_var _prm_a access
        json_select ..
        case "$_prm_a" in
            read)  PLUGIN_RPC_READ="${PLUGIN_RPC_READ:+$PLUGIN_RPC_READ }$_prm_k" ;;
            write) PLUGIN_RPC_WRITE="${PLUGIN_RPC_WRITE:+$PLUGIN_RPC_WRITE }$_prm_k" ;;
        esac
    done
    return 0
}

# Список имён через пробел -> `"a","b"` для JSON.
plugin_quote_list() {  # ИМЕНА
    _pq=""
    for _pq_n in $1; do _pq="${_pq:+$_pq,}\"$_pq_n\""; done
    printf '%s' "$_pq"
}

# Текст ACL группы плагина: права LuCI работают, как у любого luci-app-*. Новые имена на объекте splify2
# (псевдонимы `methods.alias`, которых нет у каркаса) получают права тут же: статический ACL каркаса их не знает.
plugin_acl_text() {  # ID
    _pat_r="$(plugin_quote_list "$PLUGIN_RPC_READ")"
    _pat_w="$(plugin_quote_list "$PLUGIN_RPC_WRITE")"
    _pat_ar=""; _pat_aw=""
    if command -v ext_acl_aliases >/dev/null 2>&1; then
        while read -r _pat_n _pat_a; do
            [ -n "$_pat_n" ] || continue
            case "$_pat_a" in
                read)  _pat_ar="$_pat_ar $_pat_n" ;;
                write) _pat_aw="$_pat_aw $_pat_n" ;;
            esac
        done <<EOF
$(ext_acl_aliases "$1")
EOF
    fi
    _pat_ar="$(plugin_quote_list "$_pat_ar")"; _pat_aw="$(plugin_quote_list "$_pat_aw")"
    printf '{\n  "splify2-p-%s": {\n    "description": "Плагин %s: методы панели"' "$1" "$1"
    if [ -n "$_pat_r$_pat_ar" ]; then
        printf ',\n    "read": { "ubus": { '
        [ -n "$_pat_r" ] && printf '"splify2.p.%s": [ %s ]' "$1" "$_pat_r"
        [ -n "$_pat_ar" ] && printf '%s"splify2": [ %s ]' "${_pat_r:+, }" "$_pat_ar"
        printf ' } }'
    fi
    if [ -n "$_pat_w$_pat_aw" ]; then
        printf ',\n    "write": { "ubus": { '
        [ -n "$_pat_w" ] && printf '"splify2.p.%s": [ %s ]' "$1" "$_pat_w"
        [ -n "$_pat_aw" ] && printf '%s"splify2": [ %s ]' "${_pat_w:+, }" "$_pat_aw"
        printf ' } }'
    fi
    printf '\n  }\n}\n'
}

# Привести ссылки и ACL в согласие с тем, что стоит и включено. Объект нужен каждому ВКЛЮЧЁННОМУ
# плагину с `rpc`: отключённый плагин из реестра выпадает, и его объекта быть не должно (метод
# отключённого плагина отвечает отказом `disabled` через plugin_call, а не «Object not found»).
# PLUGIN_SYNC_CHANGED=1 — что-то поменялось, rpcd надо перечитать (plugin_sync_reload).
plugin_sync() {
    PLUGIN_SYNC_CHANGED=0
    _ps_want=" "; _ps_uiwant=" "
    mkdir -p "$PLUGIN_RPCD_DIR" "$PLUGIN_ACL_DIR" 2>/dev/null
    # Реестр расширений (хуки, задачи, события, псевдонимы) собирается первым: ACL новых имён на объекте splify2
    # берёт из него. Перечень новых имён изменился — rpcd надо перечитать: `list` объекта печатает их.
    plugin_need_ext
    _ps_names0="$(ext_new_aliases)"
    ext_rebuild
    [ "$(ext_new_aliases)" = "$_ps_names0" ] || PLUGIN_SYNC_CHANGED=1
    for _ps_d in "$PLUGIN_ROOT"/*/; do
        [ -f "${_ps_d}plugin.json" ] || continue
        _ps_id="${_ps_d%/}"; _ps_id="${_ps_id##*/}"
        plugin_id_ok "$_ps_id" || continue
        [ "$(plugin_state_of "$_ps_id")" = enabled ] || continue
        # Интерфейс плагина: ссылка на его ui/ (если манифест объявляет `ui`).
        if [ -n "$(jsonfilter -i "${_ps_d}plugin.json" -e '@.ui.entry' 2>/dev/null)" ] && [ -d "${_ps_d}ui" ]; then
            _ps_uiwant="$_ps_uiwant$_ps_id "
            mkdir -p "$PLUGIN_UI_DIR" 2>/dev/null
            [ "$(readlink "$PLUGIN_UI_DIR/$_ps_id" 2>/dev/null)" = "$PLUGIN_ROOT/$_ps_id/ui" ] ||
                ln -sfn "$PLUGIN_ROOT/$_ps_id/ui" "$PLUGIN_UI_DIR/$_ps_id"
        fi
        plugin_rpc_methods "$_ps_id" || continue
        [ -n "$PLUGIN_RPC_READ$PLUGIN_RPC_WRITE" ] || continue
        _ps_want="$_ps_want$_ps_id "
        _ps_link="$PLUGIN_RPCD_DIR/splify2.p.$_ps_id"
        if [ "$(readlink "$_ps_link" 2>/dev/null)" != "$PLUGIN_DISPATCHER" ]; then
            ln -sf "$PLUGIN_DISPATCHER" "$_ps_link" && PLUGIN_SYNC_CHANGED=1
        fi
        _ps_acl="$PLUGIN_ACL_DIR/splify2-p-$_ps_id.json"
        _ps_text="$(plugin_acl_text "$_ps_id")"
        if [ "$(cat "$_ps_acl" 2>/dev/null)" != "$_ps_text" ]; then
            printf '%s\n' "$_ps_text" > "$_ps_acl.tmp" && mv -f "$_ps_acl.tmp" "$_ps_acl" &&
                PLUGIN_SYNC_CHANGED=1
        fi
    done
    # Лишнее: объект плагина, которого нет среди нужных. Чужие файлы не трогаются — только имена
    # нашего вида (`splify2.p.*`, `splify2-p-*.json`).
    for _ps_l in "$PLUGIN_RPCD_DIR"/splify2.p.*; do
        [ -L "$_ps_l" ] || continue
        _ps_id="${_ps_l##*/splify2.p.}"
        case "$_ps_want" in *" $_ps_id "*) continue ;; esac
        rm -f "$_ps_l" && PLUGIN_SYNC_CHANGED=1
    done
    # Ссылки на интерфейсы: лишняя — та, чьего плагина нет среди включённых с `ui`. Перечитки rpcd они не требуют.
    for _ps_u in "$PLUGIN_UI_DIR"/*; do
        [ -L "$_ps_u" ] || continue
        _ps_id="${_ps_u##*/}"
        case "$_ps_uiwant" in *" $_ps_id "*) continue ;; esac
        # Только наши: ссылка ведёт в каталог плагинов.
        case "$(readlink "$_ps_u")" in "$PLUGIN_ROOT"/*) rm -f "$_ps_u" ;; esac
    done
    for _ps_a in "$PLUGIN_ACL_DIR"/splify2-p-*.json; do
        [ -f "$_ps_a" ] || continue
        _ps_id="${_ps_a##*/splify2-p-}"; _ps_id="${_ps_id%.json}"
        case "$_ps_want" in *" $_ps_id "*) continue ;; esac
        rm -f "$_ps_a" && PLUGIN_SYNC_CHANGED=1
    done
    # Задачи плагинов — один размеченный блок crontab; служба событий — по надобности.
    ext_cron_sync
    ext_events_sync
    return 0
}

# Перечитать rpcd, если ссылки или ACL менялись. В фоне и с задержкой: этот процесс — потомок rpcd,
# и перечитка (SIGHUP снимает объекты обработчиков и регистрирует заново) до отправки ответа унесла
# бы его (тот же довод, что у перезапуска в splify2_install).
plugin_sync_reload() {
    [ "${PLUGIN_SYNC_CHANGED:-0}" = 1 ] || return 0
    ( sleep "${PLUGIN_RELOAD_DELAY:-2}"; "${RPCD_INITD:-/etc/init.d/rpcd}" reload ) </dev/null >/dev/null 2>&1 &
    return 0
}

# ---- задания ----------------------------------------------------------------------------------------

# Долгие вызовы (установка идёт до 600 с, а rpcd ждёт 120) — заданием: метод отвечает `{job}` сразу,
# итог читает plugin_job. Каталог задания: cmd, in, out, err, rc, pid.
plugin_job_new() {
    mkdir -p "$PLUGIN_JOBS" 2>/dev/null
    # Каталог в /tmp: чужой процесс мог занять имя заранее — берём только свой и закрытый.
    [ -O "$PLUGIN_JOBS" ] && [ ! -L "$PLUGIN_JOBS" ] || return 1
    chmod 700 "$PLUGIN_JOBS" 2>/dev/null
    # Старше часа — забытые: интерфейс прочитал итог давно или не прочитает вовсе.
    for _pj_d in "$PLUGIN_JOBS"/*; do
        [ -d "$_pj_d" ] || continue
        [ -n "$(find "$_pj_d" -maxdepth 0 -mmin +60 2>/dev/null)" ] && rm -rf "$_pj_d"
    done
    PJ_ID="$(tr -d '-' < /proc/sys/kernel/random/uuid 2>/dev/null | cut -c1-16)"
    [ -n "$PJ_ID" ] || PJ_ID="$(date +%s)$$"
    PJ_DIR="$PLUGIN_JOBS/$PJ_ID"
    mkdir -p "$PJ_DIR" || return 1
    : > "$PJ_DIR/in"
}

# Запустить КОМАНДУ заданием PJ_DIR (stdin — файл `in`), по завершении выполнить `plugin_job_after`
# (вызывающий определяет её сам, по умолчанию пусто). Подоболочка отвязана от потоков вызова целиком:
# пока она держит стандартный вывод, rpcd не считает вызов оконченным.
plugin_job_start() {  # КОМАНДА [АРГУМЕНТЫ...]
    (
        trap '' HUP
        "$@" < "$PJ_DIR/in" > "$PJ_DIR/out" 2> "$PJ_DIR/err"
        echo $? > "$PJ_DIR/rc.tmp"
        # Ссылки и ACL — до отметки о конце: интерфейс, увидев «готово», сразу зовёт новый объект.
        if command -v plugin_job_after >/dev/null 2>&1; then plugin_job_after >/dev/null 2>&1; fi
        mv -f "$PJ_DIR/rc.tmp" "$PJ_DIR/rc"
    ) </dev/null >/dev/null 2>&1 &
    echo $! > "$PJ_DIR/pid"
}

# Последняя непустая строка файла: ход установки — то, что менеджер последним сказал в stderr.
plugin_last_line() {  # ФАЙЛ
    [ -s "$1" ] || return 0
    grep -v '^[[:space:]]*$' "$1" | tail -n 1
}

# Состояние задания: PJ_STATE (running|done|failed), PJ_RC, PJ_RESULT (сырой JSON, пусто — нет),
# PJ_ERROR, PJ_PROGRESS. Возврат 1 — такого задания нет.
plugin_job_state() {  # НОМЕР
    PJ_STATE=""; PJ_RC=""; PJ_RESULT=""; PJ_ERROR=""; PJ_PROGRESS=""; PJ_ECODE=""; PJ_EARGS=""
    case "$1" in ''|*[!0-9a-f]*) return 1 ;; esac
    [ "${#1}" -le 32 ] || return 1
    _pjs="$PLUGIN_JOBS/$1"
    [ -d "$_pjs" ] || return 1
    PJ_PROGRESS="$(plugin_last_line "$_pjs/err")"
    # Жив ли процесс — ДО взгляда на rc: задание кончается между двумя проверками, и обратный порядок
    # («rc нет» → процесс уже умер) принимал только что законченное задание за оборванное.
    _pjs_pid="$(cat "$_pjs/pid" 2>/dev/null)"
    _pjs_dead=""
    [ -n "$_pjs_pid" ] && ! kill -0 "$_pjs_pid" 2>/dev/null && _pjs_dead=1
    if [ -f "$_pjs/rc" ]; then
        PJ_RC="$(cat "$_pjs/rc")"
        _pjs_out="$(cat "$_pjs/out" 2>/dev/null)"
        if [ "$PJ_RC" = 0 ]; then
            PJ_STATE=done
            PJ_RESULT="$(plugin_json_obj "$_pjs_out")" || PJ_RESULT=""
        else
            PJ_STATE=failed
            _pjs_msg=""
            if _pjs_obj="$(plugin_json_obj "$_pjs_out")"; then
                _pjs_msg="$(jsonfilter -s "$_pjs_obj" -e '@.error' 2>/dev/null)"
                PJ_ECODE="$(jsonfilter -s "$_pjs_obj" -e '@.code' 2>/dev/null)"
                PJ_EARGS="$(jsonfilter -s "$_pjs_obj" -e '@.args' 2>/dev/null)"
            fi
            [ -n "$_pjs_msg" ] || _pjs_msg="$(cat "$_pjs/err" 2>/dev/null)"
            [ -n "$_pjs_msg" ] || { case "$_pjs_out" in '{'*|'['*) ;; *) _pjs_msg="$_pjs_out" ;; esac; }
            if [ -z "$_pjs_msg" ]; then
                if [ "$PJ_RC" = 124 ]; then _pjs_msg="$(s2_t job.timeout "The job did not finish in time")"
                else _pjs_msg="$(s2_t job.failed_code "The job failed (code {code})" code "$PJ_RC")"; fi
            fi
            PJ_ERROR="$_pjs_msg"
        fi
        return 0
    fi
    # Конца нет. Процесс умер — след оборванного задания (перезапуск rpcd, убитый вручную): иначе
    # «идёт» висело бы вечно.
    if [ -n "$_pjs_dead" ]; then
        PJ_STATE=failed
        PJ_ERROR="$(s2_t job.aborted "The job was interrupted")"
        return 0
    fi
    PJ_STATE=running
    return 0
}

# ---- методы самих плагинов -----------------------------------------------------------------------------

# Выполнить программу плагина с ограничением по времени (на роутере нет `timeout` — он отдельный пакет).
# Итог: stdout и stderr — в файлы OUT и ERR, возврат — код программы или 124 при исходе срока.
plugin_run_limited() {  # СРОК ВХОД ВЫХОД ОШИБКИ ПРОГРАММА МЕТОД
    _pr_to="$1"; _pr_in="$2"; _pr_out="$3"; _pr_err="$4"; shift 4
    _pr_flag="$_pr_out.timeout"
    rm -f "$_pr_flag"
    "$@" < "$_pr_in" > "$_pr_out" 2> "$_pr_err" &
    _pr_pid=$!
    (
        sleep "$_pr_to" &
        _pr_sp=$!
        trap 'kill "$_pr_sp" 2>/dev/null; exit 0' TERM
        wait "$_pr_sp"
        : > "$_pr_flag"
        kill "$_pr_pid" 2>/dev/null
    ) </dev/null >/dev/null 2>&1 &
    _pr_wd=$!
    wait "$_pr_pid"
    _pr_rc=$?
    kill "$_pr_wd" 2>/dev/null
    if [ -f "$_pr_flag" ]; then rm -f "$_pr_flag"; return 124; fi
    return $_pr_rc
}

# Манифест плагина: PLUGIN_PROG (путь программы, внутри каталога плагина), PLUGIN_MTIMEOUT, PLUGIN_MJOB —
# про метод. Возврат: 0 — метод есть; 1 — нет такого метода; 2 — манифест не читается или в нём нет rpc.
plugin_method_info() {  # ID МЕТОД
    PLUGIN_PROG=""; PLUGIN_MTIMEOUT=""; PLUGIN_MJOB=""
    _pi_f="$PLUGIN_ROOT/$1/plugin.json"
    [ -r "$_pi_f" ] || return 2
    json_load "$(cat "$_pi_f")" 2>/dev/null || return 2
    json_select rpc 2>/dev/null || return 2
    json_get_var PLUGIN_PROG prog
    json_select methods 2>/dev/null || return 2
    json_select "$2" 2>/dev/null || return 1
    json_get_var PLUGIN_MTIMEOUT timeout_s
    json_get_var PLUGIN_MJOB job
    return 0
}

# Метод плагина: печатает ОДИН ответ JSON. Отказы — {ok:false, error, code}. Ответ программы идёт как
# есть, если это объект JSON. Метод с `job: true` отвечает `{job: "<номер>"}` сразу.
# Права (read/write) здесь не проверяются: их проверяет rpcd по ACL группы плагина, а шлюз для
# приложения вне LuCI работает от root и пускает только того, у кого есть право на splify2.
plugin_invoke() {  # ID МЕТОД [ВХОД_JSON]
    _pv_id="$1"; _pv_m="$2"; _pv_in="${3:-}"
    plugin_id_ok "$_pv_id" || { plugin_fail bad_request plugin.bad_name "Invalid plugin name"; return 1; }
    plugin_method_ok "$_pv_m" || { plugin_fail no_method plugin.no_method "Plugin {id} has no action {method}" id "$_pv_id" method "$_pv_m"; return 1; }
    plugin_installed "$_pv_id" || { plugin_fail not_installed plugin.not_installed "Plugin {id} is not installed" id "$_pv_id"; return 1; }
    [ "$(plugin_state_of "$_pv_id")" = enabled ] ||
        { plugin_fail disabled plugin.disabled "Plugin {id} is off. Turn it on in the Plugins tab." id "$_pv_id"; return 1; }
    plugin_method_info "$_pv_id" "$_pv_m"
    case $? in
        0) ;;
        1) plugin_fail no_method plugin.no_method "Plugin {id} has no action {method}" id "$_pv_id" method "$_pv_m"; return 1 ;;
        *) plugin_fail unavailable plugin.no_methods "Plugin {id} has no panel actions" id "$_pv_id"; return 1 ;;
    esac
    # prog — относительный путь внутри каталога плагина (схема манифеста): абсолютный и с «..»
    # отвергаются, чтобы манифест не мог вывести вызов за каталог плагина.
    case "$PLUGIN_PROG" in
        ''|/*|..|../*|*/..|*/../*) plugin_fail unavailable plugin.no_program "Plugin {id} has no program for the panel" id "$_pv_id"; return 1 ;;
    esac
    _pv_prog="$PLUGIN_ROOT/$_pv_id/$PLUGIN_PROG"
    [ -x "$_pv_prog" ] || { plugin_fail unavailable plugin.no_program "Plugin {id} has no program for the panel" id "$_pv_id"; return 1; }
    _pv_to="$PLUGIN_MTIMEOUT"
    case "$_pv_to" in ''|*[!0-9]*|0) _pv_to="$PLUGIN_RPC_TIMEOUT" ;; esac
    _pv_job="$PLUGIN_MJOB"
    # Вход программы — объект JSON; пусто или не объект — пустой объект.
    _pv_body="$(plugin_json_obj "$_pv_in")" || _pv_body='{}'

    plugin_export_env "$_pv_id"

    if [ "$_pv_job" = 1 ]; then
        plugin_job_new || { plugin_fail failed plugin.job_failed "Cannot start the job"; return 1; }
        printf '%s' "$_pv_body" > "$PJ_DIR/in"
        PJ_PROG="$_pv_prog"; PJ_METHOD="$_pv_m"; PJ_TO="$_pv_to"
        plugin_job_start plugin_job_rpc
        plugin_ok_raw job "\"$PJ_ID\""
        return 0
    fi

    _pv_tmp="$(mktemp -d 2>/dev/null)" || { plugin_fail failed tmp.dir_failed "Cannot create a temporary directory"; return 1; }
    printf '%s' "$_pv_body" > "$_pv_tmp/in"
    ( cd "$STEER_PLUGIN_DIR" 2>/dev/null || true
      plugin_run_limited "$_pv_to" "$_pv_tmp/in" "$_pv_tmp/out" "$_pv_tmp/err" "$_pv_prog" "$_pv_m" )
    _pv_rc=$?
    _pv_out="$(cat "$_pv_tmp/out" 2>/dev/null)"
    _pv_err="$(cat "$_pv_tmp/err" 2>/dev/null)"
    rm -rf "$_pv_tmp"
    plugin_answer "$_pv_id" "$_pv_rc" "$_pv_out" "$_pv_err" "$_pv_to"
}

# Задание-метод плагина: те же правила, что у синхронного, но в процессе задания (stdin — файл in).
plugin_job_rpc() {
    cd "$STEER_PLUGIN_DIR" 2>/dev/null || true
    _pjr_tmp="$PJ_DIR/run"
    mkdir -p "$_pjr_tmp"
    cat > "$_pjr_tmp/in"
    plugin_run_limited "$PJ_TO" "$_pjr_tmp/in" "$_pjr_tmp/out" "$_pjr_tmp/err" "$PJ_PROG" "$PJ_METHOD"
    _pjr_rc=$?
    cat "$_pjr_tmp/out" 2>/dev/null
    cat "$_pjr_tmp/err" >&2 2>/dev/null
    return $_pjr_rc
}

# Итог программы -> ответ метода.
plugin_answer() {  # ID КОД_ВОЗВРАТА STDOUT STDERR СРОК
    case "$2" in
        0)
            if _pa_obj="$(plugin_json_obj "$3")"; then
                printf '%s\n' "$_pa_obj"
                return 0
            fi
            plugin_fail failed plugin.bad_reply "Plugin {id} gave an unexpected reply" id "$1"
            return 1 ;;
        124)
            plugin_fail timeout plugin.timeout "Plugin {id} did not answer within {seconds} s" id "$1" seconds "$5"
            return 1 ;;
        *)
            _pa_msg="$4"
            [ -n "$_pa_msg" ] || {
                if _pa_obj="$(plugin_json_obj "$3")"; then
                    _pa_msg="$(jsonfilter -s "$_pa_obj" -e '@.error' 2>/dev/null)"
                fi
            }
            [ -n "$_pa_msg" ] || _pa_msg="$(s2_t plugin.exit_code "Plugin {id} stopped with an error (code {code})" id "$1" code "$2")"
            plugin_fail_raw failed "$_pa_msg"
            return 1 ;;
    esac
}

# ---- ключи репозиториев ------------------------------------------------------------------------------

# Номер ключа usign: файл .pub — комментарий и строка base64 из «Ed», 8 байт номера и 32 байт ключа.
# Печатает номер (16 знаков hex) и возвращает 0; не ключ — возвращает 1.
plugin_key_id() {  # ТЕКСТ_КЛЮЧА
    _pk_b64="$(printf '%s\n' "$1" | grep -v '^untrusted comment:' | grep -v '^[[:space:]]*$' | tail -n 1 | tr -d '[:space:]')"
    [ -n "$_pk_b64" ] || return 1
    _pk_hex="$(printf '%s' "$_pk_b64" | base64 -d 2>/dev/null | od -An -tx1 | tr -d ' \n')"
    # 2 + 8 + 32 байта = 84 знака hex; первые два байта — «Ed» (4564).
    [ "${#_pk_hex}" = 84 ] || return 1
    case "$_pk_hex" in 4564*) ;; *) return 1 ;; esac
    _pk_rest="${_pk_hex#????}"
    printf '%s' "$_pk_rest" | cut -c1-16
}
