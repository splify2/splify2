#!/bin/sh
# splify2-api v1 в бэкенде: точки расширения каркаса, которыми пользуются плагины (plugin-sdk/docs/splify2-api.md).
#
#   реестр      — файл /var/run/splify2/ext.reg, который собирается из манифестов ВКЛЮЧЁННЫХ плагинов (блок
#                 `splify2`) и пересобирается при любой перемене состава плагинов (plugin_sync) или, если файла
#                 нет или state.json новее, лениво при первом же вызове. Всё, что делают хуки, задачи, события,
#                 псевдонимы и переопределения, читается из этого файла, а не из манифестов на каждый вызов.
#   хуки        — ext_gate (до/после операций), ext_hook_each (хуки с данными: heal, backup_sections, …)
#   методы      — ext_dispatch: псевдоним (метод каркаса вынесен в плагин или это новое имя на объекте splify2) и
#                 переопределение (replace, wrap)
#   задачи      — ext_cron_sync пишет один размеченный блок в crontab, ext_task_run — запуск из splify2-task
#   события     — ext_events_sync держит службу splify2-events, ext_event_dispatch раздаёт событие плагинам
#
# ЗАЩИТА (раздел 4.3.4 проекта и «Защита» в splify2-api.md):
#   - методы `plugin_*`, `plugins_*`, `repo_*`, `repos_*`, `prefs_*` — final: их нельзя ни заменить, ни обернуть, ни
#     взять псевдонимом (таблица methods.tsv, колонка kind=final);
#   - безопасный режим — файл /etc/splify2/safe или SPLIFY2_SAFE=1 в окружении вызова: хуки, задачи, события и
#     переопределения выключены; остаются каркас, менеджер плагинов и псевдонимы вынесенных из каркаса методов
#     (без них человек остался бы без архива настроек и каталога списков);
#   - хук, который упал, не ответил за срок или ответил не по форме, НЕ останавливает операцию: строка в журнале и
#     предупреждение в ответе. Останавливает только `"critical": true` у самого плагина;
#   - хуки, переопределения и псевдонимы без заявленного права (`splify2.hooks`, `splify2.override`) в реестр не
#     попадают, а причина — строкой `err` реестра и в ответе plugins_list (`ext_errors`).
#
# Файл подключается точкой (ленивo: need_ext в env.sh) и при подключении ничего не печатает и не завершает.

EXT_API_VERSION="${EXT_API_VERSION:-1.1.0}"
EXT_REG="${EXT_REG:-/var/run/splify2/ext.reg}"
EXT_SAFE_FILE="${EXT_SAFE_FILE:-/etc/splify2/safe}"
EXT_TASKS_JSON="${EXT_TASKS_JSON:-/etc/splify2/tasks.json}"
EXT_CRONTAB="${EXT_CRONTAB:-/etc/crontabs/root}"
EXT_TASK_BIN="${EXT_TASK_BIN:-/usr/sbin/splify2-task}"
EXT_EVENTS_INITD="${EXT_EVENTS_INITD:-/etc/init.d/splify2-events}"
EXT_TASK_LOCK_DIR="${EXT_TASK_LOCK_DIR:-/var/lock}"
EXT_OFFICIAL_REPOS="${EXT_OFFICIAL_REPOS:-splify2 splify2-core-plugins}"
EXT_HOOK_TIMEOUT=10
EXT_TASK_TIMEOUT=600
EXT_HOOKS_KNOWN=" pre_spec_set post_spec_set pre_apply post_apply post_apply_fail heal backup_sections support_report purge plugin_changed sub_fields "
EXT_CRON_BEGIN='# splify2-plugins begin'
EXT_CRON_END='# splify2-plugins end'
EXT_TAB='	'

# Плагины и их помощники: библиотека плагинов нужна реестру (состояние, пути, права).
command -v plugin_state_of >/dev/null 2>&1 || . "${PLUGIN_SH:-${SPLIFY2_LIBDIR:-/usr/lib/splify2}/plugin.sh}"
# Каталог библиотек: рядом с plugin.sh лежит methods.tsv.
EXT_METHODS_TSV="${EXT_METHODS_TSV:-${SPLIFY2_LIBDIR:-/usr/lib/splify2}/methods.tsv}"

ext_log() { logger -t splify2-ext "$*" 2>/dev/null; return 0; }

# Безопасный режим (файл или переменная окружения вызова).
ext_safe() { [ -n "${SPLIFY2_SAFE:-}" ] || [ -e "$EXT_SAFE_FILE" ]; }

# ---- методы каркаса: methods.tsv ------------------------------------------------------------------------

# Вид метода: печатает `frame`, `final`, `moved <плагин>` или ничего (имени на объекте нет).
ext_method_kind() {  # ИМЯ
    [ -r "$EXT_METHODS_TSV" ] || { case "$1" in plugin_*|plugins_*|repo_*|repos_*|prefs_*) printf 'final' ;; esac; return 0; }
    while IFS="$EXT_TAB" read -r _mk_n _mk_k _mk_a; do
        [ "$_mk_n" = "$1" ] || continue
        printf '%s%s' "$_mk_k" "${_mk_a:+ $_mk_a}"
        return 0
    done < "$EXT_METHODS_TSV"
    return 0
}

# Плагин, в который вынесен метод каркаса (для отказа «нужен плагин X»).
ext_moved_plugin() {  # ИМЯ_МЕТОДА
    _mp="$(ext_method_kind "$1")"
    case "$_mp" in "moved "*) printf '%s' "${_mp#moved }" ;; esac
}

# ---- реестр ---------------------------------------------------------------------------------------------

ext_jget() { eval "$1="; json_get_var "$1" "$2"; }

# Ось compat.splify2-api подходит этой версии API? Принимается ^1.x, ~1.x, =1.x, 1.x и >=1.x (и >=0.x). Правило версий:
# minor добавляет, major ломает — плагин ^1.2 исполняется хостом 1.y при y >= 2 и не исполняется хостом 1.1.
# Всё остальное — не подходит: major у хоста один, и выше него плагину ставиться нельзя.
ext_api_ok() {  # ДИАПАЗОН
    _ao="$1"
    _ao="${_ao#"${_ao%%[![:space:]]*}"}"
    _ah="${EXT_API_VERSION%%.*}"; _am="${EXT_API_VERSION#*.}"; _am="${_am%%.*}"
    case "$_ao" in
        '') return 1 ;;
        '>='*)
            _ao="${_ao#>=}"; _ao="${_ao#"${_ao%%[![:space:]]*}"}"
            _ar="${_ao%%.*}"
            case "$_ar" in ''|*[!0-9]*) return 1 ;; esac
            [ "$_ar" -le "$_ah" ]; return $? ;;
        '^'*|'~'*|'='*) _ao="${_ao#?}" ;;
    esac
    _ar="${_ao%%.*}"
    [ "$_ar" = "$_ah" ] || return 1
    # minor, если он назван (^1 и ^1.0 — любой хост 1.x)
    case "$_ao" in
        *.*) _an="${_ao#*.}"; _an="${_an%%.*}"
             case "$_an" in ''|*[!0-9]*) return 0 ;; esac
             [ "$_an" -le "$_am" ]; return $? ;;
    esac
    return 0
}

