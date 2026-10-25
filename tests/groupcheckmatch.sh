#!/bin/sh
# Стенд плагина group-check (plugins/group-check): приговор по каждому члену группы, подсказка «член мёртв», история
# отказов и переключений, расписание, архив настроек.
#
# Плагин пользуется каркасом только через службы хоста (`spec get`, `call outbound_probe`, `settings`); хост настоящий, за
# ним — двойник обработчика методов каркаса: исход пробы члена задаётся файлом probe.<выход> («ok мс», «fail»,
# «nodev»).
#
# Запуск: sh tests/groupcheckmatch.sh (нужен python3 — заглушки jsonfilter и jshn).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d /tmp/groupcheckmatch.XXXXXX)"
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
cat > "$T/bin/steer" <<'EOF'
#!/bin/sh
if [ "${1:-}" = spec ] && [ "${2:-}" = convert ]; then
    shift 2; _f=""
    while [ $# -gt 0 ]; do case "$1" in --spec) _f="$2"; shift ;; esac; shift; done
    if [ "$_f" = - ]; then cat; else cat "$_f"; fi
    exit 0
fi
exit 0
EOF
cat > "$T/bin/rpcd-fake" <<'EOF'
#!/bin/sh
read -r req
[ "$2" = outbound_probe ] || exit 1
o="$(printf '%s' "$req" | sed -n 's/.*"output":"\([^"]*\)".*/\1/p')"
echo "$o" >> "$SANDBOX/probes.log"
case "$(cat "$SANDBOX/fix/probe.$o" 2>/dev/null || echo nodev)" in
    ok*) set -- $(cat "$SANDBOX/fix/probe.$o"); printf '{"output":"%s","code":"ok","state":"ok","ms":%s}\n' "$o" "${2:-10}" ;;
    fail) printf '{"output":"%s","code":"no_answer","state":"нет ответа","ms":-1}\n' "$o" ;;
    *) printf '{"output":"%s","code":"no_device","state":"нет устройства","ms":-1}\n' "$o" ;;
esac
EOF
cat > "$T/bin/logger" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$T/bin"/*
cat > "$T/etc/spec.json" <<'EOF'
{"version":2,"outputs":{
 "a":{"kind":"interface","device":"wg0"},
 "b":{"kind":"interface","device":"wg1"},
 "c":{"kind":"tunnel","protocol":"vless"},
 "gA":{"kind":"group","pick":"latency","members":["a","b","c"]},
 "g2":{"kind":"group","pick":"order","members":["gA","a"]},
 "direct":{"kind":"direct"}}}
EOF
echo "ok 20" > "$T/fix/probe.a"; echo "ok 40" > "$T/fix/probe.b"; echo "ok 60" > "$T/fix/probe.c"

. "$ROOT/tests/stub/plugins-env.sh"
plugins_provision "$T/plugins" group-check
PD="$T/plugins/lib/group-check"; CONF="$T/plugins/conf/group-check"; RUN="$T/plugins/state/group-check"
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
        "$T/bin/runplugin" group-check "$@" 2>"$T/stderr"
}
method() { printf '%s\n' "${2:-{\}}" | pl "$PD/bin/groupcheck" "$1"; }
runhook() { printf '{"api":1,"hook":"%s","plugin":"group-check","ctx":%s}\n' "$1" "$2" | pl "$PD/hooks/$3"; }
event() { printf '{"api":1,"event":%s}\n' "$1" | pl "$PD/hooks/event"; }
settings() { printf '%s\n' "$1" > "$CONF/settings.json"; }
member() {  # ГРУППА ЧЛЕН ПОЛЕ
    method group_status "{\"group\":\"$1\"}" | python3 -c 'import json,sys
d=json.load(sys.stdin)["groups"][0]["members"]
print(next(m for m in d if m["name"]==sys.argv[1]).get(sys.argv[2], ""))' "$2" "$3"
}

