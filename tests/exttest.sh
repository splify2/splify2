#!/bin/sh
# Хуки, задачи, события, псевдонимы и переопределения плагинов (splify2-api 1.0) — ПОВЕДЕНИЕ настоящих
# файлов: диспетчер rpcd, ext.sh, plugin.sh, splify2-task, splify2-events, splify2-purge.
#
# Плагины здесь — маленькие shell-программы в песочнице; ядро — заглушка `steer`, менеджер плагинов — заглушка
# tests/stub/steer-plugin. Стенд проверяет три вещи, ради которых точки расширения и заведены:
#
#   1. Работают так, как описано в plugin-sdk/docs/splify2-api.md: порядок, протокол, права, режимы.
#   2. Плагин не может «кирпичить» каркас: упавший, зависший, ответивший мусором хук ничего не останавливает;
#      final-методы не заменить и не занять; безопасный режим выключает всё, кроме вынесенных методов.
#   3. Каркас без плагинов работает: вынесенные методы отвечают «нужен плагин», а не падают.
#
# Запуск: sh tests/exttest.sh (нужен python3).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/files/usr/libexec/rpcd/splify2"
LIBD="$ROOT/files/usr/lib/splify2"
SBIN="$ROOT/files/usr/sbin"
T="$(mktemp -d /tmp/exttest.XXXXXX)"
trap 'rm -rf "$T"' EXIT INT TERM

fails=0; passes=0
check() {  # ОПИСАНИЕ ОЖИДАЕМОЕ ПОЛУЧЕННОЕ
    if [ "$2" = "$3" ]; then
        passes=$((passes + 1)); printf '%-76s ok\n' "$1"
    else
        fails=$((fails + 1)); printf '%-76s ПРОВАЛ\n    ожидалось: %s\n    получено:  %s\n' "$1" "$2" "$3"
    fi
}
# Поле ответа выражением python над `d`: строки как есть, остальное JSON.
pj() {  # ВЫРАЖЕНИЕ < JSON
    python3 -c 'import json,sys
try: d = json.load(sys.stdin)
except Exception: print("НЕ JSON"); raise SystemExit
try: v = eval(sys.argv[1])
except Exception: v = "НЕТ ПОЛЯ"
print(v if isinstance(v, str) else json.dumps(v, ensure_ascii=False))' "$1"
}
# Есть ли строка в файле / есть ли файл — словами, а не кодом возврата.
has() { grep -q -- "$1" "$2" 2>/dev/null && echo yes || echo no; }
yn() { [ -e "$1" ] && echo yes || echo no; }
gc() { grep -c -- "$1" "$2" 2>/dev/null || true; }

mkdir -p "$T/bin" "$T/etc" "$T/lists" "$T/var" "$T/lock"
cp "$ROOT/tests/stub/jsonfilter" "$T/bin/jsonfilter"; cp "$ROOT/tests/stub/uci" "$T/bin/uci"
chmod +x "$T/bin/jsonfilter" "$T/bin/uci"
printf '#!/bin/sh\nexit 1\n' > "$T/bin/ubus"
cat > "$T/bin/initd-rpcd" <<'EOF'
#!/bin/sh
echo "$1" >> "$SANDBOX/rpcd-initd.log"
EOF
# Ядро: apply пишет журнал; `apply --dry-run` отвергает спеку со словом BAD; ctl subscribe печатает события из файла.
cat > "$T/bin/steer" <<'EOF'
#!/bin/sh
case "$1" in
    plugin) shift; exec sh "$STEER_PLUGIN_STUB" "$@" ;;
    apply)
        shift
        case " $* " in
            *" --dry-run "*)
                f=""; while [ $# -gt 0 ]; do [ "$1" = --spec ] && f="$2"; shift; done
                if grep -q BAD "$f" 2>/dev/null; then echo "spec: BAD" >&2; exit 1; fi
                exit 0 ;;
        esac
        echo "apply" >> "$SANDBOX/steer.log"
        echo "ядро: применено"
        exit "${STEER_RC:-0}" ;;
    spec)
        # `spec convert [--json] --spec ФАЙЛ`: заглушка отдаёт тело как есть (спека лежит JSON-текстом).
        shift; f=""; while [ $# -gt 0 ]; do [ "$1" = --spec ] && f="$2"; shift; done
        cat "$f"; exit $? ;;
    ctl)
        [ "${2:-}" = subscribe ] && { [ -f "$SANDBOX/events.in" ] && cat "$SANDBOX/events.in"; exit 0; }
        exit 1 ;;
esac
exit 0
EOF
cat > "$T/bin/initd-events" <<'EOF'
#!/bin/sh
echo "$1" >> "$SANDBOX/events-initd.log"
case "$1" in
    running) [ -f "$SANDBOX/events.running" ]; exit $? ;;
    start) touch "$SANDBOX/events.running" ;;
    stop) rm -f "$SANDBOX/events.running" ;;
esac
exit 0
EOF
chmod +x "$T/bin/steer" "$T/bin/initd-rpcd" "$T/bin/initd-events"

. "$ROOT/tests/stub/plugins-env.sh"
PL="$T/p"

# Окружение вызова объекта — как у стенда pluginmatch/rpcdmatch, но только то, что нужно этим методам.
envs() {
    env SANDBOX="$T" PATH="$T/bin:$PATH" JSHN_SH="$ROOT/tests/stub/jshn.sh" \
        RPCD_LIB="$LIBD/rpcd" FAST_SH="$LIBD/fast.sh" FETCH_SH="$LIBD/fetch.sh" \
        SPLIFY2_LOCK_DIR="$T/lock" STEER="$T/bin/steer" STEER_PLUGIN_STUB="$ROOT/tests/stub/steer-plugin" PLUG="$PL" \
        SPEC="$T/etc/spec.json" SPEC_VIEW="$T/spec.view.json" APPLIED="$T/etc/spec.applied.json" \
        LISTS="$T/lists" SUB="$T/etc/sub.txt" SUBS_DIR="$T/etc/subs" MANIFEST="$T/etc/manifest.json" \
        FW_OWNED="$T/etc/fw-owned" UCI_SPLIFY2="$T/etc/config/splify2" UCI_STUB_DB="$T/uci.db" \
        INITD="$T/bin/initd-steer" RPCD_INITD="$T/bin/initd-rpcd" \
        BACKUP_OUT="$T/var/backup.out" BACKUP_IN="$T/var/backup.in" \
        PLUGIN_RPCD_DIR="$PL/rpcd" PLUGIN_ACL_DIR="$PL/acl" PLUGIN_UI_DIR="$PL/www" \
        PLUGIN_DISPATCHER="$LIBD/plugin-rpcd" EXT_EVENTS_INITD="$T/bin/initd-events" \
        "$@"
}
# После вызова спека, записанная ядром как spec.yaml, возвращается под имя spec.json: проверки читают её так.
rpc() {  # МЕТОД [JSON]
    printf '%s\n' "${2:-}" | envs sh "$SCRIPT" call "$1" 2>"$T/stderr"
    _rc=$?
    [ -s "$T/etc/spec.yaml" ] && mv -f "$T/etc/spec.yaml" "$T/etc/spec.json"
    return $_rc
}
rpc_list() { envs sh "$SCRIPT" list 2>"$T/stderr"; }
sync_now() { envs sh "$SBIN/splify2-plugin-sync" --no-reload >/dev/null 2>&1; }

