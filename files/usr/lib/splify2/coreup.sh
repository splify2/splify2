#!/bin/sh
# Ядро steer младше, чем нужно этой панели: как это узнать и как идёт его обновление силами самого каркаса.
#
# ЗАЧЕМ ЭТО В КАРКАСЕ. Обновление ядра — метод плагина updater (steer_install). Но плагины ставит менеджер ядра 2.1
# (`steer plugin install`), а панель 26.11 приезжает и на роутер с ядром 2.0.x: её ставит самообновление 26.10.x, то
# есть одна кнопка «Обновить панель». Тогда ни updater, ни Andromeda встать не могут, и обновить ядро было бы нечем,
# кроме терминала (снято на QEMU-стенде с выпущенными пакетами: тупик). Поэтому довести ядро до STEER_MIN_VERSION
# умеет сам каркас — командой splify2-core-update, тем же путём, что updater: службы хоста `release`, `pkg`,
# `engine settle` (splify2-host). Своего скачивания и своей установки здесь нет.
#
# Подключают: splify2-core-update (выполняет), splify2-seed (семя ждёт ядра и повторяет автообновление), группа
# engine (метод engine отдаёт ход), moved (steer_install без плагина), postinst пакета (запуск после обновления).
# Файл ничего не печатает при подключении и не завершает процесс.

# Не старше какой версии должно быть ядро — одно число в pkg-lib.sh (STEER_MIN_VERSION).
[ -n "${STEER_MIN_VERSION:-}" ] ||
    STEER_MIN_VERSION="$(sed -n 's/^STEER_MIN_VERSION=\([0-9.]*\)$/\1/p' "${PKG_LIB_SH:-${RPCD_LIB:-${SPLIFY2_LIBDIR:-/usr/lib/splify2}/rpcd}/pkg-lib.sh}" 2>/dev/null)"

# Ход обновления — в /tmp: после перезагрузки его нет, и это верно — процесса тоже нет. Что переживает перезагрузку —
# метка автообновления в /etc (COREUP_AUTO): её ставит postinst, по ней повторяет cron, снимает успех.
COREUP_DIR="${COREUP_DIR:-/tmp/splify2-core-update}"
COREUP_AUTO="${COREUP_AUTO:-/etc/splify2/core-update.auto}"
# Сколько раз повторять автообновление и как часто: раз в час сутки. Чаще незачем — причина отказа (нет сети, нет
# места) за десять минут не уходит, а дольше суток повторять за человека то, что он видит кнопкой, — навязчиво.
COREUP_RETRY_MIN="${COREUP_RETRY_MIN:-60}"
COREUP_RETRY_MAX="${COREUP_RETRY_MAX:-24}"

# Версия стоящего пакета steer-core — по базе пакетов, без запуска менеджера: семя спрашивает это раз в десять минут
# из cron, а `apk list -I` стоит сотни миллисекунд и ждёт замка базы посреди чужой установки. Пусто — steer-core нет
# (нет ядра вовсе или стоит ядро 1.x под именем steer).
core_version() {
    _cv_db="${APK_DB:-/lib/apk/db/installed}"
    if [ -s "$_cv_db" ]; then
        awk '/^P:/ { p = substr($0, 3) } /^V:/ && p == "steer-core" { v = substr($0, 3); sub(/-r[0-9]+$/, "", v); print v; exit }
             /^$/ { p = "" }' "$_cv_db" 2>/dev/null
        return 0
    fi
    _cv_db="${OPKG_STATUS:-/usr/lib/opkg/status}"
    [ -s "$_cv_db" ] || return 0
    awk '/^Package:/ { p = $2; v = "" } /^Version:/ && p == "steer-core" { v = $2; sub(/-[0-9]+$/, "", v) }
         /^Status:/ && p == "steer-core" && / installed/ && v != "" { print v; exit }
         /^$/ { p = "" }' "$_cv_db" 2>/dev/null
}

# A не младше B (версии из цифр и точек).
coreup_ver_ge() {  # A B
    case "$1" in ''|*[!0-9.]*) return 1 ;; esac
    [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n 1)" = "$2" ]
}