# Относительный путь программы внутри каталога плагина: без «/» в начале и без «..», файл исполняемый.
ext_prog_ok() {  # ID ПУТЬ
    case "$2" in
        ''|/*|..|../*|*/..|*/../*|*[[:space:]]*) return 1 ;;
    esac
    [ -x "$PLUGIN_ROOT/$1/$2" ]
}

# Положительное целое или пусто (-> по умолчанию).
ext_num() {  # ЗНАЧЕНИЕ УМОЛЧАНИЕ
    case "$1" in ''|*[!0-9]*|0) printf '%s' "$2" ;; *) printf '%s' "$1" ;; esac
}

# Одна запись реестра: поля через табуляцию.
ext_emit() {  # ТИП ПОЛЕ...
    _ee=""
    for _ef in "$@"; do _ee="$_ee${_ee:+$EXT_TAB}$_ef"; done
    printf '%s\n' "$_ee" >> "$EXT_REG_TMP"
}

# Ошибка разбора блока splify2 плагина: в реестр и в журнал. Текст — на языке каркаса на момент сборки реестра
# (s2_t: КОД ТЕКСТ [ИМЯ ЗНАЧЕНИЕ]...), раздел «Плагины» показывает его как есть.
ext_err() {  # ПЛАГИН КОД ТЕКСТ [ИМЯ ЗНАЧЕНИЕ]...
    _ee_id="$1"; shift
    _ee_t="$(s2_t "$@")"
    ext_emit err "$_ee_id: $_ee_t"
    ext_log "$_ee_id: $_ee_t"
}

# Кто занял имя: список слов «имя=плагин».
ext_occupant() {  # СПИСОК ИМЯ
    for _oc in $1; do
        case "$_oc" in "$2="*) printf '%s' "${_oc#*=}"; return 0 ;; esac
    done
    return 0
}

# Слова имени: метод — [a-z][a-z0-9_]*.
ext_name_ok() { plugin_method_ok "$1"; }

# Разбор блока `splify2` одного плагина. Пишет записи в $EXT_REG_TMP. Ничего не печатает.
ext_scan_plugin() {  # ID
    _sp_id="$1"
    _sp_f="$PLUGIN_ROOT/$_sp_id/plugin.json"
    [ -r "$_sp_f" ] || return 0
    _sp_doc="$(cat "$_sp_f")"
    # Ось compat — jsonfilter: ключ с дефисом голым шагом пути jshn не читается.
    _sp_api="$(jsonfilter -s "$_sp_doc" -e "@.compat['splify2-api']" 2>/dev/null)"
    json_load "$_sp_doc" 2>/dev/null || { ext_err "$_sp_id" ext.json_unparsable "plugin.json cannot be parsed"; return 0; }
    json_select splify2 2>/dev/null || return 0
    json_select ..
    # Права и приоритет.
    _sp_perms=" "
    if json_select permissions 2>/dev/null; then
        json_get_keys _sp_pk
        for _sp_k in $_sp_pk; do ext_jget _sp_v "$_sp_k"; _sp_perms="$_sp_perms$_sp_v "; done
        json_select ..
    fi
    json_select splify2
    if [ -z "$_sp_api" ]; then
        ext_err "$_sp_id" ext.no_compat "the splify2 block has no compat.splify2-api - block not applied"
        return 0
    fi
    if ! ext_api_ok "$_sp_api"; then
        ext_err "$_sp_id" ext.api_mismatch "needs splify2-api {need}, the host has {have} - block not applied" need "$_sp_api" have "$EXT_API_VERSION"
        return 0
    fi
    _sp_repo=""
    [ -r "$PLUGIN_STATE" ] && _sp_repo="$(jsonfilter -i "$PLUGIN_STATE" -e "@.plugins['$_sp_id'].repo" 2>/dev/null)"
    _sp_official=0
    for _sp_r in $EXT_OFFICIAL_REPOS; do [ "$_sp_r" = "$_sp_repo" ] && _sp_official=1; done
    _sp_safe=0
    ext_safe && _sp_safe=1
    ext_emit plugin "$_sp_id" "$_sp_official"

    # --- хуки
    if json_select hooks 2>/dev/null; then
        json_get_keys _sp_hk
        for _sp_h in $_sp_hk; do
            case "$EXT_HOOKS_KNOWN" in *" $_sp_h "*) ;; *) ext_err "$_sp_id" ext.unknown_hook "unknown hook {hook}" hook "$_sp_h"; continue ;; esac
            json_select "$_sp_h" 2>/dev/null || continue
            ext_jget _sp_prog prog; ext_jget _sp_mode mode; ext_jget _sp_to timeout_s; ext_jget _sp_crit critical
            json_select ..
            [ "$_sp_safe" = 1 ] && continue
            case "$_sp_perms" in *" splify2.hooks "*) ;; *) ext_err "$_sp_id" ext.hook_no_perm "hook {hook} without the splify2.hooks permission - not connected" hook "$_sp_h"; continue ;; esac
            ext_prog_ok "$_sp_id" "$_sp_prog" || { ext_err "$_sp_id" ext.hook_no_prog "hook {hook}: the program {program} is missing or not executable" hook "$_sp_h" program "$_sp_prog"; continue; }
            case "$_sp_mode" in
                '') _sp_mode=observe ;;
                transform) case "$_sp_h" in pre_spec_set|heal) ;; *) ext_err "$_sp_id" ext.transform_only "the transform mode exists only for pre_spec_set and heal ({hook})" hook "$_sp_h"; continue ;; esac ;;
                veto|warn|observe) ;;
                *) ext_err "$_sp_id" ext.hook_bad_mode "hook {hook}: unknown mode {mode}" hook "$_sp_h" mode "$_sp_mode"; continue ;;
            esac
            case "$_sp_crit" in 1|true) _sp_crit=1 ;; *) _sp_crit=0 ;; esac
            ext_emit hook "$_sp_h" "$_sp_id" "$_sp_prog" "$_sp_mode" "$(ext_num "$_sp_to" "$EXT_HOOK_TIMEOUT")" "$_sp_crit"
        done
        json_select ..
    fi

    # --- периодические задачи (в безопасном режиме не записываются)
    if json_select tasks 2>/dev/null; then
        json_get_keys _sp_tk
        for _sp_t in $_sp_tk; do
            json_select "$_sp_t" 2>/dev/null || continue
            ext_jget _sp_tn name; ext_jget _sp_ev every; ext_jget _sp_cr cron; ext_jget _sp_ji jitter
            ext_jget _sp_prog prog; ext_jget _sp_oi only_if; ext_jget _sp_to timeout_s
            json_select ..
            [ "$_sp_safe" = 1 ] && continue
            ext_name_ok "$(printf '%s' "$_sp_tn" | tr - _)" || { ext_err "$_sp_id" ext.task_bad_name "task without a valid name ({task})" task "$_sp_tn"; continue; }
            ext_prog_ok "$_sp_id" "$_sp_prog" || { ext_err "$_sp_id" ext.task_no_prog "task {task}: the program {program} is missing or not executable" task "$_sp_tn" program "$_sp_prog"; continue; }
            case "$_sp_oi" in ''|engine-enabled|spec-present) ;; *) ext_err "$_sp_id" ext.task_only_if "task {task}: unknown only_if {only_if}" task "$_sp_tn" only_if "$_sp_oi"; continue ;; esac
            if [ -n "$_sp_ev" ]; then
                case "$_sp_ev" in *[!0-9mhd]*|[!0-9]*|*[mhd]?*|*[0-9]) ext_err "$_sp_id" ext.task_every "task {task}: every '{every}' is not understood (a number and m, h or d)" task "$_sp_tn" every "$_sp_ev"; continue ;; esac
                _sp_kind=every; _sp_sched="$_sp_ev"
            elif [ -n "$_sp_cr" ]; then
                set -f; set -- $_sp_cr; set +f
                [ $# -eq 5 ] || { ext_err "$_sp_id" ext.task_cron_fields "task {task}: cron must have five fields" task "$_sp_tn"; continue; }
                case "$_sp_cr" in *[!0-9M*/,\ -]*) ext_err "$_sp_id" ext.task_cron_chars "task {task}: cron has invalid characters" task "$_sp_tn"; continue ;; esac
                _sp_kind=cron; _sp_sched="$1 $2 $3 $4 $5"
            else
                ext_err "$_sp_id" ext.task_need_schedule "task {task}: every or cron is required" task "$_sp_tn"; continue
            fi
            [ "$_sp_ji" = random-minute ] || _sp_ji=none
            ext_emit task "$_sp_id" "$_sp_tn" "$_sp_kind" "$_sp_sched" "$_sp_ji" "${_sp_oi:--}" "$_sp_prog" "$(ext_num "$_sp_to" "$EXT_TASK_TIMEOUT")"
        done
        json_select ..
    fi

    # --- события ядра
    if json_select events 2>/dev/null; then
        ext_jget _sp_prog prog
        _sp_subs=""
        if json_select subscribe 2>/dev/null; then
            json_get_keys _sp_sk
            for _sp_s in $_sp_sk; do ext_jget _sp_v "$_sp_s"; _sp_subs="${_sp_subs:+$_sp_subs,}$_sp_v"; done
            json_select ..
        fi
        ext_jget _sp_to timeout_s
        json_select ..
        if [ "$_sp_safe" != 1 ] && [ -n "$_sp_prog" ]; then
            if ext_prog_ok "$_sp_id" "$_sp_prog"; then
                case "$_sp_subs" in *[!a-z0-9,*-]*) ext_err "$_sp_id" ext.events_chars "events: invalid characters in subscribe" ;;
                    *) ext_emit event "$_sp_id" "$_sp_prog" "${_sp_subs:-*}" "$(ext_num "$_sp_to" "$EXT_HOOK_TIMEOUT")" ;; esac
            else
                ext_err "$_sp_id" ext.events_no_prog "events: the program {program} is missing or not executable" program "$_sp_prog"
            fi
        fi
    fi

    # --- методы: псевдонимы и переопределения
    if json_select methods 2>/dev/null; then
        if json_select alias 2>/dev/null; then
            json_get_keys _sp_ak
            _sp_aliases=""
            for _sp_a in $_sp_ak; do ext_jget _sp_v "$_sp_a"; _sp_aliases="$_sp_aliases $_sp_a=$_sp_v"; done
            json_select ..
        else
            _sp_aliases=""
        fi
        _sp_overrides=""
        if json_select override 2>/dev/null; then
            json_get_keys _sp_ok
            for _sp_o in $_sp_ok; do
                json_select "$_sp_o" 2>/dev/null || continue
                ext_jget _sp_prog prog; ext_jget _sp_mode mode; ext_jget _sp_to timeout_s; ext_jget _sp_crit critical
                json_select ..
                case "$_sp_crit" in 1|true) _sp_crit=1 ;; *) _sp_crit=0 ;; esac
                _sp_overrides="$_sp_overrides $_sp_o|$_sp_mode|$_sp_prog|$(ext_num "$_sp_to" "$EXT_HOOK_TIMEOUT")|$_sp_crit"
            done
            json_select ..
        fi
        json_select ..
    fi
    # Манифест перечитывается (jshn выше ушёл в глубину): права доступа методов плагина — для ACL новых имён.
    for _sp_a in $_sp_aliases; do
        _sp_name="${_sp_a%%=*}"; _sp_target="${_sp_a#*=}"
        ext_name_ok "$_sp_name" && ext_name_ok "$_sp_target" || { ext_err "$_sp_id" ext.alias_bad_name "alias '{name}' -> '{target}': the name is not valid" name "$_sp_name" target "$_sp_target"; continue; }
        _sp_kind="$(ext_method_kind "$_sp_name")"
        _sp_acc="$(jsonfilter -s "$_sp_doc" -e "@.rpc.methods.$_sp_target.access" 2>/dev/null)"
        [ -n "$_sp_acc" ] || { ext_err "$_sp_id" ext.alias_no_method "alias '{name}': the plugin has no rpc method {target}" name "$_sp_name" target "$_sp_target"; continue; }
        _sp_new=0; _sp_safe_ok=0
        case "$_sp_kind" in
            final) ext_err "$_sp_id" ext.alias_final "alias '{name}': a final method - its name cannot be taken" name "$_sp_name"; continue ;;
            fast) ext_err "$_sp_id" ext.alias_fast "alias '{name}': a fast-path method - its name cannot be taken" name "$_sp_name"; continue ;;
            frame) ext_err "$_sp_id" ext.alias_frame "alias '{name}': the name is taken by the frame - use methods.override to replace a handler" name "$_sp_name"; continue ;;
            "moved "*)
                if [ "$_sp_official" != 1 ] || [ "${_sp_kind#moved }" != "$_sp_id" ]; then
                    ext_err "$_sp_id" ext.alias_moved "alias '{name}': the method moved to plugin {plugin}, only that plugin from the official repository may take its name" name "$_sp_name" plugin "${_sp_kind#moved }"
                    continue
                fi
                _sp_safe_ok=1 ;;
            *) _sp_new=1 ;;
        esac
        [ "$_sp_safe" = 1 ] && [ "$_sp_safe_ok" != 1 ] && continue
        _sp_occ="$(ext_occupant "$_ext_taken" "$_sp_name")"
        if [ -n "$_sp_occ" ]; then ext_err "$_sp_id" ext.alias_taken "alias '{name}' is already taken by plugin {occupant}" name "$_sp_name" occupant "$_sp_occ"; continue; fi
        _ext_taken="$_ext_taken $_sp_name=$_sp_id"
        ext_emit alias "$_sp_name" "$_sp_id" "$_sp_target" "$_sp_safe_ok" "$_sp_acc" "$_sp_new"
        ext_emit m "$_sp_name"
    done
    for _sp_o in $_sp_overrides; do
        IFS='|' read -r _sp_name _sp_mode _sp_prog _sp_to _sp_crit <<EOF
