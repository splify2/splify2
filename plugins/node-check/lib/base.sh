#!/bin/sh
# Общее для программ плагина node-check: настройки, кэш страны выхода, перебор узлов подписки.
#
# Каркасу плагин принадлежит только через его API: библиотека `$SPLIFY2_LIB` и службы хоста `$SPLIFY2_HOST`: `call`
# (методы узлов и проверок каркаса), `sub list` (подписки), `probe geo|ident` (замер страны выхода через сам выход),
# `settings`. Файлов, uci и ядра каркаса здесь нет.
. "${SPLIFY2_LIB:?программа запускается хостом splify2 (нет SPLIFY2_LIB)}"

CONF_DIR="${STEER_PLUGIN_CONF:?нет STEER_PLUGIN_CONF}"
RUN_DIR="${STEER_PLUGIN_STATE:?нет STEER_PLUGIN_STATE}"
# Измерения — не настройки: в памяти (STEER_PLUGIN_STATE), перезагрузку роутера не переживают — узел мог смениться.
GEO_CACHE="$RUN_DIR/geo"
CHECK_DIR="$RUN_DIR/check"

num_or() { case "$1" in ''|*[!0-9]*) printf '%s' "$2" ;; *) printf '%s' "$1" ;; esac; }
setting_num() {  # КЛЮЧ УМОЛЧАНИЕ
    num_or "$("$SPLIFY2_HOST" settings get "$1" 2>/dev/null)" "$2"
}
now() { date -u +%s; }

# Имя выхода — только имя; имя подписки — латиница, цифры, подчёркивание. Ниже они уходят в пути файлов и в запросы методов.
output_ok() { case "$1" in ''|*[!a-zA-Z0-9_-]*) return 1 ;; esac; }
subname_ok() { case "$1" in ''|*[!A-Za-z0-9_]*) return 1 ;; esac; }

# Строка подписки (JSON) из ответа `sub list` по имени ИЛИ по пути к её файлу узлов (так её знает страница); путь к файлу
# — поле path.
sub_row() {  # ИМЯ_ИЛИ_ПУТЬ
    _sr="$("$SPLIFY2_HOST" sub list 2>/dev/null)" || return 1
    printf '%s' "$_sr" | jsonfilter -e '@.subs[*]' 2>/dev/null | while IFS= read -r _r; do
        [ "$(jsonfilter -s "$_r" -e '@.name' 2>/dev/null)" = "$1" ] ||
            [ "$(jsonfilter -s "$_r" -e '@.path' 2>/dev/null)" = "$1" ] && { printf '%s\n' "$_r"; break; }
    done
}

# Задержка ответившего узла: VLESS меряет ответ через туннель (ttfb_ms), hysteria2 и прокси — рукопожатие с запросом
# (handshake_ms; ttfb_ms у них -1).
probe_ms() {  # TTFB HANDSHAKE
    case "$1" in ''|*[!0-9]*) printf '%s' "$2" ;; *) printf '%s' "$1" ;; esac
}