# ---- фикстуры ---------------------------------------------------------------------------------------------
# reset [ID...] — песочница; без аргументов плагинов нет, с аргументами — эти официальные плагины из plugins/.
reset() {
    rm -rf "$PL" "$T/marks" "$T/steer.log" "$T/rpcd-initd.log" "$T/events-initd.log" "$T/events.running" \
           "$T/events.in" "$T/uci.db" "$T/etc/spec.yaml" "$T/etc/spec.json" "$T/spec.view.json" "$T/spec.view.json.sum"
    if [ $# -gt 0 ]; then plugins_provision "$PL" "$@"; else plugins_provision "$PL" -; fi
    mkdir -p "$PL/rpcd" "$PL/acl" "$PL/www" "$PL/jobs" "$PL/fixtures" "$T/marks"
    printf '{"version":2,"outputs":{"direct":{"kind":"direct"}}}' > "$T/etc/spec.json"
    rm -f "$T/etc/spec.applied.json"
}
# fixture_plugin ID МАНИФЕСТ_JSON [РЕПОЗИТОРИЙ] — каталог плагина, состояние enabled.
fixture_plugin() {
    mkdir -p "$PL/lib/$1"
    printf '%s\n' "$2" > "$PL/lib/$1/plugin.json"
    python3 - "$PL/state.json" "$1" "${3:-someone}" <<'PY'
import json, sys
p, i, repo = sys.argv[1:4]
d = json.load(open(p)); d.setdefault("plugins", {})[i] = {"version": "1.0.0", "state": "enabled", "repo": repo}
json.dump(d, open(p, "w"))
PY
}
# prog ID ПУТЬ — программа плагина из stdin.
prog() {
    mkdir -p "$(dirname "$PL/lib/$1/$2")"
    cat > "$PL/lib/$1/$2"
    chmod +x "$PL/lib/$1/$2"
}
set_state() {  # ID СОСТОЯНИЕ [РЕПОЗИТОРИЙ]
    python3 - "$PL/state.json" "$1" "$2" "${3:-}" <<'PY'
import json, sys
p, i, st, repo = sys.argv[1:5]
d = json.load(open(p)); d["plugins"][i]["state"] = st
if repo: d["plugins"][i]["repo"] = repo
json.dump(d, open(p, "w"))
PY
    # mtime с секундной точностью: state.json должен быть новее реестра, чтобы его пересобрали.
    touch -d '+3 seconds' "$PL/state.json"
}
reg() { cat "$PL/run/ext.reg" 2>/dev/null; }
M='"schema":1,"version":"1.0.0","arch":"all","compat":{"splify2-api":"^1.0"}'
S2='{"spec":"{\"version\":2,\"outputs\":{\"direct\":{\"kind\":\"direct\"}}}"}'

# =====================================================================================================
echo "== таблица методов"
# methods.tsv — часть splify2-api: все методы диспетчера есть в ней и только они; вынесенные идут группой moved.
disp_methods="$(sed -n '/^list)/,/^call)/p' "$SCRIPT" | grep -o 'json_add_object [a-z0-9_]*' | awk 'NF == 2 {print $2}' | sort | tr '\n' ' ')"
tsv_methods="$(grep -v '^#' "$LIBD/methods.tsv" | cut -f1 | sort | tr '\n' ' ')"
check "methods.tsv перечисляет ровно методы диспетчера" "$disp_methods" "$tsv_methods"
check "методов 93" "93" "$(grep -vc '^#' "$LIBD/methods.tsv")"
moved_tsv="$(awk -F'\t' '$2=="moved"{print $1}' "$LIBD/methods.tsv" | sort | tr '\n' ' ')"
moved_disp="$(sed -n '/^        lists|list_fetch/,/_grp=moved/p' "$SCRIPT" | tr -d '\\\n ' | sed 's/).*//' | tr '|' '\n' | sort | tr '\n' ' ')"
check "вынесенные методы в таблице — те же, что ведут в группу moved" "$moved_tsv" "$moved_disp"
check "final — ровно plugin_*, plugins_*, repo_*, repos_*, prefs_*: 19" "19" "$(awk -F'\t' '$2=="final"' "$LIBD/methods.tsv" | grep -cE '^(plugin_|plugins_|repo_|repos_|prefs_)')"
check "и все методы с такими именами — final" "19" "$(grep -E '^(plugin_|plugins_|repo_|repos_|prefs_)' "$LIBD/methods.tsv" | awk -F'\t' '$2=="final"' | wc -l | tr -d ' ')"
check "быстрый путь — три метода" "live;spec_get;applied_get" "$(awk -F'\t' '$2=="fast"{print $1}' "$LIBD/methods.tsv" | tr '\n' ';' | sed 's/;$//')"

# =====================================================================================================
echo "== каркас без плагинов"
reset
out="$(rpc backup_get '{"offset":0}')"
check "backup_get без плагина: код not_installed" "not_installed" "$(printf '%s' "$out" | pj 'd["code"]')"
check "и отказ называет плагин backup" "yes" "$(printf '%s' "$out" | grep -q 'плагин backup' && echo yes || echo no)"
out="$(rpc lists)"
check "lists без плагина: нужен lists-catalog" "not_installed;yes" "$(printf '%s' "$out" | pj 'd["code"]');$(printf '%s' "$out" | grep -q 'lists-catalog' && echo yes || echo no)"
check "методы каркаса отвечают как раньше (spec_get)" "2" "$(rpc spec_get | pj 'd["version"]')"
check "реестр заведён и пуст: версия и режим" "api	1.0.0|safe	0" "$(reg | head -2 | tr '\n' '|' | sed 's/|$//')"

# =====================================================================================================
echo "== реестр: права, имена, версия API"
reset
fixture_plugin nopermit '{'"$M"',"id":"nopermit","name":"x","splify2":{"hooks":{"pre_apply":{"prog":"h","mode":"veto"}}}}'
prog nopermit h <<'EOF'
#!/bin/sh
cat >/dev/null; echo '{"ok":false,"error":"не должен вызываться"}'
EOF
fixture_plugin badapi '{"schema":1,"id":"badapi","version":"1.0.0","arch":"all","name":"x","compat":{"splify2-api":"^2.0"},"permissions":["splify2.hooks"],"splify2":{"hooks":{"pre_apply":{"prog":"h"}}}}'
prog badapi h <<'EOF'
#!/bin/sh
cat >/dev/null; echo '{"ok":true}'
EOF
fixture_plugin noaxis '{"schema":1,"id":"noaxis","version":"1.0.0","arch":"all","name":"x","compat":{"steer-api":"^1.0"},"permissions":["splify2.hooks"],"splify2":{"hooks":{"pre_apply":{"prog":"h"}}}}'
prog noaxis h <<'EOF'
#!/bin/sh
cat >/dev/null; echo '{"ok":true}'
EOF
fixture_plugin names '{'"$M"',"id":"names","name":"x","permissions":["splify2.override","splify2.hooks"],
 "rpc":{"prog":"r","methods":{"m":{"access":"read"}}},
 "splify2":{"methods":{
   "alias":{"plugin_install":"m","status":"m","live":"m","backup_get":"m"},
   "override":{"plugin_status":{"prog":"r","mode":"replace"},"live":{"prog":"r","mode":"replace"},"nonexistent_method":{"prog":"r","mode":"wrap"},"backup_put":{"prog":"r","mode":"wrap"}}}}}'
