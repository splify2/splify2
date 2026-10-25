# Плагины, вынесенные из каркаса (plugins/backup, plugins/lists-catalog, plugins/subscriptions), в песочнице стенда.
#
# Методы backup_* и lists* каркаса стали псевдонимами методов этих плагинов (splify2-api, «Методы»): без плагина
# они отвечают «нужен плагин», с плагином — как прежде. Стенды, проверяющие эти методы, ставят плагины в
# песочницу так же, как их ставит менеджер ядра: каталог плагина, state.json с состоянием enabled и репозиторием
# официального набора. Файл подключается точкой; нужны ROOT и каталог корня плагинов в первом аргументе (lib/, state.json, conf/, run/ внутри).
#
#   . "$ROOT/tests/stub/plugins-env.sh"; plugins_provision "$T/plugins" [id...]
#
# Экспортирует швы (PLUGIN_ROOT, PLUGIN_STATE, EXT_REG, PLUGIN_SH …): их наследуют все процессы стенда.

plugins_provision() {  # КАТАЛОГ [ID...]
    _pp_d="$1"; shift
    # Без списка — официальные плагины (backup, lists-catalog, subscriptions, updater); «-» — пустой корень (стенду нужны только свои плагины).
    [ $# -gt 0 ] || set -- backup lists-catalog subscriptions updater
    [ "$1" = - ] && shift
    rm -rf "$_pp_d"
    mkdir -p "$_pp_d/lib" "$_pp_d/conf" "$_pp_d/run" "$_pp_d/state"
    _pp_st='{"schema":1,"plugins":{'
    _pp_sep=""
    for _pp_id in "$@"; do
        cp -R "$ROOT/plugins/$_pp_id" "$_pp_d/lib/$_pp_id"
        _pp_v="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$_pp_d/lib/$_pp_id/plugin.json")"
        _pp_st="$_pp_st$_pp_sep\"$_pp_id\":{\"version\":\"$_pp_v\",\"state\":\"enabled\",\"repo\":\"splify2-core-plugins\"}"
        _pp_sep=","
    done
    printf '%s}}\n' "$_pp_st" > "$_pp_d/state.json"
    export PLUGIN_ROOT="$_pp_d/lib" PLUGIN_STATE="$_pp_d/state.json" \
           PLUGIN_CONF_DIR="$_pp_d/conf" PLUGIN_JOBS="$_pp_d/jobs" \
           PLUGIN_SH="$ROOT/files/usr/lib/splify2/plugin.sh" \
           EXT_REG="$_pp_d/run/ext.reg" EXT_SAFE_FILE="$_pp_d/safe" \
           EXT_TASKS_JSON="$_pp_d/tasks.json" EXT_CRONTAB="$_pp_d/crontab" \
           EXT_TASK_LOCK_DIR="$_pp_d/run" EXT_EVENTS_INITD="$_pp_d/no-events-initd" \
           EXT_METHODS_TSV="$ROOT/files/usr/lib/splify2/methods.tsv" \
           SPLIFY2_LIBDIR="$ROOT/files/usr/lib/splify2" PLUGIN_RELOAD_DELAY=0 \
           SPLIFY2_HOST="$ROOT/files/usr/sbin/splify2-host" PLUGIN_STATE_DIR="$_pp_d/state" \
           SPLIFY2_LIB="$ROOT/files/usr/lib/splify2/lib.sh" \
           JSONFILTER_PLUGIN="$ROOT/tests/stub/jsonfilter"
}
