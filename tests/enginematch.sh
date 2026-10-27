#!/bin/sh
# Объект rpcd против НАСТОЯЩЕГО движка.
#
# Остальные стенды подменяют `steer` заглушкой и потому проверяют, что бэкенд зовёт движок
# правильно, но не то, что движок отвечает на это так, как бэкенд ждёт. Здесь подменено только
# окружение роутера (jshn, пути), а `steer apply --dry-run` — настоящий: спека v2, которую
# записывает интерфейс, должна пройти разбор движка, а негодная — вернуться отказом его же
# словами. Без движка (../steer/build/steer, make -C ../steer all) стенд пропускается вслух.
#
# Запуск: sh tests/enginematch.sh

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STEER_BIN="${STEER_BIN:-$ROOT/../steer/build/steer}"
if [ ! -x "$STEER_BIN" ]; then
    echo "ПРОПУЩЕН: нет движка $STEER_BIN — соберите: make -C ../steer all"
    exit 0
fi
T="$(mktemp -d /tmp/enginematch.XXXXXX)"
trap 'rm -rf "$T"' EXIT
mkdir -p "$T/etc" "$T/lists" "$T/bin"
# Методы каталога списков — псевдонимы плагина backup lists-catalog (plugins/), поставленного в песочницу.
. "$ROOT/tests/stub/plugins-env.sh"
plugins_provision "$T/plugins" backup lists-catalog
pass=0; fail=0
check() {  # ИМЯ ОЖИДАЛОСЬ ПОЛУЧЕНО
    if [ "$2" = "$3" ]; then pass=$((pass + 1)); printf '%-60s ok\n' "$1"
    else fail=$((fail + 1)); printf '%-60s ПРОВАЛ\n    ожидалось: %s\n    получено:  %s\n' "$1" "$2" "$3"; fi
}
jget() { python3 -c 'import json,sys
v=json.load(sys.stdin).get(sys.argv[1], "")
print(str(v).lower() if isinstance(v, bool) else v)' "$1"; }

rpcd() {  # ПЕРЕМЕННЫЕ... МЕТОД ВХОД
    printf '%s\n' "${2:-}" | env SANDBOX="$T" PATH="$T/bin:$PATH" \
        JSHN_SH="$ROOT/tests/stub/jshn.sh" FETCH_SH="$ROOT/files/usr/lib/splify2/fetch.sh" \
        FAST_SH="$ROOT/files/usr/lib/splify2/fast.sh" RPCD_LIB="$ROOT/files/usr/lib/splify2/rpcd" \
        STEER="$STEER_BIN" SPEC="$T/etc/spec.json" SPEC_VIEW="$T/spec-view.json" APPLIED="$T/etc/spec.applied.json" \
        LISTS="$T/lists" MANIFEST="$T/etc/manifest.json" UCI_SPLIFY2="$T/etc/config-splify2" \
        INITD="$T/bin/initd" FW_OWNED="$T/etc/fw-owned" SUB="$T/etc/sub.txt" SUBS_DIR="$T/etc/subs" \
        sh "$ROOT/files/usr/libexec/rpcd/splify2" call "$1" 2>"$T/stderr"
}
req() { python3 -c 'import json,sys; print(json.dumps({"spec": sys.argv[1]}))' "$1"; }

# jsonfilter роутера (машина разработки его не имеет): только `-i файл -e '@.ключ'` верхнего уровня.
cat > "$T/bin/jsonfilter" <<'EOF'
#!/bin/sh
# Выражения плагинов (манифест, state.json, ответы хуков) — общая заглушка tests/stub/jsonfilter.
[ -n "${JSONFILTER_PLUGIN:-}" ] && case "$*" in *plugins\[*|*@.splify2*|*@.compat*|*@.rpc*|*@.ui.*|*@.ok*|*@.error*|*@.warn*|*@.plan*|*@.section*|*@.message*|*@.args*|*@.code*) exec sh "$JSONFILTER_PLUGIN" "$@" ;; esac
python3 -c 'import json,sys
d = json.load(open(sys.argv[1], encoding="utf-8"))
k = sys.argv[2][2:]
if k in d: print(json.dumps(d[k]) if isinstance(d[k], (dict, list)) else d[k])' "$2" "$4"
EOF
chmod +x "$T/bin/jsonfilter"
printf 'example.org\n' > "$T/lists/dom.lst"
printf '#!/bin/sh\nexit 0\n' > "$T/bin/initd"; chmod +x "$T/bin/initd"

# Что лежит на диске. Ядро 2.1 (печатает JSON-вид, `spec convert --json`) бэкенд ведёт в spec.yaml,
# прежнее — в spec.json. На 2.1 файл не совпадает с присланным текстом побайтно (ядро пишет свой
# перевод и дополняет умолчаниями), поэтому там сравнивается канонический JSON: «лежит» — это
# JSON-вид ядра той же спеки, а при отказе — вид прежней спеки, тот же, что ядро даёт её тексту.
if printf '{"version":2,"outputs":{"direct":{"kind":"direct"}}}' | "$STEER_BIN" spec convert --json --spec - 2>/dev/null | grep -q '^{'; then
    YAML_CORE=1
else
    YAML_CORE=0
fi
canon() { python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin), sort_keys=True, ensure_ascii=False))'; }
disk_spec() {
    if [ "$YAML_CORE" = 1 ]; then
        [ ! -e "$T/etc/spec.json" ] && [ -s "$T/etc/spec.yaml" ] || { echo "нет spec.yaml или рядом лежит spec.json"; return; }
        "$STEER_BIN" spec convert --json --spec "$T/etc/spec.yaml" | canon
    else
        cat "$T/etc/spec.json" 2>/dev/null
    fi
}
want_spec() {  # ТЕКСТ — как спека должна лежать
    if [ "$YAML_CORE" = 1 ]; then printf '%s' "$1" | "$STEER_BIN" spec convert --json --spec - | canon
    else printf '%s' "$1"; fi
}

