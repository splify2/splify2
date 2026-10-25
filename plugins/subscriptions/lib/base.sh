#!/bin/sh
# Общее для программ плагина subscriptions: расписание автообновления подписок и отметки времени.
#
# Подключается точкой из bin/*, hooks/*. Каркасу плагин принадлежит только через его API: библиотека `$SPLIFY2_LIB`
# (jshn, s2_fail, s2_setting) и службы хоста `$SPLIFY2_HOST` (`sub list|info|refresh|quota|title`, `settings`). Файлов
# подписок и uci каркаса здесь нет: данные расписания — плагина.
. "${SPLIFY2_LIB:?программа запускается хостом splify2 (нет SPLIFY2_LIB)}"

CONF_DIR="${STEER_PLUGIN_CONF:?нет STEER_PLUGIN_CONF}"
RUN_DIR="${STEER_PLUGIN_STATE:?нет STEER_PLUGIN_STATE}"
# Интервалы: «имя минуты» по строке. Отметки последней попытки лежат в conf (флеш): после перезагрузки роутер не должен
# стучаться ко всем панелям разом, и вторая запись в сутки на подписку флеш не изнашивает.
SCHEDULE="$CONF_DIR/schedule"
STAMPS="$CONF_DIR/stamps"

# Имя подписки: так же, как у каркаса (латиница, цифры, подчёркивание); пустое — первая, main.
sub_name_ok() { case "$1" in ''|*[!A-Za-z0-9_]*) return 1 ;; esac; }

num_or() {  # ЗНАЧЕНИЕ УМОЛЧАНИЕ
    case "$1" in ''|*[!0-9]*) printf '%s' "$2" ;; *) printf '%s' "$1" ;; esac
}

min_interval() { num_or "$(s2_setting min_interval 2>/dev/null)" 30; }
max_interval() { num_or "$(s2_setting max_interval 2>/dev/null)" 4320; }
quota_interval() { num_or "$(s2_setting quota_interval 2>/dev/null)" 0; }

# Интервал подписки в минутах: 0, если не задан или не годится под нынешние пределы (настройки могли ужесточить).
sched_get() {  # ИМЯ
    _sg="$(sed -n "s/^$1 \([0-9][0-9]*\)\$/\1/p" "$SCHEDULE" 2>/dev/null | head -n 1)"
    case "$_sg" in ''|0) printf 0; return 0 ;; esac
    if [ "$_sg" -ge "$(min_interval)" ] && [ "$_sg" -le "$(max_interval)" ]; then printf '%s' "$_sg"; else printf 0; fi
}

# Записать интервал (0 — снять). Файл переписывается целиком и атомарно.
sched_set() {  # ИМЯ МИНУТЫ
    mkdir -p "$CONF_DIR" 2>/dev/null
    _ss_tmp="$SCHEDULE.new.$$"
    { grep -v "^$1 " "$SCHEDULE" 2>/dev/null
      [ "$2" != 0 ] && printf '%s %s\n' "$1" "$2"
      true
    } > "$_ss_tmp" 2>/dev/null || { rm -f "$_ss_tmp"; return 1; }
    if [ -s "$_ss_tmp" ]; then mv "$_ss_tmp" "$SCHEDULE" || { rm -f "$_ss_tmp"; return 1; }
    else rm -f "$_ss_tmp" "$SCHEDULE"; fi
}

stamp_get() {  # ИМЯ [вид]
    _st="$(cat "$STAMPS/$1${2:+.$2}" 2>/dev/null)"
    num_or "$_st" 0
}

stamp_put() {  # ИМЯ [вид]
    mkdir -p "$STAMPS" 2>/dev/null
    date -u +%s > "$STAMPS/$1${2:+.$2}.new" 2>/dev/null && mv "$STAMPS/$1${2:+.$2}.new" "$STAMPS/$1${2:+.$2}"
}

# Пора ли обновлять: подписка-источник (url), интервал задан и с последней попытки (отметка плагина или время файла
# узлов — что позже) прошёл он весь. Отметка ставится ДО похода наружу: попытка была, и повторять её на каждом тике при
# мёртвой панели — значит стучаться к ней 144 раза в сутки вместо одного-двух.
sched_due() {  # ИМЯ ВИД ВРЕМЯ_ФАЙЛА -> 0, если пора
    [ "$2" = url ] || return 1
    _sd_m="$(sched_get "$1")"
    [ "$_sd_m" != 0 ] || return 1
    _sd_last="$(stamp_get "$1")"
    _sd_mt="$(num_or "$3" 0)"
    [ "$_sd_mt" -gt "$_sd_last" ] && _sd_last="$_sd_mt"
    [ $(( $(date -u +%s) - _sd_last )) -ge $(( _sd_m * 60 )) ]
}
