#!/bin/sh
# Библиотека для shell-плагинов (splify2-api v1, plugin-sdk/docs/splify2-api.md, «Библиотека»).
#
# Программа плагина подключает её одной строкой и получает то же окружение, в котором работал код метода внутри
# диспетчера splify2: швы и пути (SPEC, SUB, LISTS, STEER, UCI_SPLIFY2 …), общие функции каркаса (fail,
# call_lock, need_fetch → download, spec_json, spec_put, spec_have, uci_file, private_file, sanitize_list …) и
# jshn. Путь к файлу даёт хост в SPLIFY2_LIB при каждом запуске программы плагина.
#
#     . "$SPLIFY2_LIB"
#
# Файл не печатает и не завершает процесс при подключении. Версия API — SPLIFY2_API (1).

_sl_dir="${SPLIFY2_LIBDIR:-/usr/lib/splify2}"
. "${ENV_SH:-$_sl_dir/env.sh}"
. "${SPEC_SH:-${RPCD_LIB%/rpcd}/spec.sh}"
. "$RPCD_LIB/common.sh"
unset _sl_dir
