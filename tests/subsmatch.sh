#!/bin/sh
# Стенд плагина subscriptions (plugins/subscriptions): расписание автообновления, остаток трафика, своё название, поля к
# ответам sub_list/sub_info (хук sub_fields), архив настроек, чистка следов.
#
# Плагин пользуется каркасом только через API: службы хоста (`splify2-host sub …`, `settings`) и библиотеку SPLIFY2_LIB.
# Поэтому здесь хост настоящий, а за ним — заглушка обработчика методов каркаса с журналом вызовов (службы `sub …`
# хоста проверяет hostmatch.sh). Задание крона само ничего не
# качает — проверять надо ровно одно: КОГО оно позвало и кого не тронуло.
#
# Запуск: sh tests/subsmatch.sh (нужен python3 — заглушки jsonfilter и jshn).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d /tmp/subsmatch.XXXXXX)"
trap 'rm -rf "$T"' EXIT INT TERM
mkdir -p "$T/bin" "$T/etc/subs" "$T/lock" "$T/lists"

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
. "$ROOT/tests/stub/plugins-env.sh"
plugins_provision "$T/plugins" subscriptions
PD="$T/plugins/lib/subscriptions"; CONF="$T/plugins/conf/subscriptions"; RUN="$T/plugins/state/subscriptions"
mkdir -p "$CONF"

# Обработчик методов каркаса (его вызывает служба хоста `sub list|info|refresh`): перечень подписок берётся из файла, остальное
# протоколируется. Отказ объекта — UBUS_LIST_RC, отказ обновления — UBUS_REFRESH_RC / UBUS_REFRESH_FAIL.
cat > "$T/bin/rpcd-fake" <<'EOF'
#!/bin/sh
# call <метод>, запрос — стандартный ввод
read -r req
printf '%s %s\n' "$2" "$req" >> "$SANDBOX/ubus.log"
case "$2" in
    sub_list)
        [ "${UBUS_LIST_RC:-0}" = 0 ] || exit "$UBUS_LIST_RC"
        cat "$SANDBOX/sub_list.json" ;;
    sub_info)
        n="$(printf '%s' "$req" | sed -n 's/.*"name":"\([^"]*\)".*/\1/p')"
        k="$(sed -n "s/^$n //p" "$SANDBOX/kinds")"
        [ -n "$k" ] || { printf '{"name":"%s","kind":"none"}\n' "$n"; exit 0; }
        printf '{"name":"%s","kind":"%s"}\n' "$n" "$k" ;;
    sub_refresh)
        [ "${UBUS_REFRESH_RC:-0}" = 0 ] || { printf 'отказ\n'; exit "$UBUS_REFRESH_RC"; }
        [ "${UBUS_REFRESH_FAIL:-}" = 1 ] && { printf '{"ok":false,"error":"подписка не скачалась: нет сети"}\n'; exit 0; }
        printf '{"ok":true,"changed":%s,"usable":3}\n' "${UBUS_CHANGED:-false}" ;;
    *) exit 1 ;;