prog names r <<'EOF'
#!/bin/sh
cat >/dev/null; echo '{"ok":true}'
EOF
fixture_plugin noover '{'"$M"',"id":"noover","name":"x","rpc":{"prog":"r","methods":{"m":{"access":"read"}}},"splify2":{"methods":{"override":{"ui_get":{"prog":"r","mode":"wrap"}}}}}'
prog noover r <<'EOF'
#!/bin/sh
cat >/dev/null; echo '{"ok":true}'
EOF
sync_now
R="$PL/run/ext.reg"
check "хук без права splify2.hooks не попал в реестр" "0;yes" "$(reg | grep -c '^hook	pre_apply	nopermit');$(has 'nopermit: хук pre_apply без права splify2.hooks' "$R")"
check "compat.splify2-api ^2.0 — блок не применён" "0;yes" "$(reg | grep -c '^hook	pre_apply	badapi');$(has 'badapi: нужен splify2-api ^2.0, у хоста 1.0.0' "$R")"
check "блок без оси splify2-api — не применён" "0;yes" "$(reg | grep -c '^hook	pre_apply	noaxis');$(has 'noaxis: блок splify2 есть, а compat.splify2-api нет' "$R")"
check "псевдоним на final-метод отвергнут" "yes" "$(has 'names: псевдоним «plugin_install»: метод final' "$R")"
check "псевдоним на метод каркаса отвергнут" "yes" "$(has 'names: псевдоним «status»: имя занято каркасом' "$R")"
check "псевдоним на метод быстрого пути отвергнут" "yes" "$(has 'names: псевдоним «live»: метод быстрого пути' "$R")"
check "чужой плагин не берёт имя вынесенного метода" "yes" "$(has 'names: псевдоним «backup_get»: метод вынесен в плагин backup' "$R")"
check "замена final-метода отвергнута" "yes" "$(has 'names: переопределение «plugin_status»: метод final' "$R")"
check "замена метода быстрого пути отвергнута" "yes" "$(has 'names: переопределение «live»: метод быстрого пути' "$R")"
check "замена несуществующего метода отвергнута" "yes" "$(has 'переопределение «nonexistent_method»: такого метода у каркаса нет' "$R")"
check "обёртка вынесенного метода отвергнута (для него есть псевдоним)" "yes" "$(has 'переопределение «backup_put»: метод вынесен в плагин backup' "$R")"
check "override без права splify2.override отвергнут" "yes" "$(has 'noover: переопределение «ui_get» без права splify2.override' "$R")"
check "от этих плагинов в реестре нет ни одной записи m" "0" "$(reg | grep -c '^m	')"
out="$(rpc plugins_list)"
check "plugins_list: версия splify2-api" "1.0.0" "$(printf '%s' "$out" | pj 'd["splify2_api"]')"
check "plugins_list: ext_errors называет причины" "yes" "$(printf '%s' "$out" | pj 'd["ext_errors"]' | grep -q 'badapi: нужен splify2-api' && echo yes || echo no)"

# =====================================================================================================
echo "== хуки: pre_spec_set"
reset
fixture_plugin xform '{'"$M"',"id":"xform","name":"x","permissions":["splify2.hooks"],"splify2":{"hooks":{"pre_spec_set":{"prog":"h","mode":"transform"}}}}'
prog xform h <<'EOF'
#!/bin/sh
cat >/dev/null
sed 's/BAD/GOOD/g' "$SPLIFY2_SPEC_TMP" > "$SPLIFY2_SPEC_TMP.t" && mv "$SPLIFY2_SPEC_TMP.t" "$SPLIFY2_SPEC_TMP"
echo '{"ok":true}'
EOF
body='{"spec":"{\"version\":2,\"outputs\":{\"direct\":{\"kind\":\"direct\"}},\"note\":\"BAD\"}"}'
out="$(rpc spec_set "$body")"
check "transform переписал спеку, ядро проверило результат: ok" "true" "$(printf '%s' "$out" | pj 'd["ok"]')"
check "на диске лёг исправленный текст" "yes" "$(has '"note":"GOOD"' "$T/etc/spec.json")"
set_state xform disabled
out="$(rpc spec_set "$body")"
check "без плагина та же спека отвергается ядром" "false" "$(printf '%s' "$out" | pj 'd["ok"]')"

reset
fixture_plugin vetoer '{'"$M"',"id":"vetoer","name":"x","permissions":["splify2.hooks"],"splify2":{"hooks":{"pre_spec_set":{"prog":"h","mode":"veto"}}}}'
prog vetoer h <<'EOF'
#!/bin/sh
cat >/dev/null
echo '{"ok":false,"error":"спеку менять нельзя: идёт обслуживание"}'
EOF
before="$(cat "$T/etc/spec.json")"
out="$(rpc spec_set "$S2")"
check "veto: spec_set отказывает словами плагина" "false;спеку менять нельзя: идёт обслуживание" "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["error"]')"
check "и спека на диске не тронута" "$before" "$(cat "$T/etc/spec.json")"

echo "== хуки: упавший, зависший, ответивший мусором — ничего не останавливают"
reset
fixture_plugin crash '{'"$M"',"id":"crash","name":"x","permissions":["splify2.hooks"],"splify2":{"hooks":{"pre_spec_set":{"prog":"h","mode":"veto"}}}}'
prog crash h <<'EOF'
#!/bin/sh
cat >/dev/null; echo "рухнул" >&2; exit 3
EOF
out="$(rpc spec_set "$S2")"
check "упавший хук (код 3, режим veto): спека сохранена" "true" "$(printf '%s' "$out" | pj 'd["ok"]')"
check "и в ответе предупреждение с кодом" "yes" "$(printf '%s' "$out" | pj 'd["warn"]' | grep -q 'плагин crash: хук pre_spec_set завершился с ошибкой (код 3)' && echo yes || echo no)"

reset
fixture_plugin crash '{'"$M"',"id":"crash","name":"x","permissions":["splify2.hooks"],"splify2":{"hooks":{"pre_spec_set":{"prog":"h","mode":"veto","critical":true}}}}'
prog crash h <<'EOF'
#!/bin/sh
cat >/dev/null; exit 3
EOF
out="$(rpc spec_set "$S2")"
check "critical:true — упавший хук останавливает операцию" "false;yes" "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["error"]' | grep -q 'плагин crash (pre_spec_set) завершился с ошибкой' && echo yes || echo no)"

