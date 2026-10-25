#!/bin/sh
# Стенд плагина autoapply (plugins/autoapply): автоприменение на роутере — хук после записи спеки, отложенное применение с
# паузой, задача sweep, события, методы status/now/cancel, архив настроек.
#
# Плагин пользуется каркасом только через службы хоста (`spec get [--applied]`, `apply`, `settings`); хост здесь настоящий,
# а применение (метод apply каркаса) — двойник с журналом и исходом по команде APPLY_OUT: ok, reject (ядро отвергло, код 1),
# busy (не состоялось, код 3).
#
# Запуск: sh tests/autoapplymatch.sh (нужен python3 — заглушки jsonfilter и jshn).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d /tmp/autoapplymatch.XXXXXX)"
trap 'rm -rf "$T"' EXIT INT TERM
mkdir -p "$T/bin" "$T/etc" "$T/lock" "$T/lists"

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
# Применение: исход по APPLY_OUT, каждое обращение — строка в журнале. Успех кладёт снимок применённого (как настоящий apply).
cat > "$T/bin/rpcd-apply" <<'EOF'
#!/bin/sh
echo "apply" >> "$SANDBOX/apply.log"
case "$(cat "$SANDBOX/apply.mode" 2>/dev/null || echo ok)" in
    ok)     cp "$SANDBOX/etc/spec.json" "$SANDBOX/etc/spec.applied.json"; echo '{"ok":true,"output":"applied"}' ;;
    reject) echo '{"ok":false,"output":"cannot read a list"}' ;;
    busy)   echo '{"ok":false,"error":"ядро занято: podkop"}' ;;
