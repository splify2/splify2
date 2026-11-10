#!/bin/sh
# Свой туннель WireGuard/AmneziaWG файлом или текстом: методы awg_put, awg_list, awg_del (rpcd/m-awg.sh), архив
# настроек с файлами туннелей (splify2-host state, плагин backup), полное удаление.
#
#   1. Проверка формы отвергает негодное до записи, и отказ называет строку, но не её содержимое.
#   2. Судья значений — ядро: его отказ доходит словами, а без плагина awg файл принимается по форме.
#   3. Файл закрыт (0600, каталог 0700), приватный ключ не возвращается ни одним ответом.
#   4. Ответ несёт готовый выход для спеки; спеку метод не трогает.
#   5. Удаление — только когда файл не читает ни сохранённая, ни применённая спека.
#   6. Архив: файлы туннелей уезжают и возвращаются дословно, негодный файл в архиве отвергается до записи.
#   7. С настоящим ядром (../steer/build/steer или STEER_BIN) — то же против его разбора; без него шаг пропускается вслух.
#
# Запуск: sh tests/awgmatch.sh (нужен python3).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/files/usr/libexec/rpcd/splify2"
HOST="$ROOT/files/usr/sbin/splify2-host"
LIBD="$ROOT/files/usr/lib/splify2"
T="$(mktemp -d /tmp/awgmatch.XXXXXX)"
trap 'rm -rf "$T"' EXIT INT TERM

fails=0; passes=0
check() {  # ОПИСАНИЕ ОЖИДАЕМОЕ ПОЛУЧЕННОЕ
    if [ "$2" = "$3" ]; then
        passes=$((passes + 1)); printf '%-76s ok\n' "$1"
    else
        printf '%-76s ПРОВАЛ\n    ожидалось: %s\n    получено:  %s\n' "$1" "$2" "$3"
        fails=$((fails + 1))
    fi
}
pj() {  # ВЫРАЖЕНИЕ < JSON
    python3 -c 'import json,sys
try: d = json.load(sys.stdin)
except Exception: print("НЕ JSON"); raise SystemExit
try: v = eval(sys.argv[1])
except Exception: v = "НЕТ ПОЛЯ"
print(v if isinstance(v, str) else json.dumps(v, ensure_ascii=False))' "$1"
}
req() {  # ИМЯ ТЕКСТ [replace] -> вход awg_put
    python3 -c 'import json,sys
r = {"name": sys.argv[1], "text": sys.argv[2]}
if len(sys.argv) > 3: r["replace"] = True
print(json.dumps(r))' "$@"
}

mkdir -p "$T/bin" "$T/etc" "$T/lock" "$T/var"
cp "$ROOT/tests/stub/jsonfilter" "$T/bin/jsonfilter"; cp "$ROOT/tests/stub/uci" "$T/bin/uci"
: > "$T/uci.db"

# Заглушка ядра. `outputs --kind awg` — имена выходов awg из спеки; `apply --dry-run` — вердикт о файле туннеля:
# строка с BadKey в файле — предупреждение теми же словами, что печатает ядро (awg_check_all); STEER_NOPLUGIN=1 —
# отказ «вида нет, нужен плагин» с кодом spec.key_rejected; STEER_GONE=1 — ядра нет вовсе.
cat > "$T/bin/steer" <<'EOF'
#!/bin/sh
[ -n "${STEER_GONE:-}" ] && exit 127
if [ "${1:-}" = spec ] && [ "${2:-}" = convert ]; then
    shift 2; _f=""
    while [ $# -gt 0 ]; do case "$1" in --spec) _f="$2"; shift ;; esac; shift; done
    if [ "$_f" = - ]; then cat; else cat "$_f"; fi
    exit 0
fi
echo "$*" >> "$SANDBOX/steer.log"
_spec=""; _kind=""; _dry=0; _cmd="${1:-}"
while [ $# -gt 0 ]; do
    case "$1" in --spec) _spec="$2"; shift ;; --kind) _kind="$2"; shift ;; --dry-run) _dry=1 ;; esac
    shift
done
case "$_cmd" in
    outputs)
        [ -s "$_spec" ] || exit 0
        python3 -c 'import json,sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
