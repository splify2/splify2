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

# Ответ-отказ плагинной части: {ok:false, error, code}. code — машинное слово, по которому интерфейс
# выбирает вид отказа: bad_request, not_installed, disabled, no_method, unavailable, timeout, failed,
# busy. Печатает и возвращает 1: вызывающий решает, выходить ли ему.
plugin_fail() {  # КОД ТЕКСТ
    json_init
    json_add_boolean ok 0
    json_add_string error "$2"
    json_add_string code "$1"
    json_dump
    return 1
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
plugin_jstr() {  # ТЕКСТ
    printf '"'
    printf '%s' "$1" | tr -d '\000-\010\013-\037' | sed -e ':a' -e 'N' -e '$!ba' \
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

# Текст отказа по итогам plugin_manager: поле `error` JSON-ответа, иначе stderr, иначе stdout, иначе
# слова про код. Менеджер называет причину числами и именами (место, совместимость, выходы) — они
# доходят до человека как есть.
plugin_manager_error() {
    _pe=""
    # 126 и 127 — ядра или команды `plugin` нет: слова оболочки о ненайденном файле человеку не нужны.
    case "$PLUGIN_RC" in
        126|127) printf '%s' "ядро не умеет плагины — обновите steer"; return 0 ;;
    esac
    if _pe_obj="$(plugin_json_obj "$PLUGIN_OUT")"; then
        _pe="$(jsonfilter -s "$_pe_obj" -e '@.error' 2>/dev/null)"
    fi
    [ -n "$_pe" ] || _pe="$PLUGIN_ERR"
    [ -n "$_pe" ] || { case "$PLUGIN_OUT" in '{'*|'['*) ;; *) _pe="$PLUGIN_OUT" ;; esac; }
    if [ -z "$_pe" ]; then
        case "$PLUGIN_RC" in
            126|127) _pe="ядро не умеет плагины — обновите steer" ;;
            *) _pe="менеджер плагинов не ответил (код $PLUGIN_RC)" ;;
        esac
    fi
    printf '%s' "$_pe"
}

# Отказ менеджера по-русски: ответ `{ok:false, error, code}`. Менеджер, ответивший «busy» (параллельный
# запрос под его замком), получает код busy.
plugin_manager_fail() {
    _pf="$(plugin_manager_error)"
    _pf_code=failed
    case "$_pf" in busy|busy:*|*" busy"*) _pf_code=busy ;; esac
    plugin_fail "$_pf_code" "$_pf"
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

