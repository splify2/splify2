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
        STEER="$STEER_BIN" SPEC="$T/etc/spec.json" APPLIED="$T/etc/spec.applied.json" \
        LISTS="$T/lists" MANIFEST="$T/etc/manifest.json" UCI_SPLIFY2="$T/etc/config-splify2" \
        INITD="$T/bin/initd" FW_OWNED="$T/etc/fw-owned" SUB="$T/etc/sub.txt" SUBS_DIR="$T/etc/subs" \
        sh "$ROOT/files/usr/libexec/rpcd/splify2" call "$1" 2>"$T/stderr"
}
req() { python3 -c 'import json,sys; print(json.dumps({"spec": sys.argv[1]}))' "$1"; }

printf 'example.org\n' > "$T/lists/dom.lst"
printf '#!/bin/sh\nexit 0\n' > "$T/bin/initd"; chmod +x "$T/bin/initd"

GOOD='{"version":2,"outputs":{"direct":{"kind":"direct"},"wg0":{"kind":"interface","device":"wg0"},"wg1":{"kind":"interface","device":"wg1"},"g":{"kind":"group","pick":"order","members":["wg0","wg1"]}},"lists":{"a":{"domains_file":["'"$T"'/lists/dom.lst"]}},"rules":[{"name":"Новости","to":["a"],"out":"g"}]}'
out="$(rpcd spec_set "$(req "$GOOD")")"
check "спека v2 с группой проходит разбор движка" "true" "$(printf '%s' "$out" | jget ok)"
check "и лежит на месте байт в байт" "$GOOD" "$(cat "$T/etc/spec.json")"

BAD='{"version":2,"outputs":{"direct":{"kind":"direct"},"x":{"kind":"interface","device":"wg0","опечатка":1}}}'
out="$(rpcd spec_set "$(req "$BAD")")"
check "неизвестный ключ — отказ движка" "false" "$(printf '%s' "$out" | jget ok)"
check "и его слова доехали до человека" "yes" \
      "$(printf '%s' "$out" | jget error | grep -q 'опечатка' && echo yes || echo no)"
check "прежняя спека при отказе цела" "$GOOD" "$(cat "$T/etc/spec.json")"

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

printf '{"schema":1,"outputs":{"direct":{"kind":"direct"}},"channels":[]}\n' > "$T/etc/spec.json"
rm -f "$T/etc/spec.json.v1.bak"
out="$(rpcd spec_set "$(req '{"version":2,"outputs":{"direct":{"kind":"direct"}}}')")"
check "перенос v1 → v2 прошёл" "true" "$(printf '%s' "$out" | jget ok)"
check "копия v1 осталась рядом" "yes" "$(grep -q schema "$T/etc/spec.json.v1.bak" && echo yes || echo no)"

printf '\n%d проверок пройдено' "$pass"
if [ "$fail" -gt 0 ]; then printf ', %d ПРОВАЛЕНО\n' "$fail"; exit 1; fi
printf '\nвсе проверки прошли\n'