GOOD='{"version":2,"outputs":{"direct":{"kind":"direct"},"wg0":{"kind":"interface","device":"wg0"},"wg1":{"kind":"interface","device":"wg1"},"g":{"kind":"group","pick":"order","members":["wg0","wg1"]}},"lists":{"a":{"domains_file":["'"$T"'/lists/dom.lst"]}},"rules":[{"name":"Новости","to":["a"],"out":"g"}]}'
out="$(rpcd spec_set "$(req "$GOOD")")"
check "спека v2 с группой проходит разбор движка" "true" "$(printf '%s' "$out" | jget ok)"
check "и лежит на месте" "$(want_spec "$GOOD")" "$(disk_spec)"

BAD='{"version":2,"outputs":{"direct":{"kind":"direct"},"x":{"kind":"interface","device":"wg0","опечатка":1}}}'
out="$(rpcd spec_set "$(req "$BAD")")"
check "неизвестный ключ — отказ движка" "false" "$(printf '%s' "$out" | jget ok)"
check "и его слова доехали до человека" "yes" \
      "$(printf '%s' "$out" | jget error | grep -q 'опечатка' && echo yes || echo no)"
check "прежняя спека при отказе цела" "$(want_spec "$GOOD")" "$(disk_spec)"

# Выход, через который ходит DNS, убран из спеки, а сервер DNS на него ссылается. Именно такую спеку
# панель оставляла в памяти после удаления выхода: ядро отвергает её целиком («настройки не
# применяются, если через выход идёт DNS»), на этой правке и на всех следующих. Панель теперь такой
# выход не удаляет (ui/tests/output-delete.test.tsx), а при отказе ядра называет сервер сама.
DNSVIA='{"version":2,"outputs":{"direct":{"kind":"direct"},"wg0":{"kind":"interface","device":"wg0"},"wg1":{"kind":"interface","device":"wg1"}},"dns":{"upstreams":{"cf":{"url":"https://cloudflare-dns.com/dns-query","ips":["1.1.1.1"],"out":"wg1"}}}}'
out="$(rpcd spec_set "$(req "$DNSVIA")")"
check "сервер DNS через существующий выход проходит разбор" "true" "$(printf '%s' "$out" | jget ok)"
DNSGONE='{"version":2,"outputs":{"direct":{"kind":"direct"},"wg0":{"kind":"interface","device":"wg0"}},"dns":{"upstreams":{"cf":{"url":"https://cloudflare-dns.com/dns-query","ips":["1.1.1.1"],"out":"wg1"}}}}'
out="$(JSONFILTER_PLUGIN="$ROOT/tests/stub/jsonfilter" rpcd spec_set "$(req "$DNSGONE")")"
check "выход сервера DNS убран — отказ ядра" "false" "$(printf '%s' "$out" | jget ok)"
check "и его слова называют сервер и выход" "yes" \
      "$(printf '%s' "$out" | jget error | grep -q 'dns.upstreams.cf.out: выхода «wg1» нет в outputs' && echo yes || echo no)"
check "  и код ядра с приставкой steer., подстановки — по порядку" "steer.spec.output_missing_direct;dns.upstreams.cf.out;wg1" \
      "$(printf '%s' "$out" | jget code);$(printf '%s' "$out" | python3 -c 'import json,sys; a=json.load(sys.stdin)["args"]; print(a["1"]+";"+a["2"])')"
check "прежняя спека при отказе цела (DNS через wg1)" "$(want_spec "$DNSVIA")" "$(disk_spec)"

NOMOD='{"version":2,"outputs":{"direct":{"kind":"direct"},"nl":{"kind":"tunnel","protocol":"hysteria2","subscription":"'"$T"'/etc/sub.txt"}}}'
printf 'hy2://x@h:443#n\n' > "$T/etc/sub.txt"
out="$(rpcd spec_set "$(req "$NOMOD")")"
# Базовая сборка без модуля отвечает отказом с именем пакета; сборка с модулем принимает.
if [ "$(printf '%s' "$out" | jget ok)" = false ]; then
    check "выход без установленного модуля — отказ называет пакет" "yes" \
          "$(printf '%s' "$out" | jget error | grep -q 'steer-hysteria2' && echo yes || echo no)"
else
    check "движок с модулем hysteria2 принял спеку" "true" "$(printf '%s' "$out" | jget ok)"
fi

rm -f "$T/etc/spec.yaml" "$T/etc/spec.json"
printf '{"schema":1,"outputs":{"direct":{"kind":"direct"}},"channels":[]}\n' > "$T/etc/spec.json"
rm -f "$T/etc/spec.json.bak"
out="$(rpcd spec_set "$(req '{"version":2,"outputs":{"direct":{"kind":"direct"}}}')")"
check "перенос v1 → v2 прошёл" "true" "$(printf '%s' "$out" | jget ok)"
check "копия v1 осталась рядом" "yes" "$(grep -q schema "$T/etc/spec.json.bak" && echo yes || echo no)"

printf '\n%d проверок пройдено' "$pass"
if [ "$fail" -gt 0 ]; then printf ', %d ПРОВАЛЕНО\n' "$fail"; exit 1; fi
printf '\nвсе проверки прошли\n'
