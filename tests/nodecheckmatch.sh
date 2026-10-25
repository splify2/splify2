#!/bin/sh
# Стенд плагина node-check (plugins/node-check): страна выхода с кэшем, перебор узлов подписки на роутере, лучший узел,
# задача по расписанию, архив настроек.
#
# Плагин пользуется каркасом только через службы хоста (`call`, `sub list`, `probe geo|ident`, `settings`); хост здесь
# настоящий. За ним — двойник обработчика методов каркаса (`call` зовёт его вместо rpcd), заглушки ядра (`steer status`) и
# curl. Узлы и исходы проб задаются файлами-фикстурами.
#
# Запуск: sh tests/nodecheckmatch.sh (нужен python3 — заглушки jsonfilter и jshn).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d /tmp/nodecheckmatch.XXXXXX)"
trap 'rm -rf "$T"' EXIT INT TERM
mkdir -p "$T/bin" "$T/etc/subs" "$T/lock" "$T/lists" "$T/fix"

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
# Ядро: `steer status` называет устройство выхода vless (его номер в системе даёт файл ifindex — здесь «ident» меняется
# переменной DEV).
cat > "$T/bin/steer" <<'EOF'
#!/bin/sh
echo "$*" >> "$SANDBOX/steer.log"
case "${1:-}" in
    status) printf '{"outputs":{"vless":{"device":"%s","up":true},"dead":{"up":false}}}\n' "$(cat "$SANDBOX/dev" 2>/dev/null || echo tun0)" ;;
esac
exit 0
EOF
# curl: ответ проверочного адреса; CURL_MODE=silent — молчит. Задержка — ради проверки фонового режима.
cat > "$T/bin/curl" <<'EOF'
#!/bin/sh
echo "curl $*" >> "$SANDBOX/curl.log"
[ "$(cat "$SANDBOX/curl.mode" 2>/dev/null)" = silent ] && exit 28
printf 'fl=1\nip=203.0.113.7\nloc=DE\n\nsplify_ms=0.123\n'
EOF
# Обработчик методов каркаса: узлы и пробы из фикстур. Проба: файл probe.<метод>.<узел> = «ok ttfb handshake» или «fail причина».
cat > "$T/bin/rpcd-fake" <<'EOF'
#!/bin/sh
read -r req
m="$2"
case "$m" in
    sub_list) cat "$SANDBOX/fix/sub_list.json" ;;
    vless_nodes|hysteria2_nodes|proxy_nodes) cat "$SANDBOX/fix/$m.json" 2>/dev/null || echo '{"nodes":[]}' ;;
    vless_probe|hysteria2_probe|proxy_probe)
        node="$(printf '%s' "$req" | sed -n 's/.*"node":\([0-9-]*\).*/\1/p')"
        echo "$m $node start $(date +%s%N)" >> "$SANDBOX/probes.log"
        sleep "$(cat "$SANDBOX/fix/delay" 2>/dev/null || echo 0)"
        echo "$m $node end $(date +%s%N)" >> "$SANDBOX/probes.log"
        r="$(cat "$SANDBOX/fix/probe.$m.$node" 2>/dev/null || echo 'fail нет ответа')"
        case "$r" in
            ok*) set -- $r; printf '{"output":"","results":[{"ok":true,"handshake_ms":%s,"ttfb_ms":%s}],"working":1}\n' "${3:--1}" "${2:--1}" ;;
            *) printf '{"output":"","results":[{"ok":false,"why":"%s"}],"working":0}\n' "${r#fail }" ;;
        esac ;;
    outbound_probe) echo '{"output":"x","code":"ok","state":"ok","ms":10}' ;;
    *) exit 1 ;;