$_sp_o
EOF
        [ "$_sp_safe" = 1 ] && continue
        case "$_sp_perms" in *" splify2.override "*) ;; *) ext_err "$_sp_id" ext.override_no_perm "override '{name}' without the splify2.override permission" name "$_sp_name"; continue ;; esac
        _sp_kind="$(ext_method_kind "$_sp_name")"
        case "$_sp_kind" in
            frame) ;;
            final) ext_err "$_sp_id" ext.override_final "override '{name}': a final method - it cannot be replaced or wrapped" name "$_sp_name"; continue ;;
            fast) ext_err "$_sp_id" ext.override_fast "override '{name}': a fast-path method - the dispatcher answers it before the registry, it cannot be replaced" name "$_sp_name"; continue ;;
            "moved "*) ext_err "$_sp_id" ext.override_moved "override '{name}': the method moved to plugin {plugin} - use an alias" name "$_sp_name" plugin "${_sp_kind#moved }"; continue ;;
            *) ext_err "$_sp_id" ext.override_unknown "override '{name}': the frame has no such method" name "$_sp_name"; continue ;;
        esac
        case "$_sp_mode" in replace|wrap) ;; *) ext_err "$_sp_id" ext.override_mode "override '{name}': the mode is replace or wrap, not '{mode}'" name "$_sp_name" mode "$_sp_mode"; continue ;; esac
        ext_prog_ok "$_sp_id" "$_sp_prog" || { ext_err "$_sp_id" ext.override_no_prog "override '{name}': the program {program} is missing or not executable" name "$_sp_name" program "$_sp_prog"; continue; }
        if [ "$_sp_mode" = replace ]; then
            _sp_occ="$(ext_occupant "$_ext_replaced" "$_sp_name")"
            if [ -n "$_sp_occ" ]; then ext_err "$_sp_id" ext.override_taken "the handler '{name}' was already replaced by plugin {occupant} - a second replace is not accepted" name "$_sp_name" occupant "$_sp_occ"; continue; fi
            _ext_replaced="$_ext_replaced $_sp_name=$_sp_id"
        fi
        ext_emit override "$_sp_name" "$_sp_id" "$_sp_mode" "$_sp_prog" "$_sp_to" "$_sp_crit"
        ext_emit m "$_sp_name"
    done
    return 0
}