reset
fixture_plugin slow '{'"$M"',"id":"slow","name":"x","permissions":["splify2.hooks"],"splify2":{"hooks":{"pre_spec_set":{"prog":"h","mode":"veto","timeout_s":1}}}}'
prog slow h <<'EOF'
#!/bin/sh
cat >/dev/null; sleep 5; echo '{"ok":false,"error":"поздно"}'
EOF
t0=$(date +%s)
out="$(rpc spec_set "$S2")"
t1=$(date +%s)
check "зависший хук отрезан по сроку: спека сохранена" "true" "$(printf '%s' "$out" | pj 'd["ok"]')"
check "предупреждение «не ответил за срок»" "yes" "$(printf '%s' "$out" | pj 'd["warn"]' | grep -q 'не ответил за срок' && echo yes || echo no)"
check "и ждали не пять секунд" "yes" "$([ $((t1 - t0)) -lt 4 ] && echo yes || echo no)"

reset
fixture_plugin junk '{'"$M"',"id":"junk","name":"x","permissions":["splify2.hooks"],"splify2":{"hooks":{"pre_spec_set":{"prog":"h","mode":"veto"}}}}'
prog junk h <<'EOF'
#!/bin/sh
cat >/dev/null; echo "это не JSON"
EOF
out="$(rpc spec_set "$S2")"
check "ответ не по форме: спека сохранена, предупреждение" "true;yes" "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["warn"]' | grep -q 'ответил не по форме' && echo yes || echo no)"
fixture_plugin noexec '{'"$M"',"id":"noexec","name":"x","permissions":["splify2.hooks"],"splify2":{"hooks":{"pre_spec_set":{"prog":"h","mode":"veto"}}}}'
prog noexec h <<'EOF'
#!/bin/sh
echo '{"ok":false}'
EOF
chmod -x "$PL/lib/noexec/h"
sync_now
check "хук без бита исполнения не подключается" "0;yes" "$(reg | grep -c '^hook	pre_spec_set	noexec');$(has 'программы h нет или она не исполняемая' "$PL/run/ext.reg")"

echo "== хуки: порядок и режимы pre_apply"
reset
for id in alpha bravo; do
    pr=100; [ "$id" = bravo ] && pr=10
    fixture_plugin $id '{'"$M"',"id":"'$id'","name":"x","permissions":["splify2.hooks"],"splify2":{"priority":'$pr',"hooks":{"pre_apply":{"prog":"h","mode":"warn"}}}}'
    prog $id h <<'EOF'
#!/bin/sh
cat >/dev/null
echo "$STEER_PLUGIN_ID" >> "$SANDBOX/marks/order"
printf '{"ok":true,"warn":["предупреждает %s"]}\n' "$STEER_PLUGIN_ID"
EOF
done
out="$(rpc apply)"
check "порядок хуков: меньший priority раньше, затем по id" "bravo alpha" "$(tr '\n' ' ' < "$T/marks/order" | sed 's/ $//')"
check "apply прошёл, ядро применило" "true;1" "$(printf '%s' "$out" | pj 'd["ok"]');$(gc apply "$T/steer.log")"
check "предупреждения хуков — в output ответа" "yes;yes" "$(printf '%s' "$out" | pj 'd["output"]' | grep -q 'предупреждает bravo' && echo yes || echo no);$(printf '%s' "$out" | pj 'd["output"]' | grep -q 'предупреждает alpha' && echo yes || echo no)"

reset
fixture_plugin gate '{'"$M"',"id":"gate","name":"x","permissions":["splify2.hooks"],"splify2":{"hooks":{"pre_apply":{"prog":"h","mode":"veto"}}}}'
prog gate h <<'EOF'
#!/bin/sh
cat > "$SANDBOX/marks/pre_apply.in"
echo '{"ok":false,"error":"применять рано: идёт проверка"}'
EOF
out="$(rpc apply)"
check "veto у pre_apply: apply остановлен с причиной плагина" "false;true;применять рано: идёт проверка" "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'str(d["veto"]).lower()');$(printf '%s' "$out" | pj 'd["error"]')"
check "и ядро apply не получало" "no" "$(yn "$T/steer.log")"
check "хук получил контекст по протоколу: api, hook, plugin, ctx.spec" "1;pre_apply;gate;yes" "$(pj 'd["api"]' < "$T/marks/pre_apply.in");$(pj 'd["hook"]' < "$T/marks/pre_apply.in");$(pj 'd["plugin"]' < "$T/marks/pre_apply.in");$(pj '"yes" if "spec" in d["ctx"] else "no"' < "$T/marks/pre_apply.in")"

reset
fixture_plugin observer '{'"$M"',"id":"observer","name":"x","permissions":["splify2.hooks"],"splify2":{"hooks":{
  "pre_apply":{"prog":"h","mode":"observe"},"post_apply":{"prog":"h"},"post_apply_fail":{"prog":"h"},"post_spec_set":{"prog":"h"}}}}'
prog observer h <<'EOF'
#!/bin/sh
cat > "$SANDBOX/marks/$SPLIFY2_HOOK.in"
echo '{"ok":false,"error":"observe не учитывается"}'
EOF
out="$(rpc apply)"
check "observe не останавливает apply, даже если ответил отказом" "true" "$(printf '%s' "$out" | pj 'd["ok"]')"
check "post_apply получил rc 0 и вывод ядра" "0;yes" "$(pj 'd["ctx"]["rc"]' < "$T/marks/post_apply.in");$(pj 'd["ctx"]["output"]' < "$T/marks/post_apply.in" | grep -q 'ядро: применено' && echo yes || echo no)"
check "post_apply_fail при успехе не вызывался" "no" "$(yn "$T/marks/post_apply_fail.in")"
rm -f "$T/marks/post_apply.in"
out="$(STEER_RC=1 rpc apply)"
check "ядро отказало: ok=false, post_apply_fail получил rc 1, post_apply — нет" "false;1;no" "$(printf '%s' "$out" | pj 'd["ok"]');$(pj 'd["ctx"]["rc"]' < "$T/marks/post_apply_fail.in");$(yn "$T/marks/post_apply.in")"
rpc spec_set "$S2" >/dev/null
check "post_spec_set получил новую ревизию" "yes" "$(pj '"yes" if "rev" in d["ctx"] else "no"' < "$T/marks/post_spec_set.in")"

echo "== хуки: heal"
reset
fixture_plugin healer '{'"$M"',"id":"healer","name":"x","permissions":["splify2.hooks"],"splify2":{"hooks":{"heal":{"prog":"h","mode":"transform"}}}}'
prog healer h <<'EOF'
#!/bin/sh
cat >/dev/null
sed 's/"version":2/"version":2,"healed_by":"healer"/' "$SPLIFY2_SPEC_TMP" > "$SPLIFY2_SPEC_TMP.t"
mv "$SPLIFY2_SPEC_TMP.t" "$SPLIFY2_SPEC_TMP"
echo '{"ok":true,"message":"healer: спека поправлена"}'
EOF
out="$(rpc spec_heal)"
check "heal-плагин поправил спеку, spec_heal сообщил healed" "true;true" "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'str(d["healed"]).lower()')"
check "поправка легла на диск" "yes" "$(has '"healed_by":"healer"' "$T/etc/spec.json")"