for n, o in d.get("outputs", {}).items():
    if not sys.argv[2] or o.get("kind") == sys.argv[2]: print(n)' "$_spec" "$_kind" ;;
    apply)
        [ "$_dry" = 1 ] || exit "${STEER_RC:-0}"
        # Проверка спеки целиком (spec_set, восстановление архива): вердикт — STEER_RC.
        case "$_spec" in */.*.check.*) ;; *) exit "${STEER_RC:-0}" ;; esac
        cp "$_spec" "$SANDBOX/last-check.json"
        if [ -n "${STEER_NOPLUGIN:-}" ]; then
            echo "steer: outputs.x: нужен плагин awg — поставить" >&2
            echo '{"ok":false,"error":"outputs.x: нужен плагин awg — поставить","code":"spec.key_rejected","args":{"1":"outputs.x","2":"нужен плагин awg — поставить"}}' >&2
            exit 1
        fi
        python3 -c 'import json,sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
for n, o in d["outputs"].items():
    if o.get("kind") != "awg": continue
    for i, l in enumerate(open(o["conf"], encoding="utf-8"), 1):
        if l.startswith("Unreadable"):
            sys.stderr.write("steer[warn] awg: выход %s: %s: файл слишком большой для конфигурации туннеля\n" % (n, o["conf"]))
            break
        if l.startswith("BadKey"):
            sys.stderr.write("steer[warn] awg: выход %s: строка %d: неизвестный параметр BadKey в [Interface]\n" % (n, i))' "$_spec"
        exit 0 ;;
