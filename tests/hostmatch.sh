#!/bin/sh
# Стенд служб хоста для программ плагинов (files/usr/sbin/splify2-host, plugin-sdk/docs/splify2-api.md, раздел 8).
#
# Службы — единственный путь плагина к тому, что принадлежит каркасу, поэтому каждая проверяется как контракт: аргументы,
# ответ, код возврата. Настоящая служба запускается целиком, как на роутере; внешнее (steer, uci, curl, init) — заглушки в
# PATH, пути каркаса — швы в песочнице (их знает только хост, плагин их не видит).
#
# Запуск: sh tests/hostmatch.sh (нужен python3 — только заглушки jsonfilter и jshn).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="$ROOT/files/usr/sbin/splify2-host"
T="$(mktemp -d /tmp/hostmatch.XXXXXX)"
trap 'rm -rf "$T"' EXIT INT TERM

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
jget() {  # КЛЮЧ — поле объекта JSON со стандартного ввода (булево как true/false)
    python3 -c 'import json,sys
d = json.load(sys.stdin); v = d.get(sys.argv[1], "")
print(("true" if v else "false") if isinstance(v, bool) else v)' "$1"
}

mkdir -p "$T/bin" "$T/lists" "$T/etc/subs" "$T/etc/xs" "$T/plug" "$T/lock" "$T/rc.d"
cp "$ROOT/tests/stub/jsonfilter" "$T/bin/jsonfilter"
cp "$ROOT/tests/stub/uci" "$T/bin/uci"

# steer: перевод спеки (как есть), проверка (код из STEER_RC), применение.
cat > "$T/bin/steer" <<'EOF'
#!/bin/sh
if [ "${1:-}" = spec ] && [ "${2:-}" = convert ]; then
    shift 2; _f=""
    while [ $# -gt 0 ]; do case "$1" in --spec) _f="$2"; shift ;; esac; shift; done
    if [ "$_f" = - ]; then cat; else cat "$_f"; fi
    exit 0
fi
echo "$*" >> "$SANDBOX/steer.log"
case "${1:-}" in
    status) printf '{"outputs":{"vless":{"device":"tun0","up":true}}}\n' ;;
    sub-quota)
        # Ответ панели: остаток пишется в файл --info; SUB_QUOTA=none — панель промолчала.
        [ "${SUB_QUOTA:-ok}" = none ] && exit 1
        shift; _i=""
        while [ $# -gt 0 ]; do case "$1" in --info) _i="$2"; shift ;; esac; shift; done
        printf 'upload=1\ndownload=2\ntotal=10\nexpire=1900000000\nat=1700000000\n' > "$_i"
        exit 0 ;;
    apply) [ -n "${STEER_ERR:-}" ] && echo "$STEER_ERR" >&2; exit "${STEER_RC:-0}" ;;
esac
exit 0
EOF
# curl: что скачать, решает URL; запрос протоколируется.
cat > "$T/bin/curl" <<'EOF'
#!/bin/sh
out=""; url=""
while [ $# -gt 0 ]; do case "$1" in -o) out="$2"; shift 2 ;; http*) url="$1"; shift ;; *) shift ;; esac; done
echo "$url" >> "$SANDBOX/requested"
case "$url" in
    *1.1.1.1*|*trace*) printf 'ip=203.0.113.7\nloc=DE\n\nsplify_ms=0.250\n'; exit 0 ;;
    *down*) exit 22 ;;
    *) printf 'body of %s\n' "$url" > "$out" ;;