esac
EOF
cat > "$T/bin/logger" <<'EOF'
#!/bin/sh
shift 2 2>/dev/null || true
printf '%s\n' "$*" >> "$SANDBOX/log.txt"
EOF
chmod +x "$T/bin"/*

. "$ROOT/tests/stub/plugins-env.sh"
plugins_provision "$T/plugins" autoapply
PD="$T/plugins/lib/autoapply"; CONF="$T/plugins/conf/autoapply"; RUN="$T/plugins/state/autoapply"
mkdir -p "$CONF" "$RUN"; chmod 700 "$RUN"
cat > "$T/bin/runplugin" <<'EOT'
#!/bin/sh
. "$PLUGIN_SH"
plugin_export_env "$1"; shift
exec sh "$@"
EOT
chmod +x "$T/bin/runplugin"
pl() {  # ПРОГРАММА [АРГУМЕНТЫ…] — со стандартного ввода
    env SANDBOX="$T" PATH="$T/bin:$PATH" JSHN_SH="$ROOT/tests/stub/jshn.sh" RPCD_BIN="$T/bin/rpcd-apply" \
        RPCD_LIB="$ROOT/files/usr/lib/splify2/rpcd" STEER="$T/bin/steer" STEER_SOCK="$T/none.sock" \
        SPEC="$T/etc/spec.json" APPLIED="$T/etc/spec.applied.json" LISTS="$T/lists" SUB="$T/etc/sub.txt" \
        SUBS_DIR="$T/etc/subs" UCI_SPLIFY2="$T/etc/config-splify2" UCI_STUB_DB="$T/uci.db" SPLIFY2_LOCK_DIR="$T/lock" \
        SPLIFY2_EVENT="${EV:-}" "$T/bin/runplugin" autoapply "$@" 2>"$T/stderr"
}
method() { printf '%s\n' "${2:-{\}}" | pl "$PD/bin/autoapply" "$1"; }
hook() { printf '{"api":1,"hook":"%s","plugin":"autoapply","ctx":%s}\n' "$1" "$2" | pl "$PD/hooks/$3"; }
applies() { grep -c '^apply' "$T/apply.log" 2>/dev/null; }
set_spec() { printf '{"version":2,"outputs":{"direct":{"kind":"direct"}},"n":%s}\n' "$1" > "$T/etc/spec.json"; }
settings() { printf '%s\n' "$1" > "$CONF/settings.json"; }
reset() { : > "$T/apply.log"; rm -f "$RUN/pending" "$RUN/last.json" "$RUN/failed-sum" "$RUN/spec."*; echo ok > "$T/apply.mode"; }

set_spec 1; cp "$T/etc/spec.json" "$T/etc/spec.applied.json"; reset

echo "== выключено: ничего не происходит =="
set_spec 2
out="$(hook post_spec_set '{"rev":"r1"}' spec-saved)"
check "хук отвечает ok" "true" "$(printf '%s' "$out" | jget ok)"
check "по умолчанию автоприменение выключено — метки нет" "no" "$([ -e "$RUN/pending" ] && echo yes || echo no)"
sleep 3
check "и применения не было" "0" "$(applies)"
out="$(method autoapply_status)"
check "status: выключено, есть неприменённое" "true;false;true" "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget enabled);$(printf '%s' "$out" | jget unapplied)"
reset; : > "$T/log.txt"
check "sweep при выключенном ничего не применяет" "0" "$(pl "$PD/bin/sweep" </dev/null; applies)"

echo "== включено: применяет через паузу, подряд идущие правки — одним применением =="
settings '{"enabled":true,"pause_s":1}'
reset
hook post_spec_set '{"rev":"a"}' spec-saved >/dev/null
check "хук поставил метку ожидания" "yes" "$([ -s "$RUN/pending" ] && echo yes || echo no)"
check "status: ждёт применения" "true" "$(method autoapply_status | jget pending)"
set_spec 3; hook post_spec_set '{"rev":"b"}' spec-saved >/dev/null
sleep 3
check "две правки подряд — одно применение" "1" "$(applies)"
check "метка снята, исход записан" "no;true;pause" "$([ -e "$RUN/pending" ] && echo yes || echo no);$(method autoapply_status | jget last.ok);$(method autoapply_status | jget last.source)"
check "после применения неприменённого нет" "false" "$(method autoapply_status | jget unapplied)"
reset
hook post_spec_set '{"rev":"c"}' spec-saved >/dev/null
sleep 3
check "применять нечего (спека равна применённой) — роутер не трогаем" "0" "$(applies)"

echo "== пауза и отмена =="
settings '{"enabled":true,"pause_s":2}'
set_spec 4; reset
hook post_spec_set '{"rev":"d"}' spec-saved >/dev/null
out="$(method autoapply_cancel)"
check "cancel: ожидающее применение отменено" "true" "$(printf '%s' "$out" | jget cancelled)"
sleep 4
check "отменённое не применяется" "0" "$(applies)"
check "cancel без ожидающего — cancelled false" "false" "$(method autoapply_cancel | jget cancelled)"

echo "== autoapply_now =="
reset
out="$(method autoapply_now)"
check "now: применено сразу, без паузы" "true;true;1" "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget applied);$(applies)"
out="$(method autoapply_now)"
check "now: применять нечего — applied false" "true;false;1" "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget applied);$(applies)"

echo "== sweep: сохранённое и не применённое =="
settings '{"enabled":true,"pause_s":1}'
set_spec 5; reset
pl "$PD/bin/sweep" </dev/null
check "sweep применил то, что лежало неприменённым" "1" "$(applies)"
set_spec 6; reset; echo reject > "$T/apply.mode"
pl "$PD/bin/sweep" </dev/null
check "ядро отвергло: код 1, исход записан с причиной" "false;1;yes" "$(method autoapply_status | jget last.ok);$(jget rc < "$RUN/last.json");$(method autoapply_status | jget last.message | grep -q 'cannot read' && echo yes || echo no)"
pl "$PD/bin/sweep" </dev/null
check "отвергнутое повторно не применяется, пока спека та же" "1" "$(applies)"
check "status называет это: rejected" "true" "$(method autoapply_status | jget rejected)"
set_spec 7; echo ok > "$T/apply.mode"
pl "$PD/bin/sweep" </dev/null
check "спека изменилась — sweep пробует снова" "2" "$(applies)"
set_spec 8; reset; echo busy > "$T/apply.mode"
pl "$PD/bin/sweep" </dev/null; pl "$PD/bin/sweep" </dev/null
check "не состоялось (ядро занято) — sweep повторяет" "2" "$(applies)"
echo ok > "$T/apply.mode"
settings '{"enabled":true,"sweep":false}'
set_spec 9; reset
pl "$PD/bin/sweep" </dev/null
check "настройка sweep выключена — задача молчит" "0" "$(applies)"
settings '{"enabled":true,"pause_s":1}'
printf 'tok %s\n' "$(date -u +%s)" > "$RUN/pending"
pl "$PD/bin/sweep" </dev/null
check "пока идёт пауза, sweep не вмешивается" "0" "$(applies)"
rm -f "$RUN/pending"

echo "== события =="
echo 1 > "$RUN/failed-sum"
printf '{"api":1,"event":{"ev":"applied"}}\n' | EV=applied pl "$PD/hooks/event"
check "applied снимает память об отвергнутом" "no" "$([ -e "$RUN/failed-sum" ] && echo yes || echo no)"
check "событие записано" "applied" "$(cut -d' ' -f1 "$RUN/last-event")"

echo "== архив настроек, отчёт, чистка =="
settings '{"enabled":true,"pause_s":7}'
out="$(hook backup_sections '{"op":"export"}' backup)"
check "export: настройки плагина разделом settings" "yes" "$(printf '%s' "$out" | jget sections.settings | grep -q pause_s && echo yes || echo no)"
check "check: годное принято, чужой раздел отвергнут" "true;false" "$(hook backup_sections '{"op":"check","sections":{"settings":"{\"pause_s\":3}"}}' backup | jget ok);$(hook backup_sections '{"op":"check","sections":{"zzz":"x"}}' backup | jget ok)"
hook backup_sections '{"op":"restore","sections":{"settings":"{\"pause_s\":3}"}}' backup >/dev/null
check "restore: настройка записана службой хоста" "3" "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["pause_s"])' "$CONF/settings.json")"
out="$(hook support_report '{}' support)"
check "support_report: раздел с текстом" "autoapply;yes" "$(printf '%s' "$out" | jget section.title);$(printf '%s' "$out" | jget section.text | grep -q 'auto-apply: on' && echo yes || echo no)"
out="$(hook purge '{"dry_run":true,"keep_config":false}' purge)"
check "purge --dry: называет настройки, ничего не убирает" "yes;yes" "$(printf '%s' "$out" | grep -q settings.json && echo yes || echo no);$([ -e "$CONF/settings.json" ] && echo yes || echo no)"
hook purge '{"dry_run":false,"keep_config":false}' purge >/dev/null
check "purge: настройки убраны" "no" "$([ -e "$CONF/settings.json" ] && echo yes || echo no)"
check "неизвестный метод — код 2" "2" "$(printf '{}\n' | pl "$PD/bin/autoapply" nothing >/dev/null; echo $?)"

echo
if [ "$fails" -gt 0 ]; then echo "ЕСТЬ ПРОВАЛЫ: $fails"; exit 1; fi
echo "плагин autoapply работает"