# Собрать реестр заново: атомарно (временный файл рядом и переименование).
ext_rebuild() {
    EXT_REG_TMP="$EXT_REG.new.$$"
    mkdir -p "${EXT_REG%/*}" 2>/dev/null
    # Не `: > файл || …`: отказ перенаправления у специальной встроенной команды завершает оболочку целиком.
    ( : > "$EXT_REG_TMP" ) 2>/dev/null || return 1
    _ext_taken=""; _ext_replaced=""
    ext_emit api "$EXT_API_VERSION"
    if ext_safe; then ext_emit safe 1; touch "$EXT_REG.safe" 2>/dev/null; else ext_emit safe 0; rm -f "$EXT_REG.safe"; fi
    # Порядок — приоритет манифеста (меньше — раньше), затем id: в этом же порядке идут хуки и обёртки.
    _er_list="$(
        for _er_d in "$PLUGIN_ROOT"/*/; do
            [ -f "${_er_d}plugin.json" ] || continue
            _er_id="${_er_d%/}"; _er_id="${_er_id##*/}"
            plugin_id_ok "$_er_id" || continue
            [ "$(plugin_state_of "$_er_id")" = enabled ] || continue
            _er_p="$(jsonfilter -i "${_er_d}plugin.json" -e '@.splify2.priority' 2>/dev/null)"
            case "$_er_p" in ''|*[!0-9-]*) _er_p=100 ;; esac
            printf '%06d %s\n' "$((_er_p + 100000))" "$_er_id"
        done | sort
    )"
    while read -r _er_p _er_id; do
        [ -n "$_er_id" ] && ext_scan_plugin "$_er_id"
    done <<EOF
$_er_list
EOF
    if [ -f "$EXT_REG" ] && cmp -s "$EXT_REG" "$EXT_REG_TMP"; then
        # Тот же состав: время файла обновляется, чтобы «state.json новее» не повторялось.
        touch "$EXT_REG"
        rm -f "$EXT_REG_TMP"
    else
        mv -f "$EXT_REG_TMP" "$EXT_REG"
    fi
    return 0
}

# Реестр устарел: нет файла, state.json новее, режим безопасности переключили.
ext_stale() {
    [ -f "$EXT_REG" ] || return 0
    [ "$PLUGIN_STATE" -nt "$EXT_REG" ] && return 0
    if [ -e "$EXT_SAFE_FILE" ]; then [ -e "$EXT_REG.safe" ] || return 0
    else [ -e "$EXT_REG.safe" ] && return 0; fi
    return 1
}

# Реестр актуален (пересобирается при нужде).
ext_ready() {
    if ext_stale; then ext_rebuild; fi
    [ -f "$EXT_REG" ]
}

# ---- выполнение программ плагина ----------------------------------------------------------------------

# Окружение программы плагина (так же, как у методов rpc, плюс splify2-api).
ext_env() {  # ID
    plugin_export_env "$1"
}

# Запуск программы плагина с пределом по времени. Итог: EXT_RC, файлы EXT_OUT и EXT_ERRF во временном каталоге
# EXT_TMP (удаляется ext_clean).
ext_exec() {  # ID ПУТЬ СРОК МЕТОД_ИЛИ_ПУСТО ВХОД_ФАЙЛ [ПЕРЕМЕННАЯ=ЗНАЧЕНИЕ...]
    _ex_id="$1"; _ex_prog="$2"; _ex_to="$3"; _ex_arg="$4"; _ex_in="$5"; shift 5
    EXT_TMP="$(mktemp -d 2>/dev/null)" || { EXT_RC=125; EXT_OUT=/dev/null; EXT_ERRF=/dev/null; return 0; }
    EXT_OUT="$EXT_TMP/out"; EXT_ERRF="$EXT_TMP/err"
    (
        ext_env "$_ex_id"
        for _ex_kv in "$@"; do export "$_ex_kv"; done
        cd "$PLUGIN_ROOT/$_ex_id" 2>/dev/null || true
        if [ -n "$_ex_arg" ]; then
            plugin_run_limited "$_ex_to" "$_ex_in" "$EXT_OUT" "$EXT_ERRF" "$PLUGIN_ROOT/$_ex_id/$_ex_prog" "$_ex_arg"
        else
            plugin_run_limited "$_ex_to" "$_ex_in" "$EXT_OUT" "$EXT_ERRF" "$PLUGIN_ROOT/$_ex_id/$_ex_prog"
        fi
    )
    EXT_RC=$?
    return 0
}
ext_clean() { [ -n "${EXT_TMP:-}" ] && rm -rf "$EXT_TMP"; EXT_TMP=""; }

# Содержимое выходного файла похоже на объект JSON (первый и последний значащие знаки — фигурные скобки).
ext_is_object() {  # ФАЙЛ
    _io_h="$(head -c 64 "$1" 2>/dev/null | tr -d ' \t\r\n' | head -c 1)"
    _io_t="$(tail -c 64 "$1" 2>/dev/null | tr -d ' \t\r\n' | tail -c 1)"
    [ "$_io_h" = '{' ] && [ "$_io_t" = '}' ]
}

# ---- хуки ---------------------------------------------------------------------------------------------

# Контекст хука: {"api":1,"hook":..,"plugin":..,"ctx":<ctx>}.
ext_hook_input() {  # ХУК ID КОНТЕКСТ_JSON ФАЙЛ
    _hi_ctx="${3:-}"
    [ -n "$_hi_ctx" ] || _hi_ctx='{}'
    printf '{"api":1,"hook":"%s","plugin":"%s","ctx":%s}\n' "$1" "$2" "$_hi_ctx" > "$4"
}