esac
exit 0
EOF
chmod +x "$T/bin"/*

. "$ROOT/tests/stub/plugins-env.sh"
PL="$T/p"
plugins_provision "$PL" backup
# Плагин awg в state.json менеджера: enabled — стоит, пусто — нет.
awg_plugin() {  # enabled | none
    python3 - "$PL/state.json" "$1" <<'PY'
import json, sys
p, s = sys.argv[1:3]
d = json.load(open(p))
if s == "none": d["plugins"].pop("awg", None)
else: d["plugins"]["awg"] = {"version": "2.1.0", "state": s, "repo": "splify2"}
json.dump(d, open(p, "w"))
PY
}

envs() {
    env SANDBOX="$T" PATH="$T/bin:$PATH" JSHN_SH="$ROOT/tests/stub/jshn.sh" \
        RPCD_LIB="$LIBD/rpcd" FAST_SH="$LIBD/fast.sh" FETCH_SH="$LIBD/fetch.sh" \
        SPLIFY2_LOCK_DIR="$T/lock" STEER="${STEER_REAL:-$T/bin/steer}" STEER_SOCK="$T/none.sock" \
        SPEC="$T/etc/spec.json" SPEC_VIEW="$T/spec.view.json" APPLIED="$T/etc/spec.applied.json" \
        LISTS="$T/lists" SUB="$T/etc/sub.txt" SUBS_DIR="$T/etc/subs" XSTEER_DIR="$T/etc/xs" \
        FW_OWNED="$T/etc/fw-owned" UCI_SPLIFY2="$T/etc/config-splify2" UCI_STUB_DB="$T/uci.db" \
        BACKUP_OUT="$T/var/backup.out" BACKUP_IN="$T/var/backup.in" \
        "$@"
}
rpc() {  # МЕТОД [JSON]
    printf '%s\n' "${2:-}" | envs sh "$SCRIPT" call "$1" 2>"$T/stderr"
}
hostrun() { envs sh "$HOST" "$@" 2>"$T/stderr" </dev/null; }

# Ключи — 32 байта в base64 (44 знака), как у WireGuard; значения стендовые.
PRIV='YAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk='
PUB='HIgo9xNzJMWLKASShiTqIybxZ0U3wGLiUeJ1PKf8ykw='
WG="[Interface]
PrivateKey = $PRIV
Address = 10.8.0.2/32
DNS = 1.1.1.1

[Peer]
PublicKey = $PUB
Endpoint = 203.0.113.7:51820
AllowedIPs = 0.0.0.0/0"
AWG="[Interface]
PrivateKey = $PRIV
Address = 10.9.0.2/32, fd00:9::2/128
Jc = 4
Jmin = 40
Jmax = 70
S1 = 15
S2 = 30
H1 = 1234567
H2 = 2345678
H3 = 3456789
H4 = 4567890
# комментарий из файла сервера
[Peer]
PublicKey = $PUB
Endpoint = vpn.example.org:443
AllowedIPs = 0.0.0.0/0, ::/0"

echo "== методы объявлены и разрешены"
check "awg_list, awg_put, awg_del есть в list диспетчера" "3" \
      "$(envs sh "$SCRIPT" list 2>/dev/null | python3 -c 'import json,sys; d=json.load(sys.stdin); print(sum(k in d for k in ("awg_list","awg_put","awg_del")))')"
check "awg_put принимает name, text и replace" "name,replace,text" \
      "$(envs sh "$SCRIPT" list 2>/dev/null | python3 -c 'import json,sys; print(",".join(sorted(json.load(sys.stdin)["awg_put"])))')"
check "ACL: awg_list — чтение, awg_put и awg_del — запись" "read;write;write" \
      "$(python3 -c 'import json,sys
a = list(json.load(open(sys.argv[1])).values())[0]
side = lambda m: "read" if m in a["read"]["ubus"]["splify2"] else "write" if m in a["write"]["ubus"]["splify2"] else "нет"
print(";".join(side(m) for m in ("awg_list", "awg_put", "awg_del")))' "$ROOT/luci/root/usr/share/rpcd/acl.d/splify2.json")"
check "methods.tsv: три метода каркаса" "3" "$(grep -cE '^awg_(list|put|del)	frame$' "$LIBD/methods.tsv")"
check "правки спеки и файлов туннелей — под одним замком" "1" \
      "$(grep -c 'awg_put|awg_del.*call_lock state' "$SCRIPT")"

echo "== awg_put: проверка формы"
printf '{"version":2,"outputs":{"direct":{"kind":"direct"},"wg0":{"kind":"interface","device":"wg0"}}}\n' > "$T/etc/spec.json"
awg_plugin enabled
bad() {  # ОПИСАНИЕ КОД ИМЯ ТЕКСТ
    out="$(rpc awg_put "$(req "$3" "$4")")"
    check "$1" "false;$2" "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()');$(printf '%s' "$out" | pj 'd.get("code","")')"
    BAD_OUT="$out"
}
bad "имя с точки отвергается" awg.bad_name ".x" "$WG"
bad "имя с косой чертой отвергается" awg.bad_name "a/b" "$WG"
bad "имя длиннее 31 знака отвергается" awg.bad_name "abcdefghijklmnopqrstuvwxyz0123456" "$WG"
bad "пустой текст отвергается" awg.need_text nl ""
bad "имя выхода другого вида занято" awg.name_taken wg0 "$WG"
bad "слово ядра direct именем не становится" awg.name_taken direct "$WG"
out="$(rpc awg_put "$(req nl "PrivateKey = $PRIV")")"
check "строка вне раздела: отказ без кода ядра, со словами о строке 1" "false;yes" \
      "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()');$(printf '%s' "$out" | pj 'd["error"]' | grep -q 'строка 1' && echo yes || echo no)"
check "  и содержимое строки (ключ) в отказ не попало" "no" "$(printf '%s' "$out" | grep -qF "$PRIV" && echo yes || echo no)"
out="$(rpc awg_put "$(req nl "[Interface]
Address = 10.0.0.2/32
[Peer]
PublicKey = $PUB")")"
check "нет PrivateKey — отказ называет приватный ключ" "yes" "$(printf '%s' "$out" | pj 'd["error"]' | grep -q 'нет приватного ключа' && echo yes || echo no)"
out="$(rpc awg_put "$(req nl "[Interface]
PrivateKey = $PRIV")")"
check "нет раздела [Peer] — отказ называет сервер" "yes" "$(printf '%s' "$out" | pj 'd["error"]' | grep -q 'нет сервера' && echo yes || echo no)"
out="$(rpc awg_put "$(req nl "[Interface]
PrivateKey = $PRIV
[Interface]
PrivateKey = $PRIV
[Peer]
PublicKey = $PUB")")"
check "два раздела [Interface] — отказ" "yes" "$(printf '%s' "$out" | pj 'd["error"]' | grep -q 'ровно один раздел' && echo yes || echo no)"
out="$(rpc awg_put "$(req nl "$(printf '[Interface]\nPrivateKey = %s\n\001\n[Peer]\nPublicKey = %s' "$PRIV" "$PUB")")")"
check "управляющий байт в тексте — «двоичные данные»" "yes" "$(printf '%s' "$out" | pj 'd["error"]' | grep -q 'двоичные данные' && echo yes || echo no)"
check "после отказов каталог туннелей пуст: ни файла, ни черновика" "0" "$(ls -A "$T/etc/awg" 2>/dev/null | wc -l | tr -d ' ')"

echo "== awg_put: ядро проверяет значения"
out="$(rpc awg_put "$(req nl "[Interface]
PrivateKey = $PRIV
BadKey = 1
[Peer]
PublicKey = $PUB")")"
check "отказ ядра: код awg.rejected, слова ядра о строке и параметре" "awg.rejected;yes" \
      "$(printf '%s' "$out" | pj 'd.get("code","")');$(printf '%s' "$out" | pj 'd["error"]' | grep -q 'строка 3: неизвестный параметр BadKey' && echo yes || echo no)"
check "  ядру дана спека из одного этого выхода, а не спека человека" "direct,nl" \
      "$(python3 -c 'import json,sys; print(",".join(sorted(json.load(open(sys.argv[1]))["outputs"])))' "$T/last-check.json")"
check "  после отказа ядра файла нет" "0" "$(ls -A "$T/etc/awg" 2>/dev/null | wc -l | tr -d ' ')"
out="$(rpc awg_put "$(req nl "[Interface]
PrivateKey = $PRIV
Unreadable = 1
[Peer]
PublicKey = $PUB")")"
check "отказ ядра с путём файла: путь черновика человеку не показан" "awg.rejected;no;yes" \
      "$(printf '%s' "$out" | pj 'd.get("code","")');$(printf '%s' "$out" | grep -q '\.nl\.new\.' && echo yes || echo no);$(printf '%s' "$out" | pj 'd["error"]' | grep -q 'не принят: файл слишком большой' && echo yes || echo no)"

echo "== awg_put: файл принят"
out="$(rpc awg_put "$(req nl "$WG")")"
check "ответ: ok, имя, путь под каталогом ядра" "true;nl;$T/etc/awg/nl.conf" \
      "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()');$(printf '%s' "$out" | pj 'd["name"]');$(printf '%s' "$out" | pj 'd["conf"]')"
check "ответ: сервер, адреса, обычный WireGuard, IPv6 нет" "203.0.113.7:51820;10.8.0.2/32;false;off" \
      "$(printf '%s' "$out" | pj 'd["endpoint"]');$(printf '%s' "$out" | pj '",".join(d["addresses"])');$(printf '%s' "$out" | pj 'str(d["amnezia"]).lower()');$(printf '%s' "$out" | pj 'd["ipv6"]')"
check "ответ: ядро проверило, плагин стоит" "true;awg;true" \
      "$(printf '%s' "$out" | pj 'str(d["checked"]).lower()');$(printf '%s' "$out" | pj 'd["plugin"]');$(printf '%s' "$out" | pj 'str(d["plugin_ready"]).lower()')"
check "ответ: готовый выход для спеки — без пути к файлу" '{"kind": "awg", "on_fail": "drop", "ipv6": "off"}' "$(printf '%s' "$out" | pj 'd["output"]')"
check "приватный ключ в ответ не попал" "no" "$(printf '%s' "$out" | grep -qF "$PRIV" && echo yes || echo no)"
check "файл закрыт (0600), каталог — 0700" "600;700" "$(stat -c %a "$T/etc/awg/nl.conf");$(stat -c %a "$T/etc/awg")"
check "файл лёг дословно" "$WG" "$(cat "$T/etc/awg/nl.conf")"
check "черновиков в каталоге не осталось" "nl.conf" "$(ls -A "$T/etc/awg" | tr '\n' ' ' | sed 's/ $//')"
check "спеку метод не трогал" '{"version":2,"outputs":{"direct":{"kind":"direct"},"wg0":{"kind":"interface","device":"wg0"}}}' "$(cat "$T/etc/spec.json")"
check "ключ не попал в журнал вызовов ядра" "no" "$(grep -qF "$PRIV" "$T/steer.log" "$T/stderr" 2>/dev/null && echo yes || echo no)"

# Имя уже занято файлом: без replace — отказ, файл первого туннеля не тронут (второй туннель из wg0.conf
# другого сервера не должен молча заменить ключи первого); с replace — замена.
cp "$T/etc/awg/nl.conf" "$T/nl.before"
out="$(rpc awg_put "$(req nl "$(printf '%s' "$WG" | sed 's/203.0.113.7/198.51.100.9/')")")"
check "то же имя без replace: отказ awg.exists, файл прежний" "awg.exists;nl;yes" \
      "$(printf '%s' "$out" | pj 'd.get("code","")');$(printf '%s' "$out" | pj 'd["args"]["name"]');$(cmp -s "$T/nl.before" "$T/etc/awg/nl.conf" && echo yes || echo no)"
out="$(rpc awg_put "$(req nl "$(printf '%s' "$WG" | sed 's/203.0.113.7/198.51.100.9/')" replace)")"
check "то же имя с replace: файл заменён" "true;198.51.100.9:51820;1" \
      "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()');$(printf '%s' "$out" | pj 'd["endpoint"]');$(grep -c 198.51.100.9 "$T/etc/awg/nl.conf")"
check "  и закрыт по-прежнему, черновиков нет" "600;nl.conf" "$(stat -c %a "$T/etc/awg/nl.conf");$(ls -A "$T/etc/awg" | tr '\n' ' ' | sed 's/ $//')"
cp "$T/nl.before" "$T/etc/awg/nl.conf"
# Выход awg с этим именем, но со своим conf, читает другой файл: принятый здесь лёг бы мимо.
printf '{"version":2,"outputs":{"direct":{"kind":"direct"},"cust":{"kind":"awg","conf":"/srv/cust.conf"}}}\n' > "$T/etc/spec.json"
out="$(rpc awg_put "$(req cust "$WG" replace)")"
check "имя выхода awg со своим conf — занято, файла нет" "awg.name_taken;no" \
      "$(printf '%s' "$out" | pj 'd.get("code","")');$([ -e "$T/etc/awg/cust.conf" ] && echo yes || echo no)"
printf '{"version":2,"outputs":{"direct":{"kind":"direct"},"wg0":{"kind":"interface","device":"wg0"}}}\n' > "$T/etc/spec.json"

out="$(rpc awg_put "$(req am.1 "$(printf '%s' "$AWG" | sed 's/$/\r/')")")"
check "файл из Windows (\\r\\n): принят, AmneziaWG, адрес IPv6 — nat" "true;true;nat;vpn.example.org:443" \
      "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()');$(printf '%s' "$out" | pj 'str(d["amnezia"]).lower()');$(printf '%s' "$out" | pj 'd["ipv6"]');$(printf '%s' "$out" | pj 'd["endpoint"]')"
check "  адреса — оба, через запятую разобраны" "10.9.0.2/32,fd00:9::2/128" "$(printf '%s' "$out" | pj '",".join(d["addresses"])')"
check "  \\r из файла убран, комментарий остался" "0;1" "$(grep -c "$(printf '\r')" "$T/etc/awg/am.1.conf");$(grep -c '^# комментарий' "$T/etc/awg/am.1.conf")"
out="$(rpc awg_put "$(req plain "$(printf '%s' "$WG" | sed 's/^DNS.*/Jc = 0\nH1 = 1\nH2 = 2/')")")"
check "файл Amnezia с выключенной обфускацией — обычный WireGuard" "false" "$(printf '%s' "$out" | pj 'str(d["amnezia"]).lower()')"
rm -f "$T/etc/awg/plain.conf"