reset
fixture_plugin healer '{'"$M"',"id":"healer","name":"x","permissions":["splify2.hooks"],"splify2":{"hooks":{"heal":{"prog":"h","mode":"transform"}}}}'
prog healer h <<'EOF'
#!/bin/sh
cat >/dev/null
sed 's/"direct"/"BAD"/' "$SPLIFY2_SPEC_TMP" > "$SPLIFY2_SPEC_TMP.t"; mv "$SPLIFY2_SPEC_TMP.t" "$SPLIFY2_SPEC_TMP"
echo '{"ok":true}'
EOF
before="$(cat "$T/etc/spec.json")"
out="$(rpc spec_heal)"
check "heal, испортивший спеку, отвергнут ядром: спека та же, healed=false" "$before;false" "$(cat "$T/etc/spec.json");$(printf '%s' "$out" | pj 'str(d["healed"]).lower()')"
check "рабочие копии лечения не копятся" "0" "$(ls "$T/etc" | grep -c 'heal')"

echo "== хуки: support_report, plugin_changed"
reset
fixture_plugin sr '{'"$M"',"id":"sr","name":"x","permissions":["splify2.hooks"],"splify2":{"hooks":{"support_report":{"prog":"h"}}}}'
prog sr h <<'EOF'
#!/bin/sh
cat >/dev/null
printf '{"ok":true,"section":{"title":"Проверка плагина","text":"строка один\\nстрока два"}}\n'
EOF
out="$(rpc support_report)"
txt="$(printf '%s' "$out" | pj 'd["text"]')"
check "support_report: раздел плагина в отчёте" "yes;yes;yes" "$(printf '%s' "$txt" | grep -q -- '-- Проверка плагина --' && echo yes || echo no);$(printf '%s' "$txt" | grep -q 'строка один' && echo yes || echo no);$(printf '%s' "$txt" | grep -q 'строка два' && echo yes || echo no)"
check "и текст про исключённое остался последним" "yes" "$(printf '%s' "$txt" | tail -n 3 | grep -q 'В отчёт намеренно не попали' && echo yes || echo no)"

reset
fixture_plugin obs '{'"$M"',"id":"obs","name":"x","permissions":["splify2.hooks"],"splify2":{"hooks":{"plugin_changed":{"prog":"h"}}}}'
prog obs h <<'EOF'
#!/bin/sh
cat >> "$SANDBOX/marks/changed"
echo '{"ok":true}'
EOF
fixture_plugin other '{"schema":1,"id":"other","version":"1.0.0","name":"x"}'
rpc plugin_disable '{"id":"other"}' >/dev/null
check "plugin_changed: наблюдатель узнал о выключении другого плагина" "yes;yes" "$(has '"id":"other"' "$T/marks/changed");$(has '"action":"disable"' "$T/marks/changed")"

# =====================================================================================================
echo "== методы: псевдонимы вынесенных методов"
reset backup
out="$(rpc backup_get '{"offset":0}')"
check "backup_get через псевдоним плагина backup: ok" "true" "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()')"
check "и архив — формат 3 без разделов плагинов" "3;yes" "$(printf '%s' "$out" | pj 'd["format"]');$(printf '%s' "$out" | pj 'd["text"]' | grep -q '^splify2-backup 3' && echo yes || echo no)"
set_state backup disabled
out="$(rpc backup_get '{"offset":0}')"
check "плагин выключен — реестр пересобрался сам: not_installed" "not_installed" "$(printf '%s' "$out" | pj 'd["code"]')"
set_state backup enabled
check "включён обратно — снова отвечает" "true" "$(rpc backup_get '{"offset":0}' | pj 'str(d["ok"]).lower()')"
# Псевдоним только у официального репозитория: тот же плагин из чужого репозитория имя не получает.
set_state backup enabled someone
out="$(rpc backup_get '{"offset":0}')"
check "тот же плагин из чужого репозитория имя backup_get не берёт" "not_installed" "$(printf '%s' "$out" | pj 'd["code"]')"
check "причина записана" "yes" "$(has 'брать его имя может только он и только из официального репозитория' "$PL/run/ext.reg")"

echo "== методы: новое имя на объекте splify2"
reset
fixture_plugin hello '{'"$M"',"id":"hello","name":"x","rpc":{"prog":"r","methods":{"say":{"access":"read"},"set":{"access":"write"}}},
  "splify2":{"methods":{"alias":{"hello_say":"say","hello_set":"set"}}}}'
prog hello r <<'EOF'
#!/bin/sh
cat >/dev/null
printf '{"ok":true,"via":"%s","method":"%s"}\n' "$STEER_PLUGIN_ID" "$1"
EOF
sync_now
out="$(rpc hello_say '{}')"
check "новое имя hello_say отвечает методом say плагина" "true;hello;say" "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()');$(printf '%s' "$out" | pj 'd["via"]');$(printf '%s' "$out" | pj 'd["method"]')"
check "list объекта называет новые имена" "yes;yes" "$(rpc_list | grep -q '"hello_say"' && echo yes || echo no);$(rpc_list | grep -q '"hello_set"' && echo yes || echo no)"
acl="$PL/acl/splify2-p-hello.json"
check "ACL плагина даёт права и на новые имена объекта splify2" "yes;yes" \
      "$(python3 -c 'import json,sys; a=json.load(open(sys.argv[1]))["splify2-p-hello"]; print("yes" if "hello_say" in a["read"]["ubus"]["splify2"] else "no")' "$acl");$(python3 -c 'import json,sys; a=json.load(open(sys.argv[1]))["splify2-p-hello"]; print("yes" if "hello_set" in a["write"]["ubus"]["splify2"] and "set" in a["write"]["ubus"]["splify2.p.hello"] else "no")' "$acl")"
fixture_plugin hello2 '{'"$M"',"id":"hello2","name":"x","rpc":{"prog":"r","methods":{"say":{"access":"read"}}},"splify2":{"methods":{"alias":{"hello_say":"say"}}}}'
prog hello2 r <<'EOF'
#!/bin/sh
cat >/dev/null; echo '{"ok":true}'
EOF
sync_now
check "второй плагин на то же новое имя отвергнут, называет занявшего" "yes" "$(has 'hello2: псевдоним «hello_say» уже занят плагином hello' "$PL/run/ext.reg")"
rm -rf "$PL/lib/hello2"; set_state hello2 disabled 2>/dev/null || true
sync_now
check "синхронизация без перемен ничего не пишет: перечитка rpcd не просится" "без изменений" "$(envs sh "$SBIN/splify2-plugin-sync" --no-reload)"