# Для каждого плагина, подключившего хук, выполнить его и вызвать ОБРАБОТЧИК ID КОД ВЫХОДНОЙ_ФАЙЛ РЕЖИМ КРИТИЧЕСКИЙ.
# Ошибки самого хука (код, срок, форма) — на совести обработчика: см. ext_gate.
ext_hook_each() {  # ХУК КОНТЕКСТ_JSON ОБРАБОТЧИК [ПЕРЕМЕННАЯ=ЗНАЧЕНИЕ...]
    _eh_hook="$1"; _eh_ctx="$2"; _eh_cb="$3"; shift 3
    ext_ready || return 0
    ext_safe && return 0
    while IFS="$EXT_TAB" read -r _eh_t _eh_h _eh_id _eh_prog _eh_mode _eh_to _eh_crit; do
        [ "$_eh_t" = hook ] && [ "$_eh_h" = "$_eh_hook" ] || continue
        [ -z "${EXT_ONLY_ID:-}" ] || [ "$EXT_ONLY_ID" = "$_eh_id" ] || continue
        EXT_TMP_IN="$(mktemp 2>/dev/null)" || continue
        ext_hook_input "$_eh_hook" "$_eh_id" "$_eh_ctx" "$EXT_TMP_IN"
        ext_exec "$_eh_id" "$_eh_prog" "$_eh_to" "" "$EXT_TMP_IN" "SPLIFY2_HOOK=$_eh_hook" "$@" </dev/null
        rm -f "$EXT_TMP_IN"
        "$_eh_cb" "$_eh_id" "$EXT_RC" "$EXT_OUT" "$_eh_mode" "$_eh_crit" </dev/null
        ext_clean
    done < "$EXT_REG"
    return 0
}

# Хуки до и после операции: накапливают EXT_VETO (отказ, одна строка) и EXT_WARN (предупреждения построчно).
# Правила (splify2-api, «Политика отказа»):
#   ответ {ok:false, error}: у режима veto — отказ, у warn — предупреждение, у observe — только журнал;
#   {ok:true, warn:[..]}: предупреждения (кроме observe);
#   упал, не ответил за срок, ответил не по форме: журнал и предупреждение; critical:true — отказ.
EXT_VETO=""; EXT_WARN=""
ext_gate_cb() {  # ID КОД ФАЙЛ РЕЖИМ КРИТИЧЕСКИЙ
    _gc_id="$1"; _gc_rc="$2"; _gc_f="$3"; _gc_mode="$4"; _gc_crit="$5"
    _gc_bad=""
    if [ "$_gc_rc" = 124 ]; then _gc_bad="$(s2_t hook.reason_timeout "did not answer in time")"
    elif [ "$_gc_rc" != 0 ]; then _gc_bad="$(s2_t hook.reason_exit "stopped with an error (code {code})" code "$_gc_rc")"
    elif ! ext_is_object "$_gc_f"; then _gc_bad="$(s2_t hook.reason_form "gave an unexpected reply")"
    fi
    if [ -n "$_gc_bad" ]; then
        ext_log "hook ${EXT_GATE_HOOK:-?} of plugin $_gc_id $_gc_bad"
        if [ "$_gc_crit" = 1 ]; then
            EXT_VETO="${EXT_VETO:-$(s2_t hook.veto "Plugin {id} ({hook}) {reason}" id "$_gc_id" hook "$EXT_GATE_HOOK" reason "$_gc_bad")}"
        else
            EXT_WARN="${EXT_WARN:+$EXT_WARN
}$(s2_t hook.warn "Plugin {id}: hook {hook} {reason}" id "$_gc_id" hook "$EXT_GATE_HOOK" reason "$_gc_bad")"
        fi
        return 0
    fi
    _gc_resp="$(cat "$_gc_f")"
    _gc_ok="$(jsonfilter -s "$_gc_resp" -e '@.ok' 2>/dev/null)"
    _gc_err="$(jsonfilter -s "$_gc_resp" -e '@.error' 2>/dev/null)"
    if [ "$_gc_ok" = false ]; then
        case "$_gc_mode" in
            veto) [ -n "$EXT_VETO" ] || EXT_VETO="${_gc_err:-$(s2_t hook.refused "Plugin {id} refused" id "$_gc_id")}" ;;
            warn|transform) EXT_WARN="${EXT_WARN:+$EXT_WARN
}${_gc_err:-$(s2_t hook.warns "Plugin {id} warns" id "$_gc_id")}" ;;
            *) ext_log "hook $EXT_GATE_HOOK of plugin $_gc_id: ${_gc_err:-refused} (observe - not counted)" ;;
        esac
        return 0
    fi
    if [ "$_gc_mode" != observe ]; then
        _gc_w="$(jsonfilter -s "$_gc_resp" -e '@.warn[*]' 2>/dev/null)"
        [ -n "$_gc_w" ] && EXT_WARN="${EXT_WARN:+$EXT_WARN
}$_gc_w"
    fi
    return 0
}

ext_gate() {  # ХУК КОНТЕКСТ_JSON [ПЕРЕМЕННАЯ=ЗНАЧЕНИЕ...]
    EXT_GATE_HOOK="$1"; _gg_ctx="$2"; shift 2
    EXT_VETO=""; EXT_WARN=""
    ext_hook_each "$EXT_GATE_HOOK" "$_gg_ctx" ext_gate_cb "$@"
    return 0
}

# Есть ли у хука подписчики.
ext_has_hook() {  # ХУК
    ext_ready || return 1
    ext_safe && return 1
    while IFS="$EXT_TAB" read -r _hh_t _hh_h _hh_rest; do
        [ "$_hh_t" = hook ] && [ "$_hh_h" = "$1" ] && return 0
    done < "$EXT_REG"
    return 1
}

# Хук pre_spec_set: плагины в порядке приоритета могут переписать файл $1 (transform) или отказать (veto).
# После transform файл остаётся тем, что ответил плагин; проверит его ядро (вызывающий). Итог — EXT_VETO, EXT_WARN.
ext_pre_spec_set() {  # ФАЙЛ_СПЕКИ
    ext_has_hook pre_spec_set || { EXT_VETO=""; EXT_WARN=""; return 0; }
    EXT_GATE_HOOK=pre_spec_set; EXT_VETO=""; EXT_WARN=""
    ext_hook_each pre_spec_set "{\"spec_tmp\":$(plugin_jstr "$1")}" ext_gate_cb "SPLIFY2_SPEC_TMP=$1"
    return 0
}

# Хук heal: плагины дополняют лечение спеки. Каждому дают рабочую копию (SPLIFY2_SPEC_TMP); изменённую копию, которую
# проверило ядро (engine_check), вызывающий кладёт на место. Итог: EXT_HEAL_MSG (что сделано) и код 0, если спека изменена.
ext_heal() {  # ФАЙЛ_РАБОЧЕЙ_КОПИИ
    EXT_HEAL_MSG=""
    ext_has_hook heal || return 1
    _hl_before="$(md5sum < "$1" 2>/dev/null)"
    ext_hook_each heal "{\"spec_tmp\":$(plugin_jstr "$1")}" ext_heal_cb "SPLIFY2_SPEC_TMP=$1"
    [ "$(md5sum < "$1" 2>/dev/null)" != "$_hl_before" ]
}
ext_heal_cb() {
    EXT_GATE_HOOK=heal
    ext_gate_cb "$@"
    _hc_m="$(jsonfilter -i "$3" -e '@.message' 2>/dev/null)"
    [ -n "$_hc_m" ] && EXT_HEAL_MSG="${EXT_HEAL_MSG:+$EXT_HEAL_MSG
}$_hc_m"
    return 0
}

# ---- методы: псевдонимы и переопределения -----------------------------------------------------------

