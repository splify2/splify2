#!/bin/sh
# Обновление ядра силами каркаса (splify2-core-update, coreup.sh): панель 26.11 на ядре младше нужного — тупик
# самообновления 26.10.x, снятый на QEMU-стенде. Проверяется:
#   1. сама команда — порядок шагов по службам хоста (версия, файл, установка, довод, семя), выбор версии, отказы и их
#      слова, ход в COREUP_DIR, замок «один за раз», метка автообновления и счёт попыток, запуск в фоне;
#   2. семя на старом ядре — ни одной попытки менеджера, одна строка, строка cron остаётся, повтор автообновления;
#   3. методы: steer_install и steer_versions без плагина updater (moved) и ход в ответе engine (core_update);
#   4. postinst пакета: на старом ядре — одна строка и обновление в фоне, а не «failed … нет такой команды» на плагин.
#
# Службы хоста — двойник с журналом (настоящие скачивание и установку проверяют rpcdmatch и updatermatch), база пакетов —
# файл в формате /lib/apk/db/installed, который двойник «установки» переписывает новой версией.
#
# Запуск: sh tests/coreupmatch.sh (нужен python3 — заглушки jsonfilter и jshn).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d /tmp/coreupmatch.XXXXXX)"
trap 'kill $(cat "$T"/sleeper.pid 2>/dev/null) 2>/dev/null; rm -rf "$T"' EXIT INT TERM
mkdir -p "$T/bin" "$T/fix" "$T/lock" "$T/etc"

fails=0
check() {  # ОПИСАНИЕ ОЖИДАЕМОЕ ПОЛУЧЕННОЕ
    if [ "$2" = "$3" ]; then
        printf '%-76s ok\n' "$1"
    else
        printf '%-76s ПРОВАЛ\n' "$1"
        printf '    ожидалось: %s\n    получено:  %s\n' "$2" "$3"
        fails=$((fails + 1))
    fi
}
jget() {  # КЛЮЧ — поле объекта JSON со стандартного ввода (через точку)
    python3 -c 'import json,sys
try: d = json.load(sys.stdin)
except Exception: print("НЕ JSON"); raise SystemExit
for k in sys.argv[1].split("."):
    d = d.get(k, "") if isinstance(d, dict) else ""
print(("true" if d else "false") if isinstance(d, bool) else d)' "$1"
}

cp "$ROOT/tests/stub/jsonfilter" "$T/bin/jsonfilter"
cp "$ROOT/tests/stub/uci" "$T/bin/uci"
# База пакетов apk: steer-core нужной версии (пусто — ядра нет).
setcore() {  # [ВЕРСИЯ]
    if [ -n "${1:-}" ]; then printf 'C:Q1x=\nP:steer-core\nV:%s-r1\n\nC:Q1y=\nP:splify2\nV:26.11.0-r1\n\n' "$1" > "$T/apkdb"
    else printf 'C:Q1y=\nP:splify2\nV:26.11.0-r1\n\n' > "$T/apkdb"; fi
}
cat > "$T/bin/fakehost" <<'EOF'
#!/bin/sh
echo "$*" >> "$SANDBOX/host.log"
fx="$SANDBOX/fix"
case "$1" in
    release)
        case "$2" in
            versions) [ -e "$fx/versions.fail" ] && { echo '{"ok":false,"error":"перечень не получен"}'; exit 1; }
                      cat "$fx/versions.json" ;;
            fetch) [ -e "$fx/fetch.fail" ] && { echo '{"ok":false,"error":"не скачалось","note":"зеркало молчит"}'; exit 1; }
                   echo "PKG $4" > "$6"; echo '{"ok":true}' ;;
        esac ;;
    pkg)
        case "$2" in
            info) echo '{"ok":true,"manager":"apk","ext":"apk","noarch":"noarch.apk","arch":"x86_64","steer_min":"2.1.0"}' ;;
            install)
                case "$(cat "$fx/install.mode" 2>/dev/null || echo ok)" in
                    ok) v="$(echo "${3##*/}" | sed 's/^steer-core-//; s/-1_.*//')"
                        printf 'C:Q1x=\nP:steer-core\nV:%s-r1\n\n' "$v" > "$SANDBOX/apkdb"
                        echo '{"ok":true,"output":"OK: steer-core","removed":false}' ;;
                    lie) echo '{"ok":true,"output":"","removed":false}' ;;
                    fail) echo '{"ok":false,"error":"ERROR: No space left on device","output":"ERROR: No space left on device","removed":false}'; exit 1 ;;
                esac ;;
        esac ;;
    engine)
        case "${2:-}" in
            modules) echo '{"ok":true,"modules":["proxy","obfs"]}' ;;
            settle) echo '{"ok":true,"restarted":true}' ;;
        esac ;;
    *) exit 2 ;;