echo "== методы: переопределения"
reset
fixture_plugin wrapper '{'"$M"',"id":"wrapper","name":"x","permissions":["splify2.override"],"splify2":{"methods":{"override":{"ui_get":{"prog":"w","mode":"wrap"}}}}}'
prog wrapper w <<'EOF'
#!/bin/sh
cat > "$SANDBOX/marks/wrap.in"
printf '%s\n' "$SPLIFY2_NEXT" > "$SANDBOX/marks/wrap.next"
python3 - "$SPLIFY2_NEXT" <<'PY'
import json, sys
d = json.loads(sys.argv[1]); d["wrapped"] = True; print(json.dumps(d))
PY
EOF
base="$(SPLIFY2_NO_EXT=1 rpc ui_get '{}')"
out="$(rpc ui_get '{"x":1}')"
check "обёртка: ответ каркаса дошёл до плагина в SPLIFY2_NEXT" "$base" "$(cat "$T/marks/wrap.next")"
check "и плагин дополнил его (wrapped), поля каркаса остались" "true;$(printf '%s' "$base" | pj 'str(d["ok"]).lower()')" "$(printf '%s' "$out" | pj 'str(d["wrapped"]).lower()');$(printf '%s' "$out" | pj 'str(d["ok"]).lower()')"
check "запрос обёртка получила на stdin" '{"x":1}' "$(cat "$T/marks/wrap.in")"
fixture_plugin replacer '{'"$M"',"id":"replacer","name":"x","permissions":["splify2.override"],"splify2":{"priority":5,"methods":{"override":{"ui_get":{"prog":"r","mode":"replace"}}}}}'
prog replacer r <<'EOF'
#!/bin/sh
cat >/dev/null; echo '{"ok":true,"replaced_by":"replacer"}'
EOF
sync_now
out="$(rpc ui_get '{}')"
check "replace подменил обработчик каркаса; обёртка поверх замены" "replacer;true" "$(printf '%s' "$out" | pj 'd["replaced_by"]');$(printf '%s' "$out" | pj 'str(d["wrapped"]).lower()')"
fixture_plugin replacer2 '{'"$M"',"id":"replacer2","name":"x","permissions":["splify2.override"],"splify2":{"methods":{"override":{"ui_get":{"prog":"r","mode":"replace"}}}}}'
prog replacer2 r <<'EOF'
#!/bin/sh
cat >/dev/null; echo '{"ok":true,"replaced_by":"replacer2"}'
EOF
sync_now
check "второй replace отвергнут, называет занявшего" "yes" "$(has 'replacer2: обработчик «ui_get» уже заменил плагин replacer' "$PL/run/ext.reg")"
check "и работает первый" "replacer" "$(rpc ui_get '{}' | pj 'd["replaced_by"]')"
prog replacer r <<'EOF'
#!/bin/sh
cat >/dev/null; exit 4
EOF
out="$(rpc ui_get '{}')"
check "упавшая замена: ответ каркаса, поля каркаса на месте" "$(printf '%s' "$base" | pj 'str(d["ok"]).lower()');yes" "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()');$(printf '%s' "$out" | pj '"yes" if "replaced_by" not in d else "no"')"

echo "== безопасный режим"
reset backup
fixture_plugin sfty '{'"$M"',"id":"sfty","name":"x","permissions":["splify2.hooks","splify2.override"],"splify2":{
 "hooks":{"pre_spec_set":{"prog":"h","mode":"veto"}},
 "methods":{"override":{"ui_get":{"prog":"r","mode":"replace"}}},
 "tasks":[{"name":"tick","every":"10m","prog":"t"}]}}'
prog sfty h <<'EOF'
#!/bin/sh
cat >/dev/null; echo '{"ok":false,"error":"заблокировано плагином"}'
EOF
prog sfty r <<'EOF'
#!/bin/sh
cat >/dev/null; echo '{"ok":true,"replaced_by":"sfty"}'
EOF
prog sfty t <<'EOF'
#!/bin/sh
exit 0
EOF
sync_now
check "без безопасного режима хук блокирует" "false" "$(rpc spec_set "$S2" | pj 'str(d["ok"]).lower()')"
check "и задача в crontab есть" "1" "$(gc 'splify2-task sfty tick' "$PL/crontab")"
touch "$PL/safe"
check "файл safe: хук не вызывается, спека сохранена" "true" "$(rpc spec_set "$S2" | pj 'str(d["ok"]).lower()')"
check "файл safe: замена не действует" "yes" "$(rpc ui_get '{}' | pj '"yes" if "replaced_by" not in d else "no"')"
check "файл safe: вынесенный из каркаса метод (backup_get) работает" "true" "$(rpc backup_get '{"offset":0}' | pj 'str(d["ok"]).lower()')"
sync_now
check "файл safe: задач в crontab нет" "0" "$(gc 'splify2-task' "$PL/crontab")"
check "final-методы в безопасном режиме работают как обычно" "true" "$(rpc plugins_list | pj 'str(d["ok"]).lower()')"
rm -f "$PL/safe"
check "файл убран — хук снова блокирует (реестр пересобран сам)" "false" "$(rpc spec_set "$S2" | pj 'str(d["ok"]).lower()')"
out="$(printf '%s\n' "$S2" | SPLIFY2_SAFE=1 envs sh "$SCRIPT" call spec_set 2>/dev/null)"
check "SPLIFY2_SAFE=1 в окружении вызова — то же, что файл" "true" "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()')"

# =====================================================================================================
echo "== периодические задачи"
reset lists-catalog
fixture_plugin ticker '{'"$M"',"id":"ticker","name":"x","splify2":{"tasks":[
  {"name":"tick","every":"10m","prog":"t","only_if":"spec-present"},
  {"name":"hourly","every":"6h","jitter":"random-minute","prog":"t"},
  {"name":"nightly","cron":"M 3 * * *","prog":"t","jitter":"random-minute"},
  {"name":"bad","every":"soon","prog":"t"}]}}'
prog ticker t <<'EOF'
#!/bin/sh
echo "$STEER_PLUGIN_ID $1 $SPLIFY2_TASK" >> "$SANDBOX/marks/tasks"
EOF
printf '0 3 * * * /usr/bin/чужое\n' > "$PL/crontab"
sync_now
CR="$PL/crontab"
check "блок crontab: чужая строка на месте" "1" "$(gc '^0 3 \* \* \* /usr/bin/чужое$' "$CR")"
check "блок размечен" "1;1" "$(gc '^# splify2-plugins begin$' "$CR");$(gc '^# splify2-plugins end$' "$CR")"
check "every 10m → */10 * * * *" "1" "$(gc '^\*/10 \* \* \* \* /usr/sbin/splify2-task ticker tick$' "$CR")"
m_h="$(sed -n 's|^\([0-9][0-9]*\) \*/6 \* \* \* /usr/sbin/splify2-task ticker hourly$|\1|p' "$CR")"
m_n="$(sed -n 's|^\([0-9][0-9]*\) 3 \* \* \* /usr/sbin/splify2-task ticker nightly$|\1|p' "$CR")"
m_l="$(sed -n 's|^\([0-9][0-9]*\) 5 \* \* \* /usr/sbin/splify2-task lists-catalog update-lists$|\1|p' "$CR")"
check "every 6h с random-minute → «M */6 * * *»; cron с M — минута подставлена" "yes;yes" "$([ -n "$m_h" ] && echo yes || echo no);$([ -n "$m_n" ] && echo yes || echo no)"
check "задача плагина lists-catalog — из его манифеста (M 5 * * *)" "yes" "$([ -n "$m_l" ] && echo yes || echo no)"
check "задача с непонятным every отвергнута, причина записана" "0;yes" "$(gc 'ticker bad' "$CR");$(has 'ticker: задача bad: every «soon» не разобрать' "$PL/run/ext.reg")"
tj() { sed -n "s/^ *\"$1\": *\([0-9]*\).*/\1/p" "$PL/tasks.json"; }
check "tasks.json хранит минуты по ключам «плагин:задача»" "$m_h;$m_n;$m_l" "$(tj ticker:hourly);$(tj ticker:nightly);$(tj lists-catalog:update-lists)"
cp "$CR" "$T/crontab.1"; cp "$PL/tasks.json" "$T/tasks.1"
sync_now
check "повторная синхронизация ничего не меняет (crontab и tasks.json те же)" "same;same" "$(cmp -s "$CR" "$T/crontab.1" && echo same || echo diff);$(cmp -s "$PL/tasks.json" "$T/tasks.1" && echo same || echo diff)"
set_state ticker disabled
sync_now
check "плагин выключен — его задач в crontab нет, чужая строка на месте" "0;1" "$(gc 'splify2-task ticker' "$CR");$(gc 'чужое' "$CR")"
check "а задача lists-catalog осталась с прежней минутой" "$m_l" "$(sed -n 's|^\([0-9][0-9]*\) 5 \* \* \* /usr/sbin/splify2-task lists-catalog update-lists$|\1|p' "$CR")"
set_state lists-catalog disabled
sync_now
check "последний плагин с задачами выключен — блока нет, чужая строка одна" "0;0;1" "$(gc 'splify2-plugins' "$CR");$(gc 'splify2-task' "$CR");$(gc . "$CR")"
check "и tasks.json убран" "no" "$(yn "$PL/tasks.json")"