# Выполнить метод плагина как метод каркаса. Тело запроса — файл $3 (без передачи через аргументы), ответ — в stdout.
ext_invoke() {  # ID МЕТОД ВХОД_ФАЙЛ
    _iv_id="$1"; _iv_m="$2"; _iv_in="$3"
    plugin_installed "$_iv_id" && [ "$(plugin_state_of "$_iv_id")" = enabled ] ||
        { plugin_fail disabled plugin.disabled "Plugin {id} is off. Turn it on in the Plugins tab." id "$_iv_id"; return 0; }
    plugin_method_info "$_iv_id" "$_iv_m"
    case $? in 0) ;; *) plugin_fail no_method plugin.no_method "Plugin {id} has no action {method}" id "$_iv_id" method "$_iv_m"; return 0 ;; esac
    _iv_prog="$PLUGIN_PROG"; _iv_to="$PLUGIN_MTIMEOUT"; _iv_job="$PLUGIN_MJOB"
    case "$_iv_to" in ''|*[!0-9]*|0) _iv_to="$PLUGIN_RPC_TIMEOUT" ;; esac
    case "$_iv_job" in 1|true) plugin_invoke "$_iv_id" "$_iv_m" "$(cat "$_iv_in")"; return 0 ;; esac
    ext_prog_ok "$_iv_id" "$_iv_prog" || { plugin_fail unavailable plugin.no_program "Plugin {id} has no program for the panel" id "$_iv_id"; return 0; }
    ext_exec "$_iv_id" "$_iv_prog" "$_iv_to" "$_iv_m" "$_iv_in"
    ext_answer "$_iv_id" "$EXT_RC" "$EXT_OUT" "$EXT_ERRF" "$_iv_to"
    ext_clean
    return 0
}

# Итог программы -> ответ метода (как plugin_answer, но без передачи ответа аргументом: он бывает на сотни КБ).
ext_answer() {  # ID КОД ВЫХОД ОШИБКИ СРОК
    case "$2" in
        0)
            if ext_is_object "$3"; then cat "$3"; return 0; fi
            plugin_fail failed plugin.bad_reply "Plugin {id} gave an unexpected reply" id "$1" ;;
        124) plugin_fail timeout plugin.timeout "Plugin {id} did not answer within {seconds} s" id "$1" seconds "$5" ;;
        *)
            _an_m="$(tail -n 1 "$4" 2>/dev/null)"
            [ -n "$_an_m" ] || _an_m="$(s2_t plugin.exit_code "Plugin {id} stopped with an error (code {code})" id "$1" code "$2")"
            plugin_fail_raw failed "$_an_m" ;;
    esac
    return 0
}

# Метод с реестровой записью: выполнить. Вызывается диспетчером, stdin — запрос.
ext_dispatch() {  # МЕТОД
    _dp_m="$1"
    _dp_in="$(mktemp 2>/dev/null)" || { plugin_fail failed tmp.file_failed "Cannot create a temporary file"; return 0; }
    cat > "$_dp_in"
    _dp_safe=0; ext_safe && _dp_safe=1
    _dp_alias=""; _dp_repl=""; _dp_wraps=""
    while IFS="$EXT_TAB" read -r _dp_t _dp_a _dp_b _dp_c _dp_d _dp_e _dp_f; do
        [ "$_dp_a" = "$_dp_m" ] || continue
        case "$_dp_t" in
            alias)    [ "$_dp_safe" = 1 ] && [ "$_dp_d" != 1 ] && continue; _dp_alias="$_dp_b $_dp_c" ;;
            override)
                [ "$_dp_safe" = 1 ] && continue
                # поля: МЕТОД ID РЕЖИМ ПРОГРАММА СРОК КРИТИЧЕСКИЙ
                if [ "$_dp_c" = replace ]; then _dp_repl="$_dp_b|$_dp_d|$_dp_e|$_dp_f"
                else _dp_wraps="$_dp_wraps $_dp_b|$_dp_d|$_dp_e|$_dp_f"; fi ;;
        esac
    done < "$EXT_REG"
    if [ -n "$_dp_alias" ]; then
        set -- $_dp_alias
        ext_invoke "$1" "$2" "$_dp_in"
        rm -f "$_dp_in"
        return 0
    fi
    # База ответа: обработчик каркаса или замена.
    _dp_out="$(mktemp 2>/dev/null)" || { rm -f "$_dp_in"; plugin_fail failed tmp.file_failed "Cannot create a temporary file"; return 0; }
    _dp_base=1
    if [ -n "$_dp_repl" ]; then
        IFS='|' read -r _dp_id _dp_prog _dp_to _dp_crit <<EOF
$_dp_repl
EOF
        ext_exec "$_dp_id" "$_dp_prog" "$_dp_to" "$_dp_m" "$_dp_in"
        if [ "$EXT_RC" = 0 ] && ext_is_object "$EXT_OUT"; then
            cat "$EXT_OUT" > "$_dp_out"; _dp_base=0
        else
            ext_log "replacing the method $_dp_m (plugin $_dp_id) failed (code $EXT_RC)"
            if [ "$_dp_crit" = 1 ]; then
                ext_clean; rm -f "$_dp_in" "$_dp_out"
                plugin_fail failed plugin.replace_silent "Plugin {id} replaced the method {method} and gave no answer" id "$_dp_id" method "$_dp_m"; return 0
            fi
        fi
        ext_clean
    fi
    if [ "$_dp_base" = 1 ]; then
        SPLIFY2_NO_EXT=1 "${SPLIFY2_SELF:-$0}" call "$_dp_m" < "$_dp_in" > "$_dp_out"
    fi
    for _dp_w in $_dp_wraps; do
        IFS='|' read -r _dp_id _dp_prog _dp_to _dp_crit <<EOF
$_dp_w
EOF
        if [ "$(wc -c < "$_dp_out")" -le 100000 ]; then
            ext_exec "$_dp_id" "$_dp_prog" "$_dp_to" "$_dp_m" "$_dp_in" "SPLIFY2_NEXT_FILE=$_dp_out" "SPLIFY2_NEXT=$(cat "$_dp_out")"
        else
            ext_exec "$_dp_id" "$_dp_prog" "$_dp_to" "$_dp_m" "$_dp_in" "SPLIFY2_NEXT_FILE=$_dp_out"
        fi
        if [ "$EXT_RC" = 0 ] && ext_is_object "$EXT_OUT"; then
            cat "$EXT_OUT" > "$_dp_out"
        else
            ext_log "wrapping the method $_dp_m (plugin $_dp_id) failed (code $EXT_RC) - the frame answer is used without it"
        fi
        ext_clean
    done
    cat "$_dp_out"
    rm -f "$_dp_in" "$_dp_out"
    return 0
}

# Лишние имена объекта splify2 для `list`: новые псевдонимы из реестра.
ext_new_aliases() {
    [ -f "$EXT_REG" ] || return 0
    while IFS="$EXT_TAB" read -r _ln_t _ln_n _ln_id _ln_tg _ln_s _ln_acc _ln_new; do
        [ "$_ln_t" = alias ] && [ "$_ln_new" = 1 ] && printf '%s\n' "$_ln_n"
    done < "$EXT_REG"
}
ext_list_names() {
    ext_ready || return 0
    ext_new_aliases
}

# Для ACL: новые имена объекта splify2 у плагина — «имя доступ» построчно.
ext_acl_aliases() {  # ID
    [ -f "$EXT_REG" ] || return 0
    while IFS="$EXT_TAB" read -r _aa_t _aa_n _aa_id _aa_tg _aa_s _aa_acc _aa_new; do
        [ "$_aa_t" = alias ] && [ "$_aa_new" = 1 ] && [ "$_aa_id" = "$1" ] && printf '%s %s\n' "$_aa_n" "$_aa_acc"
    done < "$EXT_REG"
}