esac
EOF
chmod +x "$T/bin"/*

. "$ROOT/tests/stub/plugins-env.sh"
plugins_provision "$T/plug" -

host() {  # СЛУЖБА [АРГУМЕНТЫ…] — службы хоста так, как зовёт плагин: песочница видна только хосту
    env SANDBOX="$T" PATH="$T/bin:$PATH" JSHN_SH="$ROOT/tests/stub/jshn.sh" \
        SPLIFY2_LOCK_DIR="$T/lock" FETCH_SH="$ROOT/files/usr/lib/splify2/fetch.sh" \
        RPCD_LIB="$ROOT/files/usr/lib/splify2/rpcd" STEER="$T/bin/steer" STEER_SOCK="$T/none.sock" \
        SPEC="$T/etc/spec.json" SPEC_VIEW="$T/spec.view.json" LISTS="$T/lists" SUB="$T/etc/sub.txt" \
        SUBS_DIR="$T/etc/subs" APPLIED="$T/etc/spec.applied.json" UCI_SPLIFY2="$T/etc/config-splify2" \
        UCI_STUB_DB="$T/uci.db" XSTEER_DIR="$T/etc/xs" RC_D="${RC_D_FIXTURE:-$T/rc.d}" STEER_INIT="$T/bin/initd-steer" \
        RPCD_BIN="${RPCD_BIN_FIXTURE:-$T/bin/rpcd-apply}" \
        STEER_RC="${STEER_RC:-0}" STEER_ERR="${STEER_ERR:-}" GEO_CURL="${GEO_CURL_FIXTURE:-$T/bin/curl}" \
        OPENWRT_RELEASE="$T/openwrt_release" PM_FIXTURE="${PM_FIXTURE_HOST:-apk}" PKG_DB="$T/pkgdb" \
        "$@" 2>"$T/stderr" <"${HOST_IN:-/dev/null}"
}
hostrun() { host sh "$HOST" "$@"; }

# ---- paths: ответ до подключения библиотек каркаса ---------------------------------
out="$(hostrun paths)"
check "paths: каталог списков и программа ядра" "true;$T/lists;$T/bin/steer" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget lists);$(printf '%s' "$out" | jget steer)"

# ---- настройки плагина: схема, умолчание, запись -------------------------------------
PD="$T/pl/lib/demo"; PC="$T/pl/conf/demo"
mkdir -p "$PD" "$PC"
cat > "$PD/plugin.json" <<'EOF'
{"schema":1,"id":"demo","version":"1.0.0","name":"Demo","compat":{"splify2-api":"^1.0"},"arch":"all",
 "splify2":{"settings":{"schema":"settings.schema.json"}}}
EOF
cat > "$PD/settings.schema.json" <<'EOF'
{"type":"object","additionalProperties":false,"properties":{
  "url":{"type":"string","default":"https://example.org/a.json","pattern":"^https?://[^ ]+$"},
  "factor":{"type":"integer","minimum":0,"maximum":10,"default":4},
  "mode":{"type":"string","enum":["off","always"]},
  "on":{"type":"boolean","default":true},
  "tag":{"type":"string"}}}
EOF
settings() { STEER_PLUGIN_ID=demo STEER_PLUGIN_DIR="$PD" STEER_PLUGIN_CONF="$PC" hostrun settings "$@"; }
check "settings get: умолчание схемы, пока человек ничего не задал" "https://example.org/a.json;0" \
      "$(settings get url);$(settings get url >/dev/null; echo $?)"
check "settings get: настройки нет ни у человека, ни в схеме — пусто и код 1" ";1" \
      "$(settings get tag);$(settings get tag >/dev/null; echo $?)"
out="$(settings get nothing)"
check "settings get: ключа нет в схеме — отказ" "false" "$(printf '%s' "$out" | jget ok)"
settings set factor 7 >/dev/null
check "settings set: число записано числом, get читает" "7" "$(settings get factor)"
check "в файле настроек число — число, а не строка" "7" \
      "$(python3 -c 'import json,sys; print(repr(json.load(open(sys.argv[1]))["factor"]))' "$PC/settings.json")"
out="$(settings set factor 11)"; rc=$?
check "settings set: число выше предела — отказ с кодом 1" "false;1" \
      "$(printf '%s' "$out" | jget ok);$(settings set factor 11 >/dev/null; echo $?)"
check "settings set: предел назван в причине" "yes" "$(printf '%s' "$out" | jget error | grep -q '10' && echo yes || echo no)"
check "settings set: не число — отказ" "false" "$(settings set factor many | jget ok)"
check "settings set: значение не из списка — отказ" "false" "$(settings set mode sometimes | jget ok)"
check "settings set: значение из списка принято" "true;always" "$(settings set mode always | jget ok);$(settings get mode)"
check "settings set: не подходит под шаблон — отказ" "false" "$(settings set url 'ftp://x' | jget ok)"
check "settings set: флаг" "true;false" "$(settings set on false | jget ok);$(settings get on)"
check "settings set: флаг не true/false — отказ" "false" "$(settings set on maybe | jget ok)"
# Прежние значения сохраняются, объекты и массивы тоже (форма каркаса пишет их целиком, служба их не теряет).
printf '{"factor":3,"mode":"off","nested":{"a":[1,2],"b":"x"},"list":["p","q"]}\n' > "$PC/settings.json"
settings set tag v1 >/dev/null
check "settings set: остальные значения файла целы, включая объект и массив" "yes" \
      "$(python3 - "$PC/settings.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
print("yes" if d == {"factor": 3, "mode": "off", "nested": {"a": [1, 2], "b": "x"}, "list": ["p", "q"], "tag": "v1"} else "no: %r" % d)
PY
)"
settings set tag '' >/dev/null
check "settings set: пустое значение убирает ключ — возвращает умолчание" ";1" \
      "$(settings get tag);$(settings get tag >/dev/null; echo $?)"
check "settings set: остальное по-прежнему на месте" "3" "$(settings get factor)"
check "settings set: временных файлов рядом не осталось" "settings.json" "$(ls "$PC")"
out="$(STEER_PLUGIN_ID=demo hostrun settings get url)"
check "settings без каталога плагина — отказ, а не угадывание" "false" "$(printf '%s' "$out" | jget ok)"

# ---- скачивание -------------------------------------------------------------------------
: > "$T/requested"
out="$(hostrun fetch https://example.org/a.lst "$T/dl/a.lst")"; rc=$?
check "fetch: файл на месте, ответ ok, код 0" "true;0;body of https://example.org/a.lst" \
      "$(printf '%s' "$out" | jget ok);$rc;$(cat "$T/dl/a.lst" 2>/dev/null)"
out="$(hostrun fetch https://example.org/down.lst "$T/dl/b.lst")"; rc=$?
check "fetch: не скачалось — ok:false, причина и код 1, файла нет" "false;1;no" \
      "$(printf '%s' "$out" | jget ok);$rc;$([ -e "$T/dl/b.lst" ] && echo yes || echo no)"
out="$(hostrun fetch file:///etc/passwd "$T/dl/c.lst")"; rc=$?
check "fetch: не http(s) — отказ до сети" "false;1" "$(printf '%s' "$out" | jget ok);$rc"
check "fetch: срок — число секунд" "false" "$(hostrun fetch https://example.org/a.lst "$T/dl/d.lst" --timeout много | jget ok)"
hostrun fetch https://example.org/ok.lst "$T/dl/e.lst" --timeout 5 >/dev/null
check "fetch: срок принят" "body of https://example.org/ok.lst" "$(cat "$T/dl/e.lst" 2>/dev/null)"

# ---- режим «через туннель» --------------------------------------------------------------
check "fetch-mode: по умолчанию выключен" "off" "$(hostrun fetch-mode get | jget mode)"
check "fetch-mode set: always записан в uci" "always;always" \
      "$(hostrun fetch-mode set always | jget mode);$(sed -n 's/^splify2.main.fetch_via_tunnel=//p' "$T/uci.db")"
check "fetch-mode get: читает записанное" "always" "$(hostrun fetch-mode get | jget mode)"
check "fetch-mode set: не always и не off — отказ" "false" "$(hostrun fetch-mode set maybe | jget ok)"
hostrun fetch-mode set off >/dev/null

# ---- спека ------------------------------------------------------------------------------
rm -f "$T/etc/spec.json"
check "spec get: спеки нет — отказ и код 1" "false;1" "$(hostrun spec get | jget ok);$(hostrun spec get >/dev/null; echo $?)"
printf '{"version":2,"lists":{"a":{"domains_file":["%s/domains/a.lst"]}},"outputs":{"direct":{"kind":"direct"}}}\n' "$T/lists" > "$T/etc/spec.json"
check "spec get: JSON-вид спеки в stdout" "2" "$(hostrun spec get | jget version)"
hostrun spec get "$T/copy.json" >/dev/null
check "spec get ФАЙЛ: копия в файле" "2" "$(jget version < "$T/copy.json")"
rm -f "$T/etc/spec.applied.json"
check "spec get --applied: снимка нет — применённой считается сама спека" "2" "$(hostrun spec get --applied | jget version)"
printf '{"version":1}\n' > "$T/etc/spec.applied.json"
check "spec get --applied: снимок применённого в stdout" "1" "$(hostrun spec get --applied | jget version)"
hostrun spec get --applied "$T/app.json" >/dev/null
check "spec get --applied ФАЙЛ: копия снимка в файле, обычная спека — своя" "1;2" "$(jget version < "$T/app.json");$(hostrun spec get | jget version)"
rm -f "$T/etc/spec.applied.json"
check "spec uses: спека ссылается на путь — код 0, на другой — 1" "0;1" \
      "$(hostrun spec uses "$T/lists/domains/a.lst" >/dev/null; echo $?);$(hostrun spec uses "$T/lists/b.lst" >/dev/null; echo $?)"
printf '{"version":2}\n' > "$T/cand.json"
check "spec check: ядро приняло" "true" "$(hostrun spec check "$T/cand.json" | jget ok)"
out="$(STEER_RC=1 STEER_ERR='cannot read a list' hostrun spec check "$T/cand.json")"
check "spec check: ядро отвергло — слова ядра в ответе" "false;yes" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget error | grep -q 'cannot read a list' && echo yes || echo no)"

# ---- применение: три исхода ---------------------------------------------------------------
cat > "$T/bin/rpcd-apply" <<'EOF'
#!/bin/sh
case "${APPLY_OUT:-ok}" in
    ok)     echo '{"ok":true,"output":"applied"}' ;;
    reject) echo '{"ok":false,"output":"cannot read a list"}' ;;
    veto)   echo '{"ok":false,"veto":true,"error":"plugin said no","output":"stopped"}' ;;
    busy)   echo '{"ok":false,"error":"ядро занято: podkop"}' ;;
esac
EOF
for want in "ok 0" "reject 1" "veto 3" "busy 3"; do
    set -- $want
    out="$(APPLY_OUT=$1 hostrun apply)"; rc=$?
    check "apply: исход $1 — код $2, ответ метода дословно" "$2;yes" \
          "$rc;$([ -n "$out" ] && printf '%s' "$out" | grep -q '"ok"' && echo yes || echo no)"
done
# APPLY_OUT доходит до заглушки через окружение хоста: host() его не фильтрует.

# ---- ядро: включено ли, работает ли ----------------------------------------------------------
printf '#!/bin/sh\n[ "$1" = running ] && exit "${INITD_RUNNING:-1}"\nexit 0\n' > "$T/bin/initd-steer"; chmod +x "$T/bin/initd-steer"
out="$(hostrun engine)"
check "engine: автозапуска нет, процесса нет" "true;true;false;false" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget known);$(printf '%s' "$out" | jget enabled);$(printf '%s' "$out" | jget running)"
: > "$T/rc.d/S99steer"
check "engine: автозапуск стоит" "true" "$(hostrun engine | jget enabled)"
rm -f "$T/rc.d/S99steer"
check "engine: процесс работает" "true" "$(INITD_RUNNING=0 hostrun engine | jget running)"
out="$(RC_D_FIXTURE=/nonexistent hostrun engine)"
check "engine: нет каталога автозапуска — known:false, и так сказано" "false" "$(printf '%s' "$out" | jget known)"

# ---- настройки каркаса: выгрузка, проверка, восстановление -------------------------------------
reset_state() {
    rm -rf "$T/etc" "$T/lists" "$T/uci.db"; mkdir -p "$T/etc/subs" "$T/etc/xs" "$T/lists"
    : > "$T/uci.db"
}
seed_state() {
    printf '{"version":2,"lan":{"devices":["br-lan"]},"outputs":{"direct":{"kind":"direct"},"vpn":{"kind":"tunnel","protocol":"vless","subscription":"%s/etc/sub.txt"}},"rules":[]}\n' "$T" > "$T/etc/spec.json"
    printf 'vless://k@h:443#node\n' > "$T/etc/sub.txt"
    printf 'vless://k2@h2:443#second\n' > "$T/etc/subs/work.txt"
    printf '[Interface]\nPrivateKey = 6Gtidge6FqhO/0LhrAWpRiyYaKdLZF/gib/HePLC9GU=\nAddress = 10.77.0.5/24\n\n[Peer]\nPublicKey = QYkH5bWOsEOCgIMldHPATSG7yvNyJ8st7o/HMelWKxs=\n' > "$T/etc/xs/home.conf"
    printf 'eu wg1\nпроизвольная; строка\n' > "$T/etc/select"
    uci_put() { printf '%s=%s\n' "$1" "$2" >> "$T/uci.db"; }
    uci_put splify2.main.sub_url 'https://panel.example.net/sub/1'
    uci_put splify2.main.sub_kind url
    uci_put splify2.main.fetch_via_tunnel always
    uci_put splify2.main.geo_url 'https://example.net/trace'
    uci_put splify2.main.manifest_url 'https://example.net/own.json'
    uci_put splify2.sub_work subscription
    uci_put splify2.sub_work.url 'https://panel.example.net/sub/2'
}
reset_state; seed_state
out="$(hostrun state export "$T/ex")"; rc=$?
check "state export: ответ ok, код 0" "true;0" "$(printf '%s' "$out" | jget ok);$rc"
check "state export: спека, подписка, именованная подписка, ключ туннеля" "yes" \
      "$([ -s "$T/ex/spec" ] && [ -s "$T/ex/sub" ] && [ -s "$T/ex/sub.work" ] && [ -s "$T/ex/xsteer.home" ] && echo yes || echo no)"
check "state export: выбор у групп — только строки вида «группа член»" "eu wg1" "$(cat "$T/ex/select")"
check "state export: поля uci каркаса и именованной подписки; чужие (manifest_url) — нет" "yes;no" \
      "$(grep -qx 'sub_url=https://panel.example.net/sub/1' "$T/ex/options" && grep -qx 'sub_work.url=https://panel.example.net/sub/2' "$T/ex/options" && grep -qx 'fetch_via_tunnel=always' "$T/ex/options" && echo yes || echo no);$(grep -q 'manifest_url' "$T/ex/options" && echo yes || echo no)"
check "state export: файлы выгрузки закрыты (0600)" "600;600" "$(stat -c %a "$T/ex/xsteer.home");$(stat -c %a "$T/ex/sub")"
check "state check: собственная выгрузка проверку проходит" "true" "$(hostrun state check "$T/ex" | jget ok)"

# Отказы проверки: ничего не пишется, причина названа.
bad_dir() {  # ИМЯ ФАЙЛ СОДЕРЖИМОЕ
    rm -rf "$T/bad"; cp -R "$T/ex" "$T/bad"; printf '%s\n' "$3" > "$T/bad/$2"
}
bad_dir b1 spec '{"version":2,"outputs":{},"lists":{"a":{"domains_file":["/etc/shadow"]}}}'
check "state check: список вне каталога списков отвергается" "false;yes" \
      "$(hostrun state check "$T/bad" | jget ok);$(hostrun state check "$T/bad" | jget error | grep -q 'вне каталога' && echo yes || echo no)"
bad_dir b2 spec '{"version":2,"lan_device":"br-lan; reboot","outputs":{}}'
check "state check: lan_device с метасимволами отвергается" "yes" "$(hostrun state check "$T/bad" | jget error | grep -q 'lan_device' && echo yes || echo no)"
bad_dir b3 spec '{"version":2,"outputs":{"vpn; reboot":{"kind":"direct"}}}'
check "state check: имя выхода с метасимволами отвергается" "false" "$(hostrun state check "$T/bad" | jget ok)"
bad_dir b4 sub 'http://example.org/list'
check "state check: подписка не из ссылок узлов отвергается" "false" "$(hostrun state check "$T/bad" | jget ok)"
bad_dir b5 options 'sub_url=https://x/$(reboot)'
check "state check: ссылка с подстановкой отвергается" "false" "$(hostrun state check "$T/bad" | jget ok)"
bad_dir b6 options 'root_password=x'
check "state check: неизвестное поле настроек отвергается" "yes" "$(hostrun state check "$T/bad" | jget error | grep -q 'непонятная настройка' && echo yes || echo no)"
bad_dir b7 options 'manifest_url=https://example.net/own.json'
check "state check: manifest_url — настройка плагина каталога, каркасу не принадлежит" "false" "$(hostrun state check "$T/bad" | jget ok)"
bad_dir b8 xsteer.home 'Address = 10.77.0.5/24'
check "state check: туннель без приватного ключа отвергается" "false" "$(hostrun state check "$T/bad" | jget ok)"
bad_dir b9 select 'eu wg1; reboot'
check "state check: чужая строка выбора отвергает" "false" "$(hostrun state check "$T/bad" | jget ok)"
rm -rf "$T/empty"; mkdir "$T/empty"
check "state check: пустой каталог — нечего восстанавливать" "false" "$(hostrun state check "$T/empty" | jget ok)"

# Восстановление на чистый «роутер»: файлы на месте, uci записан, применения нет.
cp -R "$T/ex" "$T/ex.keep"
reset_state
: > "$T/steer.log"
out="$(hostrun state import "$T/ex.keep")"; rc=$?
check "state import: ответ ok, код 0, что восстановлено числами" "true;0;true;true;1;1;true" \
      "$(printf '%s' "$out" | jget ok);$rc;$(printf '%s' "$out" | jget spec);$(printf '%s' "$out" | jget sub);$(printf '%s' "$out" | jget subs);$(printf '%s' "$out" | jget xsteer);$(printf '%s' "$out" | jget select)"
check "state import: спека, подписки и ключ легли на место" "yes" \
      "$(grep -q br-lan "$T/etc/spec.json" 2>/dev/null; [ -s "$T/etc/sub.txt" ] && grep -q second "$T/etc/subs/work.txt" && grep -q PrivateKey "$T/etc/xs/home.conf" && echo yes || echo no)"
check "state import: ключ туннеля закрыт (0600)" "600" "$(stat -c %a "$T/etc/xs/home.conf")"
check "state import: поля uci и секция именованной подписки" "https://panel.example.net/sub/1;https://panel.example.net/sub/2;subscription" \
      "$(sed -n 's/^splify2.main.sub_url=//p' "$T/uci.db");$(sed -n 's/^splify2.sub_work.url=//p' "$T/uci.db");$(sed -n 's/^splify2.sub_work=//p' "$T/uci.db")"
check "state import: спека проверена ядром, но не применена" "1;0" \
      "$(grep -c 'apply --dry-run' "$T/steer.log");$(grep -c 'apply --spec' "$T/steer.log")"
check "state import: снимок применённого снят с ПРЕЖНЕЙ спеки (пусто → заглушка v2)" "yes" \
      "$([ -s "$T/etc/spec.applied.json" ] && ! grep -q br-lan "$T/etc/spec.applied.json" && echo yes || echo no)"
check "state import: выбор у групп лёг рядом со спекой" "eu wg1" "$(cat "$T/etc/select" 2>/dev/null)"
out="$(STEER_RC=1 STEER_ERR='cannot read a channel list' hostrun state import "$T/ex.keep")"; rc=$?
check "state import: ядро отвергло спеку — отказ с кодом 1 и словами ядра" "false;1;yes" \
      "$(printf '%s' "$out" | jget ok);$rc;$(printf '%s' "$out" | jget error | grep -q 'cannot read a channel list' && echo yes || echo no)"
check "state import: в отказе сказано, что подписки и ключи уже восстановлены" "yes" \
      "$(printf '%s' "$out" | jget error | grep -q 'уже восстановлены' && echo yes || echo no)"
out="$(hostrun state import "$T/bad")"; rc=$?
check "state import: негодный каталог — отказ, ничего не записано" "false;1" "$(printf '%s' "$out" | jget ok);$rc"

# ---- хук backup_sections у плагинов (для плагина-владельца) ----------------------------------------
rm -rf "$T/hk"; mkdir -p "$T/hk/lib/alpha/hooks" "$T/hk/conf" "$T/hk/run"
cat > "$T/hk/lib/alpha/plugin.json" <<'EOF'
{"schema":1,"id":"alpha","version":"1.0.0","name":"Alpha","compat":{"splify2-api":"^1.0"},"arch":"all",
 "permissions":["splify2.hooks"],"splify2":{"hooks":{"backup_sections":{"prog":"hooks/b"}}}}
EOF
cat > "$T/hk/lib/alpha/hooks/b" <<'EOF'
#!/bin/sh
in="$(cat)"
case "$in" in
    *'"op":"export"'*) printf '%s\n' '{"ok":true,"sections":{"one":"a\nb"}}' ;;
    *) printf '%s\n' '{"ok":true,"restored":[{"name":"x","kind":"domains","count":1,"dropped":0}]}' ;;
esac
EOF
chmod +x "$T/hk/lib/alpha/hooks/b"
printf '{"schema":1,"plugins":{"alpha":{"version":"1.0.0","state":"enabled","repo":"x"}}}\n' > "$T/hk/state.json"
printf '{"op":"export"}\n' > "$T/ctx.json"
hkhost() {
    PLUGIN_ROOT="$T/hk/lib" PLUGIN_STATE="$T/hk/state.json" PLUGIN_CONF_DIR="$T/hk/conf" EXT_REG="$T/hk/run/ext.reg" \
        PLUGIN_STATE_DIR="$T/hk/state" hostrun "$@"
}
out="$(hkhost hook backup_sections --ctx "$T/ctx.json")"
check "hook backup_sections: ответ плагина дословно, статус ok" "true;alpha;ok" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | python3 -c 'import json,sys; r=json.load(sys.stdin)["results"][0]; print(r["plugin"] + ";" + r["status"])')"
check "hook backup_sections: разделы доехали" "a
b" "$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["results"][0]["response"]["sections"]["one"])')"
out="$(hkhost hook backup_sections --ctx "$T/ctx.json" --plugin nothere)"
check "hook backup_sections: плагина нет — его нет и в списке" "0" "$(printf '%s' "$out" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["results"]))')"
check "hook: чужие хуки хост плагинам не раздаёт" "false" "$(hkhost hook pre_apply --ctx "$T/ctx.json" | jget ok)"
printf '#!/bin/sh\ncat >/dev/null\nexit 3\n' > "$T/hk/lib/alpha/hooks/b"
out="$(hkhost hook backup_sections --ctx "$T/ctx.json")"
check "hook backup_sections: упавший хук — статус failed, а не падение службы" "failed" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["results"][0]["status"])')"
printf '#!/bin/sh\ncat >/dev/null\necho "не JSON"\n' > "$T/hk/lib/alpha/hooks/b"
out="$(hkhost hook backup_sections --ctx "$T/ctx.json")"
check "hook backup_sections: ответ не по форме — статус bad_answer" "bad_answer" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["results"][0]["status"])')"

# sub list|info|refresh: ответы методов каркаса дословно.
cat > "$T/bin/rpcd-sub" <<'EOF'
#!/bin/sh
read -r req
case "$2" in
    sub_list) echo '{"subs":[{"name":"main","kind":"url","due":false}],"hwid":"h"}' ;;
    sub_info) printf '{"name":"main","kind":"url","req":%s}\n' "$(printf '%s' "$req" | sed 's/"/\\"/g; s/^/"/; s/$/"/')" ;;
    sub_refresh) echo '{"ok":false,"error":"подписка не скачалась"}' ;;
    *) exit 1 ;;
esac
EOF
RPCD_BIN_FIXTURE="$T/bin/rpcd-sub"
out="$(hostrun sub list)"
check "sub list: ответ метода дословно, код 0" "main;0" "$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["subs"][0]["name"])');$(hostrun sub list >/dev/null; echo $?)"
check "sub info: имя уходит запросом метода" "yes" "$(hostrun sub info main | jget req | grep -q '"name":"main"' && echo yes || echo no)"
out="$(hostrun sub refresh main)"; rc=$?
check "sub refresh: отказ метода — в ответе (ok:false), код 0" "false;0" "$(printf '%s' "$out" | jget ok);$rc"
check "sub info: имя не из латиницы — отказ до вызова" "false;1" "$(hostrun sub info 'a/b' | jget ok);$(hostrun sub info 'a/b' >/dev/null; echo $?)"
check "sub info: без имени — использование (код 2)" "2" "$(hostrun sub info >/dev/null; echo $?)"
unset RPCD_BIN_FIXTURE

# ---- call и probe: методы проверки узлов и замер страны выхода ----------------------------------------------------
cat > "$T/bin/rpcd-call" <<'EOF'
#!/bin/sh
read -r req
printf '%s\n' "$req" > "$SANDBOX/call.req"
printf '{"method":"%s"}\n' "$2"
EOF
RPCD_BIN_FIXTURE="$T/bin/rpcd-call"
printf '{"output":"vless"}\n' > "$T/in.json"
out="$(HOST_IN="$T/in.json" hostrun call outbound_probe)"; rc=$?
check "call: ответ метода дословно, запрос дошёл, код 0" "outbound_probe;yes;0" \
      "$(printf '%s' "$out" | jget method);$(grep -q '"output":"vless"' "$T/call.req" && echo yes || echo no);$rc"
check "call: метод вне списка (purge) — отказ, код 1" "false;1" \
      "$(hostrun call purge | jget ok);$(hostrun call purge >/dev/null; echo $?)"
for m in vless_nodes hysteria2_nodes proxy_nodes vless_probe hysteria2_probe proxy_probe; do
    check "call: $m разрешён" "$m" "$(HOST_IN="$T/in.json" hostrun call $m | jget method)"
done
check "call без метода — использование (код 2)" "2" "$(hostrun call >/dev/null; echo $?)"
unset RPCD_BIN_FIXTURE
out="$(hostrun probe ident vless)"
check "probe ident: признак устройства выхода" "true;tun0:0" "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget ident)"
check "probe ident: выхода нет среди поднятых — none" "none" "$(hostrun probe ident nothere | jget ident)"
out="$(hostrun probe geo vless)"
check "probe geo: адрес, страна, отклик в мс, признак устройства" "true;203.0.113.7;DE;250;tun0:0" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget ip);$(printf '%s' "$out" | jget cc);$(printf '%s' "$out" | jget ms);$(printf '%s' "$out" | jget ident)"
out="$(hostrun probe geo nothere)"; rc=$?
check "probe geo: выхода нет — отказ no_device, код 1" "false;no_device;1" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget why);$(hostrun probe geo nothere >/dev/null; echo $?)"
out="$(GEO_CURL_FIXTURE=/nonexistent/curl hostrun probe geo vless)"
check "probe geo: нет curl — why no_curl и curl:false" "no_curl;false" "$(printf '%s' "$out" | jget why);$(printf '%s' "$out" | jget curl)"
check "probe: имя выхода с косой — отказ" "false" "$(hostrun probe geo 'a/b' | jget ok)"
check "probe: неизвестная проба — использование (код 2)" "2" "$(hostrun probe other vless >/dev/null; echo $?)"

# ---- release, pkg, engine modules: выпуски, пакеты, протоколы ядра -------------------------------------------------
printf "DISTRIB_ARCH='aarch64_cortex-a53'\n" > "$T/openwrt_release"
cat > "$T/bin/apk" <<'EOF'
#!/bin/sh
case "$1" in
    list) echo "steer-core-2.1.0-r1 aarch64_cortex-a53 {steer-core} (GPL-2.0) [installed]" ; echo "splify2-26.10.3-r1 noarch {splify2} (MIT) [installed]" ;;
    add) echo "add $*" >> "$SANDBOX/apk.log"; [ -n "${APK_FAIL:-}" ] && { echo "ERROR: unable to select packages" >&2; exit 1; }; echo OK ;;
    *) exit 0 ;;
esac
EOF
chmod +x "$T/bin/apk"
out="$(hostrun pkg info)"
check "pkg info: менеджер, расширение, архитектура, минимум ядра" "true;apk;apk;noarch.apk;aarch64_cortex-a53" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget manager);$(printf '%s' "$out" | jget ext);$(printf '%s' "$out" | jget noarch);$(printf '%s' "$out" | jget arch)"
check "pkg info: установленные версии по именам пакетов" "2.1.0;26.10.3" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["versions"]["steer-core"])');$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["versions"]["splify2"])')"
check "pkg info: минимум версии ядра задан" "yes" "$(printf '%s' "$out" | jget steer_min | grep -qE '^[0-9]+(\.[0-9]+)+$' && echo yes || echo no)"
check "release fetch: продукт не из двух — отказ" "false;1" "$(hostrun release fetch other 1.0 a.apk "$T/dl/x" | jget ok);$(hostrun release fetch other 1.0 a.apk "$T/dl/x" >/dev/null; echo $?)"
check "release fetch: версия не цифрами — отказ до сети" "false" "$(hostrun release fetch steer '1.0;x' a.apk "$T/dl/x" | jget ok)"
check "release fetch: имя файла со слэшем — отказ" "false" "$(hostrun release fetch steer 1.0 ../a.apk "$T/dl/x" | jget ok)"
check "release versions: продукт не из двух — использование (код 2)" "2" "$(hostrun release versions other >/dev/null; echo $?)"
printf 'x' > "$T/pk.apk"
check "pkg install: пакет вне /tmp и рабочего каталога плагина — отказ" "false;1" "$(hostrun pkg install /etc/passwd | jget ok);$(hostrun pkg install /etc/passwd >/dev/null; echo $?)"
check "pkg install: файла нет — отказ" "false" "$(hostrun pkg install /tmp/no-such-file.apk | jget ok)"
check "pkg install без файлов — использование (код 2)" "2" "$(hostrun pkg install >/dev/null; echo $?)"
printf '{"version":2,"outputs":{"direct":{"kind":"direct"},"t":{"kind":"tunnel","protocol":"trojan"},"o":{"kind":"interface","device":"wg0","obfs":{"server":"a:1","listen":"b:2"}}}}\n' > "$T/etc/spec.json"
out="$(hostrun engine modules)"
check "engine modules: нужные спеке протоколы в порядке карточки" "proxy obfs" "$(printf '%s' "$out" | python3 -c 'import json,sys; print(" ".join(json.load(sys.stdin)["modules"]))')"
out="$(hostrun engine modules --want hysteria2)"
check "engine modules --want: просимый добавлен к нужным" "hysteria2 proxy obfs" "$(printf '%s' "$out" | python3 -c 'import json,sys; print(" ".join(json.load(sys.stdin)["modules"]))')"
out="$(hostrun engine modules --want wireguard)"
check "engine modules: неизвестный — отказ, названо имя, код 1" "false;yes;1" "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget error | grep -q wireguard && echo yes || echo no);$(hostrun engine modules --want wireguard >/dev/null; echo $?)"
rm -f "$T/etc/spec.json"

# ---- подписки: остаток у панели и своё название ---------------------------------------------
printf 'vless://a\n' > "$T/etc/sub.txt"
printf 'vless://b\n' > "$T/etc/subs/hand.txt"
env UCI_STUB_DB="$T/uci.db" "$T/bin/uci" -q set splify2.main.sub_url=https://panel.invalid/s
env UCI_STUB_DB="$T/uci.db" "$T/bin/uci" -q set splify2.main.sub_kind=url
env UCI_STUB_DB="$T/uci.db" "$T/bin/uci" -q set splify2.sub_hand=subscription
env UCI_STUB_DB="$T/uci.db" "$T/bin/uci" -q set splify2.sub_hand.kind=links
out="$(hostrun sub quota main)"
check "sub quota: панель назвала остаток — asked, числа в quota" "true;url;true;10;1900000000" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget kind);$(printf '%s' "$out" | jget asked);$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["quota"]["total"])');$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["quota"]["expire"])')"
out="$(SUB_QUOTA=none hostrun sub quota main)"
check "sub quota: панель промолчала — не отказ, причина в why" "true;yes" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget why | grep -q 'не сообщила' && echo yes || echo no)"
out="$(hostrun sub quota hand)"
check "sub quota: узлы ссылками — не спрашивали, asked false" "true;links;false" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget kind);$(printf '%s' "$out" | jget asked)"
out="$(hostrun sub quota nothere)"; rc=$?
check "sub quota: подписки нет — отказ с кодом 1" "false;1" "$(printf '%s' "$out" | jget ok);$(hostrun sub quota nothere >/dev/null; echo $?)"
out="$(hostrun sub title main 'Моя подписка')"
check "sub title: название записано и отдано" "true;main;Моя подписка;Моя подписка" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget name);$(printf '%s' "$out" | jget title);$(sed -n 's/^splify2.main.sub_title=//p' "$T/uci.db")"
check "sub title: пустое название снимает своё" "true;" \
      "$(hostrun sub title main '' | jget ok);$(sed -n 's/^splify2.main.sub_title=//p' "$T/uci.db")"
long="$(python3 -c 'print("я" * 101)')"
check "sub title: длиннее 200 байт — отказ" "false" "$(hostrun sub title main "$long" | jget ok)"
check "sub title: управляющие знаки — отказ" "false" "$(hostrun sub title main "$(printf 'a\001b')" | jget ok)"
check "sub title: подписки нет — отказ" "false" "$(hostrun sub title nothere x | jget ok)"
check "sub title: у именованной подписки — в её секции" "true;Свои" \
      "$(hostrun sub title hand Свои | jget ok);$(sed -n 's/^splify2.sub_hand.title=//p' "$T/uci.db")"

[ "$fails" = 0 ] && echo "все проверки прошли" || { echo "ПРОВАЛОВ: $fails"; exit 1; }