echo "== awg_put: плагина awg нет, ядра нет"
awg_plugin none
out="$(STEER_NOPLUGIN=1 rpc awg_put "$(req np "$WG")")"
check "ядро без плагина: файл принят по форме, checked и plugin_ready — false" "true;false;false" \
      "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()');$(printf '%s' "$out" | pj 'str(d["checked"]).lower()');$(printf '%s' "$out" | pj 'str(d["plugin_ready"]).lower()')"
check "  файл лежит" "600" "$(stat -c %a "$T/etc/awg/np.conf" 2>/dev/null)"
out="$(STEER_GONE=1 rpc awg_put "$(req np "$WG" replace)")"
check "ядра нет вовсе: файл принят по форме" "true;false" "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()');$(printf '%s' "$out" | pj 'str(d["checked"]).lower()')"
awg_plugin enabled

echo "== awg_list"
printf '{"version":2,"outputs":{"direct":{"kind":"direct"},"nl":{"kind":"awg","on_fail":"drop"},"second":{"kind":"awg","conf":"%s/etc/awg/am.1.conf"}}}\n' "$T" > "$T/etc/spec.json"
: > "$T/etc/awg/.hidden.conf"; : > "$T/etc/awg/note.txt"
out="$(rpc awg_list)"
check "перечень: три файла по имени, скрытые и чужие — нет" "am.1,nl,np" "$(printf '%s' "$out" | pj '",".join(sorted(t["name"] for t in d["tunnels"]))')"
check "  кто читает: nl — выход nl, am.1 — выход second (по conf), np — никто" "nl=nl;am.1=second;np=" \
      "$(printf '%s' "$out" | pj '";".join("%s=%s" % (n, ",".join(next(t["outputs"] for t in d["tunnels"] if t["name"] == n))) for n in ("nl", "am.1", "np"))')"
