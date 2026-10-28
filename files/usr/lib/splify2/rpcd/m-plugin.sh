# Плагины: вкладка «Плагины» панели и методы самих плагинов.
#
# ХОЗЯИН ПЛАГИНОВ — ЯДРО STEER (менеджер `steer plugin …`, plugin-sdk/docs/steer-api.md, 4.2). Здесь тонкая
# обёртка: каждый метод — одно действие менеджера с `--json`, и ничего, кроме проверки входа, сюда не
# вписано. Ответ менеджера не пересказывается: массивы плагинов, каталога и репозиториев приходят из ядра
# как есть, отказ несёт слова менеджера (место, совместимость, выходы, которым плагин нужен).
#
# Долгое — установка и обновление — заданием: метод отвечает {ok, job} сразу, итог читает plugin_job.
# rpcd ждёт обработчик 120 с, а установка по плану — до 600.

. "${PLUGIN_SH:-/usr/lib/splify2/plugin.sh}"

# Входной JSON запроса: поля через jsonfilter (читает поток целиком — тело одной строкой).
plugin_in() {  # ПОЛЕ
    jsonfilter -s "$input" -e "@.$1" 2>/dev/null
}

# После действия, меняющего состав плагинов: ссылки и ACL объектов плагинов, перечитка rpcd.
plugin_after() {  # [ДЕЙСТВИЕ]
    plugin_sync
    plugin_sync_reload
    plugin_changed_notify "${1:-}"
}

# Хук plugin_changed (splify2-api): плагины пересчитывают своё. Исход хуков здесь не учитывается.
plugin_changed_notify() {  # ДЕЙСТВИЕ
    [ -n "$1" ] || return 0
    plugin_need_ext && ext_plugin_changed "$1" "${PL_ID:-}"
    return 0
}

# Конец задания (в его процессе, ответ уже отдан): ссылки и ACL объектов плагинов и перечитка rpcd сразу —
# интерфейс, увидевший «готово», зовёт новый объект.
plugin_job_after() {
    plugin_sync
    [ "$PLUGIN_SYNC_CHANGED" = 1 ] && "${RPCD_INITD:-/etc/init.d/rpcd}" reload
    plugin_changed_notify "${PL_ACTION:-}"
    return 0
}

# Метод с id плагина: читает `input`, проверяет id в PL_ID.
plugin_need_id() {
    read -r input
    PL_ID="$(plugin_in id)"
    plugin_id_ok "$PL_ID" || { plugin_fail bad_request plugin.bad_name "Invalid plugin name"; return 1; }
    return 0
}

# Действие над плагином без хода: remove, enable, disable. Ответ — {ok, id}; перечитать список — дело
# интерфейса. Отказ менеджера доходит его словами.
plugin_simple() {  # ДЕЙСТВИЕ [ФЛАГИ...]
    _ps_act="$1"; shift
    if plugin_manager "$_ps_act" "$PL_ID" "$@"; then
        _ps_res="$(plugin_json_obj "$PLUGIN_OUT")" || _ps_res=""
        plugin_after "$_ps_act"
        if [ -n "$_ps_res" ]; then plugin_ok_raw id "\"$PL_ID\"" result "$_ps_res"
        else plugin_ok_raw id "\"$PL_ID\""; fi
    else
        plugin_manager_fail
    fi
}