esac
exit 0
EOF
cat > "$T/bin/logger" <<'EOF'
#!/bin/sh
shift 2 2>/dev/null || true
printf '%s\n' "$*" >> "$SANDBOX/log.txt"
EOF
# Остаток трафика: заглушка ядра пишет файл --info, как его пишет `steer sub-quota`.
cat > "$T/bin/steer" <<'EOF'
#!/bin/sh
echo "$*" >> "$SANDBOX/steer.log"
case "${1:-}" in
    sub-quota)
        shift; _i=""
        while [ $# -gt 0 ]; do case "$1" in --info) _i="$2"; shift ;; esac; shift; done
        printf 'upload=1\ndownload=2\ntotal=10\nexpire=1900000000\nat=%s\n' "$(date -u +%s)" > "$_i" ;;
esac
exit 0
EOF
chmod +x "$T/bin"/*

# Программа плагина так, как её запускает хост: окружение плагина, стенд хоста за SPLIFY2_HOST.
cat > "$T/bin/runplugin" <<'EOT'
#!/bin/sh
. "$PLUGIN_SH"
plugin_export_env "$1"; shift
exec sh "$@"
EOT
chmod +x "$T/bin/runplugin"
pl() {  # ПРОГРАММА [АРГУМЕНТЫ…] — со стандартного ввода
    env SANDBOX="$T" PATH="$T/bin:$PATH" JSHN_SH="$ROOT/tests/stub/jshn.sh" RPCD_BIN="$T/bin/rpcd-fake" \
        RPCD_LIB="$ROOT/files/usr/lib/splify2/rpcd" STEER="$T/bin/steer" STEER_SOCK="$T/none.sock" \
        SPEC="$T/etc/spec.json" LISTS="$T/lists" SUB="$T/etc/sub.txt" SUBS_DIR="$T/etc/subs" \
        UCI_SPLIFY2="$T/etc/config-splify2" UCI_STUB_DB="$T/uci.db" SPLIFY2_LOCK_DIR="$T/lock" \
        UBUS_LIST_RC="${UBUS_LIST_RC:-0}" UBUS_REFRESH_RC="${UBUS_REFRESH_RC:-0}" \
        UBUS_CHANGED="${UBUS_CHANGED:-false}" UBUS_REFRESH_FAIL="${UBUS_REFRESH_FAIL:-}" \
        "$T/bin/runplugin" subscriptions "$@" 2>"$T/stderr"
}
method() {  # МЕТОД [JSON]
    printf '%s\n' "${2:-{\}}" | pl "$PD/bin/subs" "$1"
}
hook() {  # ХУК CTX_JSON
    printf '{"api":1,"hook":"%s","plugin":"subscriptions","ctx":%s}\n' "$1" "$2" | pl "$PD/hooks/$3"
}
now() { date -u +%s; }

# Состав подписок в песочнице: первая — по ссылке, вторая — по ссылкам узлов.
printf 'main url\nhand links\nsecond url\n' > "$T/kinds"
printf 'vless://a\n' > "$T/etc/sub.txt"; printf 'vless://b\n' > "$T/etc/subs/hand.txt"; printf 'vless://c\n' > "$T/etc/subs/second.txt"
UCI="env UCI_STUB_DB=$T/uci.db $T/bin/uci -q"
$UCI set splify2.main.sub_url=https://panel.invalid/s; $UCI set splify2.main.sub_kind=url
$UCI set splify2.sub_hand=subscription; $UCI set splify2.sub_hand.kind=links
$UCI set splify2.sub_second=subscription; $UCI set splify2.sub_second.url=https://two.invalid/s; $UCI set splify2.sub_second.kind=url

echo "== sub_auto: интервал подписки =="
out="$(method sub_auto '{"minutes":60}')"
check "интервал первой подписки записан" "true;main;60" "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget name);$(printf '%s' "$out" | jget auto)"
check "в файле расписания — строка «имя минуты»" "main 60" "$(cat "$CONF/schedule")"
check "отметка попытки поставлена сразу" "yes" "$([ -s "$CONF/stamps/main" ] && echo yes || echo no)"
check "сразу после настройки обновлять не пора (отметка свежая)" "yes" \
      "$(a=$(cat "$CONF/stamps/main"); [ $(( $(now) - a )) -lt 60 ] && echo yes || echo no)"
check "поля uci каркаса не тронуты" "" "$(sed -n 's/^splify2.main.sub_auto=//p' "$T/uci.db")"
out="$(method sub_auto '{"name":"second","minutes":120}')"
check "у второй подписки свой интервал" "true;second;120" "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget name);$(printf '%s' "$out" | jget auto)"
check "в расписании обе" "main 60,second 120" "$(tr '\n' ',' < "$CONF/schedule" | sed 's/,$//')"
out="$(method sub_auto '{"name":"second","minutes":10}')"
check "меньше наименьшего интервала — отказ с числом" "false;yes" "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget error | grep -q 30 && echo yes || echo no)"
out="$(method sub_auto '{"name":"second","minutes":5000}')"
check "больше наибольшего — отказ" "false" "$(printf '%s' "$out" | jget ok)"
check "и прежний интервал остался" "second 120" "$(grep '^second ' "$CONF/schedule")"
check "не число — отказ" "false" "$(method sub_auto '{"name":"second","minutes":"каждый час"}' | jget ok)"
check "подписка из ссылок — обновлять нечем" "false;yes" \
      "$(method sub_auto '{"name":"hand","minutes":60}' | jget ok);$(method sub_auto '{"name":"hand","minutes":60}' | jget error | grep -q 'нечем' && echo yes || echo no)"
check "имя с лишними знаками — отказ" "false" "$(method sub_auto '{"name":"a/b","minutes":60}' | jget ok)"
# Пределы — настройки плагина.
SPLIFY2_HOST_SETTING() { pl "$SPLIFY2_HOST" settings set "$@"; }
printf '{"min_interval":5}\n' > "$CONF/settings.json"
check "наименьший интервал — настройка: пять минут теперь можно" "true" "$(method sub_auto '{"name":"second","minutes":5}' | jget ok)"
printf '{"max_interval":100}\n' > "$CONF/settings.json"
check "наибольший интервал — настройка: 120 уже нельзя" "false" "$(method sub_auto '{"name":"second","minutes":120}' | jget ok)"
rm -f "$CONF/settings.json"
check "ужесточили пределы — прежний интервал вне предела не действует" "0" \
      "$(printf '{"min_interval":100}\n' > "$CONF/settings.json"; hook sub_fields '{"subs":[{"name":"second","kind":"url","present":true,"mtime":0}]}' sub-fields | jget fields.second.auto)"
rm -f "$CONF/settings.json"
out="$(method sub_auto '{"name":"second","minutes":0}')"
check "ноль снимает интервал и отметку" "true;0;no;" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget auto);$([ -e "$CONF/stamps/second" ] && echo yes || echo no);$(grep '^second ' "$CONF/schedule")"
check "первая осталась" "main 60" "$(cat "$CONF/schedule")"
mkdir -p "$T/ro"
check "кончилось место: отказ записи назван отказом" "false" \
      "$(chmod 500 "$CONF"; r="$(method sub_auto '{"name":"second","minutes":60}' | jget ok)"; chmod 700 "$CONF"; [ "$(id -u)" = 0 ] && echo false || echo "$r")"

echo "== sub_fields: поля к ответам sub_list и sub_info =="
echo "main 60" > "$CONF/schedule"; echo "second 120" >> "$CONF/schedule"
echo $(( $(now) - 7200 )) > "$CONF/stamps/second"; echo $(( $(now) - 100 )) > "$CONF/stamps/main"
CTX='{"subs":[{"name":"main","kind":"url","present":true,"mtime":0},{"name":"hand","kind":"links","present":true,"mtime":0},{"name":"second","kind":"url","present":true,"mtime":0}]}'
out="$(hook sub_fields "$CTX" sub-fields)"
check "ответ хука: объект с ok" "true" "$(printf '%s' "$out" | jget ok)"
check "main: интервал есть, срок не вышел" "60;false" "$(printf '%s' "$out" | jget fields.main.auto);$(printf '%s' "$out" | jget fields.main.due)"
check "second: срок вышел — due" "120;true" "$(printf '%s' "$out" | jget fields.second.auto);$(printf '%s' "$out" | jget fields.second.due)"
check "подписка из ссылок: интервал 0, обновлять не пора" "0;false" "$(printf '%s' "$out" | jget fields.hand.auto);$(printf '%s' "$out" | jget fields.hand.due)"
check "время попытки отдаётся" "yes" "$(a="$(printf '%s' "$out" | jget fields.main.auto_at)"; [ "${a:-0}" -gt 0 ] && echo yes || echo no)"
# Свежий файл узлов (ручное «Обновить») отодвигает срок: время файла сильнее отметки.
CTX2="{\"subs\":[{\"name\":\"second\",\"kind\":\"url\",\"present\":true,\"mtime\":$(now)}]}"
check "свежий файл узлов отодвигает срок" "false" "$(hook sub_fields "$CTX2" sub-fields | jget fields.second.due)"
check "пустой список подписок — пустые поля" "true" "$(hook sub_fields '{"subs":[]}' sub-fields | jget ok)"
check "имя подписки с лишними знаками хук пропускает" "" "$(hook sub_fields '{"subs":[{"name":"a b","kind":"url","present":true,"mtime":0}]}' sub-fields | jget 'fields.a b.auto')"

echo "== задание update-subs: кого зовём =="
run() {
    : > "$T/ubus.log"; : > "$T/log.txt"; : > "$T/steer.log"
    pl "$PD/bin/update-subs" >/dev/null 2>&1
}
subs() { printf '{"subs":%s}\n' "$1" > "$T/sub_list.json"; }
refreshed() { grep '^sub_refresh' "$T/ubus.log" | sed 's/^sub_refresh //' | tr '\n' ' ' | sed 's/ $//'; }
echo "main 60" > "$CONF/schedule"; rm -rf "$CONF/stamps"
# 1. Без интервала не ходим никуда.
subs '[{"name":"a","kind":"url","mtime":0}]'
run; check "интервал не задан — не обновляем" "" "$(refreshed)"
# 2. Срок не вышел.
mkdir -p "$CONF/stamps"; echo "main 60" > "$CONF/schedule"; now > "$CONF/stamps/main"
subs '[{"name":"main","kind":"url","mtime":0}]'
run; check "срок не вышел — не обновляем" "" "$(refreshed)"
# 3. Срок вышел — обновляем именно её.
printf 'main 60\nb 30\nc 600\n' > "$CONF/schedule"; echo $(( $(now) - 7200 )) > "$CONF/stamps/main"; now > "$CONF/stamps/b"; now > "$CONF/stamps/c"
subs '[{"name":"main","kind":"url","mtime":0},{"name":"b","kind":"url","mtime":0},{"name":"c","kind":"url","mtime":0}]'
run; check "срок вышел — обновляем именно её" '{"name":"main"}' "$(refreshed)"
check "отметка попытки поставлена до похода наружу" "yes" "$(a=$(cat "$CONF/stamps/main"); [ $(( $(now) - a )) -lt 60 ] && echo yes || echo no)"
# 4. Подписка без отметки и без времени файла.
printf 'new 30\n' > "$CONF/schedule"; rm -rf "$CONF/stamps"
subs '[{"name":"new","kind":"url"}]'
run; check "подписка без отметки не теряется" '{"name":"new"}' "$(refreshed)"
# 5. Подписка из ссылок с записанным интервалом — не обновляем.
printf 'hand 30\n' > "$CONF/schedule"
subs '[{"name":"hand","kind":"links","mtime":0}]'
run; check "ссылки вместо панели — обновлять нечем" "" "$(refreshed)"
# 6. Свежий файл узлов отодвигает срок.
printf 'new 30\n' > "$CONF/schedule"
subs "[{\"name\":\"new\",\"kind\":\"url\",\"mtime\":$(now)}]"
run; check "файл узлов свежее срока — не обновляем" "" "$(refreshed)"
# 7. Объект не отвечает.
subs '[{"name":"new","kind":"url","mtime":0}]'
UBUS_LIST_RC=1 run; check "объект не отвечает — никого не зовём" "" "$(refreshed)"
# 8. Отказ одной не мешает остальным.
printf 'a 30\nb 30\n' > "$CONF/schedule"; rm -rf "$CONF/stamps"
subs '[{"name":"a","kind":"url","mtime":0},{"name":"b","kind":"url","mtime":0}]'
UBUS_REFRESH_RC=1 run
check "отказ одной не отменяет остальных" '{"name":"a"} {"name":"b"}' "$(refreshed)"
check "и о неудаче сказано в журнале" "yes" "$(grep -q 'не обновилась' "$T/log.txt" && echo yes || echo no)"
# 9. Названо, менялись ли узлы.
printf 'a 30\n' > "$CONF/schedule"; rm -rf "$CONF/stamps"; subs '[{"name":"a","kind":"url","mtime":0}]'
UBUS_CHANGED=true run; check "смена узлов названа в журнале" "yes" "$(grep -q 'узлы изменились' "$T/log.txt" && echo yes || echo no)"
rm -rf "$CONF/stamps"; UBUS_CHANGED=false run; check "и неизменность тоже" "yes" "$(grep -q 'узлы прежние' "$T/log.txt" && echo yes || echo no)"
# 10. Отказ метода приходит ответом ok:false с кодом 0.
rm -rf "$CONF/stamps"; UBUS_REFRESH_FAIL=1 run
check "отказ метода назван неудачей, а не обновлением" "yes;no" \
      "$(grep -q 'не обновилась (подписка не скачалась: нет сети)' "$T/log.txt" && echo yes || echo no);$(grep -q 'узлы прежние' "$T/log.txt" && echo yes || echo no)"
# 11. Подписки, которой больше нет, нет и в расписании.
printf 'a 30\ngone 60\n' > "$CONF/schedule"; mkdir -p "$CONF/stamps"; now > "$CONF/stamps/gone"; now > "$CONF/stamps/a"
subs '[{"name":"a","kind":"url","mtime":0}]'
run; check "ушедшая подписка снята из расписания вместе с отметкой" "a 30;no" "$(cat "$CONF/schedule");$([ -e "$CONF/stamps/gone" ] && echo yes || echo no)"
subs '[]'
run; check "подписок нет вовсе — расписание пусто" "no" "$([ -e "$CONF/schedule" ] && echo yes || echo no)"

echo "== остаток трафика =="
out="$(method sub_quota '{"name":"main"}')"
check "sub_quota: ответ службы хоста дословно" "true;url;true;10" "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget kind);$(printf '%s' "$out" | jget asked);$(printf '%s' "$out" | jget quota.total)"
check "и панель спросили ядром" "yes" "$(grep -q '^sub-quota https://panel.invalid/s' "$T/steer.log" && echo yes || echo no)"
check "sub_quota: подписки нет — отказ" "false" "$(method sub_quota '{"name":"nothere"}' | jget ok)"
check "sub_quota: узлы ссылками — не спрашивали" "false" "$(method sub_quota '{"name":"hand"}' | jget asked)"
# По расписанию: только если включено, и не чаще настройки.
printf '[]' > /dev/null
subs '[{"name":"main","kind":"url","mtime":0},{"name":"hand","kind":"links","mtime":0}]'
rm -f "$CONF/schedule"; rm -rf "$CONF/stamps"
run; check "проверка остатка по умолчанию выключена" "0" "$(grep -c '^sub-quota' "$T/steer.log")"
printf '{"quota_interval":60}\n' > "$CONF/settings.json"
run; check "включена — спросили панель, но не ссылки" "1" "$(grep -c '^sub-quota' "$T/steer.log")"
run; check "второй прогон сразу же — не чаще настройки" "0" "$(grep -c '^sub-quota' "$T/steer.log")"
subs "[{\"name\":\"main\",\"kind\":\"url\",\"mtime\":0,\"quota\":{\"at\":$(now)}}]"
rm -rf "$CONF/stamps"; run
check "запомненный ответ панели свежий — не спрашиваем" "0" "$(grep -c '^sub-quota' "$T/steer.log")"
rm -f "$CONF/settings.json"

echo "== sub_rename: своё название =="
out="$(method sub_rename '{"name":"main","title":"Моя подписка"}')"
check "название записано и отдано" "true;main;Моя подписка;Моя подписка" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget name);$(printf '%s' "$out" | jget title);$(sed -n 's/^splify2.main.sub_title=//p' "$T/uci.db")"
check "пустое снимает своё" "true;" "$(method sub_rename '{"name":"main","title":""}' | jget ok);$(sed -n 's/^splify2.main.sub_title=//p' "$T/uci.db")"
check "подписки нет — отказ" "false" "$(method sub_rename '{"name":"nothere","title":"x"}' | jget ok)"
check "слишком длинное — отказ" "false" "$(method sub_rename "{\"name\":\"main\",\"title\":\"$(python3 -c 'print("я" * 101)')\"}" | jget ok)"
check "неизвестный метод — код 2" "2" "$(printf '{}\n' | pl "$PD/bin/subs" nothing >/dev/null; echo $?)"

echo "== subs_schedule =="
printf 'main 60\nsecond 120\n' > "$CONF/schedule"; mkdir -p "$CONF/stamps"; echo 1700000000 > "$CONF/stamps/main"
out="$(method subs_schedule)"
check "расписание: обе подписки с интервалом и отметкой" "true;60;1700000000;120" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | python3 -c 'import json,sys; s=json.load(sys.stdin)["subs"]; print(s[0]["auto"])');$(printf '%s' "$out" | python3 -c 'import json,sys; s=json.load(sys.stdin)["subs"]; print(s[0]["auto_at"])');$(printf '%s' "$out" | python3 -c 'import json,sys; s=json.load(sys.stdin)["subs"]; print(s[1]["auto"])')"

echo "== архив настроек: хук backup_sections =="
bk() { hook backup_sections "$1" backup; }
out="$(bk '{"op":"export"}')"
check "export: расписание отдаётся разделом schedule" "main 60
second 120" "$(printf '%s' "$out" | jget sections.schedule)"
rm -f "$CONF/settings.json"
printf '{"quota_interval":90}\n' > "$CONF/settings.json"
check "export: настройки плагина — разделом settings" "yes" "$(bk '{"op":"export"}' | jget sections.settings | grep -q quota_interval && echo yes || echo no)"
check "check: годное принято" "true" "$(bk '{"op":"check","sections":{"schedule":"main 60\nx 90"}}' | jget ok)"
check "check: строка не по форме — отказ" "false" "$(bk '{"op":"check","sections":{"schedule":"main часто"}}' | jget ok)"
check "check: имя с лишними знаками — отказ" "false" "$(bk '{"op":"check","sections":{"schedule":"a/b 60"}}' | jget ok)"
check "check: чужой раздел — отказ" "false" "$(bk '{"op":"check","sections":{"zzz":"x"}}' | jget ok)"
check "check ничего не пишет" "main 60
second 120" "$(cat "$CONF/schedule")"
out="$(bk '{"op":"restore","sections":{"schedule":"main 45\nthird 600","settings":"{\"quota_interval\":15}"}}')"
check "restore: записано, в restored число строк" "true;2" "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["restored"][0]["count"])')"
check "restore: расписание заменено" "main 45,third 600" "$(tr '\n' ',' < "$CONF/schedule" | sed 's/,$//')"
check "restore: настройка записана службой хоста" "15" "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["quota_interval"])' "$CONF/settings.json")"

echo "== support_report и purge =="
out="$(hook support_report '{}' support)"
check "support_report: раздел с текстом и числом подписок" "subscriptions;yes" "$(printf '%s' "$out" | jget section.title);$(printf '%s' "$out" | jget section.text | grep -q 'subscriptions on schedule: 2' && echo yes || echo no)"
out="$(hook purge '{"dry_run":true,"keep_config":true}' purge)"
check "purge --dry: называет расписание и отметки, ничего не удаляет" "yes;yes" \
      "$(printf '%s' "$out" | grep -q schedule && echo yes || echo no);$([ -e "$CONF/schedule" ] && echo yes || echo no)"
check "purge --dry с настройками: settings.json в плане только без keep_config" "no" "$(printf '%s' "$out" | grep -q settings.json && echo yes || echo no)"
hook purge '{"dry_run":false,"keep_config":true}' purge >/dev/null
check "purge: расписание и отметки убраны, настройки остались" "no;no;yes" \
      "$([ -e "$CONF/schedule" ] && echo yes || echo no);$([ -e "$CONF/stamps" ] && echo yes || echo no);$([ -e "$CONF/settings.json" ] && echo yes || echo no)"
hook purge '{"dry_run":false,"keep_config":false}' purge >/dev/null
check "purge без keep_config убирает и настройки" "no" "$([ -e "$CONF/settings.json" ] && echo yes || echo no)"

echo
if [ "$fails" -gt 0 ]; then echo "ЕСТЬ ПРОВАЛЫ: $fails"; exit 1; fi
echo "плагин subscriptions работает"