check "  плагин стоит, каталог назван" "true;$T/etc/awg" "$(printf '%s' "$out" | pj 'str(d["plugin_ready"]).lower()');$(printf '%s' "$out" | pj 'd["dir"]')"
check "  ключей в перечне нет" "no" "$(printf '%s' "$out" | grep -qF "$PRIV" && echo yes || echo no)"
rm -f "$T/etc/awg/.hidden.conf" "$T/etc/awg/note.txt"

echo "== awg_del"
out="$(rpc awg_del '{"name":"nl"}')"
check "файл выхода сохранённой спеки не удаляется: код и имя выхода" "awg.in_use;nl;yes" \
      "$(printf '%s' "$out" | pj 'd.get("code","")');$(printf '%s' "$out" | pj 'd["args"]["outputs"]');$([ -f "$T/etc/awg/nl.conf" ] && echo yes || echo no)"
out="$(rpc awg_del '{"name":"am.1"}')"
check "файл, названный ключом conf другого выхода, — тоже" "awg.in_use;second" "$(printf '%s' "$out" | pj 'd.get("code","")');$(printf '%s' "$out" | pj 'd["args"]["outputs"]')"
out="$(STEER_GONE=1 rpc awg_del '{"name":"nl"}')"
check "ядро не ответило — выход находится по тексту спеки" "awg.in_use" "$(printf '%s' "$out" | pj 'd.get("code","")')"
cp "$T/etc/spec.json" "$T/etc/spec.applied.json"
printf '{"version":2,"outputs":{"direct":{"kind":"direct"}}}\n' > "$T/etc/spec.json"
out="$(rpc awg_del '{"name":"nl"}')"
check "выход убран, но правка не применена — файл остаётся" "awg.in_use_applied;yes" \
      "$(printf '%s' "$out" | pj 'd.get("code","")');$([ -f "$T/etc/awg/nl.conf" ] && echo yes || echo no)"
