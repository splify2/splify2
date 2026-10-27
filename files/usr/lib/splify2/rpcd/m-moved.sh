#!/bin/sh
# Методы, вынесенные из каркаса в плагины (plugins/, методы со словом moved в methods.tsv).
#
# Сюда метод попадает, только если реестр расширений не нашёл у него псевдонима: плагина нет, он выключен или
# снят. Каркас без этих плагинов работает, а метод честно говорит, чего ему не хватает, — тем же ответом, что у
# методов самих плагинов (code: not_installed), чтобы интерфейс выбрал вид отказа по слову, а не по тексту.

_mv_plugin=""
need_ext && _mv_plugin="$(ext_moved_plugin "$2")"
[ -n "$_mv_plugin" ] || _mv_plugin="$(s2_t plugin.this_method "this method")"
. "${PLUGIN_SH:-${SPLIFY2_LIBDIR:-/usr/lib/splify2}/plugin.sh}"
plugin_fail not_installed plugin.needed "The {plugin} plugin is required. Install it on the Plugins tab." plugin "$_mv_plugin"
exit 0