esac
EOF
cat > "$T/bin/logger" <<'EOF'
#!/bin/sh
shift 2 2>/dev/null || true
printf '%s\n' "$*" >> "$SANDBOX/log.txt"
EOF
chmod +x "$T/bin"/*

. "$ROOT/tests/stub/plugins-env.sh"
plugins_provision "$T/plugins" node-check
PD="$T/plugins/lib/node-check"; CONF="$T/plugins/conf/node-check"; RUN="$T/plugins/state/node-check"
mkdir -p "$CONF"
cat > "$T/bin/runplugin" <<'EOT'
#!/bin/sh
. "$PLUGIN_SH"
plugin_export_env "$1"; shift
exec sh "$@"
EOT
chmod +x "$T/bin/runplugin"
pl() {
    env SANDBOX="$T" PATH="$T/bin:$PATH" JSHN_SH="$ROOT/tests/stub/jshn.sh" RPCD_BIN="$T/bin/rpcd-fake" \
        RPCD_LIB="$ROOT/files/usr/lib/splify2/rpcd" STEER="$T/bin/steer" STEER_SOCK="$T/none.sock" \
        SPEC="$T/etc/spec.json" LISTS="$T/lists" SUB="$T/etc/sub.txt" SUBS_DIR="$T/etc/subs" \
        UCI_SPLIFY2="$T/etc/config-splify2" UCI_STUB_DB="$T/uci.db" SPLIFY2_LOCK_DIR="$T/lock" \
        GEO_CURL="${GEO_CURL_FIXTURE:-$T/bin/curl}" \
        "$T/bin/runplugin" node-check "$@" 2>"$T/stderr"
}
method() { printf '%s\n' "${2:-{\}}" | pl "$PD/bin/nodecheck" "$1"; }
hook() { printf '{"api":1,"hook":"%s","plugin":"node-check","ctx":%s}\n' "$1" "$2" | pl "$PD/hooks/$3"; }
settings() { printf '%s\n' "$1" > "$CONF/settings.json"; }
waitfor() {  # ПОДПИСКА — ждать конца перебора (не дольше 20 с)
    for _i in $(seq 1 100); do
        [ "$(method nodes_result "{\"sub\":\"$1\"}" | jget state)" != running ] && return 0
        sleep 0.2
    done
}

echo "== страна выхода =="
rm -rf "$RUN/geo"; : > "$T/steer.log"; : > "$T/curl.log"
out="$(method outbound_geo '{"output":"vless"}')"
check "без замера: ответ из кэша (пустого) — cached true, сети не ждём" "vless;true;" "$(printf '%s' "$out" | jget output);$(printf '%s' "$out" | jget cached);$(printf '%s' "$out" | jget cc)"
sleep 1
check "фоновый замер выполнен и записан в кэш" "yes" "$([ -s "$RUN/geo/geo-vless" ] && echo yes || echo no)"
out="$(method outbound_geo '{"output":"vless"}')"
check "теперь страна, адрес и отклик из кэша" "DE;203.0.113.7;123" "$(printf '%s' "$out" | jget cc);$(printf '%s' "$out" | jget ip);$(printf '%s' "$out" | jget ms)"
check "curl привязан к устройству выхода" "yes" "$(grep -q -- '--interface tun0' "$T/curl.log" && echo yes || echo no)"
rm -rf "$RUN/geo"; : > "$T/steer.log"; : > "$T/curl.log"
for _i in 1 2 3 4 5; do method outbound_geo '{"output":"vless"}' >/dev/null; done
sleep 1
check "пять опросов подряд без замера — один фоновый замер" "1" "$(grep -c '^curl' "$T/curl.log")"
# Выход пересоздали — прежний замер не отдаётся.
echo tun9 > "$T/dev"
out="$(method outbound_geo '{"output":"vless"}')"
check "устройство выхода сменилось — прежнюю страну не отдаём" "" "$(printf '%s' "$out" | jget cc)"
sleep 1; echo tun0 > "$T/dev"
# Свежий запрос.
out="$(method outbound_geo '{"output":"vless","fresh":true}')"
check "fresh: замер сейчас, cached false" "DE;false" "$(printf '%s' "$out" | jget cc);$(printf '%s' "$out" | jget cached)"
echo silent > "$T/curl.mode"
out="$(method outbound_geo '{"output":"vless","fresh":true}')"
check "fresh, адрес молчит: прежний замер и причина" "DE;yes" "$(printf '%s' "$out" | jget cc);$(printf '%s' "$out" | jget why | grep -q 'не ответили' && echo yes || echo no)"
rm -f "$T/curl.mode"
out="$(method outbound_geo '{"output":"dead","fresh":true}')"
check "выход не поднят — причина, страны нет" "yes;" "$(printf '%s' "$out" | jget why | grep -q . && echo yes || echo no);$(printf '%s' "$out" | jget cc)"
check "имя выхода с косой — отказ" "false" "$(method outbound_geo '{"output":"a/b"}' | jget ok)"
check "без выхода — отказ" "false" "$(method outbound_geo '{}' | jget ok)"
out="$(GEO_CURL_FIXTURE=/nonexistent/curl method outbound_geo '{"output":"vless"}')"
check "без curl: так и сказано" "false" "$(printf '%s' "$out" | jget curl)"
out="$(GEO_CURL_FIXTURE=/nonexistent/curl method outbound_geo '{"output":"vless","fresh":true}')"
check "без curl, свежий запрос: так и сказано" "false" "$(printf '%s' "$out" | jget curl)"
out="$(method outbound_geo '{"output":"vless"}')"
check "с curl: поля curl нет" "" "$(printf '%s' "$out" | jget curl)"
# Срок свежести — настройка.
settings '{"geo_ttl_s":60,"geo_retry_s":10}'
rm -f "$RUN/geo/geo-vless.try"; : > "$T/curl.log"
printf '%s DE 203.0.113.7 tun0:0 123\n' "$(( $(date -u +%s) - 3600 ))" > "$RUN/geo/geo-vless"
method outbound_geo '{"output":"vless"}' >/dev/null; sleep 1
check "замер старше срока — обновляется в фоне" "1" "$(grep -c '^curl' "$T/curl.log")"
rm -f "$CONF/settings.json"

echo "== перебор узлов =="
cat > "$T/fix/sub_list.json" <<EOF
{"subs":[{"name":"main","kind":"url","path":"$T/etc/sub.txt","present":true},{"name":"hand","kind":"links","path":"$T/etc/subs/hand.txt","present":true},{"name":"empty","kind":"url","path":"$T/etc/subs/empty.txt","present":false}],"hwid":"h"}
EOF
cat > "$T/fix/vless_nodes.json" <<'EOF'
{"output":"","usable":3,"nodes":[{"index":0,"name":"DE one","type":"vless"},{"index":1,"name":"NL two","type":"vless"},{"index":2,"name":"skipped","type":"vless","excluded":true},{"index":3,"name":"FI three","type":"vless"}]}
EOF
cat > "$T/fix/hysteria2_nodes.json" <<'EOF'
{"output":"","nodes":[{"index":0,"name":"PL hy","type":"hysteria2"}]}
EOF
cat > "$T/fix/proxy_nodes.json" <<'EOF'
{"output":"","nodes":[{"index":0,"name":"tj","type":"trojan"},{"index":1,"name":"sk","type":"socks"},{"index":2,"name":"odd","type":"wireguard"}]}
EOF
# Исходы: vless 0 — 120 мс, vless 1 — отказ, vless 3 — 80 мс (ttfb), hy 0 — рукопожатие 60 мс (ttfb -1), proxy 0 — отказ, proxy 1 — 200.
echo "ok 120 5" > "$T/fix/probe.vless_probe.0"
echo "fail таймаут узла" > "$T/fix/probe.vless_probe.1"
echo "ok 80 5" > "$T/fix/probe.vless_probe.3"
echo "ok -1 60" > "$T/fix/probe.hysteria2_probe.0"
echo "fail отказ рукопожатия" > "$T/fix/probe.proxy_probe.0"
echo "ok -1 200" > "$T/fix/probe.proxy_probe.1"
rm -f "$T/fix/delay"
check "до первого перебора: state none" "none" "$(method nodes_result '{"sub":"main"}' | jget state)"
out="$(method nodes_check '{"sub":"main"}')"
check "nodes_check: запущен" "true;true" "$(printf '%s' "$out" | jget started);$(printf '%s' "$out" | jget running)"
waitfor main
out="$(method nodes_result '{"sub":"main"}')"
check "итог: перебор завершён" "done" "$(printf '%s' "$out" | jget state)"
check "узлов шесть (исключённый и чужой протокол не входят)" "6;6;4" "$(printf '%s' "$out" | jget total);$(printf '%s' "$out" | jget done);$(printf '%s' "$out" | jget ok_count)"
check "лучший — самый быстрый из ответивших: hysteria2, 60 мс (рукопожатие)" "PL hy;hysteria2;60" \
      "$(printf '%s' "$out" | jget best.name);$(printf '%s' "$out" | jget best.proto);$(printf '%s' "$out" | jget best.ms)"
check "первая причина отказа названа" "таймаут узла" "$(printf '%s' "$out" | jget why)"
check "у VLESS меряется ответ через туннель (ttfb), у прокси — рукопожатие" "120;200" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; n=json.load(sys.stdin)["nodes"]; print(next(x["ms"] for x in n if x["name"]=="DE one"))');$(printf '%s' "$out" | python3 -c 'import json,sys; n=json.load(sys.stdin)["nodes"]; print(next(x["ms"] for x in n if x["name"]=="sk"))')"
check "у узла-отказа — checked, ok false, причина" "true;false;yes" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; n=json.load(sys.stdin)["nodes"]; x=next(x for x in n if x["name"]=="NL two"); print("%s;%s;%s" % (str(x["checked"]).lower(), str(x["ok"]).lower(), "yes" if "таймаут" in x["why"] else "no"))')"
check "прокси проверяется по сквозному номеру файла" "1" "$(grep -c '^proxy_probe 1 start' "$T/probes.log")"
out="$(method nodes_best '{"sub":"main"}')"
check "nodes_best: лучший узел с протоколом и номером" "true;PL hy;hysteria2;0;60;true" \
      "$(printf '%s' "$out" | jget found);$(printf '%s' "$out" | jget name);$(printf '%s' "$out" | jget proto);$(printf '%s' "$out" | jget index);$(printf '%s' "$out" | jget ms);$(printf '%s' "$out" | jget complete)"

echo "== параллелизм, отмена, отказы =="
: > "$T/probes.log"; echo 1 > "$T/fix/delay"
settings '{"parallel":2}'
method nodes_check '{"sub":"main"}' >/dev/null
out="$(method nodes_check '{"sub":"main"}')"
check "второй запуск при идущем переборе не стартует" "false;true" "$(printf '%s' "$out" | jget started);$(printf '%s' "$out" | jget running)"
waitfor main
check "одновременно не больше настройки parallel" "2" "$(python3 - "$T/probes.log" <<'PY'
import sys
ev = []
for l in open(sys.argv[1]):
    m, node, kind, t = l.split()
    ev.append((int(t), 1 if kind == "start" else -1))
cur = mx = 0
for t, d in sorted(ev):
    cur += d; mx = max(mx, cur)
print(mx)
PY
)"
: > "$T/probes.log"; settings '{"parallel":1}'
method nodes_check '{"sub":"main"}' >/dev/null
sleep 1.5
out="$(method nodes_cancel '{"sub":"main"}')"
check "cancel: идущий перебор остановлен" "true" "$(printf '%s' "$out" | jget cancelled)"
waitfor main
out="$(method nodes_result '{"sub":"main"}')"
check "остановленный перебор не дошёл до конца" "yes" "$([ "$(printf '%s' "$out" | jget done)" -lt 6 ] && echo yes || echo no)"
check "cancel без перебора — cancelled false" "false" "$(method nodes_cancel '{"sub":"main"}' | jget cancelled)"
rm -f "$T/fix/delay" "$CONF/settings.json"
check "подписки нет — отказ" "false" "$(method nodes_check '{"sub":"nothere"}' | jget ok)"
check "подписка ещё не скачана — отказ" "false" "$(method nodes_check '{"sub":"empty"}' | jget ok)"
check "имя с косой — отказ" "false" "$(method nodes_check '{"sub":"a/b"}' | jget ok)"
check "nodes_best без перебора — отказ" "false" "$(method nodes_best '{"sub":"hand"}' | jget ok)"
check "неизвестный метод — код 2" "2" "$(printf '{}\n' | pl "$PD/bin/nodecheck" nothing >/dev/null; echo $?)"

echo "== задача check-nodes =="
rm -rf "$RUN/check"; : > "$T/probes.log"
pl "$PD/bin/check-nodes" </dev/null
check "интервал не задан — ничего не перебирает" "0" "$(grep -c start "$T/probes.log")"
settings '{"interval":30}'
pl "$PD/bin/check-nodes" </dev/null
check "интервал задан — перебрана подписка с файлом (не ссылки, не нескачанная — только main, hand — links тоже имеет файл)" "yes" "$([ -e "$RUN/check/main/done" ] && echo yes || echo no)"
n1="$(grep -c start "$T/probes.log")"
pl "$PD/bin/check-nodes" </dev/null
check "повторный тик в пределах интервала не перебирает заново" "$n1" "$(grep -c start "$T/probes.log")"
echo $(( $(date -u +%s) - 7200 )) > "$RUN/check/main/done"
pl "$PD/bin/check-nodes" </dev/null
check "интервал вышел — перебор заново" "yes" "$([ "$(grep -c start "$T/probes.log")" -gt "$n1" ] && echo yes || echo no)"
check "пока нескачанной подписки нет файла, её не трогают" "no" "$([ -e "$RUN/check/empty" ] && echo yes || echo no)"
rm -f "$CONF/settings.json"

echo "== архив настроек, отчёт, чистка =="
settings '{"parallel":4}'
check "export: настройки плагина" "yes" "$(hook backup_sections '{"op":"export"}' backup | jget sections.settings | grep -q parallel && echo yes || echo no)"
check "restore: настройка записана службой хоста" "2" \
      "$(hook backup_sections '{"op":"restore","sections":{"settings":"{\"parallel\":2}"}}' backup >/dev/null; python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["parallel"])' "$CONF/settings.json")"
check "check: чужой раздел отвергнут" "false" "$(hook backup_sections '{"op":"check","sections":{"zzz":"x"}}' backup | jget ok)"
out="$(hook support_report '{}' support)"
check "support_report: раздел с текстом" "node-check;yes" "$(printf '%s' "$out" | jget section.title);$(printf '%s' "$out" | jget section.text | grep -q 'parallel: 2' && echo yes || echo no)"
hook purge '{"dry_run":false,"keep_config":true}' purge >/dev/null
check "purge: замеры и переборы убраны, настройки остались" "no;yes" "$([ -e "$RUN/check" ] && echo yes || echo no);$([ -e "$CONF/settings.json" ] && echo yes || echo no)"

echo
if [ "$fails" -gt 0 ]; then echo "ЕСТЬ ПРОВАЛЫ: $fails"; exit 1; fi
echo "плагин node-check работает"