out="$(rpc awg_del '{"name":"am.1"}')"
check "  то же для файла, названного в применённой спеке ключом conf" "awg.in_use_applied" "$(printf '%s' "$out" | pj 'd.get("code","")')"
cp "$T/etc/spec.json" "$T/etc/spec.applied.json"
out="$(rpc awg_del '{"name":"nl"}')"
check "никем не занятый файл удаляется" "true;no" "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()');$([ -f "$T/etc/awg/nl.conf" ] && echo yes || echo no)"
out="$(rpc awg_del '{"name":"nl"}')"
check "повторное удаление — «такого туннеля нет»" "awg.no_such" "$(printf '%s' "$out" | pj 'd.get("code","")')"
out="$(rpc awg_del '{"name":"../spec"}')"
check "имя с путём отвергается" "awg.bad_name;yes" "$(printf '%s' "$out" | pj 'd.get("code","")');$([ -f "$T/etc/spec.json" ] && echo yes || echo no)"

echo "== архив настроек: файлы туннелей"
rpc awg_put "$(req nl "$WG")" >/dev/null
printf '{"version":2,"outputs":{"direct":{"kind":"direct"},"nl":{"kind":"awg","on_fail":"drop"}}}\n' > "$T/etc/spec.json"
out="$(hostrun state export "$T/ex")"
check "state export: файлы туннелей выгружены" "true;am.1 nl np" \
      "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()');$(ls "$T/ex" | sed -n 's/^awg\.//p' | tr '\n' ' ' | sed 's/ $//')"
check "  дословно и закрытыми (0600)" "yes;600" "$(cmp -s "$T/ex/awg.nl" "$T/etc/awg/nl.conf" && echo yes || echo no);$(stat -c %a "$T/ex/awg.nl")"
check "state check: своя выгрузка проходит" "true" "$(hostrun state check "$T/ex" | pj 'str(d["ok"]).lower()')"
rm -rf "$T/bad"; cp -R "$T/ex" "$T/bad"; printf '[Interface]\nAddress = 10.0.0.2/32\n' > "$T/bad/awg.nl"
out="$(hostrun state check "$T/bad")"
check "state check: файл туннеля без ключа отвергается" "false;yes" \
      "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()');$(printf '%s' "$out" | pj 'd["error"]' | grep -q 'нет приватного ключа' && echo yes || echo no)"
