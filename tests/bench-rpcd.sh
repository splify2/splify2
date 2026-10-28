#!/bin/sh
# Замер методов rpcd, которые зовут каркас и Andromeda при открытии страниц: время каждого и число
# запущенных процессов (fork/exec утилит — главная плата на роутере и на стенде TCG).
#
# Не стенд: ничего не проверяет и в tests/run.sh не входит. Песочница — официальные плагины, как их ставит
# менеджер (tests/stub/plugins-env.sh), менеджер плагинов — заглушка, остальное ядро — настоящее (STEER_BIN).
# Процессы считаются обёртками в PATH: каждая утилита пишет своё имя в журнал и запускает настоящую.
# Время меряется отдельным проходом без обёрток. Заглушки jsonfilter и менеджера — python: их запуск на
# машине разработки дороже настоящих, поэтому смотреть надо прежде всего на число процессов.
#
# Запуск: STEER_BIN=…/steer sh tests/bench-rpcd.sh [ПОВТОРОВ]
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/files/usr/libexec/rpcd/splify2"
STEER_BIN="${STEER_BIN:-$ROOT/../steer/build/steer}"
N="${1:-3}"
T="$(mktemp -d /tmp/benchrpcd.XXXXXX)"
trap 'rm -rf "$T"' EXIT INT TERM

. "$ROOT/tests/stub/plugins-env.sh"
plugins_provision "$T/plugins" backup lists-catalog subscriptions updater autoapply group-check node-check lang-en
PLUG="$T/plugins"; export PLUG
mkdir -p "$T/bin" "$T/etc" "$T/lock" "$PLUG/rpcd" "$PLUG/acl" "$PLUG/www" "$PLUG/fixtures"
cp "$ROOT/tests/stub/jsonfilter" "$T/bin/jsonfilter"; chmod +x "$T/bin/jsonfilter"
cat > "$T/bin/steer" <<EOF
#!/bin/sh
if [ "\${1:-}" = plugin ]; then shift; exec sh "$ROOT/tests/stub/steer-plugin" "\$@"; fi
exec "$STEER_BIN" "\$@"
EOF
printf '#!/bin/sh\nexit 0\n' > "$T/bin/initd-rpcd"
chmod +x "$T/bin/steer" "$T/bin/initd-rpcd"
printf '{"version":2,"outputs":{"direct":{"kind":"direct"}}}\n' > "$T/etc/spec.json"

envs() {
    env PATH="$T/bin:$PATH" JSHN_SH="$ROOT/tests/stub/jshn.sh" RPCD_LIB="$ROOT/files/usr/lib/splify2/rpcd" \
        FAST_SH="$ROOT/files/usr/lib/splify2/fast.sh" FETCH_SH="$ROOT/files/usr/lib/splify2/fetch.sh" \
        SPLIFY2_LOCK_DIR="$T/lock" SPEC="$T/etc/spec.json" SPEC_VIEW="$T/spec-view.json" \
        APPLIED="$T/etc/spec.applied.json" UI_STATE="$T/etc/ui.json" PREFS="$T/etc/prefs.json" \
        PLUGIN_RPCD_DIR="$PLUG/rpcd" PLUGIN_ACL_DIR="$PLUG/acl" PLUGIN_UI_DIR="$PLUG/www" \
        PLUGIN_DISPATCHER="$ROOT/files/usr/lib/splify2/plugin-rpcd" STEER="$T/bin/steer" \
        STEER_PLUGIN_STUB="$ROOT/tests/stub/steer-plugin" RPCD_INITD="$T/bin/initd-rpcd" "$@"
}

# Обёртки-счётчики: имя утилиты в журнал, затем настоящая.
mkdir -p "$T/shim"
for u in jsonfilter steer awk sed grep cat tr wc head tail sort mkdir ln readlink rm mv cp date stat \
         printf python3 sh uci ubus mktemp basename dirname cut od md5sum sha256sum flock lock find ls touch; do
    real="$(PATH="$T/bin:$PATH" command -v "$u" 2>/dev/null)" || continue
    case "$real" in /*) ;; *) continue ;; esac
    printf '#!/bin/sh\necho %s >> "%s/exec.log"\nexec "%s" "$@"\n' "$u" "$T" "$real" > "$T/shim/$u"
    chmod +x "$T/shim/$u"
done

call() {  # МЕТОД ВХОД
    printf '%s\n' "$2" | envs sh "$SCRIPT" call "$1" >"$T/out" 2>"$T/err"
}
ms() { date +%s%N; }

# Первый вызов приводит ссылки и реестр в согласие — дальше всё как на открытой странице.
call plugins_list '{"lang":"ru"}'
printf '%-16s %8s %8s  %s\n' метод мс процессы 'чаще всего'
for m in prefs_get i18n_get plugins_list spec_get spec_schema engine applied_get status sub_list repos_list; do
    case "$m" in plugins_list|i18n_get) in='{"lang":"ru"}' ;; *) in='{}' ;; esac
    best=""
    i=0
    while [ "$i" -lt "$N" ]; do
        a="$(ms)"; call "$m" "$in"; b="$(ms)"
        d=$(( (b - a) / 1000000 ))
        [ -z "$best" ] || [ "$d" -lt "$best" ] && best="$d"
        i=$((i + 1))
    done
    : > "$T/exec.log"
    PATH="$T/shim:$PATH" call "$m" "$in"
    cnt="$(wc -l < "$T/exec.log")"
    top="$(sort "$T/exec.log" | uniq -c | sort -rn | head -4 | awk '{printf "%s×%s ", $2, $1}')"
    printf '%-16s %8s %8s  %s\n' "$m" "$best" "$cnt" "$top"
    [ -n "${BENCH_SHOW:-}" ] && { head -c 300 "$T/out"; echo; head -c 300 "$T/err"; echo; }
done