# Название и описание стоящих плагинов на языке человека: ключи plugin.name и plugin.description словаря
# плагина (i18n/<язык>.json, manifest.md). Язык ищется как есть, затем без региона (pt-BR, pt), затем en — каркас
# английский; нет и там — поле не отдаётся, и интерфейс показывает слова манифеста. Печатает объект
# {"<id>":{"name":…,"description":…}}.
plugin_names_json() {  # ЯЗЫК
    _pn_l="$1"; _pn_c=""
    case "$_pn_l" in
        ''|*[!A-Za-z0-9-]*) _pn_l="" ;;
        [a-z][a-z]|[a-z][a-z][a-z]|[a-z][a-z]-[A-Za-z0-9]*|[a-z][a-z][a-z]-[A-Za-z0-9]*) _pn_c="$_pn_l ${_pn_l%%-*}" ;;
        *) _pn_l="" ;;
    esac
    _pn_c="$_pn_c en"
    _pn_out=""
    for _pn_d in "$PLUGIN_ROOT"/*/; do
        [ -r "${_pn_d}plugin.json" ] || continue
        _pn_id="${_pn_d%/}"; _pn_id="${_pn_id##*/}"
        plugin_id_ok "$_pn_id" || continue
        _pn_dir="$(jsonfilter -i "${_pn_d}plugin.json" -e '@.i18n.dir' 2>/dev/null)"
        case "$_pn_dir" in ''|/*|*..*) _pn_dir=i18n ;; esac
        _pn_nm=""; _pn_ds=""
        for _pn_x in $(printf '%s\n' $_pn_c | awk '!s[$0]++'); do
            _pn_f="${_pn_d}${_pn_dir}/${_pn_x}.json"
            [ -r "$_pn_f" ] || continue
            [ -n "$_pn_nm" ] || _pn_nm="$(jsonfilter -i "$_pn_f" -e '@["plugin.name"]' 2>/dev/null)"
            [ -n "$_pn_ds" ] || _pn_ds="$(jsonfilter -i "$_pn_f" -e '@["plugin.description"]' 2>/dev/null)"
        done
        [ -n "$_pn_nm$_pn_ds" ] || continue
        _pn_o="{"
        [ -n "$_pn_nm" ] && _pn_o="$_pn_o\"name\":$(plugin_jstr "$_pn_nm")"
        [ -n "$_pn_ds" ] && _pn_o="$_pn_o${_pn_nm:+,}\"description\":$(plugin_jstr "$_pn_ds")"
        _pn_out="${_pn_out:+$_pn_out,}\"$_pn_id\":$_pn_o}"
    done
    printf '{%s}' "$_pn_out"
}

case "$2" in

    plugins_list)
        # Установленные плагины и подключённые репозитории — для открытия вкладки и для загрузки
        # интерфейсов плагинов. Ссылки и ACL приводятся в согласие здесь же: после обновления
        # прошивки (sysupgrade) плагины на месте, а ссылки rpcd — нет; первое открытие вкладки их
        # возвращает.
        read -r input
        _pl_lang="$(plugin_in lang)"
        # Проход согласия — только когда с прошлого что-то менялось (plugin_sync_fresh): без перемен он стоил
        # сотни запусков процессов на каждое открытие вкладки.
        plugin_sync_fresh || plugin_sync
        plugin_manager list || { plugin_manager_fail; exit 0; }
        _pl_plugins="$(plugin_json_array "$PLUGIN_OUT" plugins)"
        _pl_repos="[]"; _pl_rerr=""
        if plugin_manager repo list; then
            _pl_repos="$(plugin_json_array "$PLUGIN_OUT" repos)"
        else
            _pl_rerr="$(plugin_manager_error)"
        fi
        plugin_sync_reload
        # splify2_api — версия точек расширения каркаса, ext_errors — почему блок `splify2` какого-то плагина не
        # применён (нет права, имя занято, версия API не та): карточка плагина показывает это человеку.
        _pl_ext="$(ext_errors_json)"
        if [ -n "$_pl_rerr" ]; then
            plugin_ok_raw host_api "$(plugin_jstr "$PLUGIN_HOST_API")" splify2_api "$(plugin_jstr "$PLUGIN_SPLIFY2_API")" \
                ext_errors "$_pl_ext" names "$(plugin_names_json "$_pl_lang")" plugins "$_pl_plugins" repos "$_pl_repos" repos_error "$(plugin_jstr "$_pl_rerr")"
        else
            plugin_ok_raw host_api "$(plugin_jstr "$PLUGIN_HOST_API")" splify2_api "$(plugin_jstr "$PLUGIN_SPLIFY2_API")" \
                ext_errors "$_pl_ext" names "$(plugin_names_json "$_pl_lang")" plugins "$_pl_plugins" repos "$_pl_repos"
        fi
        ;;

    plugins_search)
        # Каталог всех подключённых репозиториев; слово — необязательно.
        read -r input
        _pq="$(plugin_in query)"
        # Слово уходит менеджеру одним аргументом; начинаться с «-» оно не может — его приняли бы за флаг.
        case "$_pq" in -*) plugin_fail bad_request plugin.query_dash "The query cannot start with a hyphen"; exit 0 ;; esac
        if [ -n "$_pq" ]; then plugin_manager search "$_pq"; else plugin_manager search; fi ||
            { plugin_manager_fail; exit 0; }
        plugin_ok_raw plugins "$(plugin_json_array "$PLUGIN_OUT" plugins)"
        ;;

    repos_list)
        plugin_manager repo list || { plugin_manager_fail; exit 0; }
        plugin_ok_raw repos "$(plugin_json_array "$PLUGIN_OUT" repos)"
        ;;

    plugin_status)
        # Состояние одного плагина или всех: что стоит, включён ли, причина отказа.
        read -r input
        PL_ID="$(plugin_in id)"
        if [ -n "$PL_ID" ]; then
            plugin_id_ok "$PL_ID" || { plugin_fail bad_request plugin.bad_name "Invalid plugin name"; exit 0; }
            plugin_manager status "$PL_ID" || { plugin_manager_fail; exit 0; }
        else
            plugin_manager status || { plugin_manager_fail; exit 0; }
        fi
        # Ответ ядра идёт целиком под ключом status: его форма — дело ядра, а не этого слоя.
        _ps_obj="$(plugin_json_obj "$PLUGIN_OUT")" || _ps_obj="null"
        plugin_ok_raw status "$_ps_obj"
        ;;

    plugin_job)
        # Ход и итог задания. Идёт — ok:true, state:running и строка хода; готово — ok:true, state:done
        # и result (ответ менеджера или метода плагина); не удалось — ok:false, state:failed и error.
        read -r input
        _pj_id="$(plugin_in id)"
        if ! plugin_job_state "$_pj_id"; then
            plugin_fail no_job plugin.no_job "No such job"
            exit 0
        fi
        s2_core_load "$PJ_EARGS"    # до json_init: json_load сбрасывает документ
        json_init
        case "$PJ_STATE" in
            failed)
                json_add_boolean ok 0
                if [ -n "$PJ_ECODE" ]; then s2_core_fields "$PJ_ECODE" "$PJ_ERROR" failed
                else json_add_string error "$PJ_ERROR"; json_add_string code failed; fi
                ;;
            *) json_add_boolean ok 1 ;;
        esac
        json_add_string id "$_pj_id"
        json_add_string state "$PJ_STATE"
        [ -n "$PJ_PROGRESS" ] && json_add_string progress "$PJ_PROGRESS"
        _pj_out="$(json_dump)"
        if [ -n "$PJ_RESULT" ]; then
            printf '%s,"result":%s}\n' "${_pj_out%\}}" "$PJ_RESULT"
        else
            printf '%s\n' "$_pj_out"
        fi
        ;;

    plugin_install)
        # Установка — заданием: скачивание, подпись, место, системные пакеты, проверка здоровья.
        plugin_need_id || exit 0
        PL_VER="$(plugin_in version)"
        if [ -n "$PL_VER" ] && ! plugin_ver_ok "$PL_VER"; then
            plugin_fail bad_request plugin.bad_version "Invalid version: {version}" version "$PL_VER"; exit 0
        fi
        plugin_job_new || { plugin_fail failed plugin.job_failed "Cannot start the job"; exit 0; }
        PL_ACTION=install
        if [ -n "$PL_VER" ]; then plugin_job_start "$STEER" plugin install "$PL_ID" "$PL_VER" --json
        else plugin_job_start "$STEER" plugin install "$PL_ID" --json; fi
        plugin_ok_raw job "\"$PJ_ID\"" id "\"$PL_ID\""
        ;;

    plugin_update)
        # Обновление одного плагина или всех (без id) — заданием.
        read -r input
        PL_ID="$(plugin_in id)"
        if [ -n "$PL_ID" ] && ! plugin_id_ok "$PL_ID"; then
            plugin_fail bad_request plugin.bad_name "Invalid plugin name"; exit 0
        fi
        plugin_job_new || { plugin_fail failed plugin.job_failed "Cannot start the job"; exit 0; }
        PL_ACTION=update
        if [ -n "$PL_ID" ]; then plugin_job_start "$STEER" plugin update "$PL_ID" --json
        else plugin_job_start "$STEER" plugin update --json; fi
        plugin_ok_raw job "\"$PJ_ID\""
        ;;

    plugin_remove)
        # Снятие. Плагин, вид которого есть в спеке, снимается только с force — отказ менеджера
        # называет выходы. purge убирает и настройки плагина (conf/<id>). Системные пакеты менеджер
        # не снимает: чужой пакет — чужая настройка.
        plugin_need_id || exit 0
        _fl=""
        [ "$(plugin_in force)" = true ] && _fl="--force"
        [ "$(plugin_in purge)" = true ] && _fl="$_fl --purge"
        # shellcheck disable=SC2086
        plugin_simple remove $_fl
        ;;

    plugin_enable)
        plugin_need_id || exit 0
        plugin_simple enable
        ;;

    plugin_disable)
        plugin_need_id || exit 0
        plugin_simple disable
        ;;

    plugin_autoupdate)
        # Автообновление одного плагина: {id, enabled}.
        plugin_need_id || exit 0
        case "$(plugin_in enabled)" in
            true)  _au=on ;;
            false) _au=off ;;
            *) plugin_fail bad_request plugin.need_enabled "The enabled field must be true or false"; exit 0 ;;
        esac
        if plugin_manager autoupdate "$PL_ID" "$_au"; then
            plugin_ok_raw id "\"$PL_ID\"" enabled "$([ "$_au" = on ] && echo true || echo false)"
        else
            plugin_manager_fail
        fi
        ;;

    repo_key)
        # Номер ключа репозитория — его человек видит до того, как принять ключ.
        read -r input
        _rk="$(plugin_in key)"
        _rk_id="$(plugin_key_id "$_rk")" || { plugin_fail bad_request repo.key_unknown "The key is not recognized"; exit 0; }
        plugin_ok_raw key_id "\"$_rk_id\""
        ;;

    repo_add)
        # Подключить репозиторий: {url, key}. Ключ — открытый ключ репозитория (файл .pub). Номер
        # ключа считается здесь; если интерфейс прислал key_id (тот, что человек видел и принял), он
        # обязан совпасть. Ключ уходит менеджеру телом (stdin), номер — словом.
        read -r input
        _ra_url="$(plugin_in url)"
        _ra_key="$(plugin_in key)"
        case "$_ra_url" in
            https://?*|http://?*) ;;
            *) plugin_fail bad_request repo.need_https "The repository address must start with https://"; exit 0 ;;
        esac
        case "$_ra_url" in *[[:space:]]*)
            plugin_fail bad_request repo.bad_url "The repository address has invalid characters"; exit 0 ;;
        esac
        _ra_id="$(plugin_key_id "$_ra_key")" || { plugin_fail bad_request repo.key_unknown "The key is not recognized"; exit 0; }
        _ra_want="$(plugin_in key_id)"
        if [ -n "$_ra_want" ] && [ "$_ra_want" != "$_ra_id" ]; then
            plugin_fail bad_request repo.key_mismatch "The key number {want} does not match the key ({id})" want "$_ra_want" id "$_ra_id"; exit 0
        fi
        # Ключ — файлом на stdin менеджера: конвейер запустил бы plugin_manager в подоболочке, и его итог пропал бы.
        _ra_f="$(mktemp 2>/dev/null)" || { plugin_fail failed tmp.file_failed "Cannot create a temporary file"; exit 0; }
        printf '%s\n' "$_ra_key" > "$_ra_f"
        plugin_manager repo add "$_ra_url" "$_ra_id" < "$_ra_f"
        _ra_rc=$?
        rm -f "$_ra_f"
        if [ "$_ra_rc" = 0 ]; then
            plugin_ok_raw key_id "\"$_ra_id\""
        else
            plugin_manager_fail
        fi
        ;;

    repo_del)
        read -r input
        _rd="$(plugin_in name)"
        case "$_rd" in
            ''|*[!A-Za-z0-9._-]*) plugin_fail bad_request repo.bad_name "Invalid repository name"; exit 0 ;;
        esac
        if plugin_manager repo del "$_rd"; then
            plugin_ok_raw name "\"$_rd\""
        else
            plugin_manager_fail
        fi
        ;;

    plugin_call)
        # Метод самого плагина через объект splify2 — для шлюза приложения вне LuCI (/v1/plugin/<id>/<метод>),
        # у которого нет сессии ubus: вход {id, method, params}. В LuCI те же методы идут объектом
        # splify2.p.<id> с ACL из манифеста; диспетчер один (plugin_invoke).
        read -r input
        _pc_id="$(plugin_in id)"
        _pc_m="$(plugin_in method)"
        _pc_p="$(plugin_in params)"
        plugin_invoke "$_pc_id" "$_pc_m" "$_pc_p"
        ;;

    plugin_settings_get)
        # Settings of a plugin for the settings form of the splify2 frame. The plugin declares a REQUIRED
        # schema in its manifest: "splify2": {"settings": {"schema": "<file in the plugin dir>"}} (the subset of
        # JSON Schema of kind-keys.schema.json); the values live in conf/<id>/settings.json - the file the
        # plugin itself reads. Answer: {ok, id, schema, values}.
        plugin_need_id || exit 0
        [ -n "$(plugin_state_of "$PL_ID")" ] || { plugin_fail not_installed plugin.not_installed "Plugin {id} is not installed" id "$PL_ID"; exit 0; }
        _pg_man="$PLUGIN_ROOT/$PL_ID/plugin.json"
        _pg_rel="$(jsonfilter -s "$(cat "$_pg_man" 2>/dev/null)" -e '@.splify2.settings.schema' 2>/dev/null)"
        case "$_pg_rel" in
            ''|/*|*..*|*[!A-Za-z0-9._/-]*) plugin_fail no_settings plugin.no_settings "Plugin {id} has no settings" id "$PL_ID"; exit 0 ;;
        esac
        _pg_sch="$(plugin_json_obj "$(cat "$PLUGIN_ROOT/$PL_ID/$_pg_rel" 2>/dev/null)")" ||
            { plugin_fail failed plugin.schema_unreadable "The settings schema of {id} cannot be read" id "$PL_ID"; exit 0; }
        _pg_val="$(plugin_json_obj "$(cat "$PLUGIN_CONF_DIR/$PL_ID/settings.json" 2>/dev/null)")" || _pg_val="{}"
        plugin_ok_raw id "\"$PL_ID\"" schema "$_pg_sch" values "$_pg_val"
        ;;

    plugin_settings_set)
        # Write the settings of a plugin: {id, values}. The file is replaced atomically; checking the values
        # against the schema is the form's work and the plugin's own (it reads the file), here only the shape.
        read -r input
        PL_ID="$(plugin_in id)"
        plugin_id_ok "$PL_ID" || { plugin_fail bad_request plugin.bad_name "Invalid plugin name"; exit 0; }
        [ -n "$(plugin_state_of "$PL_ID")" ] || { plugin_fail not_installed plugin.not_installed "Plugin {id} is not installed" id "$PL_ID"; exit 0; }
        _pv="$(plugin_json_obj "$(plugin_in values)")" || { plugin_fail bad_request plugin.values_object "The values must be an object"; exit 0; }
        [ "$(printf '%s' "$_pv" | wc -c)" -le 262144 ] || { plugin_fail bad_request plugin.settings_big "The settings are larger than 256 KB"; exit 0; }
        mkdir -p "$PLUGIN_CONF_DIR/$PL_ID" 2>/dev/null
        _pv_f="$PLUGIN_CONF_DIR/$PL_ID/settings.json"
        printf '%s\n' "$_pv" > "$_pv_f.new.$$" 2>/dev/null && mv "$_pv_f.new.$$" "$_pv_f" ||
            { rm -f "$_pv_f.new.$$"; plugin_fail failed plugin.settings_not_saved "The settings were not saved. Free up some space and try again."; exit 0; }
        plugin_ok_raw id "\"$PL_ID\""
        ;;

    *) fail_code req.unknown_method "Unknown method" ;;
esac
