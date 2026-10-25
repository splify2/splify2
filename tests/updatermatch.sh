#!/bin/sh
# Стенд плагина updater (plugins/updater): версии и установка ядра и splify2 по службам хоста, проверка «вышло ли новее»,
# канал, задача, архив настроек.
#
# Установка сквозь настоящий хост (суммы, зеркала, apk, конфликты, откаты) проверяется в tests/rpcdmatch.sh; здесь хост —
# двойник с журналом вызовов: проверяется то, что делает сам плагин, — порядок шагов, проверки до сети, слова отказов,
# итог проверки и расписание. Настройки плагина (`settings`) читает настоящий хост.
#
# Запуск: sh tests/updatermatch.sh (нужен python3 — заглушки jsonfilter и jshn).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d /tmp/updatermatch.XXXXXX)"
trap 'rm -rf "$T"' EXIT INT TERM
mkdir -p "$T/bin" "$T/etc" "$T/lock" "$T/lists" "$T/fix"

fails=0
check() {  # ОПИСАНИЕ ОЖИДАЕМОЕ ПОЛУЧЕННОЕ
    if [ "$2" = "$3" ]; then
        printf '%-72s ok\n' "$1"
    else
        printf '%-72s ПРОВАЛ\n' "$1"
        printf '    ожидалось: %s\n    получено:  %s\n' "$2" "$3"
        fails=$((fails + 1))
    fi
}
jget() {  # КЛЮЧ — поле объекта JSON со стандартного ввода
    python3 -c 'import json,sys
d = json.load(sys.stdin)
for k in sys.argv[1].split("."):
    d = d.get(k, "") if isinstance(d, dict) else ""
print(("true" if d else "false") if isinstance(d, bool) else d)' "$1"
}

cp "$ROOT/tests/stub/jsonfilter" "$T/bin/jsonfilter"
cp "$ROOT/tests/stub/uci" "$T/bin/uci"
cat > "$T/bin/logger" <<'EOF'
#!/bin/sh
shift 2 2>/dev/null || true
printf '%s\n' "$*" >> "$SANDBOX/log.txt"
EOF
# Двойник службы хоста: версии, скачивание, установка, довод — из фикстур; settings — настоящая служба.
cat > "$T/bin/fakehost" <<'EOF'
#!/bin/sh
echo "$*" >> "$SANDBOX/host.log"
fx="$SANDBOX/fix"
case "$1" in
    release)
        case "$2" in
            versions) cat "$fx/versions.$3.json" ;;
            fetch)
                [ -e "$fx/fetch.fail.$5" ] || [ -e "$fx/fetch.fail" ] && { echo '{"ok":false,"error":"не скачалось","note":"зеркало молчит"}'; exit 1; }
                : > "$6"; if [ -e "$fx/via" ]; then echo '{"ok":true,"via":"зеркало gitlab"}'; else echo '{"ok":true}'; fi ;;
        esac ;;
    pkg)
        case "$2" in
            info) cat "$fx/pkginfo.json" ;;
            install)
                case "$(cat "$fx/install.mode" 2>/dev/null || echo ok)" in
                    ok) echo '{"ok":true,"output":"installed","removed":false}' ;;
                    fail) echo '{"ok":false,"error":"apk: broken","output":"apk: broken","removed":true}'; exit 1 ;;
                    room) echo '{"ok":false,"error":"на флеше мало места"}'; exit 1 ;;
                esac ;;
        esac ;;
    engine)
        case "${2:-}" in
            modules) if [ "${3:-}" = --want ] && [ "$4" = wireguard ]; then echo '{"ok":false,"error":"неизвестный модуль: wireguard"}'; exit 1; fi
                     echo '{"ok":true,"modules":["proxy","obfs"]}' ;;
            settle) echo '{"ok":true,"restarted":true,"ensure_error":"'"$(cat "$fx/ensure.err" 2>/dev/null)"'"}' | sed 's/,"ensure_error":""//' ;;
            *) if [ -e "$fx/busy" ]; then echo '{"ok":true,"known":true,"busy":"podkop"}'; else echo '{"ok":true,"known":true}'; fi ;;
        esac ;;
    settings) exec sh "$REAL_HOST" "$@" ;;
    *) exit 2 ;;