rm -rf "$T/bad"; cp -R "$T/ex" "$T/bad"; cp "$T/ex/awg.nl" "$T/bad/awg..x"
check "state check: имя туннеля с точки отвергается" "false" "$(hostrun state check "$T/bad" | pj 'str(d["ok"]).lower()')"
rm -rf "$T/etc/awg" "$T/etc/spec.json" "$T/etc/spec.applied.json"
out="$(hostrun state import "$T/ex")"
check "state import: туннели легли, числом" "true;3" "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()');$(printf '%s' "$out" | pj 'd["awg"]')"
check "  дословно, закрытыми, каталог 0700, без черновиков" "yes;600;700;am.1.conf nl.conf np.conf" \
      "$(cmp -s "$T/ex/awg.nl" "$T/etc/awg/nl.conf" && echo yes || echo no);$(stat -c %a "$T/etc/awg/nl.conf");$(stat -c %a "$T/etc/awg");$(ls -A "$T/etc/awg" | tr '\n' ' ' | sed 's/ $//')"

echo "== архив плагина backup: раздел [awg имя]"
# Настоящие методы backup_get и backup_put (псевдонимы плагина backup): архив собирается из выгрузки хоста и
# возвращается через его же проверку и восстановление.
out="$(rpc backup_get '{"offset":0}')"
printf '%s' "$out" | python3 -c 'import json,sys; sys.stdout.write(json.load(sys.stdin).get("text", ""))' > "$T/arch.txt"
check "backup_get: архив с туннелями — формата 5, целиком в одном куске" "true;5;true;splify2-backup 5" \
      "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()');$(printf '%s' "$out" | pj 'd["format"]');$(printf '%s' "$out" | pj 'str(d["eof"]).lower()');$(head -n 1 "$T/arch.txt")"
check "  разделы туннелей названы" "[awg am.1] [awg nl] [awg np]" "$(grep '^\[awg ' "$T/arch.txt" | tr '\n' ' ' | sed 's/ $//')"
put() { rpc backup_put "$(python3 -c 'import json,sys; print(json.dumps({"text": open(sys.argv[1], encoding="utf-8").read(), "final": True}))' "$1")"; }
cp -R "$T/etc/awg" "$T/awg.keep"
rm -rf "$T/etc/awg" "$T/etc/spec.json" "$T/etc/spec.applied.json"
out="$(put "$T/arch.txt")"
check "backup_put: архив принят, туннели числом" "true;3" "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()');$(printf '%s' "$out" | pj 'd["awg"]')"
check "  файлы вернулись дословно — с комментарием и своими разделами [Interface] и [Peer]" "yes;yes;600" \
      "$(cmp -s "$T/awg.keep/nl.conf" "$T/etc/awg/nl.conf" && echo yes || echo no);$(cmp -s "$T/awg.keep/am.1.conf" "$T/etc/awg/am.1.conf" && echo yes || echo no);$(stat -c %a "$T/etc/awg/am.1.conf" 2>/dev/null)"
# Заголовки разделов в файле сервера бывают в другом регистре и с комментарием — проверка формы и ядро такие
# принимают, значит и архив обязан их вернуть, а не оборвать восстановление «неизвестным разделом».
printf '%s\n' "[interface]" "PrivateKey = $PRIV" "Address = 10.8.0.2/32" "[Peer] # сервер" "PublicKey = $PUB" > "$T/etc/awg/low.conf"
chmod 600 "$T/etc/awg/low.conf"
check "файл с [interface] и «[Peer] # …» проходит проверку формы" "true" \
      "$(rpc awg_put "$(req low "$(cat "$T/etc/awg/low.conf")" replace)" | pj 'str(d["ok"]).lower()')"
cp "$T/etc/awg/low.conf" "$T/low.keep"
out="$(rpc backup_get '{"offset":0}')"
printf '%s' "$out" | python3 -c 'import json,sys; sys.stdout.write(json.load(sys.stdin).get("text", ""))' > "$T/arch5.txt"
rm -rf "$T/etc/awg"
out="$(put "$T/arch5.txt")"
check "  и возвращается из архива дословно" "true;yes" \
      "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()');$(cmp -s "$T/low.keep" "$T/etc/awg/low.conf" && echo yes || echo no)"