# Ошибки реестра для ответа plugins_list: массив JSON строк.
ext_errors_json() {
    _ej="["; _ej_first=1
    if [ -f "$EXT_REG" ]; then
        while IFS="$EXT_TAB" read -r _ej_t _ej_msg; do
            [ "$_ej_t" = err ] || continue
            [ "$_ej_first" = 1 ] || _ej="$_ej,"
            _ej="$_ej$(plugin_jstr "$_ej_msg")"; _ej_first=0
        done < "$EXT_REG"
    fi
    printf '%s]' "$_ej"
}

# ---- периодические задачи ----------------------------------------------------------------------------

# Минута задачи: хранится в tasks.json («id:имя»: минута) и выбирается один раз, как раньше выбиралась при установке.
ext_task_minute() {  # ID ИМЯ
    _tm="$(sed -n "s/^ *\"$1:$2\": *\([0-9]*\).*/\1/p" "$EXT_TASKS_JSON" 2>/dev/null | head -n 1)"
    if [ -z "$_tm" ]; then
        _tm="$(awk 'BEGIN{srand();print int(rand()*60)}')"
    fi
    printf '%s' "$_tm"
}

# Строка crontab для задачи; EXT_TL_MIN — выбранная минута (пусто, если она не случайная).
ext_task_line() {  # ID ИМЯ ВИД РАСПИСАНИЕ ДЖИТТЕР
    _tl_i="$1"; _tl_n="$2"; _tl_k="$3"; _tl_s="$4"; _tl_j="$5"
    EXT_TL_MIN=""
    _tl_min=0
    if [ "$_tl_j" = random-minute ]; then _tl_min="$(ext_task_minute "$_tl_i" "$_tl_n")"; EXT_TL_MIN="$_tl_min"; fi
    case "$_tl_k" in
        every)
            _tl_c="${_tl_s%[mhd]}"; _tl_u="${_tl_s#$_tl_c}"
            case "$_tl_u" in
                m) _tl_spec="*/$_tl_c * * * *" ;;
                h) if [ "$_tl_c" = 1 ]; then _tl_spec="$_tl_min * * * *"; else _tl_spec="$_tl_min */$_tl_c * * *"; fi ;;
                d) if [ "$_tl_c" = 1 ]; then _tl_spec="$_tl_min 4 * * *"; else _tl_spec="$_tl_min 4 */$_tl_c * *"; fi ;;
            esac ;;
        *)
            set -f; set -- $_tl_s; set +f
            _tl_m="$1"
            if [ "$_tl_m" = M ]; then _tl_min="$(ext_task_minute "$_tl_i" "$_tl_n")"; EXT_TL_MIN="$_tl_min"; _tl_m="$_tl_min"; fi
            _tl_spec="$_tl_m $2 $3 $4 $5" ;;
    esac
    printf '%s %s %s %s' "$_tl_spec" "$EXT_TASK_BIN" "$_tl_i" "$_tl_n"
}

# Привести блок crontab и tasks.json в согласие с реестром. Возврат 0 всегда; EXT_CRON_CHANGED=1, если crontab менялся.
ext_cron_sync() {
    EXT_CRON_CHANGED=0
    _cs_block=""; _cs_json=""
    if [ -f "$EXT_REG" ]; then
        while IFS="$EXT_TAB" read -r _cs_t _cs_id _cs_name _cs_kind _cs_sched _cs_ji _cs_oi _cs_prog _cs_to; do
            [ "$_cs_t" = task ] || continue
            _cs_line="$(ext_task_line "$_cs_id" "$_cs_name" "$_cs_kind" "$_cs_sched" "$_cs_ji")"
            # Минута выбрана в подоболочке подстановки, поэтому берётся из самой строки: первое поле при
            # случайной минуте — число (every h и d, cron с M), для every m минута не случайна по смыслу.
            _cs_block="${_cs_block:+$_cs_block
}$_cs_line"
            _cs_f1="${_cs_line%% *}"
            case "$_cs_f1" in
                ''|*[!0-9]*) ;;
                *) if [ "$_cs_ji" = random-minute ] || [ "${_cs_sched%% *}" = M ]; then
                       _cs_json="${_cs_json:+$_cs_json,
}  \"$_cs_id:$_cs_name\": $_cs_f1"
                   fi ;;
            esac
        done < "$EXT_REG"
    fi
    # tasks.json
    if [ -n "$_cs_json" ]; then
        _cs_want="{
$_cs_json
}"
        if [ "$(cat "$EXT_TASKS_JSON" 2>/dev/null)" != "$_cs_want" ]; then
            mkdir -p "${EXT_TASKS_JSON%/*}" 2>/dev/null
            # Своё временное имя у процесса (см. ACL в plugin_sync): проходы бывают одновременными.
            if printf '%s\n' "$_cs_want" 2>/dev/null > "$EXT_TASKS_JSON.new.$$"; then mv -f "$EXT_TASKS_JSON.new.$$" "$EXT_TASKS_JSON"
            else rm -f "$EXT_TASKS_JSON.new.$$"; fi
        fi
    else
        [ -f "$EXT_TASKS_JSON" ] && rm -f "$EXT_TASKS_JSON"
    fi
    # crontab: свой блок между метками; чужие строки переносятся как есть.
    _cs_old="$(cat "$EXT_CRONTAB" 2>/dev/null)"
    _cs_rest="$(printf '%s\n' "$_cs_old" | awk -v b="$EXT_CRON_BEGIN" -v e="$EXT_CRON_END" '
        $0 == b { skip = 1; next }
        $0 == e { skip = 0; next }
        !skip { print }')"
    # хвостовые пустые строки не накапливаются
    _cs_rest="$(printf '%s' "$_cs_rest" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')"
    if [ -n "$_cs_block" ]; then
        _cs_new="${_cs_rest:+$_cs_rest
}$EXT_CRON_BEGIN
$_cs_block
$EXT_CRON_END"
    else
        _cs_new="$_cs_rest"
    fi
    if [ "$_cs_new" != "$(printf '%s' "$_cs_old" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}')" ]; then
        mkdir -p "${EXT_CRONTAB%/*}" 2>/dev/null
        # Временный файл — не рядом: crond читает КАЖДЫЙ файл каталога как расписание пользователя.
        _cs_tmp="$(mktemp 2>/dev/null)" || return 0
        printf '%s\n' "$_cs_new" > "$_cs_tmp" && cat "$_cs_tmp" > "$EXT_CRONTAB" && EXT_CRON_CHANGED=1
        rm -f "$_cs_tmp"
    fi
    return 0
}

# Условие only_if.
ext_only_if() {  # УСЛОВИЕ
    case "$1" in
        engine-enabled)
            [ -d "${RC_D:-/etc/rc.d}" ] || return 1
            set -- "${RC_D:-/etc/rc.d}"/S[0-9][0-9]steer
            [ -e "$1" ] ;;
        spec-present) spec_have ;;
        *) return 0 ;;
    esac
}