echo "== запуск задачи: splify2-task"
reset
fixture_plugin ticker '{'"$M"',"id":"ticker","name":"x","splify2":{"tasks":[
  {"name":"tick","every":"10m","prog":"t","only_if":"spec-present"},
  {"name":"long","every":"1h","prog":"l"}]}}'
prog ticker t <<'EOF'
#!/bin/sh
echo "$STEER_PLUGIN_ID $1 $SPLIFY2_TASK $SPLIFY2_API" >> "$SANDBOX/marks/tasks"
EOF
prog ticker l <<'EOF'
#!/bin/sh
touch "$SANDBOX/marks/long.started"; sleep 3; echo done >> "$SANDBOX/marks/long.done"
EOF
task() { envs sh "$SBIN/splify2-task" "$@" >/dev/null 2>&1; }
rm -f "$T/etc/spec.json"
task ticker tick
check "only_if spec-present: спеки нет — задача не запущена" "no" "$(yn "$T/marks/tasks")"
printf '{"version":2}' > "$T/etc/spec.json"
task ticker tick
check "спека есть — задача запущена с окружением плагина и splify2-api" "ticker tick tick 1" "$(cat "$T/marks/tasks")"
task ticker unknown
task nosuch tick
check "неизвестные задача и плагин — тихий отказ, второго запуска нет" "1" "$(gc . "$T/marks/tasks")"
( task ticker long ) &
sleep 1
task ticker long
wait
check "замок: пока идёт прошлый запуск, второй не стартует" "1" "$(gc done "$T/marks/long.done")"
set_state ticker disabled
task ticker tick
check "плагин выключен — задача не запускается" "1" "$(gc . "$T/marks/tasks")"
touch "$PL/safe"; set_state ticker enabled
task ticker tick
check "безопасный режим: задача пропущена" "1" "$(gc . "$T/marks/tasks")"
rm -f "$PL/safe"

# =====================================================================================================
echo "== события ядра"
reset
fixture_plugin ev1 '{'"$M"',"id":"ev1","name":"x","splify2":{"events":{"prog":"e","subscribe":["applied","failed"]}}}'
fixture_plugin ev2 '{'"$M"',"id":"ev2","name":"x","splify2":{"events":{"prog":"e","subscribe":["*"]}}}'
for id in ev1 ev2; do
    prog $id e <<'EOF'
#!/bin/sh
cat >> "$SANDBOX/marks/ev-$STEER_PLUGIN_ID"
EOF
done
sync_now
check "есть подписчики на события — служба splify2-events запущена один раз" "enable|running|start|" "$(tr '\n' '|' < "$T/events-initd.log")"
{
  printf '%s\n' '{"v":1,"ev":"applied","by":"apply","spec":"5a0e","enabled":true}'
  printf '%s\n' '{"v":1,"ev":"switched","out":"vpn","to":"wg0"}'
  printf '%s\n' '{"v":1,"ev":"failed","out":"vpn"}'
  printf '%s\n' 'не событие'
} > "$T/events.in"
envs EVENTS_ONCE=1 sh "$SBIN/splify2-events" >/dev/null 2>&1
check "ev1 получил applied и failed, но не switched" "2;1;1;0" "$(gc '"api":1' "$T/marks/ev-ev1");$(gc '"ev":"applied"' "$T/marks/ev-ev1");$(gc '"ev":"failed"' "$T/marks/ev-ev1");$(gc '"ev":"switched"' "$T/marks/ev-ev1")"
check "ev2 с фильтром «*» получил все три события, мусор — нет" "3" "$(gc '"ev"' "$T/marks/ev-ev2")"
check "событие передано объектом внутри оболочки {api, event}" "applied" "$(head -1 "$T/marks/ev-ev1" | pj 'd["event"]["ev"]')"
set_state ev1 disabled; set_state ev2 disabled
sync_now
check "подписчиков не осталось — служба остановлена и снята с автозапуска" "stop|disable|" "$(tail -n 2 "$T/events-initd.log" | tr '\n' '|')"

# =====================================================================================================
echo "== хук purge"
reset
fixture_plugin pg '{'"$M"',"id":"pg","name":"x","permissions":["splify2.hooks"],"splify2":{"hooks":{"purge":{"prog":"h"}}}}'
prog pg h <<'EOF'
#!/bin/sh
body="$(cat)"
case "$body" in
    *'"dry_run":false'*) echo "did" >> "$SANDBOX/marks/purge.done"; echo '{"ok":true,"plan":["ключ /etc/pg.key удалён"]}' ;;
    *) echo '{"ok":true,"plan":["ключ /etc/pg.key будет удалён"]}' ;;
esac
EOF
purge() {  # КЛЮЧИ
    mkdir -p "$T/etc/splify2" "$T/etc/steer"
    envs SPLIFY2_DIR="$T/etc/splify2" STEER_DIR="$T/etc/steer" CRONTAB="$T/etc/crontabs-purge" CRON_INITD="$T/bin/none" \
        INITD="$T/bin/none" FW_INITD="$T/bin/none" BOX_INITD="$T/bin/none" RECHECK_INITD="$T/bin/none" \
        STATE_PATHS="$T/var/none" NFT_TABLES="" FW_ZONES="" FW_LEGACY_ZONES="" EXT_LIB_SH="$LIBD/ext.sh" \
        sh "$SBIN/splify2-purge" "$@" 2>&1
}
out="$(purge)"
check "показ: план плагина в общем плане, ничего не удалено" "yes;no" "$(printf '%s' "$out" | grep -q 'будет сделано: pg: ключ /etc/pg.key будет удалён' && echo yes || echo no);$(yn "$T/marks/purge.done")"
out="$(purge --yes)"
check "--yes: хук вызван с dry_run:false, его слова — в плане" "yes;yes" "$(printf '%s' "$out" | grep -q 'pg: ключ /etc/pg.key удалён' && echo yes || echo no);$(yn "$T/marks/purge.done")"
touch "$PL/safe"
out="$(purge)"
check "безопасный режим: хуки purge не зовутся, об этом сказано" "yes" "$(printf '%s' "$out" | grep -q 'безопасный режим: хуки purge плагинов не вызваны' && echo yes || echo no)"
rm -f "$PL/safe"