echo "== до первой проверки =="
out="$(method group_status)"
check "обе группы спеки найдены, члены в порядке предпочтения" "gA,g2;a b c;3" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; print(",".join(g["name"] for g in json.load(sys.stdin)["groups"]))');$(printf '%s' "$out" | python3 -c 'import json,sys; print(" ".join(m["name"] for m in json.load(sys.stdin)["groups"][0]["members"]))');$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["groups"][0]["total"])')"
check "приговор неизвестен, пока не проверяли" "unknown" "$(member gA a verdict)"
check "подсказок нет" "0" "$(printf '%s' "$out" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["hints"]))')"

echo "== проверка и приговор =="
: > "$T/probes.log"
out="$(method group_check '{"group":"gA"}')"
check "group_check: одна группа проверена" "true;1" "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget checked)"
check "пробованы члены gA, но не соседняя группа" "a b c" "$(tr '\n' ' ' < "$T/probes.log" | sed 's/ $//')"
check "ответившие — alive с откликом" "alive;20;alive;40" "$(member gA a verdict);$(member gA a ms);$(member gA b verdict);$(member gA b ms)"
echo fail > "$T/fix/probe.b"
method group_check '{"group":"gA"}' >/dev/null
check "один отказ — unstable, серия 1" "unstable;1" "$(member gA b verdict);$(member gA b failures)"
method group_check '{"group":"gA"}' >/dev/null
check "два отказа — всё ещё unstable" "unstable;2" "$(member gA b verdict);$(member gA b failures)"
method group_check '{"group":"gA"}' >/dev/null
check "три отказа подряд — dead" "dead;3" "$(member gA b verdict);$(member gA b failures)"
out="$(method group_status '{"group":"gA"}')"
check "подсказка: член мёртв" "member_dead;gA;b" "$(printf '%s' "$out" | python3 -c 'import json,sys; h=json.load(sys.stdin)["hints"][0]; print("%s;%s;%s" % (h["code"],h["group"],h["member"]))')"
check "живых из трёх — два" "2;3" "$(printf '%s' "$out" | python3 -c 'import json,sys; g=json.load(sys.stdin)["groups"][0]; print("%s;%s" % (g["alive"], g["total"]))')"
check "без устройства (c — туннель без устройства в фикстуре) — unknown, не отказ" "unknown" "$(echo nodev > "$T/fix/probe.c"; method group_check '{"group":"gA"}' >/dev/null; member gA c verdict)"
echo "ok 30" > "$T/fix/probe.b"
method group_check '{"group":"gA"}' >/dev/null
check "член ожил — alive, серия обнулена, подсказки нет" "alive;0;0" "$(member gA b verdict);$(member gA b failures);$(method group_status '{"group":"gA"}' | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["hints"]))')"
settings '{"dead_after":1}'
echo fail > "$T/fix/probe.a"
method group_check '{"group":"gA"}' >/dev/null
check "dead_after — настройка: один отказ — уже dead" "dead" "$(member gA a verdict)"
rm -f "$CONF/settings.json"; echo "ok 20" > "$T/fix/probe.a"; method group_check '{"group":"gA"}' >/dev/null
check "вложенная группа в g2 не пробуется, обычный член — да" "unknown;alive" "$(method group_check '{"group":"g2"}' >/dev/null; member g2 gA verdict);$(member g2 a verdict)"
check "группы нет — отказ" "false" "$(method group_check '{"group":"nothere"}' | jget ok)"
check "имя с косой — отказ" "false" "$(method group_status '{"group":"a/b"}' | jget ok)"