# Ядро стоит (steer-core), но младше нужного: тупик самообновления, который и снимает splify2-core-update.
core_too_old() {
    _cto="$(core_version)"
    [ -n "$_cto" ] && [ -n "$STEER_MIN_VERSION" ] && ! coreup_ver_ge "$_cto" "$STEER_MIN_VERSION"
}

# Ядро годится для плагинов (steer-core не младше нужного).
core_fits() {
    _cf="$(core_version)"
    [ -n "$_cf" ] && coreup_ver_ge "$_cf" "${STEER_MIN_VERSION:-0}"
}

# Идёт ли обновление сейчас: номер процесса в COREUP_DIR/pid и он жив.
coreup_running() {
    _cr="$(cat "$COREUP_DIR/pid" 2>/dev/null)"
    case "$_cr" in ''|*[!0-9]*) return 1 ;; esac
    kill -0 "$_cr" 2>/dev/null || return 1
    # Номер мог достаться другому процессу (обновление оборвалось, номера пошли по кругу): живым считается только наш.
    [ ! -r "/proc/$_cr/cmdline" ] || tr '\0' ' ' < "/proc/$_cr/cmdline" 2>/dev/null | grep -q splify2-core-update
}

# Ход последнего обновления: CU_STATE (running|done|failed, пусто — не было), CU_PROGRESS, CU_ERROR, CU_CODE,
# CU_VERSION, CU_AUTO (1 — начато само, после обновления пакета). Оборванное (процесса нет, итога нет) — failed.
coreup_state() {
    CU_STATE="$(cat "$COREUP_DIR/state" 2>/dev/null)"
    CU_PROGRESS="$(cat "$COREUP_DIR/progress" 2>/dev/null)"
    CU_ERROR="$(cat "$COREUP_DIR/error" 2>/dev/null)"
    CU_CODE="$(cat "$COREUP_DIR/code" 2>/dev/null)"
    CU_VERSION="$(cat "$COREUP_DIR/version" 2>/dev/null)"
    CU_AUTO="$(cat "$COREUP_DIR/auto" 2>/dev/null)"
    if [ "$CU_STATE" = running ] && ! coreup_running; then
        CU_STATE=failed; CU_CODE=core_update.aborted; CU_ERROR=""
    fi
    return 0
}

# Отдельным процессом в фоне, отвязанным от вызывающего: его зовут rpcd (метод — свой процесс, который rpcd убивает по
# сроку и при перезапуске) и postinst внутри транзакции менеджера пакетов. setsid — свой сеанс: перезапуск rpcd или
# закрытие ssh не уносят обновление посреди установки. Код 1 — уже идёт.
coreup_start() {  # [АРГУМЕНТЫ splify2-core-update]
    coreup_running && return 1
    _cs_bin="${COREUP_BIN:-/usr/sbin/splify2-core-update}"
    if command -v setsid >/dev/null 2>&1; then
        setsid "$_cs_bin" "$@" </dev/null >/dev/null 2>&1 &
    else
        ( trap '' HUP; exec "$_cs_bin" "$@" ) </dev/null >/dev/null 2>&1 &
    fi
    return 0
}

# Автообновление (метка COREUP_AUTO: «попыток время_последней»): пора ли повторить. Повтор — раз в COREUP_RETRY_MIN
# минут, не больше COREUP_RETRY_MAX раз; дальше остаётся кнопка.
coreup_auto_due() {
    [ -f "$COREUP_AUTO" ] || return 1
    set -- $(cat "$COREUP_AUTO" 2>/dev/null)
    _ca_n="${1:-0}"; _ca_t="${2:-0}"
    case "$_ca_n$_ca_t" in *[!0-9]*) _ca_n=0; _ca_t=0 ;; esac
    [ "$_ca_n" -lt "$COREUP_RETRY_MAX" ] || return 1
    [ $(( $(date +%s) - _ca_t )) -ge $(( COREUP_RETRY_MIN * 60 )) ]
}