# =====================================================================================================
echo "== хук backup_sections и архив настроек"
reset backup
fixture_plugin bs '{'"$M"',"id":"bs","name":"x","permissions":["splify2.hooks"],"splify2":{"hooks":{"backup_sections":{"prog":"h"}}}}'
prog bs h <<'EOF'
#!/bin/sh
body="$(cat)"
case "$body" in
    *'"op":"export"'*) printf '{"ok":true,"sections":{"state":"первая строка\\n[spec]\\n# не комментарий\\nтретья","empty":""}}\n' ;;
    *'"op":"restore"'*) printf '%s' "$body" > "$SANDBOX/marks/restore.in"; echo '{"ok":true}' ;;
esac
EOF
out="$(rpc backup_get '{"offset":0}')"
arch="$(printf '%s' "$out" | pj 'd["text"]')"
check "архив с разделами плагина — формат 4" "4" "$(printf '%s' "$out" | pj 'd["format"]')"
check "раздел плагина в архиве: заголовок [plugin bs state]" "yes" "$(printf '%s\n' "$arch" | grep -q '^\[plugin bs state\]$' && echo yes || echo no)"
check "строки раздела — с отступом: [spec] внутри текста заголовком не стал" "1;yes" "$(printf '%s\n' "$arch" | grep -c '^\[spec\]$');$(printf '%s\n' "$arch" | grep -q '^ \[spec\]$' && echo yes || echo no)"
# Восстановление: тот же архив обратно — плагину уходят его разделы дословно.
body="$(python3 -c 'import json,sys; print(json.dumps({"text": sys.stdin.read(), "final": True}))' <<EOF
$arch
EOF
)"
out="$(rpc backup_put "$body")"
check "backup_put принял архив с разделами плагина" "true;1" "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()');$(printf '%s' "$out" | pj 'd.get("plugins", 0)')"
check "плагин получил раздел дословно (строки, [spec], #)" "первая строка|[spec]|# не комментарий|третья" "$(pj 'd["ctx"]["sections"]["state"]' < "$T/marks/restore.in" | tr '\n' '|' | sed 's/|$//')"
check "и op=restore" "restore" "$(pj 'd["ctx"]["op"]' < "$T/marks/restore.in")"
# Раздел плагина, которого нет на роутере: предупреждение, остальное восстановлено.
set_state bs disabled
rm -f "$T/marks/restore.in"
out="$(rpc backup_put "$body")"
check "плагина нет: архив принят, в warn — какой раздел не восстановлен" "true;yes;no" "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()');$(printf '%s' "$out" | pj 'd["warn"]' | grep -q 'раздел плагина bs не восстановлен' && echo yes || echo no);$(yn "$T/marks/restore.in")"
out="$(rpc backup_get '{"offset":0}')"
check "без плагина-источника архив снова формата 3" "3" "$(printf '%s' "$out" | pj 'd["format"]')"
# Негодные заголовки разделов плагина отвергаются разборщиком целиком.
bad="$(printf 'splify2-backup 4\n[plugin bs ../x]\n a\n')"
out="$(rpc backup_put "$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1], "final": True}))' "$bad")")"
check "имя раздела плагина с точкой отвергнуто" "false" "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()')"
bad="$(printf 'splify2-backup 4\n[plugin bs state]\nбез отступа\n')"
out="$(rpc backup_put "$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1], "final": True}))' "$bad")")"
check "строка раздела плагина без отступа отвергнута" "false" "$(printf '%s' "$out" | pj 'str(d["ok"]).lower()')"
bad="$(printf 'splify2-backup 5\n[spec]\n{}\n')"
out="$(rpc backup_put "$(python3 -c 'import json,sys; print(json.dumps({"text": sys.argv[1], "final": True}))' "$bad")")"
check "файл версии 5 отвергнут: понимается до 4" "yes" "$(printf '%s' "$out" | grep -q 'понимает до 4' && echo yes || echo no)"

# =====================================================================================================
echo "== сборка .s2p: плагины каркаса из архива работают так же, как из каталога"
SDK="${PLUGIN_SDK:-$ROOT/../plugin-sdk}"
[ -d "$SDK" ] || SDK="$ROOT/../../plugin-sdk"
[ -d "$SDK" ] || SDK=/home/yo1nk/splicicd/plugin-sdk
if { command -v s2p >/dev/null 2>&1 || [ -x "$SDK/bin/s2p" ] || { [ -f "$SDK/build.sh" ] && command -v go >/dev/null 2>&1; }; }; then
    mkdir -p "$T/dist"
    if PLUGIN_SDK="$SDK" S2P_OUT_DIR="$T/dist" sh "$ROOT/plugins/build.sh" >"$T/build.log" 2>&1; then built=ok; else built=fail; cat "$T/build.log"; fi
    check "plugins/build.sh: lint и сборка обоих плагинов" "ok;2" "$built;$(ls "$T/dist" | grep -c '\.s2p$')"
    reset
    for id in backup lists-catalog; do
        mkdir -p "$PL/lib/$id"
        tar xzf "$T/dist/$id-1.0.0-all.s2p" -C "$PL/lib/$id"
        python3 - "$PL/state.json" "$id" <<'PY'
import json, sys
p, i = sys.argv[1:3]
d = json.load(open(p)); d.setdefault("plugins", {})[i] = {"version": "1.0.0", "state": "enabled", "repo": "splify2-core-plugins"}
json.dump(d, open(p, "w"))
PY
    done
    check "в архиве программы исполняемые, как в каталоге" "yes;yes;yes" "$([ -x "$PL/lib/backup/bin/backup" ] && echo yes || echo no);$([ -x "$PL/lib/lists-catalog/bin/lists" ] && echo yes || echo no);$([ -x "$PL/lib/lists-catalog/bin/update-lists" ] && echo yes || echo no)"
    check "из архива: backup_get отвечает" "true" "$(rpc backup_get '{"offset":0}' | pj 'str(d["ok"]).lower()')"
    check "из архива: lists отвечает ответом каталога, а не отказом плагина" "no" "$(rpc lists | pj '"yes" if d.get("code") in ("not_installed", "unavailable", "failed") else "no"')"
    sync_now
    check "из архива: задача update-lists в crontab" "1" "$(gc 'splify2-task lists-catalog update-lists' "$PL/crontab")"
else
    echo "ПРОПУЩЕНО: нет s2p и нет Go для сборки SDK (PLUGIN_SDK=каталог plugin-sdk)"
fi

printf '\n%d проверок пройдено' "$passes"
if [ "$fails" -gt 0 ]; then printf ', %d ПРОВАЛЕНО\n' "$fails"; exit 1; fi
printf '\nвсе проверки прошли\n'