esac
EOF
cat > "$T/bin/fakeseed" <<'EOF'
#!/bin/sh
echo "seed $*" >> "$SANDBOX/host.log"
if [ -e "$SANDBOX/fix/seed.fail" ]; then echo "installed lang-ru 26.11.0"; echo "failed andromeda: нет места"; exit 1; fi
echo "installed updater 1.0.0"; echo "installed andromeda 26.11.0"
EOF
# coreup_start запускает эту команду: журнал и «работа» (для проверки фона — настоящая команда, см. ниже).
cat > "$T/bin/fakestart" <<'EOF'
#!/bin/sh
echo "start $*" >> "$SANDBOX/start.log"
EOF
chmod +x "$T/bin"/*
# Живой «чужой» процесс обновления: в его командной строке — имя команды (coreup_running смотрит /proc/<pid>/cmdline).
mkdir -p "$T/sl"; printf 'sleep 30\n' > "$T/sl/splify2-core-update"
cat > "$T/fix/versions.json" <<'EOF'
{"ok":true,"arch":"x86_64","versions":["2.1.1","2.1.0","2.0.5"],"names":{},"prerelease":"2.1.1"}
EOF

envs() {
    env SANDBOX="$T" PATH="$T/bin:$PATH" JSHN_SH="$ROOT/tests/stub/jshn.sh" S2_LANG=en \
        SPLIFY2_LIBDIR="$ROOT/files/usr/lib/splify2" RPCD_LIB="$ROOT/files/usr/lib/splify2/rpcd" \
        ENV_SH="$ROOT/files/usr/lib/splify2/env.sh" COREUP_SH="$ROOT/files/usr/lib/splify2/coreup.sh" \
        APK_DB="$T/apkdb" COREUP_DIR="$T/cu" COREUP_AUTO="$T/etc/core-update.auto" COREUP_PM_WAIT=0 \
        SPLIFY2_HOST_BIN="$T/bin/fakehost" SEED_BIN="$T/bin/fakeseed" SINGBOX_INITD="$T/etc/sing-box" \
        UCI_STUB_DB="$T/uci.db" SPLIFY2_LOCK_DIR="$T/lock" STEER="$T/bin/steer" \
        "$@"
}
cu() { envs sh "$ROOT/files/usr/sbin/splify2-core-update" "$@" > "$T/out" 2> "$T/err"; echo $? > "$T/rc"; }
reset() { rm -rf "$T/cu" "$T/etc/core-update.auto" "$T/etc/sing-box"; rm -f "$T"/fix/*.fail "$T/fix/install.mode"; : > "$T/host.log"; : > "$T/start.log"; }
hlog() { sed 's|'"$T"'|T|g' "$T/host.log" | tr '\n' '|' | sed 's/|$//'; }
st() { cat "$T/cu/$1" 2>/dev/null; }

echo "== команда splify2-core-update =="
reset; setcore 2.0.5
printf '0 0\n' > "$T/etc/core-update.auto"
cu --auto
check "2.0.5: успех, итог done, версия 2.1.0 (стабильная, а не предварительная 2.1.1)" "0;done;2.1.0" "$(cat "$T/rc");$(st state);$(st version)"
check "  шаги службами хоста по порядку, файл в каталоге хода, прежние пакеты — к снятию по названию" \
    "pkg info|release versions steer|release fetch steer 2.1.0 steer-core-2.1.0-1_x86_64.apk T/cu/pkg/steer-core-2.1.0-1_x86_64.apk|pkg install T/cu/pkg/steer-core-2.1.0-1_x86_64.apk --replace steer libsteer libsteer-wolfssl steer-vless steer-hysteria2 steer-proxy steer-xsteer steer-obfs steer-warpbox steer-tgws steer-extended|engine modules|engine settle proxy obfs|seed " \
    "$(hlog)"
check "  стоит 2.1.0 (база пакетов), скачанный файл убран" "2.1.0;no" \
    "$(envs sh -c '. "$COREUP_SH"; core_version');$([ -e "$T/cu/pkg" ] && echo yes || echo no)"
check "  метка автообновления снята, замка нет, отметка «авто» в ходе" "no;no;1" \
    "$([ -e "$T/etc/core-update.auto" ] && echo yes || echo no);$([ -e "$T/cu/lock" ] && echo yes || echo no);$(st auto)"
check "  последняя строка хода — итог" "The core is steer 2.1.0" "$(st progress)"
check "  журнал хода называет шаги и вывод менеджера" "yes;yes;yes" \
    "$(grep -q 'Downloading steer-core-2.1.0-1_x86_64.apk' "$T/cu/log" && echo yes);$(grep -q 'OK: steer-core' "$T/cu/log" && echo yes);$(grep -q 'installed andromeda' "$T/cu/log" && echo yes)"

reset; setcore 2.1.0
cu
check "ядро уже 2.1.0: только семя, без сети и установки" "0;done;seed " "$(cat "$T/rc");$(st state);$(hlog)"

reset; setcore 2.0.5
cu --version 2.0.9
check "--version младше нужной — отказ до сети" "1;failed;updater.steer_min;" "$(cat "$T/rc");$(st state);$(st code);$(hlog)"

reset; setcore 2.0.5
cu --version 2.1.1
check "--version 2.1.1 — ставится названная, перечень не спрашивается" "0;2.1.1;0" "$(cat "$T/rc");$(st version);$(grep -c 'release versions' "$T/host.log")"

reset; setcore 2.0.5; : > "$T/fix/versions.fail"
printf '3 0\n' > "$T/etc/core-update.auto"
cu --auto
check "нет сети (перечень не получен): отказ словами, ядро прежнее" "1;failed;updater.no_list;2.0.5" \
    "$(cat "$T/rc");$(st state);$(st code);$(envs sh -c '. "$COREUP_SH"; core_version')"
check "  попытка автообновления посчитана (3 → 4) со временем" "4;yes" \
    "$(cut -d' ' -f1 "$T/etc/core-update.auto");$([ "$(cut -d' ' -f2 "$T/etc/core-update.auto")" -gt 0 ] && echo yes)"
check "  слова отказа — в error и в строке хода" "The release list was not received;The release list was not received" "$(st error);$(st progress)"

reset; setcore 2.0.5; printf '{"ok":true,"versions":["2.0.5"],"names":{}}\n' > "$T/fix/v2.json"; cp "$T/fix/versions.json" "$T/fix/v1.json"; cp "$T/fix/v2.json" "$T/fix/versions.json"
cu
check "в перечне нет 2.1 — отказ «нет steer 2.1.0 или новее»" "1;core_update.no_version" "$(cat "$T/rc");$(st code)"
printf '{"ok":true,"arch":"x86_64","versions":[],"names":{}}\n' > "$T/fix/versions.json"; reset; setcore 2.0.5
cu
check "перечень пустой (все источники молчат, служба отвечает ok) — «перечень не получен»" "1;updater.no_list" "$(cat "$T/rc");$(st code)"
cp "$T/fix/v1.json" "$T/fix/versions.json"

reset; setcore 2.0.5; : > "$T/fix/fetch.fail"
cu
check "файл не скачался: отказ называет файл и примечание" "1;updater.download;Download failed: steer-core-2.1.0-1_x86_64.apk (no such version for x86_64?) — зеркало молчит" \
    "$(cat "$T/rc");$(st code);$(st error)"

reset; setcore 2.0.5; echo fail > "$T/fix/install.mode"
cu
check "менеджер отказал: слова менеджера, довода и семени не было" "1;core_update.install_failed;steer 2.1.0 did not install: ERROR: No space left on device;0" \
    "$(cat "$T/rc");$(st code);$(st error);$(grep -c 'engine settle\|seed' "$T/host.log")"
reset; setcore 2.0.5; echo lie > "$T/fix/install.mode"
cu
check "менеджер сказал «да», а ядро прежнее — отказ, а не «готово»" "1;core_update.still_old" "$(cat "$T/rc");$(st code)"

reset; setcore 2.0.5; : > "$T/fix/seed.fail"
cu
check "семя встало не всё: ядро обновлено (done), не вставшее названо" "0;done;yes" \
    "$(cat "$T/rc");$(st state);$(grep -q 'some plugins did not install and will be retried: andromeda: нет места' "$T/cu/log" && echo yes)"

reset; setcore 2.0.5; printf '#!/bin/sh\n# steer-box-connector\n' > "$T/etc/sing-box"; printf '0 0\n' > "$T/etc/core-update.auto"
cu --auto
check "ядро ведёт коннектор: отказ core.busy, ничего не спрошено, метка снята (повторять незачем)" "1;core.busy;;no" \
    "$(cat "$T/rc");$(st code);$(hlog);$([ -e "$T/etc/core-update.auto" ] && echo yes || echo no)"

reset; setcore 2.0.5
mkdir -p "$T/cu/lock"; sh "$T/sl/splify2-core-update" & echo $! > "$T/sleeper.pid"; cp "$T/sleeper.pid" "$T/cu/pid"
cu
check "второй запуск при живом первом — отказ «already running», ход первого не тронут" "1;already running;" \
    "$(cat "$T/rc");$(cat "$T/err");$(hlog)"
kill "$(cat "$T/sleeper.pid")" 2>/dev/null; wait 2>/dev/null
cu
check "замок умершего процесса снимается — запуск проходит" "0;done" "$(cat "$T/rc");$(st state)"

reset; setcore 2.0.5
echo running > "$T/cu.state.tmp"; mkdir -p "$T/cu"; echo running > "$T/cu/state"; echo 999999 > "$T/cu/pid"
check "ход «running» без процесса — оборвано (failed, core_update.aborted)" "failed;core_update.aborted" \
    "$(envs sh -c '. "$COREUP_SH"; coreup_state; echo "$CU_STATE;$CU_CODE"')"

reset; setcore 2.0.5
COREUP_BIN="$ROOT/files/usr/sbin/splify2-core-update"; export COREUP_BIN
cu --start --auto
unset COREUP_BIN
for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do [ "$(st state)" = done ] && break; sleep 0.5; done
check "--start: сразу код 0, работа идёт отдельным процессом и доходит до done" "0;done;1" "$(cat "$T/rc");$(st state);$(st auto)"

echo "== метка автообновления =="
au() { envs sh -c '. "$COREUP_SH"; coreup_auto_due && echo due || echo wait'; }
reset
check "метки нет — повторять нечего" "wait" "$(au)"
printf '0 0\n' > "$T/etc/core-update.auto"
check "0 попыток — пора" "due" "$(au)"
printf '5 %s\n' "$(date +%s)" > "$T/etc/core-update.auto"
check "последняя попытка только что — ждём час" "wait" "$(au)"
printf '5 %s\n' "$(( $(date +%s) - 3700 ))" > "$T/etc/core-update.auto"
check "час прошёл — пора" "due" "$(au)"
printf '24 0\n' > "$T/etc/core-update.auto"
check "24 попытки — хватит, дальше кнопка" "wait" "$(au)"

echo "== семя на старом ядре =="
. "$ROOT/tests/stub/plugins-env.sh"
plugins_provision "$T/plug" -
SEED="$T/seed"; mkdir -p "$SEED"; for id in lang-ru andromeda; do : > "$SEED/$id-26.11.0-all.s2p"; done
cat > "$T/bin/steer" <<'EOF'
#!/bin/sh
echo "steer $*" >> "$SANDBOX/steer.log"
echo "steer: нет такой команды: plugin" >&2
exit 1
EOF
chmod +x "$T/bin/steer"
seed() { envs env SPLIFY2_SEED="$SEED" SPLIFY2_SEEDED="$T/seeded" SPLIFY2_CRON="$T/crontab" CRON_INITD="$T/bin/fakestart" \
    COREUP_BIN="$T/bin/fakestart" sh "$ROOT/files/usr/sbin/splify2-seed" --no-reload; }
reset; setcore 2.0.5; rm -f "$T/steer.log" "$T/crontab"
out="$(seed)"; rc=$?
check "ядро 2.0.5: одна строка и код 3, менеджер не спрошен ни разу" "core-too-old 2.0.5 2.1.0;3;0" \
    "$out;$rc;$(cat "$T/steer.log" 2>/dev/null | wc -l | tr -d ' ')"
check "  строка cron повтора — одна" "1" "$(grep -c '# splify2-seed$' "$T/crontab")"
seed >/dev/null
check "  второй прогон (cron) строку не множит" "1" "$(grep -c '# splify2-seed$' "$T/crontab")"
check "  метки автообновления нет — обновление не начинается" "" "$(grep '^start --auto' "$T/start.log")"
printf '1 0\n' > "$T/etc/core-update.auto"; : > "$T/start.log"
seed >/dev/null
# Повтор начинает отдельный процесс: его след появляется не мгновенно (на загруженной машине — через доли секунды).
for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do [ -s "$T/start.log" ] && break; sleep 0.25; done
check "  метка есть и час прошёл — cron начинает повтор в фоне" "start --auto" "$(cat "$T/start.log")"
printf '1 %s\n' "$(date +%s)" > "$T/etc/core-update.auto"; : > "$T/start.log"
seed >/dev/null
check "  попытка была только что — не начинает" "" "$(cat "$T/start.log")"
reset; setcore; rm -f "$T/bin/steer.saved"; mv "$T/bin/steer" "$T/bin/steer.saved"
out="$(seed)"; rc=$?
check "ядра нет вовсе — no-core, код 3" "no-core;3" "$out;$rc"
mv "$T/bin/steer.saved" "$T/bin/steer"

echo "== методы без плагина updater =="
rpcd() {  # МЕТОД [JSON]
    printf '%s\n' "${2:-}" | envs env PLUGIN_ROOT="$T/plug/lib" PLUGIN_STATE="$T/plug/state.json" EXT_REG="$T/plug/run/ext.reg" \
        COREUP_BIN="$T/bin/fakestart" FAST_SH="$ROOT/files/usr/lib/splify2/fast.sh" FETCH_SH="$ROOT/files/usr/lib/splify2/fetch.sh" \
        SPEC="$T/etc/spec.json" OPENWRT_RELEASE="$T/etc/openwrt_release" INITD="$T/bin/fakestart" \
        sh "$ROOT/files/usr/libexec/rpcd/splify2" call "$1" 2>"$T/rpcd.err"
}
reset; setcore 2.0.5
out="$(rpcd steer_install '{"version":"2.1.0"}')"
check "steer_install на ядре 2.0.5: ok, started, версия" "true;true;2.1.0" \
    "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget started);$(printf '%s' "$out" | jget version)"
for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do [ -s "$T/start.log" ] && break; sleep 0.25; done
check "  обновление начато в фоне с названной версией" "start --version 2.1.0" "$(cat "$T/start.log")"
: > "$T/start.log"
out="$(rpcd steer_install '{}')"
for _i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do [ -s "$T/start.log" ] && break; sleep 0.25; done
check "steer_install без версии — последняя подходящая (решает команда)" "true;start " "$(printf '%s' "$out" | jget ok);$(cat "$T/start.log")"
out="$(rpcd steer_install '{"version":"2.0.9"}')"
check "steer_install младше нужной — отказ updater.steer_min" "false;updater.steer_min" "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget code)"
printf '#!/bin/sh\n# steer-box-connector\n' > "$T/etc/sing-box"
out="$(rpcd steer_install '{"version":"2.1.0"}')"
check "steer_install при коннекторе — отказ core.busy" "false;core.busy" "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget code)"
rm -f "$T/etc/sing-box"
out="$(rpcd steer_versions)"
check "steer_versions на старом ядре — перечень службой хоста" "true;2.1.1" "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget prerelease)"
setcore 2.1.0
out="$(rpcd steer_install '{"version":"2.1.0"}')"
check "ядро 2.1.0 без updater — прежний ответ «нужен плагин updater»" "false;not_installed;updater" \
    "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget code);$(printf '%s' "$out" | jget args.plugin)"

reset; setcore 2.0.5; printf "DISTRIB_ARCH='x86_64'\n" > "$T/etc/openwrt_release"
out="$(rpcd engine)"
check "engine без хода и метки — поля core_update нет, min_version есть" ";2.1.0" \
    "$(printf '%s' "$out" | jget core_update);$(printf '%s' "$out" | jget min_version)"
mkdir -p "$T/cu"; echo running > "$T/cu/state"; echo "Downloading steer-core-2.1.0-1_x86_64.apk" > "$T/cu/progress"; echo 2.1.0 > "$T/cu/version"
sh "$T/sl/splify2-core-update" & echo $! > "$T/cu/pid"; echo $! > "$T/sleeper.pid"; echo 1 > "$T/cu/auto"
printf '0 0\n' > "$T/etc/core-update.auto"
out="$(rpcd engine)"
check "engine во время обновления: running, строка хода, версия, auto, retry" "running;Downloading steer-core-2.1.0-1_x86_64.apk;2.1.0;true;true" \
    "$(printf '%s' "$out" | jget core_update.state);$(printf '%s' "$out" | jget core_update.progress);$(printf '%s' "$out" | jget core_update.version);$(printf '%s' "$out" | jget core_update.auto);$(printf '%s' "$out" | jget core_update.retry)"
kill "$(cat "$T/sleeper.pid")" 2>/dev/null; wait 2>/dev/null
echo failed > "$T/cu/state"; echo updater.no_list > "$T/cu/code"; echo "The release list was not received" > "$T/cu/error"
out="$(rpcd engine)"
check "engine после отказа: failed, слова и код" "failed;The release list was not received;updater.no_list" \
    "$(printf '%s' "$out" | jget core_update.state);$(printf '%s' "$out" | jget core_update.error);$(printf '%s' "$out" | jget core_update.code)"

echo "== postinst пакета =="
PI="$T/postinst.block"
sed -n '/^if \[ -x \/usr\/sbin\/splify2-seed \]; then$/,/^fi$/p' "$ROOT/build.sh" > "$PI"
check "блок семени в post-install найден" "yes" "$([ -s "$PI" ] && grep -q 'core-too-old\|no-core' "$PI" && echo yes)"
check "  postinst больше не гонит семя построчно в «failed» на старом ядре: код 3 разобран" "1" "$(grep -c '"$_sd_rc" = 3' "$PI")"
check "  на старом ядре — метка автообновления и запуск в фоне" "1;1" "$(grep -c 'printf .0 0' "$PI");$(grep -c 'coreup_start --auto' "$PI")"
check "  при коннекторе — не обновляет, а говорит, что делать" "1" "$(grep -c 'steer-box-connector: обновите коннектор' "$PI")"
check "  build.sh кладёт и сверяет splify2-core-update" "yes;yes" \
    "$(grep -q 'cp files/usr/sbin/splify2-core-update' "$ROOT/build.sh" && echo yes);$(grep -q 'test -x "\$PKG/usr/sbin/splify2-core-update"' "$ROOT/build.sh" && echo yes)"
check "шелл-файлы обновления ядра проходят разбор dash" "ok" \
    "$(for f in files/usr/lib/splify2/coreup.sh files/usr/sbin/splify2-core-update files/usr/lib/splify2/rpcd/m-moved.sh; do dash -n "$ROOT/$f" 2>&1 || echo "$f"; done | grep -q . && echo bad || echo ok)"

echo
if [ "$fails" -ne 0 ]; then echo "ЕСТЬ ПРОВАЛЫ: $fails"; exit 1; fi
echo "все проверки прошли"