# Запуск задачи (из /usr/sbin/splify2-task по строке crontab): условие, замок, программа с пределом по времени.
ext_task_run() {  # ID ИМЯ
    ext_ready || { ext_log "task $1/$2: no registry"; return 0; }
    ext_safe && { ext_log "task $1/$2: safe mode - skipped"; return 0; }
    _tr_found=0
    while IFS="$EXT_TAB" read -r _tr_t _tr_id _tr_name _tr_kind _tr_sched _tr_ji _tr_oi _tr_prog _tr_to; do
        [ "$_tr_t" = task ] && [ "$_tr_id" = "$1" ] && [ "$_tr_name" = "$2" ] || continue
        _tr_found=1; break
    done < "$EXT_REG"
    [ "$_tr_found" = 1 ] || { ext_log "task $1/$2: not in the registry"; return 0; }
    if [ "$_tr_oi" != - ] && ! ext_only_if "$_tr_oi"; then return 0; fi
    plugin_installed "$1" && [ "$(plugin_state_of "$1")" = enabled ] || return 0
    ext_prog_ok "$1" "$_tr_prog" || { ext_log "task $1/$2: the program is missing"; return 0; }
    # Замок — каталог (mkdir атомарен и работает без flock); брошенный (процесса нет) снимается.
    _tr_lock="$EXT_TASK_LOCK_DIR/splify2-task-$1-$2.lock"
    mkdir -p "$EXT_TASK_LOCK_DIR" 2>/dev/null
    if ! mkdir "$_tr_lock" 2>/dev/null; then
        _tr_pid="$(cat "$_tr_lock/pid" 2>/dev/null)"
        if [ -n "$_tr_pid" ] && kill -0 "$_tr_pid" 2>/dev/null; then
            ext_log "task $1/$2: the previous run is still going"; return 0
        fi
        rm -rf "$_tr_lock"; mkdir "$_tr_lock" 2>/dev/null || return 0
    fi
    echo $$ > "$_tr_lock/pid"
    touch "${_tr_lock}.in" 2>/dev/null
    ext_exec "$1" "$_tr_prog" "$_tr_to" "$2" "${_tr_lock}.in" "SPLIFY2_TASK=$2"
    _tr_rc=$EXT_RC
    [ -s "$EXT_ERRF" ] && ext_log "task $1/$2: $(tail -n 1 "$EXT_ERRF")"
    ext_clean
    rm -rf "$_tr_lock" "${_tr_lock}.in"
    if [ "$_tr_rc" = 124 ]; then ext_log "task $1/$2: did not finish in $_tr_to s"
    elif [ "$_tr_rc" != 0 ]; then ext_log "task $1/$2: code $_tr_rc"; fi
    return 0
}

# ---- события ядра ----------------------------------------------------------------------------------------

# Службе splify2-events быть, если у какого-нибудь плагина есть `events`.
ext_events_wanted() {
    [ -f "$EXT_REG" ] || return 1
    while IFS="$EXT_TAB" read -r _ew_t _ew_rest; do
        [ "$_ew_t" = event ] && return 0
    done < "$EXT_REG"
    return 1
}

ext_events_sync() {
    [ -x "$EXT_EVENTS_INITD" ] || return 0
    if ext_events_wanted; then
        "$EXT_EVENTS_INITD" enable >/dev/null 2>&1
        "$EXT_EVENTS_INITD" running >/dev/null 2>&1 || "$EXT_EVENTS_INITD" start >/dev/null 2>&1
    else
        "$EXT_EVENTS_INITD" running >/dev/null 2>&1 && "$EXT_EVENTS_INITD" stop >/dev/null 2>&1
        "$EXT_EVENTS_INITD" disable >/dev/null 2>&1
    fi
    return 0
}

# Раздать одно событие (строка JSON ядра) плагинам. Фильтр — имена событий через запятую или «*».
ext_event_dispatch() {  # СТРОКА_СОБЫТИЯ
    _ed_line="$1"
    ext_ready || return 0
    ext_safe && return 0
    _ed_ev="$(printf '%s' "$_ed_line" | sed -n 's/.*"ev" *: *"\([^"]*\)".*/\1/p' | head -n 1)"
    [ -n "$_ed_ev" ] || return 0
    while IFS="$EXT_TAB" read -r _ed_t _ed_id _ed_prog _ed_filter _ed_to; do
        [ "$_ed_t" = event ] || continue
        case ",$_ed_filter," in *",*,"*|*",$_ed_ev,"*) ;; *) continue ;; esac
        plugin_installed "$_ed_id" && [ "$(plugin_state_of "$_ed_id")" = enabled ] || continue
        _ed_in="$(mktemp 2>/dev/null)" || continue
        printf '{"api":1,"event":%s}\n' "$_ed_line" > "$_ed_in"
        ext_exec "$_ed_id" "$_ed_prog" "$_ed_to" "" "$_ed_in" "SPLIFY2_EVENT=$_ed_ev" </dev/null
        [ "$EXT_RC" = 0 ] || ext_log "event $_ed_ev: plugin $_ed_id ended with code $EXT_RC"
        rm -f "$_ed_in"
        ext_clean
    done < "$EXT_REG"
    return 0
}

# ---- хуки с данными: support_report, purge, backup_sections, plugin_changed ------------------------------

# support_report: раздел отчёта. Печатает строки через sr_line (функция группы state), поэтому зовётся только оттуда.
ext_support_cb() {  # ID КОД ФАЙЛ РЕЖИМ КРИТИЧЕСКИЙ
    if [ "$2" != 0 ] || ! ext_is_object "$3"; then
        sr_line ""
        sr_line "-- plugin $1: no report section received --"
        return 0
    fi
    _sc_resp="$(cat "$3")"
    _sc_title="$(jsonfilter -s "$_sc_resp" -e '@.section.title' 2>/dev/null | tr -d '\000-\037')"
    _sc_text="$(jsonfilter -s "$_sc_resp" -e '@.section.text' 2>/dev/null | tr -d '\000-\010\013-\037')"
    [ -n "$_sc_text" ] || return 0
    sr_line ""
    sr_line "-- ${_sc_title:-plugin $1} --"
    while IFS= read -r _sc_l; do sr_line "$_sc_l"; done <<EOF
$_sc_text
EOF
    return 0
}

# purge: каждый плагин называет, что уберёт (dry_run:true) или убирает и называет сделанное (dry_run:false).
# Печатает строки «плагин: текст» по одной; зовётся из splify2-purge.
ext_purge_cb() {  # ID КОД ФАЙЛ РЕЖИМ КРИТИЧЕСКИЙ
    if [ "$2" != 0 ] || ! ext_is_object "$3"; then
        printf '%s: %s\n' "$1" "$(s2_t purge.hook_failed "the purge hook did not finish, its traces remain")"
        return 0
    fi
    _pc_resp="$(cat "$3")"
    _pc_list="$(jsonfilter -s "$_pc_resp" -e '@.plan[*]' 2>/dev/null | tr -d '\000-\010\013-\037')"
    [ -n "$_pc_list" ] || return 0
    while IFS= read -r _pc_l; do printf '%s: %s\n' "$1" "$_pc_l"; done <<EOF
$_pc_list
EOF
    return 0
}
ext_purge() {  # DO(0|1) KEEP(0|1)
    if ext_safe; then printf '%s\n' "$(s2_t purge.safe_mode "safe mode: the purge hooks of the plugins were not called")"; return 0; fi
    _pu_dry=true; [ "$1" = 1 ] && _pu_dry=false
    _pu_keep=false; [ "$2" = 1 ] && _pu_keep=true
    ext_hook_each purge "{\"dry_run\":$_pu_dry,\"keep_config\":$_pu_keep}" ext_purge_cb
}

# plugin_changed: после установки, снятия, включения, выключения, обновления. Исход не учитывается.
ext_plugin_changed() {  # ДЕЙСТВИЕ ID
    ext_gate plugin_changed "{\"id\":$(plugin_jstr "$2"),\"action\":$(plugin_jstr "$1")}"
    return 0
}
