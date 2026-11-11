#!/bin/sh
# Методы, вынесенные из каркаса в плагины (plugins/, методы со словом moved в methods.tsv).
#
# Сюда метод попадает, только если реестр расширений не нашёл у него псевдонима: плагина нет, он выключен или
# снят. Каркас без этих плагинов работает, а метод честно говорит, чего ему не хватает, — тем же ответом, что у
# методов самих плагинов (code: not_installed), чтобы интерфейс выбрал вид отказа по слову, а не по тексту.
#
# ИСКЛЮЧЕНИЕ — ЯДРО МЛАДШЕ НУЖНОГО. steer_versions и steer_install переехали в плагин updater, а плагины ставит
# менеджер ядра 2.1: на ядре 2.0.x (панель приехала самообновлением 26.10.x) updater не встанет никогда, и «поставьте
# плагин» вело бы в тупик. Тогда ядро обновляет сам каркас (splify2-core-update, шапка coreup.sh): steer_versions —
# перечень выпусков службой хоста, как у updater; steer_install — обновление отдельным процессом в фоне, ответ сразу
# ({ok, started, version}), а ход отдаёт метод engine (core_update). Ядра нет вовсе — то же: поставить его кнопкой
# лучше, чем просить терминал.

. "${COREUP_SH:-${SPLIFY2_LIBDIR:-/usr/lib/splify2}/coreup.sh}"
case "$2" in
    steer_versions|steer_install)
        if ! core_fits; then
            if [ "$2" = steer_versions ]; then
                "${SPLIFY2_HOST_BIN:-/usr/sbin/splify2-host}" release versions steer
                exit 0
            fi
            read -r input
            _mv_ver="$(jsonfilter -s "$input" -e '@.version' 2>/dev/null)"
            case "$_mv_ver" in *[!0-9.]*) fail_code release.bad_version "A version may contain only digits and dots" ;; esac
            if box_busy; then fail_code core.busy "The core is busy: {by}" by "$BOX_BY"; fi
            if [ -n "$_mv_ver" ] && ! coreup_ver_ge "$_mv_ver" "$STEER_MIN_VERSION"; then
                fail_code updater.steer_min "The interface works with a core no older than {min}" min "$STEER_MIN_VERSION"
            fi
            # Уже идёт (начал postinst или вторая вкладка) — второе не начинается, ответ тот же: ход один.
            coreup_running || coreup_start ${_mv_ver:+--version "$_mv_ver"}
            json_init
            json_add_boolean ok 1
            json_add_boolean started 1
            [ -n "$_mv_ver" ] && json_add_string version "$_mv_ver"
            json_dump
            exit 0
        fi ;;
esac

_mv_plugin=""
need_ext && _mv_plugin="$(ext_moved_plugin "$2")"
[ -n "$_mv_plugin" ] || _mv_plugin="$(s2_t plugin.this_method "this method")"
. "${PLUGIN_SH:-${SPLIFY2_LIBDIR:-/usr/lib/splify2}/plugin.sh}"
plugin_fail not_installed plugin.needed "The {plugin} plugin is required. Install it on the Plugins tab." plugin "$_mv_plugin"
exit 0