esac
EOF
chmod +x "$T/bin"/*
cat > "$T/fix/pkginfo.json" <<'EOF'
{"ok":true,"manager":"apk","ext":"apk","noarch":"noarch.apk","arch":"aarch64_cortex-a53","steer_min":"2.1.0","versions":{"steer-core":"2.1.0","splify2":"26.10.3","luci-app-splify2":""}}
EOF
cat > "$T/fix/versions.steer.json" <<'EOF'
{"ok":true,"arch":"aarch64_cortex-a53","versions":["2.1.2","2.1.1","2.1.0"],"names":{"2.1.2":"2.1.2","2.1.1":"2.1.1","2.1.0":"2.1.0"},"prerelease":"2.1.2"}
EOF
cat > "$T/fix/versions.splify2.json" <<'EOF'
{"ok":true,"current":"26.10.3","versions":["26.10.5","26.10.4","26.10.3"],"names":{"26.10.5":"x","26.10.4":"y","26.10.3":"z"}}
EOF

. "$ROOT/tests/stub/plugins-env.sh"
plugins_provision "$T/plugins" updater
PD="$T/plugins/lib/updater"; CONF="$T/plugins/conf/updater"; RUN="$T/plugins/state/updater"
mkdir -p "$CONF"
REAL_HOST="$ROOT/files/usr/sbin/splify2-host"
cat > "$T/bin/runplugin" <<'EOT'
#!/bin/sh
. "$PLUGIN_SH"
plugin_export_env "$1"; shift
SPLIFY2_HOST="$FAKE_HOST"; export SPLIFY2_HOST
exec sh "$@"
EOT
chmod +x "$T/bin/runplugin"
pl() {
    env SANDBOX="$T" PATH="$T/bin:$PATH" JSHN_SH="$ROOT/tests/stub/jshn.sh" FAKE_HOST="$T/bin/fakehost" REAL_HOST="$REAL_HOST" \
        RPCD_LIB="$ROOT/files/usr/lib/splify2/rpcd" STEER="$T/bin/steer" STEER_SOCK="$T/none.sock" \
        SPEC="$T/etc/spec.json" LISTS="$T/lists" SUB="$T/etc/sub.txt" SUBS_DIR="$T/etc/subs" \
        UCI_SPLIFY2="$T/etc/config-splify2" UCI_STUB_DB="$T/uci.db" SPLIFY2_LOCK_DIR="$T/lock" \
        "$T/bin/runplugin" updater "$@" 2>"$T/stderr"
}
method() { printf '%s\n' "${2:-{\}}" | pl "$PD/bin/updater" "$1"; }
hook() { printf '{"api":1,"hook":"%s","plugin":"updater","ctx":%s}\n' "$1" "$2" | pl "$PD/hooks/$3"; }
settings() { printf '%s\n' "$1" > "$CONF/settings.json"; }
reset() { : > "$T/host.log"; : > "$T/log.txt"; rm -f "$T"/fix/fetch.fail* "$T/fix/via" "$T/fix/busy" "$T/fix/ensure.err" "$T/fix/install.mode"; }
hlog() { tr '\n' '|' < "$T/host.log" | sed 's/|$//'; }

echo "== версии =="
reset
out="$(method steer_versions)"
check "steer_versions: ответ службы дословно" "aarch64_cortex-a53;2.1.2;2.1.2" "$(printf '%s' "$out" | jget arch);$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["versions"][0])');$(printf '%s' "$out" | jget prerelease)"
out="$(method splify2_versions)"
check "splify2_versions: установленная и перечень" "26.10.3;26.10.5" "$(printf '%s' "$out" | jget current);$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["versions"][0])')"

echo "== установка splify2 =="
reset
check "версия не цифрами — отказ до сети" "false;0" "$(method splify2_install '{"version":"1.0; reboot"}' | jget ok);$(grep -c 'release fetch' "$T/host.log")"
out="$(method splify2_install '{"version":"26.10.4"}')"
check "установлено, страницу перезагрузить" "true;splify2-26.10.4-1_noarch.apk;true" "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget installed);$(printf '%s' "$out" | jget reload_needed)"
check "скачано службой в рабочий каталог плагина, не в /tmp" "yes" "$(grep -q "release fetch splify2 26.10.4 splify2-26.10.4-1_noarch.apk $RUN/" "$T/host.log" && echo yes || echo no)"
check "установка: прежнее имя пакета заменяется, rpcd перезапускается" "yes" "$(grep -q 'pkg install .* --replace luci-app-splify2 --restart-rpcd' "$T/host.log" && echo yes || echo no)"
check "скачанный файл после установки убран" "0" "$(ls "$RUN" | grep -c '\.apk$')"
reset; : > "$T/fix/via"
check "путь, которым приехал пакет, не теряется" "зеркало gitlab" "$(method splify2_install '{"version":"26.10.4"}' | jget via)"
reset; : > "$T/fix/fetch.fail.splify2-26.10.4-1_noarch.apk"
out="$(method splify2_install '{"version":"26.10.4"}')"
check "выпуск до переименования лежит под прежним именем: спрашивается и оно" "true;luci-app-splify2-26.10.4-1_noarch.apk" "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget installed)"
reset; : > "$T/fix/fetch.fail"
out="$(method splify2_install '{"version":"26.10.4"}')"
check "не скачалось ни под одним именем — отказ с причиной" "false;yes;yes" "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget error | grep -q 'не скачалось: splify2-26.10.4-1_noarch.apk' && echo yes || echo no);$(printf '%s' "$out" | jget error | grep -q 'зеркало молчит' && echo yes || echo no)"
check "и установка не запускалась" "0" "$(grep -c 'pkg install' "$T/host.log")"
reset; echo fail > "$T/fix/install.mode"
out="$(method splify2_install '{"version":"26.10.4"}')"
check "отказ менеджера пакетов: его слова и признак removed" "false;apk: broken;true" "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget error);$(printf '%s' "$out" | jget removed)"

echo "== установка ядра =="
reset
check "версия не цифрами — отказ" "false" "$(method steer_install '{"version":"2.1; x"}' | jget ok)"
: > "$T/fix/busy"
out="$(method steer_install '{"version":"2.1.2"}')"
check "ядро ведёт коннектор — отказ, названо кем" "false;ядро занято: podkop" "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget error)"
check "и ничего не скачивалось" "0" "$(grep -c 'release fetch' "$T/host.log")"
reset
out="$(method steer_install '{"version":"2.0.9"}')"
check "версия младше минимума интерфейса — отказ с числом" "false;интерфейс работает с ядром не старше 2.1.0" "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget error)"
out="$(method steer_install '{"version":"2.1.2","modules":"wireguard"}')"
check "неизвестный модуль — отказ до скачивания" "false;0" "$(printf '%s' "$out" | jget ok);$(grep -c 'release fetch' "$T/host.log")"
reset
out="$(method steer_install '{"version":"2.1.2","modules":"proxy"}')"
check "ядро поставлено: ok, имя, модули, служба перезапущена" "true;steer-core 2.1.2;proxy obfs;true" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget installed);$(printf '%s' "$out" | python3 -c 'import json,sys; print(" ".join(json.load(sys.stdin)["modules"]))');$(printf '%s' "$out" | jget restarted)"
check "порядок: модули, скачивание, установка, довод" "yes" \
      "$(awk '/engine$|^engine modules/ {a=NR} /release fetch/ {b=NR} /pkg install/ {c=NR} /engine settle/ {d=NR} END {print (a<b && b<c && c<d) ? "yes" : "no"}' "$T/host.log")"
check "файл ядра назван по архитектуре и менеджеру" "yes" "$(grep -q 'release fetch steer 2.1.2 steer-core-2.1.2-1_aarch64_cortex-a53.apk' "$T/host.log" && echo yes || echo no)"
check "довод получил модули, которые нужны" "yes" "$(grep -q 'engine settle proxy obfs' "$T/host.log" && echo yes || echo no)"
reset; echo "plugin ensure failed" > "$T/fix/ensure.err"
check "отказ менеджера ядра установку не отменяет, о нём — ensure_error" "true;plugin ensure failed" "$(method steer_install '{"version":"2.1.2"}' | jget ok);$(method steer_install '{"version":"2.1.2"}' | jget ensure_error)"
reset; echo room > "$T/fix/install.mode"
out="$(method steer_install '{"version":"2.1.2"}')"
check "мало места — отказ его словами, довода нет" "false;на флеше мало места;0" "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget error);$(grep -c 'engine settle' "$T/host.log")"
reset; : > "$T/fix/fetch.fail"
check "не скачалось — отказ с именем файла и архитектурой" "yes" "$(method steer_install '{"version":"2.1.2"}' | jget error | grep -q 'steer-core-2.1.2-1_aarch64_cortex-a53.apk (нет такой версии для aarch64_cortex-a53?)' && echo yes || echo no)"
reset; sed -i 's/"arch":"aarch64_cortex-a53"/"arch":""/' "$T/fix/pkginfo.json"
check "архитектура не определилась — отказ до сети" "не определилась архитектура;0" "$(method steer_install '{"version":"2.1.2"}' | jget error);$(grep -c 'release fetch' "$T/host.log")"
sed -i 's/"arch":""/"arch":"aarch64_cortex-a53"/' "$T/fix/pkginfo.json"

echo "== проверка «вышло ли новее» =="
rm -f "$RUN/status.json"
check "до первой проверки — checked_at 0" "0" "$(method update_status | jget checked_at)"
reset
out="$(method update_check)"
check "update_check: что стоит и что вышло (стабильный канал: предварительная не считается)" "2.1.0;2.1.1;2.1.2;26.10.3;26.10.5" \
      "$(printf '%s' "$out" | jget steer.current);$(printf '%s' "$out" | jget steer.latest);$(printf '%s' "$out" | jget steer.prerelease);$(printf '%s' "$out" | jget splify2.current);$(printf '%s' "$out" | jget splify2.latest)"
out="$(method update_status)"
check "update_status: новее есть у обоих" "true;true" "$(printf '%s' "$out" | jget steer.available);$(printf '%s' "$out" | jget splify2.available)"
sed -i 's/"steer-core":"2.1.0"/"steer-core":"2.1.1"/; s/"splify2":"26.10.3"/"splify2":"26.10.5"/' "$T/fix/pkginfo.json"
out="$(method update_status)"
check "после установки «новее» гаснет без новой проверки" "false;false" "$(printf '%s' "$out" | jget steer.available);$(printf '%s' "$out" | jget splify2.available)"
sed -i 's/"steer-core":"2.1.1"/"steer-core":"2.1.0"/; s/"splify2":"26.10.5"/"splify2":"26.10.3"/' "$T/fix/pkginfo.json"
settings '{"channel":"prerelease"}'
out="$(method update_check)"
check "канал prerelease: предварительная новее стабильной считается новой" "2.1.2;prerelease" "$(printf '%s' "$out" | jget steer.latest);$(printf '%s' "$out" | jget channel)"
rm -f "$CONF/settings.json"
cat > "$T/fix/versions.steer.json" <<'EOF'
{"ok":false,"error":"x"}
EOF
out="$(method update_check)"
check "перечень не пришёл — причина названа, а не пустота" "yes" "$(printf '%s' "$out" | jget steer.why | grep -q 'не получен' && echo yes || echo no)"

echo "== задача check-updates =="
cat > "$T/fix/versions.steer.json" <<'EOF'
{"ok":true,"arch":"x","versions":["2.1.2","2.1.1"],"names":{}}
EOF
reset; rm -f "$RUN/status.json"
pl "$PD/bin/check-updates" </dev/null
check "по умолчанию выключена — в сеть не ходит" "0" "$(grep -c 'release versions' "$T/host.log")"
settings '{"check":true}'
pl "$PD/bin/check-updates" </dev/null
check "включена — спросила выпуски и запомнила итог" "yes;yes" "$([ "$(grep -c 'release versions' "$T/host.log")" -ge 2 ] && echo yes || echo no);$([ -s "$RUN/status.json" ] && echo yes || echo no)"
check "о новой версии сказано в журнале" "yes" "$(grep -q 'steer: вышла 2.1.2, стоит 2.1.0' "$T/log.txt" && echo yes || echo no)"
rm -f "$CONF/settings.json"

echo "== архив настроек, отчёт, чистка =="
settings '{"channel":"prerelease"}'
check "export: настройки плагина" "yes" "$(hook backup_sections '{"op":"export"}' backup | jget sections.settings | grep -q prerelease && echo yes || echo no)"
check "restore: настройка записана службой хоста" "stable" \
      "$(hook backup_sections '{"op":"restore","sections":{"settings":"{\"channel\":\"stable\"}"}}' backup >/dev/null; python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["channel"])' "$CONF/settings.json")"
check "check: чужой раздел отвергнут" "false" "$(hook backup_sections '{"op":"check","sections":{"zzz":"x"}}' backup | jget ok)"
out="$(hook support_report '{}' support)"
check "support_report: что стоит" "updater;yes" "$(printf '%s' "$out" | jget section.title);$(printf '%s' "$out" | jget section.text | grep -q 'steer-core: 2.1.0' && echo yes || echo no)"
hook purge '{"dry_run":false,"keep_config":true}' purge >/dev/null
check "purge: итог проверки убран, настройки остались" "no;yes" "$([ -e "$RUN/status.json" ] && echo yes || echo no);$([ -e "$CONF/settings.json" ] && echo yes || echo no)"
check "неизвестный метод — код 2" "2" "$(printf '{}\n' | pl "$PD/bin/updater" nothing >/dev/null; echo $?)"

echo
if [ "$fails" -gt 0 ]; then echo "ЕСТЬ ПРОВАЛЫ: $fails"; exit 1; fi
echo "плагин updater работает"