echo "== история =="
out="$(method group_history '{"group":"gA"}')"
check "переходы приговоров записаны по порядку" "yes" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys
t=[e["text"] for e in json.load(sys.stdin)["entries"]]
i=[k for k,x in enumerate(t) if x.startswith("b: alive -> unstable")]
j=[k for k,x in enumerate(t) if x.startswith("b: unstable -> dead")]
l=[k for k,x in enumerate(t) if x.startswith("b: dead -> alive")]
print("yes" if i and j and l and i[0]<j[0]<l[0] else "no: %r" % t)')"
event '{"v":1,"ev":"switched","out":"gA","from":"wg0","to":"wg1","why":"latency","member":"b"}'
event '{"v":1,"ev":"failed","out":"gA","why":"all members down"}'
event '{"v":1,"ev":"switched","out":"direct","from":null,"to":"x","why":"x"}'
out="$(method group_history '{"group":"gA","limit":2}')"
check "события ядра: switched с членом и причиной, failed" "2;switched;b (latency);failed" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; e=json.load(sys.stdin)["entries"]; print("%d;%s;%s;%s" % (len(e), e[0]["kind"], e[0]["text"], e[1]["kind"]))')"
check "событие чужого (не группового) выхода в историю не попадает" "no" "$([ -e "$RUN/groups/direct" ] && echo yes || echo no)"
check "group_history без группы — отказ" "false" "$(method group_history '{}' | jget ok)"
settings '{"history":10}'
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do event "{\"v\":1,\"ev\":\"switched\",\"out\":\"gA\",\"member\":\"m$i\",\"why\":\"x\"}"; done
check "история обрезается до настройки history" "10" "$(grep -c . "$RUN/groups/gA/history")"
check "и последние остались" "yes" "$(tail -1 "$RUN/groups/gA/history" | grep -q m15 && echo yes || echo no)"
rm -f "$CONF/settings.json"

echo "== расписание: задача check-groups =="
rm -rf "$RUN/groups"; : > "$T/probes.log"
settings '{"enabled":false}'
pl "$PD/bin/check-groups" </dev/null
check "выключено — ничего не пробует" "0" "$(grep -c . "$T/probes.log")"
rm -f "$CONF/settings.json"
pl "$PD/bin/check-groups" </dev/null
check "включено — пробованы члены обеих групп" "yes" "$([ "$(grep -c . "$T/probes.log")" -ge 5 ] && echo yes || echo no)"
n="$(grep -c . "$T/probes.log")"
pl "$PD/bin/check-groups" </dev/null
check "повторный тик сразу же — интервал не вышел, не пробует" "$n" "$(grep -c . "$T/probes.log")"
settings '{"interval":60}'
echo $(( $(date -u +%s) - 600 )) > "$RUN/groups/gA/checked"
pl "$PD/bin/check-groups" </dev/null
check "интервал 60 минут, прошло 10 — по-прежнему не пробует" "$n" "$(grep -c . "$T/probes.log")"
settings '{"interval":5}'
echo $(( $(date -u +%s) - 600 )) > "$RUN/groups/gA/checked"
pl "$PD/bin/check-groups" </dev/null
check "интервал вышел — группа проверена заново" "yes" "$([ "$(grep -c . "$T/probes.log")" -gt "$n" ] && echo yes || echo no)"
rm -f "$CONF/settings.json"

echo "== архив настроек, отчёт, чистка =="
settings '{"dead_after":4}'
check "export: настройки плагина" "yes" "$(runhook backup_sections '{"op":"export"}' backup | jget sections.settings | grep -q dead_after && echo yes || echo no)"
check "restore: настройка записана службой хоста" "2" \
      "$(runhook backup_sections '{"op":"restore","sections":{"settings":"{\"dead_after\":2}"}}' backup >/dev/null; python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["dead_after"])' "$CONF/settings.json")"
check "check: чужой раздел отвергнут" "false" "$(runhook backup_sections '{"op":"check","sections":{"zzz":"x"}}' backup | jget ok)"
out="$(runhook support_report '{}' support)"
check "support_report: раздел с числом групп и мёртвых" "group-check;yes" "$(printf '%s' "$out" | jget section.title);$(printf '%s' "$out" | jget section.text | grep -q 'groups checked: 2' && echo yes || echo no)"
runhook purge '{"dry_run":false,"keep_config":true}' purge >/dev/null
check "purge: приговоры убраны, настройки остались" "no;yes" "$([ -e "$RUN/groups" ] && echo yes || echo no);$([ -e "$CONF/settings.json" ] && echo yes || echo no)"
check "неизвестный метод — код 2" "2" "$(printf '{}\n' | pl "$PD/bin/groupcheck" nothing >/dev/null; echo $?)"

echo
if [ "$fails" -gt 0 ]; then echo "ЕСТЬ ПРОВАЛЫ: $fails"; exit 1; fi
echo "плагин group-check работает"