# Текст ACL группы плагина: права LuCI работают, как у любого luci-app-*.
plugin_acl_text() {  # ID
    _pat_r="$(plugin_quote_list "$PLUGIN_RPC_READ")"
    _pat_w="$(plugin_quote_list "$PLUGIN_RPC_WRITE")"
    printf '{\n  "splify2-p-%s": {\n    "description": "Плагин %s: методы панели"' "$1" "$1"
    [ -n "$_pat_r" ] && printf ',\n    "read": { "ubus": { "splify2.p.%s": [ %s ] } }' "$1" "$_pat_r"
    [ -n "$_pat_w" ] && printf ',\n    "write": { "ubus": { "splify2.p.%s": [ %s ] } }' "$1" "$_pat_w"
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
    PJ_STATE=""; PJ_RC=""; PJ_RESULT=""; PJ_ERROR=""; PJ_PROGRESS=""
    case "$1" in ''|*[!0-9a-f]*) return 1 ;; esac
    [ "${#1}" -le 32 ] || return 1
    _pjs="$PLUGIN_JOBS/$1"
    [ -d "$_pjs" ] || return 1
    PJ_PROGRESS="$(plugin_last_line "$_pjs/err")"
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
            fi
            [ -n "$_pjs_msg" ] || _pjs_msg="$(cat "$_pjs/err" 2>/dev/null)"
            [ -n "$_pjs_msg" ] || { case "$_pjs_out" in '{'*|'['*) ;; *) _pjs_msg="$_pjs_out" ;; esac; }
            if [ -z "$_pjs_msg" ]; then
                if [ "$PJ_RC" = 124 ]; then _pjs_msg="задание не уложилось в срок"
                else _pjs_msg="задание не удалось (код $PJ_RC)"; fi
            fi
            PJ_ERROR="$_pjs_msg"
        fi
        return 0
    fi
    # Конца нет. Процесс умер — след оборванного задания (перезапуск rpcd, убитый вручную): иначе
    # «идёт» висело бы вечно.
    _pjs_pid="$(cat "$_pjs/pid" 2>/dev/null)"
    if [ -n "$_pjs_pid" ] && ! kill -0 "$_pjs_pid" 2>/dev/null; then
        PJ_STATE=failed
        PJ_ERROR="задание оборвано"
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
    plugin_id_ok "$_pv_id" || { plugin_fail bad_request "Недопустимое имя плагина"; return 1; }
    plugin_method_ok "$_pv_m" || { plugin_fail no_method "У плагина $_pv_id нет такого действия: $_pv_m"; return 1; }
    plugin_installed "$_pv_id" || { plugin_fail not_installed "Плагин $_pv_id не установлен"; return 1; }
    [ "$(plugin_state_of "$_pv_id")" = enabled ] ||
        { plugin_fail disabled "Плагин $_pv_id выключен — включите его на вкладке «Плагины»"; return 1; }
    plugin_method_info "$_pv_id" "$_pv_m"
    case $? in
        0) ;;
        1) plugin_fail no_method "У плагина $_pv_id нет такого действия: $_pv_m"; return 1 ;;
        *) plugin_fail unavailable "У плагина $_pv_id нет методов для панели"; return 1 ;;
    esac
    # prog — относительный путь внутри каталога плагина (схема манифеста): абсолютный и с «..»
    # отвергаются, чтобы манифест не мог вывести вызов за каталог плагина.
    case "$PLUGIN_PROG" in
        ''|/*|..|../*|*/..|*/../*) plugin_fail unavailable "У плагина $_pv_id нет программы для панели"; return 1 ;;
    esac
    _pv_prog="$PLUGIN_ROOT/$_pv_id/$PLUGIN_PROG"
    [ -x "$_pv_prog" ] || { plugin_fail unavailable "У плагина $_pv_id нет программы для панели"; return 1; }
    _pv_to="$PLUGIN_MTIMEOUT"
    case "$_pv_to" in ''|*[!0-9]*|0) _pv_to="$PLUGIN_RPC_TIMEOUT" ;; esac
    _pv_job="$PLUGIN_MJOB"
    # Вход программы — объект JSON; пусто или не объект — пустой объект.
    _pv_body="$(plugin_json_obj "$_pv_in")" || _pv_body='{}'

    export STEER_PLUGIN_ID="$_pv_id" STEER_PLUGIN_DIR="$PLUGIN_ROOT/$_pv_id" \
           STEER_PLUGIN_CONF="$PLUGIN_CONF_DIR/$_pv_id"

    if [ "$_pv_job" = 1 ]; then
        plugin_job_new || { plugin_fail failed "Не удалось завести задание"; return 1; }
        printf '%s' "$_pv_body" > "$PJ_DIR/in"
        PJ_PROG="$_pv_prog"; PJ_METHOD="$_pv_m"; PJ_TO="$_pv_to"
        plugin_job_start plugin_job_rpc
        plugin_ok_raw job "\"$PJ_ID\""
        return 0
    fi

    _pv_tmp="$(mktemp -d 2>/dev/null)" || { plugin_fail failed "Не удалось завести временный каталог"; return 1; }
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
            plugin_fail failed "Плагин $1 ответил не по форме"
            return 1 ;;
        124)
            plugin_fail timeout "Плагин $1 не ответил за $5 с"
            return 1 ;;
        *)
            _pa_msg="$4"
            [ -n "$_pa_msg" ] || {
                if _pa_obj="$(plugin_json_obj "$3")"; then
                    _pa_msg="$(jsonfilter -s "$_pa_obj" -e '@.error' 2>/dev/null)"
                fi
            }
            [ -n "$_pa_msg" ] || _pa_msg="Плагин $1 завершился с ошибкой (код $2)"
            plugin_fail failed "$_pa_msg"
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