rm -rf "$T/etc/awg"
out="$(rpc backup_get '{"offset":0}')"
check "архив без туннелей остаётся прежнего формата: его читают прежние версии" "3" "$(printf '%s' "$out" | pj 'd["format"]')"
printf 'splify2-backup 5\n[awg ../x]\n[Interface]\nPrivateKey = %s\n' "$PRIV" > "$T/arch3.txt"
out="$(put "$T/arch3.txt")"
check "раздел туннеля с путём в имени отвергается, ничего не записано" "false;no" \
      "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()');$([ -e "$T/etc/awg" ] || [ -e "$T/etc/x.conf" ] && echo yes || echo no)"
printf 'splify2-backup 6\n[spec]\n{}\n' > "$T/arch4.txt"
check "файл версии 6 отвергнут: понимается до 5" "yes" "$(put "$T/arch4.txt" | grep -q 'понимает до 5' && echo yes || echo no)"
cp -R "$T/awg.keep" "$T/etc/awg"

echo "== полное удаление"
check "splify2-purge убирает каталог ядра целиком — файлы туннелей в нём" "yes" \
      "$(grep -q 'STEER_DIR=${STEER_DIR:-/etc/steer}' "$ROOT/files/usr/sbin/splify2-purge" && [ "$(sh -c '. "$1"; printf %s "$AWG_DIR"' _ /dev/stdin <<EOF
SPEC=/etc/steer/spec.json
$(sed -n '/^AWG_DIR=/p' "$LIBD/rpcd/common.sh")
EOF
)" = /etc/steer/awg ] && echo yes || echo no)"

echo "== настоящее ядро"
STEER_BIN="${STEER_BIN:-$ROOT/../steer/build/steer}"
if [ -x "$STEER_BIN" ]; then
    rm -rf "$T/etc/awg"; printf '{"version":2,"outputs":{"direct":{"kind":"direct"}}}\n' > "$T/etc/spec.json"
    out="$(STEER_REAL="$STEER_BIN" rpc awg_put "$(req nl "$WG")")"
    check "ядро: файл WireGuard принят и проверен" "true;true" "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()');$(printf '%s' "$out" | pj 'str(d["checked"]).lower()')"
    out="$(STEER_REAL="$STEER_BIN" rpc awg_put "$(req am "$AWG")")"
    check "ядро: файл AmneziaWG принят и проверен" "true;true" "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()');$(printf '%s' "$out" | pj 'str(d["checked"]).lower()')"
    out="$(STEER_REAL="$STEER_BIN" rpc awg_put "$(req bad "[Interface]
PrivateKey = не-ключ
[Peer]
PublicKey = $PUB")")"
    check "ядро: негодный ключ — отказ называет строку и параметр, не значение" "awg.rejected;yes;no" \
          "$(printf '%s' "$out" | pj 'd.get("code","")');$(printf '%s' "$out" | pj 'd["error"]' | grep -q 'строка 2: PrivateKey' && echo yes || echo no);$(printf '%s' "$out" | grep -q 'не-ключ' && echo yes || echo no)"
    out="$(STEER_REAL="$STEER_BIN" rpc awg_put "$(req bad "$(printf '%s' "$WG" | sed 's/^Address.*/Address = 10.0.0.300/')")")"
    check "ядро: негодный адрес — отказ, файла нет" "awg.rejected;no" "$(printf '%s' "$out" | pj 'd.get("code","")');$([ -e "$T/etc/awg/bad.conf" ] && echo yes || echo no)"
    # Выход, который отдаёт awg_put, ядро принимает в спеке: то, что панель положит в outputs, проходит spec_set.
    SP="$(python3 -c 'import json,sys
o = json.loads(sys.argv[1])["output"]
print(json.dumps({"spec": json.dumps({"version": 2, "outputs": {"direct": {"kind": "direct"}, "nl": o}})}))' "$(STEER_REAL="$STEER_BIN" rpc awg_put "$(req nl "$WG" replace)")")"
    out="$(STEER_REAL="$STEER_BIN" rpc spec_set "$SP")"
    check "ядро: спека с выходом из ответа awg_put сохраняется" "true" "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()')"
else
    echo "ПРОПУЩЕНО: нет ядра $STEER_BIN — соберите: make -C ../steer all (или STEER_BIN=путь)"
fi

printf '\n%d проверок пройдено' "$passes"
if [ "$fails" -gt 0 ]; then printf ', %d ПРОВАЛЕНО\n' "$fails"; exit 1; fi
printf '\nвсе проверки прошли\n'
