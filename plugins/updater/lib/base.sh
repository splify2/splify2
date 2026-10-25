#!/bin/sh
# Общее для программ плагина updater: настройки, сведения о пакетах, версии из выпусков, итог последней проверки.
#
# Каркасу плагин принадлежит только через его API: библиотека `$SPLIFY2_LIB` и службы хоста `$SPLIFY2_HOST`: `release
# versions|fetch` (перечень и скачивание выпусков со суммой и обходом закрытого издателя), `pkg info|install` (менеджер
# пакетов), `engine` (занято ли ядро), `engine modules|settle` (протоколы ядра), `settings`. Файлов, uci и менеджера пакетов
# каркаса здесь нет.
. "${SPLIFY2_LIB:?программа запускается хостом splify2 (нет SPLIFY2_LIB)}"

CONF_DIR="${STEER_PLUGIN_CONF:?нет STEER_PLUGIN_CONF}"
RUN_DIR="${STEER_PLUGIN_STATE:?нет STEER_PLUGIN_STATE}"
# Итог последней проверки — в памяти: это знание о сети на этот момент, а не настройка.
STATUS="$RUN_DIR/status.json"

now() { date -u +%s; }

# Версия a новее версии b (оба — цифры и точки).
ver_gt() {  # A B
    [ -n "$1" ] && [ -n "$2" ] && [ "$1" != "$2" ] && [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | tail -n 1)" = "$1" ]
}

# Сведения о пакетах от хоста: PKG_NOARCH, PKG_EXT, PKG_ARCH, STEER_MIN, V_STEER, V_SPLIFY2 (splify2, а до переименования
# — luci-app-splify2). Один вызов.
pkg_info() {
    _pi="$("$SPLIFY2_HOST" pkg info 2>/dev/null)" || return 1
    json_load "$_pi" 2>/dev/null || return 1
    json_get_var PKG_NOARCH noarch; json_get_var PKG_EXT ext; json_get_var PKG_ARCH arch; json_get_var STEER_MIN steer_min
    json_select versions 2>/dev/null || return 1
    json_get_var V_STEER steer-core; json_get_var V_SPLIFY2 splify2
    [ -n "$V_SPLIFY2" ] || json_get_var V_SPLIFY2 luci-app-splify2
    return 0
}

# Версии продукта из выпусков (ответ службы `release versions`): LATEST — самая свежая стабильная, PRE — текущая
# предварительная (или пусто). Список приходит от новых к старым.
release_latest() {  # ПРОДУКТ
    LATEST=''; PRE=''
    _rl="$("$SPLIFY2_HOST" release versions "$1" 2>/dev/null)" || return 1
    PRE="$(jsonfilter -s "$_rl" -e '@.prerelease' 2>/dev/null)"
    for _v in $(jsonfilter -s "$_rl" -e '@.versions[*]' 2>/dev/null); do
        [ -n "$LATEST" ] && break
        [ "$_v" = "$PRE" ] && continue
        LATEST="$_v"
    done
    [ -n "$LATEST" ] || LATEST="$(jsonfilter -s "$_rl" -e '@.versions[0]' 2>/dev/null)"
    [ -n "$LATEST" ]
}
