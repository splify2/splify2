#!/bin/sh
# Плагины в бэкенде splify2: методы вкладки «Плагины» (rpcd/m-plugin.sh), диспетчер методов самих
# плагинов (plugin-rpcd, plugin_call), ссылки и ACL объектов splify2.p.<id>, шлюз /v1/plugin/*.
#
# ХОЗЯИН ПЛАГИНОВ — ЯДРО STEER, ЕГО МЕНЕДЖЕР ПИШЕТСЯ ПАРАЛЛЕЛЬНО. Поэтому стенд работает с заглушкой
# `steer plugin …` (tests/stub/steer-plugin): она держит состояние в песочнице так же, как менеджер —
# state.json и каталоги плагинов, — а проверки идут по двум поверхностям: что бэкенд СКАЗАЛ менеджеру
# (журнал вызовов, слова аргументов) и что ОТВЕТИЛ интерфейсу (точная форма — docs/rpcd-api.md,
# раздел «Плагины»). Настоящий менеджер стенд не заменяет: форма его вывода — допущение (см. там же).
#
# Диспетчер плагина проверяется настоящим: исполняемая ссылка splify2.p.<id> -> plugin-rpcd, как её
# запускает rpcd; программа плагина — маленький shell-скрипт в песочнице.
#
# Запуск: sh tests/pluginmatch.sh (нужен python3).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/files/usr/libexec/rpcd/splify2"
DISPATCHER="$ROOT/files/usr/lib/splify2/plugin-rpcd"
T="$(mktemp -d /tmp/pluginmatch.XXXXXX)"
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

mkdir -p "$T/bin" "$T/lock"
cp "$ROOT/tests/stub/jsonfilter" "$T/bin/jsonfilter"; chmod +x "$T/bin/jsonfilter"
# steer: только менеджер плагинов; всё остальное — отказ (в этих методах ядро больше ничем не нужно).
cat > "$T/bin/steer" <<'EOF'
#!/bin/sh
if [ "${1:-}" = plugin ]; then shift; exec sh "$STEER_PLUGIN_STUB" "$@"; fi
exit 1
EOF
# rpcd reload — в журнал (RELOAD_DELAY=0 у стенда: перечитка в фоне идёт сразу).
cat > "$T/bin/initd-rpcd" <<'EOF'
#!/bin/sh
echo "$1" >> "$SANDBOX/rpcd-initd.log"
exit 0
EOF
chmod +x "$T/bin/steer" "$T/bin/initd-rpcd"

PLUG="$T/plug"
PATH="$T/bin:$PATH"
envs() {
    env SANDBOX="$T" PATH="$T/bin:$PATH" S2_LANG=ru S2_DICT_EXTRA="$ROOT/plugins/lang-ru/i18n/backend" \
        JSHN_SH="$ROOT/tests/stub/jshn.sh" RPCD_LIB="$ROOT/files/usr/lib/splify2/rpcd" \
        FAST_SH="$ROOT/files/usr/lib/splify2/fast.sh" FETCH_SH="$ROOT/files/usr/lib/splify2/fetch.sh" \
        SPLIFY2_LOCK_DIR="$T/lock" \
        PLUGIN_SH="$ROOT/files/usr/lib/splify2/plugin.sh" PLUG="$PLUG" \
        PLUGIN_ROOT="$PLUG/lib" PLUGIN_STATE="$PLUG/state.json" PLUGIN_RPCD_DIR="$PLUG/rpcd" \
        PLUGIN_ACL_DIR="$PLUG/acl" PLUGIN_UI_DIR="$PLUG/www" PLUGIN_VIEW_DIR="$PLUG/views" PLUGIN_JOBS="$PLUG/jobs" PLUGIN_RELOAD_DELAY=0 \
        PLUGIN_DISPATCHER="$DISPATCHER" \
        EXT_REG="$PLUG/run/ext.reg" EXT_SAFE_FILE="$PLUG/safe" EXT_TASKS_JSON="$PLUG/tasks.json" \
        EXT_CRONTAB="$PLUG/crontab" EXT_TASK_LOCK_DIR="$PLUG/run" EXT_EVENTS_INITD="$PLUG/no-events-initd" \
        EXT_METHODS_TSV="$ROOT/files/usr/lib/splify2/methods.tsv" SPLIFY2_LIBDIR="$ROOT/files/usr/lib/splify2" \
        STEER_PLUGIN_STUB="$ROOT/tests/stub/steer-plugin" STEER="${STEER_FIXTURE:-$T/bin/steer}" \
        RPCD_INITD="$T/bin/initd-rpcd" \
        "$@"
}
rpcd() {  # МЕТОД [JSON]
    printf '%s\n' "${2:-}" | envs sh "$SCRIPT" call "$1" 2>"$T/stderr"
}
rpcd_list() { envs sh "$SCRIPT" list 2>"$T/stderr"; }
# Диспетчер плагина так, как его запускает rpcd: исполняемая ссылка с именем объекта.
disp() {  # ID ДЕЙСТВИЕ [МЕТОД] — тело на stdin
    envs "$PLUG/rpcd/splify2.p.$1" "$2" "${3:-}" 2>"$T/stderr"
}

# Поле ответа выражением python над `d`: bool и объекты печатаются как JSON, строки — как есть.
pj() {  # ВЫРАЖЕНИЕ < JSON
    python3 -c 'import json,sys
try: d = json.load(sys.stdin)
except Exception: print("НЕ JSON"); raise SystemExit
try: v = eval(sys.argv[1])
except Exception as e: v = "НЕТ ПОЛЯ"
print(v if isinstance(v, str) else json.dumps(v, ensure_ascii=False))' "$1"
}

reload_count() { [ -f "$T/rpcd-initd.log" ] && grep -c '^reload$' "$T/rpcd-initd.log" || echo 0; }
manager_calls() { cat "$PLUG/manager.log" 2>/dev/null | tr '\n' '|' | sed 's/|$//'; }

# Задание: ждать конца (не дольше ~10 с), печатает последний ответ plugin_job.
wait_job() {  # НОМЕР
    _n=0
    while [ "$_n" -lt 50 ]; do
        _o="$(rpcd plugin_job "{\"id\":\"$1\"}")"
        [ "$(printf '%s' "$_o" | pj 'd.get("state")')" = running ] || break
        _n=$((_n + 1)); sleep 0.2
    done
    printf '%s' "$_o"
}

# ---- состояние песочницы: плагины, как их ставит менеджер ---------------------------------------------
plug_reset() {
    rm -rf "$PLUG" "$T/rpcd-initd.log"
    mkdir -p "$PLUG/lib" "$PLUG/rpcd" "$PLUG/acl" "$PLUG/jobs" "$PLUG/fixtures" "$PLUG/www"
    echo '{"schema":1,"plugins":{}}' > "$PLUG/state.json"
}
# Плагин с rpc: программа rpc/prog разбирает метод; ответ несёт вход, чтобы видеть, что дошло.
mk_plugin() {  # КАТАЛОГ ID ВЕРСИЯ
    mkdir -p "$1/rpc"
    cat > "$1/plugin.json" <<MANIFEST
{"schema":1,"id":"$2","version":"$3","name":"$2",
 "rpc":{"prog":"rpc/prog","methods":{
   "status":{"access":"read"},
   "set":{"access":"write","timeout_s":5},
   "scan":{"access":"write","job":true},
   "slow":{"access":"read","timeout_s":1},
   "boom":{"access":"read"},
   "junk":{"access":"read"},
   "env":{"access":"read"}}}}
MANIFEST
    cat > "$1/rpc/prog" <<'PROG'
#!/bin/sh
: > "$(dirname "$0")/ran"
body="$(cat)"
case "$1" in
    status) printf '{"ok":true,"method":"status","in":%s}\n' "${body:-null}" ;;
    set)    printf '{"ok":true,"method":"set","in":%s}\n' "${body:-null}" ;;
    scan)   sleep 1; printf '{"ok":true,"scanned":true}\n' ;;
    slow)   sleep 5; printf '{"ok":true}\n' ;;
    boom)   echo "что-то сломалось" >&2; exit 3 ;;
    junk)   echo "это не json" ;;
    env)    printf '{"ok":true,"id":"%s","dir":"%s","pwd":"%s"}\n' "$STEER_PLUGIN_ID" "$STEER_PLUGIN_DIR" "$(pwd)" ;;
esac
PROG
    chmod +x "$1/rpc/prog"
}
put_state() {  # ID ВЕРСИЯ СОСТОЯНИЕ
    python3 - "$PLUG/state.json" "$1" "$2" "$3" <<'PY'
import json, sys
p, i, v, st = sys.argv[1:5]
d = json.load(open(p)); d["plugins"][i] = {"version": v, "state": st, "repo": "splify2"}
json.dump(d, open(p, "w"))
PY
}
install_plugin() {  # ID ВЕРСИЯ [СОСТОЯНИЕ]
    mk_plugin "$PLUG/lib/$1" "$1" "$2"; put_state "$1" "$2" "${3:-enabled}"
}
fixture_plugin() { mk_plugin "$PLUG/fixtures/$1" "$1" "$2"; }

plug_reset

# ---- методы объявлены везде, где их ищут --------------------------------------------------------------
METHODS="plugins_list plugins_search repos_list plugin_status plugin_job plugin_install plugin_update plugin_remove plugin_enable plugin_disable plugin_autoupdate repo_key repo_add repo_del plugin_call plugin_settings_get plugin_settings_set i18n_get"
out="$(rpcd_list)"
ACL="$ROOT/luci/root/usr/share/rpcd/acl.d/splify2.json"
for m in $METHODS; do
    check "метод $m — в перечне rpcd, в ACL и в контракте" "yes;yes;yes" \
        "$(printf '%s' "$out" | pj "'$m' in d" | sed 's/true/yes/; s/false/no/');$(grep -q "\"$m\"" "$ACL" && echo yes || echo no);$(grep -q "| \`$m\` |" "$ROOT/docs/rpcd-api.md" && echo yes || echo no)"
done
check "чтение и запись разведены: plugin_install и repo_add — write, plugins_list и plugin_job — read" "yes" \
    "$(python3 - "$ACL" <<'PY'
import json, sys
a = json.load(open(sys.argv[1]))["splify2"]
r, w = a["read"]["ubus"]["splify2"], a["write"]["ubus"]["splify2"]
ok = {"plugins_list", "plugin_job", "repos_list", "plugin_status", "plugins_search", "repo_key"} <= set(r) \
     and {"plugin_install", "plugin_update", "plugin_remove", "plugin_enable", "plugin_disable",
          "plugin_autoupdate", "repo_add", "repo_del", "plugin_call"} <= set(w)
print("yes" if ok else "no")
PY
)"
check "метод, которого нет, отвечает отказом" "false" "$(rpcd plugin_nope '{}' | pj 'd["ok"]')"

# ---- plugins_list: установленные, репозитории, версия host API ------------------------------------------
plug_reset
out="$(rpcd plugins_list)"
check "пустой список: ok, версия host API, пустые массивы" 'true;1.0.0;[];[]' \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["host_api"]');$(printf '%s' "$out" | pj 'd["plugins"]');$(printf '%s' "$out" | pj 'd["repos"]')"
check "  менеджеру сказано: list, repo list" "list|repo list" "$(manager_calls)"
check "  ядру ушёл флаг --json" "yes" "$(grep -q . "$PLUG/manager.log" && echo yes || echo no)"

plug_reset
printf '%s\n' '{"plugins":[{"id":"vless","version":"2.1.1","repo":"splify2","state":"enabled","why":null,"auto_update":true,"pinned":null},{"id":"recheck","version":"1.0.0","repo":"splify2","state":"failed","why":"нужен пакет kmod-nfnetlink-queue"}]}' > "$PLUG/list.json"
printf '%s\n' '{"repos":[{"name":"splify2","url":"https://splify2.github.io/plugins/","official":true}]}' > "$PLUG/repos.json"
out="$(rpcd plugins_list)"
check "плагины из ответа менеджера идут как есть" "vless recheck;enabled failed;нужен пакет kmod-nfnetlink-queue" \
    "$(printf '%s' "$out" | pj '" ".join(p["id"] for p in d["plugins"])');$(printf '%s' "$out" | pj '" ".join(p["state"] for p in d["plugins"])');$(printf '%s' "$out" | pj 'd["plugins"][1]["why"]')"
check "  репозитории — как есть" "splify2;true" \
    "$(printf '%s' "$out" | pj 'd["repos"][0]["name"]');$(printf '%s' "$out" | pj 'd["repos"][0]["official"]')"
# Менеджер может отдать сам массив, без объекта-обёртки.
printf '%s\n' '[{"id":"vless","version":"2.1.1","state":"enabled"}]' > "$PLUG/list.json"
check "менеджер отдал голый массив — он и есть список" "vless" "$(rpcd plugins_list | pj 'd["plugins"][0]["id"]')"

plug_reset
printf 'ключ индекса не принят\n' > "$PLUG/fail.list"
out="$(rpcd plugins_list)"
check "менеджер отказал: ok=false и его слова, код failed" "false;ключ индекса не принят;failed" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["error"]');$(printf '%s' "$out" | pj 'd["code"]')"
rm -f "$PLUG/fail.list"; printf 'репозиторий недоступен\n' > "$PLUG/fail.repo"
printf '%s\n' '{"plugins":[{"id":"vless","version":"2.1.1","state":"enabled"}]}' > "$PLUG/list.json"
out="$(rpcd plugins_list)"
check "не ответил список репозиториев — плагины показаны, причина в repos_error" "true;vless;[];репозиторий недоступен" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["plugins"][0]["id"]');$(printf '%s' "$out" | pj 'd["repos"]');$(printf '%s' "$out" | pj 'd["repos_error"]')"
rm -f "$PLUG/fail.repo"
printf 'busy\n' > "$PLUG/fail.list"
check "менеджер занят другим запросом — код busy" "busy" "$(rpcd plugins_list | pj 'd["code"]')"

# Название и описание на языке человека: ключи plugin.name и plugin.description словаря плагина.
plug_reset
printf '%s\n' '{"plugins":[{"id":"backup","name":"Архив настроек","version":"1.0.0","state":"enabled"}]}' > "$PLUG/list.json"
mkdir -p "$PLUG/lib/backup/i18n" "$PLUG/lib/solo"
printf '%s\n' '{"schema":1,"id":"backup","version":"1.0.0","name":"Архив настроек","i18n":{"languages":["ru","en"]}}' > "$PLUG/lib/backup/plugin.json"
printf '%s\n' '{"plugin.name":"Архив настроек","plugin.description":"Выгрузка в файл"}' > "$PLUG/lib/backup/i18n/ru.json"
printf '%s\n' '{"plugin.name":"Settings \"archive\"","plugin.description":"Export to a file"}' > "$PLUG/lib/backup/i18n/en.json"
printf '%s\n' '{"schema":1,"id":"solo","version":"1.0.0","name":"Один"}' > "$PLUG/lib/solo/plugin.json"
check "plugins_list: без языка — названия на en" "Settings \"archive\";Export to a file" \
    "$(rpcd plugins_list '{}' | pj 'd["names"]["backup"]["name"]');$(rpcd plugins_list '{}' | pj 'd["names"]["backup"]["description"]')"
check "plugins_list: язык ru — словарь ru" "Архив настроек;Выгрузка в файл" \
    "$(rpcd plugins_list '{"lang":"ru"}' | pj 'd["names"]["backup"]["name"]');$(rpcd plugins_list '{"lang":"ru"}' | pj 'd["names"]["backup"]["description"]')"
check "plugins_list: языка нет (de-AT) — en" "Export to a file" "$(rpcd plugins_list '{"lang":"de-AT"}' | pj 'd["names"]["backup"]["description"]')"
check "plugins_list: плагина без словаря в names нет (интерфейс берёт слова манифеста)" "no" \
    "$(rpcd plugins_list '{"lang":"ru"}' | pj '"solo" in d["names"]' | sed 's/True/yes/;s/true/yes/;s/False/no/;s/false/no/')"
check "plugins_list: недопустимый язык — не ломает ответ, en" "true;Export to a file" \
    "$(rpcd plugins_list '{"lang":"../x"}' | pj 'd["ok"]');$(rpcd plugins_list '{"lang":"../x"}' | pj 'd["names"]["backup"]["description"]')"
# Названия — из кэша на язык (plugin_names_cached); словарь сменился — кэш не годен.
sleep 1.1; rpcd plugins_list '{"lang":"ru"}' >/dev/null; rpcd plugins_list '{"lang":"ru"}' >/dev/null
check "plugins_list: названия ложатся в кэш на язык; чужой путь в имени файла не попадает" "yes;no" \
    "$([ -f "$PLUG/run/ext.reg.names.ru" ] && echo yes || echo no);$(ls "$PLUG/run" | grep -q '\.\.' && echo yes || echo no)"
check "  из кэша — те же слова" "Архив настроек" "$(rpcd plugins_list '{"lang":"ru"}' | pj 'd["names"]["backup"]["name"]')"
sleep 1.1
printf '%s\n' '{"plugin.name":"Архив","plugin.description":"Выгрузка"}' > "$PLUG/lib/backup/i18n/ru.json"
check "  словарь сменился — новые слова" "Архив;Выгрузка" \
    "$(rpcd plugins_list '{"lang":"ru"}' | pj 'd["names"]["backup"]["name"]');$(rpcd plugins_list '{"lang":"ru"}' | pj 'd["names"]["backup"]["description"]')"
check "  другой язык — свой кэш" "Export to a file" "$(rpcd plugins_list '{"lang":"en"}' | pj 'd["names"]["backup"]["description"]')"
rm -f "$PLUG/fail.list"
out="$(STEER_FIXTURE=/nonexistent/steer rpcd plugins_list)"
check "ядро без менеджера плагинов — понятный отказ" "false;ядро не умеет плагины — обновите steer" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["error"]')"
printf 'индекс устарел — подключитесь к сети\n' > "$PLUG/failjson.list"
check "отказ менеджера JSON-ом: берётся поле error" "индекс устарел — подключитесь к сети" "$(rpcd plugins_list | pj 'd["error"]')"
rm -f "$PLUG/failjson.list"

# ---- каталог, репозитории, состояние ---------------------------------------------------------------------
plug_reset
printf '%s\n' '{"plugins":[{"id":"warpbox","name":"WarpBox","version":"1.3.0","repo":"splify2","installed":false}]}' > "$PLUG/search.json"
out="$(rpcd plugins_search '{"query":"warp"}')"
check "каталог: плагины менеджера как есть, слово передано менеджеру" "true;warpbox;search warp" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["plugins"][0]["id"]');$(manager_calls)"
rm -f "$PLUG/manager.log"
check "каталог без слова — менеджеру без слова" "search" "$(rpcd plugins_search '{}' >/dev/null; manager_calls)"
check "слово с дефиса отвергается (приняли бы за флаг)" "false;bad_request" \
    "$(rpcd plugins_search '{"query":"--help"}' | pj 'str(d["ok"]).lower()');$(rpcd plugins_search '{"query":"--help"}' | pj 'd["code"]')"
check "слово по-русски идёт как есть" "search обход" "$(rm -f "$PLUG/manager.log"; rpcd plugins_search '{"query":"обход"}' >/dev/null; manager_calls)"
printf 'каталог недоступен\n' > "$PLUG/fail.search"
check "каталог недоступен — слова менеджера" "каталог недоступен" "$(rpcd plugins_search '{}' | pj 'd["error"]')"
rm -f "$PLUG/fail.search"

printf '%s\n' '{"repos":[{"name":"splify2","official":true},{"name":"my","url":"https://x.example/p/","official":false}]}' > "$PLUG/repos.json"
out="$(rpcd repos_list)"
check "репозитории: массив менеджера, у стороннего official=false" "true;splify2 my;false" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj '" ".join(r["name"] for r in d["repos"])');$(printf '%s' "$out" | pj 'd["repos"][1]["official"]')"

printf '%s\n' '{"id":"vless","state":"enabled","version":"2.1.1"}' > "$PLUG/status.json"
rm -f "$PLUG/manager.log"
out="$(rpcd plugin_status '{"id":"vless"}')"
check "состояние одного плагина: ответ менеджера под ключом status" "true;enabled;status vless" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["status"]["state"]');$(manager_calls)"
rm -f "$PLUG/manager.log"
check "состояние всех — без id" "status" "$(rpcd plugin_status '{}' >/dev/null; manager_calls)"
check "id с недопустимыми знаками отвергается" "false;bad_request" \
    "$(rpcd plugin_status '{"id":"../x"}' | pj 'str(d["ok"]).lower()');$(rpcd plugin_status '{"id":"../x"}' | pj 'd["code"]')"

# ---- установка и обновление — заданиями ----------------------------------------------------------------------
plug_reset
fixture_plugin recheck 1.0.0
: > "$PLUG/slow"
rm -f "$PLUG/manager.log"
out="$(rpcd plugin_install '{"id":"recheck"}')"
job="$(printf '%s' "$out" | pj 'd["job"]')"
check "установка отвечает сразу заданием" "true;recheck;yes" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["id"]');$([ -n "$job" ] && [ "$job" != "НЕТ ПОЛЯ" ] && echo yes || echo no)"
sleep 0.5
out="$(rpcd plugin_job "{\"id\":\"$job\"}")"
check "пока менеджер работает — идёт, ход — его последняя строка" "true;running;скачивание recheck" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["state"]');$(printf '%s' "$out" | pj 'd.get("progress","")')"
out="$(wait_job "$job")"
check "готово: state=done, result — ответ менеджера" "true;done;recheck;1.0.0" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["state"]');$(printf '%s' "$out" | pj 'd["result"]["id"]');$(printf '%s' "$out" | pj 'd["result"]["version"]')"
check "  менеджеру сказано: install recheck" "install recheck" "$(manager_calls)"
check "  плагин включён в state.json" "enabled" "$(jsonfilter -i "$PLUG/state.json" -e "@.plugins['recheck'].state")"
check "  объект плагина создан: ссылка на общий обработчик" "$DISPATCHER" "$(readlink "$PLUG/rpcd/splify2.p.recheck")"
check "  ACL группы splify2-p-recheck создан" "yes" "$([ -f "$PLUG/acl/splify2-p-recheck.json" ] && echo yes || echo no)"
check "  rpcd перечитан по завершении" "1" "$(reload_count)"
rm -f "$PLUG/slow"

# Версия и отказы входа — сразу, без задания.
rm -f "$PLUG/manager.log"
check "версия уходит менеджером вторым словом" "install recheck 1.0.0" "$(rpcd plugin_install '{"id":"recheck","version":"1.0.0"}' >/dev/null; sleep 0.5; manager_calls)"
for bad in '{"id":"../x"}' '{"id":"UPPER"}' '{"id":"-x"}' '{"id":""}' '{}' '{"id":"a b"}'; do
    check "  недопустимый id $bad" "false;bad_request" \
        "$(rpcd plugin_install "$bad" | pj 'str(d["ok"]).lower()');$(rpcd plugin_install "$bad" | pj 'd["code"]')"
done
check "  недопустимая версия" "false;bad_request" \
    "$(rpcd plugin_install '{"id":"recheck","version":"1.0;rm"}' | pj 'str(d["ok"]).lower()');$(rpcd plugin_install '{"id":"recheck","version":"1.0;rm"}' | pj 'd["code"]')"

# Отказ установки — слова менеджера в итоге задания, ссылок нет.
plug_reset
fixture_plugin recheck 1.0.0
printf 'нужно 1,8 МБ, свободно 0,9 МБ\n' > "$PLUG/fail.install"
job="$(rpcd plugin_install '{"id":"recheck"}' | pj 'd["job"]')"
out="$(wait_job "$job")"
check "отказ установки: ok=false, state=failed, слова менеджера" "false;failed;нужно 1,8 МБ, свободно 0,9 МБ" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["state"]');$(printf '%s' "$out" | pj 'd["error"]')"
check "  ссылок и ACL нет" "0" "$(find "$PLUG/rpcd" "$PLUG/acl" -type f -o -type l | grep -c .)"
rm -f "$PLUG/fail.install"
job="$(rpcd plugin_install '{"id":"nonexistent"}' | pj 'd["job"]')"
check "плагина нет в каталоге — отказ менеджера доходит" "в каталоге нет плагина nonexistent" "$(wait_job "$job" | pj 'd["error"]')"
printf 'busy\n' > "$PLUG/fail.install"
job="$(rpcd plugin_install '{"id":"recheck"}' | pj 'd["job"]')"
check "менеджер занят — отказ задания называет это" "failed;busy" \
    "$(wait_job "$job" | pj 'd["state"]');$(wait_job "$job" | pj 'd["error"]')"
rm -f "$PLUG/fail.install"
out="$(rpcd plugin_job '{"id":"0123456789abcdef"}')"
check "задания с таким номером нет" "false;no_job" "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["code"]')"
check "номер задания с посторонними знаками — тоже нет" "no_job" "$(rpcd plugin_job '{"id":"../../etc"}' | pj 'd["code"]')"
# Задание, чей процесс пропал, не висит «идёт» вечно.
mkdir -p "$PLUG/jobs/aaaa"; echo 999999 > "$PLUG/jobs/aaaa/pid"
check "оборванное задание — failed, а не вечное «идёт»" "failed;задание оборвано" \
    "$(rpcd plugin_job '{"id":"aaaa"}' | pj 'd["state"]');$(rpcd plugin_job '{"id":"aaaa"}' | pj 'd["error"]')"

# Обновление: одного и всех.
plug_reset
rm -f "$PLUG/manager.log"
job="$(rpcd plugin_update '{"id":"vless"}' | pj 'd["job"]')"; wait_job "$job" >/dev/null
job="$(rpcd plugin_update '{}' | pj 'd["job"]')"; out="$(wait_job "$job")"
check "обновление: один плагин и все — заданиями" "update vless|update;true;done" \
    "$(manager_calls);$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["state"]')"
check "  недопустимый id при обновлении" "bad_request" "$(rpcd plugin_update '{"id":"X!"}' | pj 'd["code"]')"

# ---- включение, выключение, снятие: объекты плагинов следуют за состоянием -----------------------------------
plug_reset
install_plugin recheck 1.0.0 disabled
install_plugin vless 2.1.1
printf '{"schema":1,"id":"vless","version":"2.1.1","name":"vless"}\n' > "$PLUG/lib/vless/plugin.json"
rm -f "$PLUG/manager.log"
out="$(rpcd plugin_enable '{"id":"recheck"}')"; sleep 0.3
check "включение: ok, id; менеджеру — enable" "true;recheck;enable recheck" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["id"]');$(manager_calls)"
check "  плагин с rpc получил объект и ACL, rpcd перечитан" "yes;yes;1" \
    "$([ -L "$PLUG/rpcd/splify2.p.recheck" ] && echo yes || echo no);$([ -f "$PLUG/acl/splify2-p-recheck.json" ] && echo yes || echo no);$(reload_count)"
check "  плагин без rpc (vless) объекта не получил" "no" "$([ -e "$PLUG/rpcd/splify2.p.vless" ] && echo yes || echo no)"
out="$(rpcd plugin_disable '{"id":"recheck"}')"; sleep 0.3
check "выключение: объект и ACL убраны, rpcd перечитан" "true;no;no;2" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$([ -e "$PLUG/rpcd/splify2.p.recheck" ] && echo yes || echo no);$([ -e "$PLUG/acl/splify2-p-recheck.json" ] && echo yes || echo no);$(reload_count)"
check "  состояние у менеджера — disabled" "disabled" "$(jsonfilter -i "$PLUG/state.json" -e "@.plugins['recheck'].state")"
rpcd plugin_enable '{"id":"recheck"}' >/dev/null; sleep 0.3

printf 'nl, de\n' > "$PLUG/needed.recheck"
rm -f "$PLUG/manager.log"
out="$(rpcd plugin_remove '{"id":"recheck"}')"
check "снятие плагина, нужного выходам: отказ называет выходы" "false;плагин recheck нужен выходам: nl, de" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["error"]')"
check "  плагин и его объект на месте" "yes;yes" \
    "$([ -d "$PLUG/lib/recheck" ] && echo yes || echo no);$([ -L "$PLUG/rpcd/splify2.p.recheck" ] && echo yes || echo no)"
rm -f "$PLUG/manager.log"
out="$(rpcd plugin_remove '{"id":"recheck","force":true,"purge":true}')"; sleep 0.3
check "снятие с force и purge: менеджеру — оба флага" "true;remove recheck --force --purge" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(manager_calls)"
check "  объект и ACL ушли вместе с плагином" "no;no" \
    "$([ -e "$PLUG/rpcd/splify2.p.recheck" ] && echo yes || echo no);$([ -e "$PLUG/acl/splify2-p-recheck.json" ] && echo yes || echo no)"
rm -f "$PLUG/needed.recheck"
rm -f "$PLUG/manager.log"
rpcd plugin_remove '{"id":"vless"}' >/dev/null
check "снятие без флагов — без флагов" "remove vless" "$(manager_calls)"
check "  force не булевым не считается" "remove vless" "$(rm -f "$PLUG/manager.log"; rpcd plugin_remove '{"id":"vless","force":"yes"}' >/dev/null; manager_calls)"
for act in plugin_remove plugin_enable plugin_disable; do
    check "$act: недопустимый id" "false;bad_request" \
        "$(rpcd $act '{"id":"../x"}' | pj 'str(d["ok"]).lower()');$(rpcd $act '{"id":"../x"}' | pj 'd["code"]')"
done
printf 'плагин x не найден\n' > "$PLUG/fail.enable"
check "enable: отказ менеджера доходит его словами" "false;плагин x не найден" \
    "$(rpcd plugin_enable '{"id":"x"}' | pj 'd["ok"]');$(rpcd plugin_enable '{"id":"x"}' | pj 'd["error"]')"
rm -f "$PLUG/fail.enable"

# Автообновление.
install_plugin vless 2.1.1
rm -f "$PLUG/manager.log"
out="$(rpcd plugin_autoupdate '{"id":"vless","enabled":false}')"
check "автообновление выкл: менеджеру — off" "true;vless;false;autoupdate vless off" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["id"]');$(printf '%s' "$out" | pj 'd["enabled"]');$(manager_calls)"
rm -f "$PLUG/manager.log"
rpcd plugin_autoupdate '{"id":"vless","enabled":true}' >/dev/null
check "автообновление вкл: менеджеру — on" "autoupdate vless on" "$(manager_calls)"
check "  без enabled — отказ входа" "bad_request" "$(rpcd plugin_autoupdate '{"id":"vless"}' | pj 'd["code"]')"

# ---- репозитории ------------------------------------------------------------------------------------------------
# Ключ usign: «Ed» + 8 байт номера + 32 байта ключа, base64 на второй строке файла .pub.
KEYFILE="$T/repo.pub"
python3 - "$KEYFILE" <<'PY'
import base64, sys
raw = b"Ed" + bytes.fromhex("0123456789abcdef") + bytes(range(32))
open(sys.argv[1], "w").write("untrusted comment: public key 0123456789abcdef\n" + base64.b64encode(raw).decode() + "\n")
PY
KEY="$(cat "$KEYFILE")"
keyjson() { python3 -c 'import json,sys; print(json.dumps(dict(a.split("=",1) for a in sys.argv[1:]), ensure_ascii=False))' "$@"; }
out="$(rpcd repo_key "$(keyjson "key=$KEY")")"
check "номер ключа считается: 16 знаков hex из файла .pub" "true;0123456789abcdef" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["key_id"]')"
check "  голая строка base64 без комментария — тоже ключ" "0123456789abcdef" \
    "$(rpcd repo_key "$(keyjson "key=$(tail -n 1 "$KEYFILE")")" | pj 'd["key_id"]')"
check "  не ключ — отказ входа" "false;bad_request;Ключ не распознан" \
    "$(rpcd repo_key '{"key":"привет"}' | pj 'str(d["ok"]).lower()');$(rpcd repo_key '{"key":"привет"}' | pj 'd["code"]');$(rpcd repo_key '{"key":"привет"}' | pj 'd["error"]')"
check "  ключ другого вида (не Ed) отвергается" "bad_request" \
    "$(rpcd repo_key '{"key":"AAAA"}' | pj 'd["code"]')"

rm -f "$PLUG/manager.log"
out="$(rpcd repo_add "$(keyjson "url=https://x.example/plugins/" "key=$KEY" "key_id=0123456789abcdef")")"
check "подключение: менеджеру — адрес и номер ключа, ключ — телом" "true;0123456789abcdef;repo add https://x.example/plugins/ 0123456789abcdef" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["key_id"]');$(manager_calls)"
check "  тело ключа дошло менеджеру на stdin" "$(tail -n 1 "$KEYFILE")" "$(tail -n 1 "$PLUG/repo-add.key")"
check "  номер, который человек принял, не совпал с ключом — отказ" "false;bad_request" \
    "$(rpcd repo_add "$(keyjson "url=https://x.example/p/" "key=$KEY" "key_id=deadbeefdeadbeef")" | pj 'str(d["ok"]).lower()');$(rpcd repo_add "$(keyjson "url=https://x.example/p/" "key=$KEY" "key_id=deadbeefdeadbeef")" | pj 'd["code"]')"
rm -f "$PLUG/manager.log"
for badurl in 'ftp://x/p' 'x.example/p' 'https://x y/p' ''; do
    check "  адрес «$badurl» отвергается" "bad_request" "$(rpcd repo_add "$(keyjson "url=$badurl" "key=$KEY")" | pj 'd["code"]')"
done
check "  ключ не распознан — отказ, менеджера не звали" "bad_request;" \
    "$(rpcd repo_add "$(keyjson "url=https://x.example/p/" "key=мусор")" | pj 'd["code"]');$(manager_calls)"
printf 'ключ не подходит индексу\n' > "$PLUG/fail.repo"
check "  отказ менеджера доходит его словами" "false;ключ не подходит индексу" \
    "$(rpcd repo_add "$(keyjson "url=https://x.example/p/" "key=$KEY")" | pj 'd["ok"]');$(rpcd repo_add "$(keyjson "url=https://x.example/p/" "key=$KEY")" | pj 'd["error"]')"
rm -f "$PLUG/fail.repo" "$PLUG/manager.log"
out="$(rpcd repo_del '{"name":"my-repo.1"}')"
check "отключение: менеджеру — repo del <имя>" "true;my-repo.1;repo del my-repo.1" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["name"]');$(manager_calls)"
check "  имя с посторонними знаками отвергается" "bad_request" "$(rpcd repo_del '{"name":"../x"}' | pj 'd["code"]')"

# ---- диспетчер методов самих плагинов -------------------------------------------------------------------------------
plug_reset
install_plugin recheck 1.0.0
install_plugin warp-box 1.3.0
install_plugin lang-en 26.11.0
# lang-en без rpc: свой манифест
mkdir -p "$PLUG/lib/lang-en"; printf '{"schema":1,"id":"lang-en","version":"26.11.0","name":"English"}\n' > "$PLUG/lib/lang-en/plugin.json"
rpcd plugins_list >/dev/null; sleep 0.3

check "ссылки: у recheck и warp-box (id с дефисом) есть, у lang-en без rpc нет" "yes;yes;no" \
    "$([ -L "$PLUG/rpcd/splify2.p.recheck" ] && echo yes || echo no);$([ -L "$PLUG/rpcd/splify2.p.warp-box" ] && echo yes || echo no);$([ -e "$PLUG/rpcd/splify2.p.lang-en" ] && echo yes || echo no)"
check "ссылка — исполняемый обработчик: list даёт методы манифеста" "boom env junk scan set slow status" \
    "$(disp recheck list < /dev/null | python3 -c 'import json,sys; print(" ".join(sorted(json.load(sys.stdin))))')"
check "  имя плагина берётся из имени ссылки (id с дефисом)" "boom env junk scan set slow status" \
    "$(disp warp-box list < /dev/null | python3 -c 'import json,sys; print(" ".join(sorted(json.load(sys.stdin))))')"
out="$(printf '{"x":1}\n' | disp recheck call status)"
check "call: программа получила JSON на stdin и её ответ идёт как есть" "true;status;1" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["method"]');$(printf '%s' "$out" | pj 'd["in"]["x"]')"
out="$(printf '{"y":2}\n' | disp recheck call set)"
check "  метод write — той же дорогой" "set;2" "$(printf '%s' "$out" | pj 'd["method"]');$(printf '%s' "$out" | pj 'd["in"]["y"]')"
out="$(disp recheck call env </dev/null)"
check "  среда программы: id, каталог плагина, рабочий каталог — он" "recheck;$PLUG/lib/recheck;$PLUG/lib/recheck" \
    "$(printf '%s' "$out" | pj 'd["id"]');$(printf '%s' "$out" | pj 'd["dir"]');$(printf '%s' "$out" | pj 'd["pwd"]')"
out="$(disp recheck call nope </dev/null)"
check "  метода нет в манифесте — понятный отказ" "false;no_method;У плагина recheck нет такого действия: nope" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["code"]');$(printf '%s' "$out" | pj 'd["error"]')"
out="$(disp recheck call boom </dev/null)"
check "  программа упала: ok=false, её stderr, код failed" "false;failed;что-то сломалось" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["code"]');$(printf '%s' "$out" | pj 'd["error"]')"
out="$(disp recheck call junk </dev/null)"
check "  программа ответила не JSON — отказ, а не мусор в панель" "failed;Плагин recheck ответил не по форме" \
    "$(printf '%s' "$out" | pj 'd["code"]');$(printf '%s' "$out" | pj 'd["error"]')"
t0="$(date +%s)"
out="$(disp recheck call slow </dev/null)"
t1="$(date +%s)"
check "  срок (timeout_s: 1) — отказ timeout, программа не ждётся до конца" "timeout;Плагин recheck не ответил за 1 с;yes" \
    "$(printf '%s' "$out" | pj 'd["code"]');$(printf '%s' "$out" | pj 'd["error"]');$([ $((t1 - t0)) -lt 4 ] && echo yes || echo no)"
check "  после срока программа не осталась висеть" "0" "$(sleep 0.3; pgrep -f "$PLUG/lib/recheck/rpc/prog" | grep -c .)"

# Метод с job: true — заданием.
out="$(disp recheck call scan </dev/null)"
job="$(printf '%s' "$out" | pj 'd["job"]')"
check "метод с job:true отвечает {job} сразу" "true;yes" "$(printf '%s' "$out" | pj 'd["ok"]');$([ -n "$job" ] && [ "$job" != "НЕТ ПОЛЯ" ] && echo yes || echo no)"
out="$(wait_job "$job")"
check "  итог — plugin_job: result — ответ программы" "done;true" \
    "$(printf '%s' "$out" | pj 'd["state"]');$(printf '%s' "$out" | pj 'd["result"]["scanned"]')"

# Через объект splify2 (шлюз приложения): plugin_call.
out="$(rpcd plugin_call '{"id":"recheck","method":"status","params":{"z":3}}')"
check "plugin_call: тот же диспетчер, params доходят как stdin" "true;3" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["in"]["z"]')"
out="$(rpcd plugin_call '{"id":"recheck","method":"status"}')"
check "  без params — пустой объект" "{}" "$(printf '%s' "$out" | pj 'd["in"]')"
out="$(rpcd plugin_call '{"id":"recheck","method":"status","params":{"q":"a'"'"'b \\\" $(id) `x`","n":[1,2]}}')"
check "  params с кавычками, \$(…) и обратными кавычками доходят как есть (разбор одним jsonfilter)" "a'b \\\" \$(id) \`x\`;[1, 2]" \
    "$(printf '%s' "$out" | pj 'd["in"]["q"]');$(printf '%s' "$out" | pj 'd["in"]["n"]')"
check "  params не объект — пустой объект" "{}" "$(rpcd plugin_call '{"id":"recheck","method":"status","params":[1]}' | pj 'd["in"]')"
check "  id с кавычкой и подстановкой — отказ bad_request" "bad_request" \
    "$(rpcd plugin_call '{"id":"x'"'"';touch /tmp/pwn;'"'"'","method":"status"}' | pj 'd["code"]')"
check "  метод с job:true через plugin_call — тоже {job}" "yes" \
    "$(rpcd plugin_call '{"id":"recheck","method":"scan"}' | pj 'd["job"]' | grep -q . && echo yes || echo no)"

# Отказы до вызова: нет плагина, выключен, имя недопустимо.
out="$(rpcd plugin_call '{"id":"nope","method":"status"}')"
check "плагина нет: not_installed, понятный текст" "false;not_installed;Плагин nope не установлен" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["code"]');$(printf '%s' "$out" | pj 'd["error"]')"
rpcd plugin_disable '{"id":"recheck"}' >/dev/null
rm -f "$PLUG/lib/recheck/rpc/ran"
out="$(rpcd plugin_call '{"id":"recheck","method":"status"}')"
check "плагин выключен: disabled, подсказка куда идти" "false;disabled;Плагин recheck выключен — включите его на вкладке «Плагины»" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["code"]');$(printf '%s' "$out" | pj 'd["error"]')"
check "  программа выключенного плагина не запускалась" "no" "$([ -e "$PLUG/lib/recheck/rpc/ran" ] && echo yes || echo no)"
put_state recheck 1.0.0 failed
check "  плагин в состоянии failed — тоже отказ (disabled)" "disabled" "$(rpcd plugin_call '{"id":"recheck","method":"status"}' | pj 'd["code"]')"
for bad in '{"id":"../x","method":"status"}' '{"id":"recheck","method":"../x"}' '{"id":"recheck","method":"A"}' '{"method":"status"}'; do
    check "  недопустимое имя $bad" "false" "$(rpcd plugin_call "$bad" | pj 'd["ok"]')"
done
put_state recheck 1.0.0 enabled

# Манифест не может вывести вызов за каталог плагина или указать на отсутствующий файл.
mkdir -p "$PLUG/lib/evil"
printf '{"schema":1,"id":"evil","version":"1","name":"e","rpc":{"prog":"../recheck/rpc/prog","methods":{"status":{"access":"read"}}}}\n' > "$PLUG/lib/evil/plugin.json"
put_state evil 1 enabled
check "prog с «..» отвергается: unavailable" "unavailable" "$(rpcd plugin_call '{"id":"evil","method":"status"}' | pj 'd["code"]')"
printf '{"schema":1,"id":"evil","version":"1","name":"e","rpc":{"prog":"/bin/sh","methods":{"status":{"access":"read"}}}}\n' > "$PLUG/lib/evil/plugin.json"
check "абсолютный prog отвергается: unavailable" "unavailable" "$(rpcd plugin_call '{"id":"evil","method":"status"}' | pj 'd["code"]')"
printf '{"schema":1,"id":"evil","version":"1","name":"e","rpc":{"prog":"rpc/missing","methods":{"status":{"access":"read"}}}}\n' > "$PLUG/lib/evil/plugin.json"
check "нет файла программы: unavailable" "unavailable" "$(rpcd plugin_call '{"id":"evil","method":"status"}' | pj 'd["code"]')"
printf '{"schema":1,"id":"evil","version":"1","name":"e"}\n' > "$PLUG/lib/evil/plugin.json"
check "в манифесте нет rpc: unavailable" "unavailable" "$(rpcd plugin_call '{"id":"evil","method":"status"}' | pj 'd["code"]')"
rm -rf "$PLUG/lib/evil"

# ---- ACL берётся из манифеста -------------------------------------------------------------------------------------------
rpcd plugin_enable '{"id":"recheck"}' >/dev/null; sleep 0.3
check "ACL: группа, объект, read и write — из access методов манифеста" "yes" \
    "$(python3 - "$PLUG/acl/splify2-p-recheck.json" <<'PY'
import json, sys
a = json.load(open(sys.argv[1]))
g = a["splify2-p-recheck"]
ok = (sorted(g["read"]["ubus"]["splify2.p.recheck"]) == ["boom", "env", "junk", "slow", "status"]
      and sorted(g["write"]["ubus"]["splify2.p.recheck"]) == ["scan", "set"]
      and list(a) == ["splify2-p-recheck"])
print("yes" if ok else "no: %r" % a)
PY
)"
# Плагин только с write-методами: блока read нет вовсе.
mkdir -p "$PLUG/lib/wonly/rpc"
printf '{"schema":1,"id":"wonly","version":"1","name":"w","rpc":{"prog":"rpc/prog","methods":{"go":{"access":"write"}}}}\n' > "$PLUG/lib/wonly/plugin.json"
cp "$PLUG/lib/recheck/rpc/prog" "$PLUG/lib/wonly/rpc/prog"; put_state wonly 1 enabled
rpcd plugins_list >/dev/null
check "ACL плагина с одними write-методами: блока read нет" "no;yes" \
    "$(python3 -c 'import json,sys; g=json.load(open(sys.argv[1]))["splify2-p-wonly"]; print("yes" if "read" in g else "no")' "$PLUG/acl/splify2-p-wonly.json");$(python3 -c 'import json,sys; g=json.load(open(sys.argv[1]))["splify2-p-wonly"]; print("yes" if g["write"]["ubus"]["splify2.p.wonly"]==["go"] else "no")' "$PLUG/acl/splify2-p-wonly.json")"
# Метод с недопустимым именем в манифесте в ACL не попадает.
printf '{"schema":1,"id":"wonly","version":"1","name":"w","rpc":{"prog":"rpc/prog","methods":{"go":{"access":"write"},"Bad-Name":{"access":"write"},"nope":{"access":"admin"}}}}\n' > "$PLUG/lib/wonly/plugin.json"
rpcd plugins_list >/dev/null
check "  имена не по схеме и access вне read/write в ACL не попадают" '["go"]' \
    "$(python3 -c 'import json,sys; g=json.load(open(sys.argv[1]))["splify2-p-wonly"]; print(json.dumps(g["write"]["ubus"]["splify2.p.wonly"]))' "$PLUG/acl/splify2-p-wonly.json")"

# plugins_list приводит всё в согласие (после sysupgrade ссылок нет), лишнее убирает, повторно ничего не делает.
rm -f "$PLUG/rpcd/splify2.p.recheck" "$PLUG/acl/splify2-p-recheck.json"
ln -s /nonexistent "$PLUG/rpcd/splify2.p.ghost"; echo '{}' > "$PLUG/acl/splify2-p-ghost.json"
echo "чужой обработчик" > "$PLUG/rpcd/other-object"; echo '{}' > "$PLUG/acl/other-acl.json"
rm -f "$T/rpcd-initd.log"
rpcd plugins_list >/dev/null; sleep 0.3
check "plugins_list возвращает потерянные ссылки и ACL, убирает лишние" "yes;yes;no;no" \
    "$([ -L "$PLUG/rpcd/splify2.p.recheck" ] && echo yes || echo no);$([ -f "$PLUG/acl/splify2-p-recheck.json" ] && echo yes || echo no);$([ -e "$PLUG/rpcd/splify2.p.ghost" ] && echo yes || echo no);$([ -e "$PLUG/acl/splify2-p-ghost.json" ] && echo yes || echo no)"
check "  чужие файлы в тех же каталогах не тронуты" "yes;yes" \
    "$([ -f "$PLUG/rpcd/other-object" ] && echo yes || echo no);$([ -f "$PLUG/acl/other-acl.json" ] && echo yes || echo no)"
check "  rpcd перечитан один раз" "1" "$(reload_count)"
rpcd plugins_list >/dev/null; sleep 0.3
check "  всё в согласии — перечитки нет" "1" "$(reload_count)"
# Без перемен проход согласия не повторяется (plugin_sync_fresh): реестр не пересобирается. Метка ставится через
# секунду после прошлого прохода — сравнение времени у оболочки бывает посекундным.
rpcd plugins_list >/dev/null; sleep 1.1; touch "$PLUG/mark"
rpcd plugins_list >/dev/null
check "  без перемен: реестр не пересобирается при открытии вкладки" "no" \
    "$([ "$PLUG/run/ext.reg" -nt "$PLUG/mark" ] && echo yes || echo no)"
# Перемена мимо панели (менеджер руками) — state.json новее отметки: проход идёт заново.
sleep 1.1; touch "$PLUG/mark"; touch "$PLUG/state.json"
rpcd plugins_list >/dev/null
check "  state.json изменился мимо панели — реестр пересобран" "yes" \
    "$([ "$PLUG/run/ext.reg" -nt "$PLUG/mark" ] && echo yes || echo no)"
# Ссылку убрали руками через секунду после прохода — каталог обработчиков новее отметки, ссылка возвращается.
sleep 1.1; rm -f "$PLUG/rpcd/splify2.p.recheck"
rpcd plugins_list >/dev/null
check "  ссылку убрали после прохода — возвращается" "yes" "$([ -L "$PLUG/rpcd/splify2.p.recheck" ] && echo yes || echo no)"
# Манифест плагина сменился (обновление руками) — новый метод попадает в ACL.
sleep 1.1
sed 's/"status":{"access":"read"}/"status":{"access":"read"},"fresh":{"access":"read"}/' "$PLUG/lib/recheck/plugin.json" > "$PLUG/m.tmp" &&
    cat "$PLUG/m.tmp" > "$PLUG/lib/recheck/plugin.json"; rm -f "$PLUG/m.tmp"
rpcd plugins_list >/dev/null
check "  манифест сменился — ACL пересобран" "yes" "$(grep -q '"fresh"' "$PLUG/acl/splify2-p-recheck.json" && echo yes || echo no)"

# splify2-plugin-sync: та же приводка командой (postinst).
rm -f "$PLUG/rpcd/splify2.p.recheck"
rm -f "$T/rpcd-initd.log"
out="$(envs sh "$ROOT/files/usr/sbin/splify2-plugin-sync" --no-reload)"
check "splify2-plugin-sync --no-reload: приводит, не перечитывает" "changed;yes;0" \
    "$out;$([ -L "$PLUG/rpcd/splify2.p.recheck" ] && echo yes || echo no);$(reload_count)"
check "  повторно — без изменений" "unchanged" "$(envs sh "$ROOT/files/usr/sbin/splify2-plugin-sync")"
# Одновременные проходы (задание установки и открытая вкладка): временные файлы у каждого свои, хвостов не остаётся.
rm -f "$PLUG"/acl/splify2-p-*.json
for _i in 1 2 3 4; do envs sh "$ROOT/files/usr/sbin/splify2-plugin-sync" --no-reload >/dev/null & done; wait
check "  четыре прохода разом: ACL на месте и целы, временных файлов нет" "ok;0" \
    "$(python3 -c 'import json,sys; json.load(open(sys.argv[1])); print("ok")' "$PLUG/acl/splify2-p-recheck.json" 2>/dev/null || echo bad);$(ls -a "$PLUG/acl" "$PLUG" "$PLUG/run" | grep -c '\.tmp\|\.new')"
check "  общих временных имён ACL и tasks.json нет" "0;0" \
    "$(grep -c '_ps_acl.tmp"' "$ROOT/files/usr/lib/splify2/plugin.sh");$(grep -c 'EXT_TASKS_JSON.new"' "$ROOT/files/usr/lib/splify2/ext.sh")"

# ---- интерфейсы плагинов: ссылка на ui/ ----------------------------------------------------------------------------------
plug_reset
install_plugin recheck 1.0.0
install_plugin lang-en 26.11.0
printf '{"schema":1,"id":"recheck","version":"1.0.0","name":"r","ui":{"entry":"ui/index.js"},"rpc":{"prog":"rpc/prog","methods":{"status":{"access":"read"}}}}\n' > "$PLUG/lib/recheck/plugin.json"
mkdir -p "$PLUG/lib/recheck/ui"; echo 'export default {}' > "$PLUG/lib/recheck/ui/index.js"
printf '{"schema":1,"id":"lang-en","version":"26.11.0","name":"English","ui":{"entry":"ui/index.js"}}\n' > "$PLUG/lib/lang-en/plugin.json"
mkdir -p "$PLUG/lib/lang-en/ui"
rpcd plugins_list >/dev/null; sleep 0.3
check "ui: ссылка только на ui/ плагина, не на весь плагин" "$PLUG/lib/recheck/ui;$PLUG/lib/lang-en/ui" \
    "$(readlink "$PLUG/www/recheck");$(readlink "$PLUG/www/lang-en")"
check "  файл интерфейса доступен по ссылке, программа плагина — нет" "yes;no" \
    "$([ -f "$PLUG/www/recheck/index.js" ] && echo yes || echo no);$([ -e "$PLUG/www/recheck/prog" ] && echo yes || echo no)"
check "  у плагина без rpc, но с ui — ссылка на ui есть, объекта ubus нет" "yes;no" \
    "$([ -L "$PLUG/www/lang-en" ] && echo yes || echo no);$([ -e "$PLUG/rpcd/splify2.p.lang-en" ] && echo yes || echo no)"
rpcd plugin_disable '{"id":"lang-en"}' >/dev/null
check "  выключенный плагин — ссылка на ui снята" "no;yes" \
    "$([ -e "$PLUG/www/lang-en" ] && echo yes || echo no);$([ -L "$PLUG/www/recheck" ] && echo yes || echo no)"
echo чужое > "$PLUG/www/stray"; ln -s /elsewhere "$PLUG/www/foreign"
rpcd plugins_list >/dev/null
check "  чужие файлы и ссылки в каталоге интерфейсов не тронуты" "yes;yes" \
    "$([ -f "$PLUG/www/stray" ] && echo yes || echo no);$([ -L "$PLUG/www/foreign" ] && echo yes || echo no)"

# ---- интерфейс плагина для страницы splify2: splify2.luci.interface (splify2-api 1.1) -----------------------------------
plug_reset
install_plugin andromeda 26.11.0
printf '{"schema":1,"id":"andromeda","version":"26.11.0","name":"Andromeda","compat":{"splify2-api":"^1.1"},"splify2":{"luci":{"interface":"luci/home.js"}}}\n' > "$PLUG/lib/andromeda/plugin.json"
mkdir -p "$PLUG/lib/andromeda/luci" "$PLUG/lib/andromeda/bin"; echo "return view.extend({});" > "$PLUG/lib/andromeda/luci/home.js"; echo secret > "$PLUG/lib/andromeda/bin/prog"
install_plugin broken 1.0.0
printf '{"schema":1,"id":"broken","version":"1.0.0","name":"b","splify2":{"luci":{"interface":"luci/sub/home.js"}}}\n' > "$PLUG/lib/broken/plugin.json"
rpcd plugins_list >/dev/null; sleep 0.3
check "luci.interface: ссылка view/p-<id> ведёт в luci/ плагина, не во весь плагин" "$PLUG/lib/andromeda/luci" "$(readlink "$PLUG/views/p-andromeda")"
check "  вид по ссылке доступен, программа плагина — нет" "yes;no" \
    "$([ -f "$PLUG/views/p-andromeda/home.js" ] && echo yes || echo no);$([ -e "$PLUG/views/p-andromeda/prog" ] && echo yes || echo no)"
check "  вид не прямо в luci/ — ссылки нет" "no" "$([ -e "$PLUG/views/p-broken" ] && echo yes || echo no)"
rpcd plugin_disable '{"id":"andromeda"}' >/dev/null
check "  выключенный плагин — ссылка на вид снята" "no" "$([ -e "$PLUG/views/p-andromeda" ] && echo yes || echo no)"
mkdir -p "$PLUG/views"; echo чужое > "$PLUG/views/p-stray"; ln -s /elsewhere "$PLUG/views/p-foreign"
rpcd plugins_list >/dev/null
check "  чужие файлы и ссылки p-* не тронуты" "yes;yes" \
    "$([ -f "$PLUG/views/p-stray" ] && echo yes || echo no);$([ -L "$PLUG/views/p-foreign" ] && echo yes || echo no)"
check "plugins_list: splify2_api — 1.1.0" "1.1.0" "$(rpcd plugins_list | pj 'd["splify2_api"]')"

# ---- семя: splify2-seed ставит плагины из пакета через менеджер ядра, один раз ----------------------------------------------
SEED="$T/seed"; mkdir -p "$SEED"
seed_reset() {  # свежая песочница менеджера: в каталоге три плагина, андромеда — с интерфейсом
    plug_reset
    for id in lang-en backup andromeda; do fixture_plugin "$id" 26.11.0; done
    printf '{"schema":1,"id":"andromeda","version":"26.11.0","name":"Andromeda","compat":{"splify2-api":"^1.1"},"splify2":{"luci":{"interface":"luci/home.js"}}}\n' > "$PLUG/fixtures/andromeda/plugin.json"
    mkdir -p "$PLUG/fixtures/andromeda/luci"; echo "return view.extend({});" > "$PLUG/fixtures/andromeda/luci/home.js"
    rm -f "$T/seeded" "$T/crontab.root"
}
for id in lang-en backup andromeda; do : > "$SEED/$id-26.11.0-all.s2p"; done
: > "$SEED/unsigned"
seed() { envs env SPLIFY2_SEED="$SEED" SPLIFY2_SEEDED="$T/seeded" SPLIFY2_CRON="$T/crontab.root" CRON_INITD="$T/bin/initd-rpcd" \
    sh "$ROOT/files/usr/sbin/splify2-seed" "$@" 2>"$T/stderr"; }
seed_reset
out="$(seed --no-reload)"
check "семя: все три плагина ставятся" "installed backup 26.11.0|installed lang-en 26.11.0" \
    "$(printf '%s\n' "$out" | grep -v andromeda | sed 's/ *$//' | sort | tr '\n' '|' | sed 's/|$//')"
check "  Andromeda — последней" "installed andromeda 26.11.0" "$(printf '%s\n' "$out" | tail -n 1)"
check "  вызовы менеджера: три install --file, без подписи в сборке без ключа" "3;3" \
    "$(manager_calls | tr '|' '\n' | grep -c 'install --file');$(manager_calls | tr '|' '\n' | grep -c -- '--unsigned')"
check "  идентификаторы записаны в seeded" "3" "$(wc -l < "$T/seeded" | tr -d ' ')"
check "  всё встало — строки повтора в cron нет" "no" "$(grep -q 'splify2-seed' "$T/crontab.root" 2>/dev/null && echo yes || echo no)"
check "  ссылка на вид Andromeda появилась (plugin_sync после установки)" "yes" "$([ -L "$PLUG/views/p-andromeda" ] && echo yes || echo no)"
rm -f "$PLUG/manager.log"
out="$(seed --no-reload)"
check "семя второй раз: стоящее не трогается" "3" "$(printf '%s\n' "$out" | grep -c '^present ')"
check "  и менеджера ни о чём не просили" "" "$(manager_calls)"
# Снятое человеком не возвращается после обновления пакета.
rpcd plugin_remove '{"id":"andromeda"}' >/dev/null; rm -f "$PLUG/manager.log"
out="$(seed --no-reload)"
check "семя: снятый человеком плагин не возвращается" "skipped andromeda;0" \
    "$(printf '%s\n' "$out" | grep andromeda);$(manager_calls | tr '|' '\n' | grep -c 'install --file')"
# Отказ менеджера: остальные пробуются, неудача повторяется по cron, код возврата 1.
seed_reset
echo 'нет места' > "$PLUG/fail.install"
out="$(seed --no-reload)"; rc=$?
check "семя: отказ менеджера — failed со словами менеджера, код 1" "yes;1" \
    "$(printf '%s' "$out" | grep -q '^failed lang-en: нет места' && echo yes || echo no);$rc"
check "  не поставленное не записано в seeded" "no" "$([ -s "$T/seeded" ] && echo yes || echo no)"
check "  повтор по cron заведён" "yes" "$(grep -q '# splify2-seed$' "$T/crontab.root" && echo yes || echo no)"
rm -f "$PLUG/fail.install"
out="$(seed --no-reload)"; rc=$?
check "  повторный запуск ставит и снимает строку cron" "0;no" "$rc;$(grep -q 'splify2-seed' "$T/crontab.root" && echo yes || echo no)"
# Без каталога семени — не ошибка (сборка «только каркас»).
check "семя: каталога нет — не ошибка" "no seed;0" "$(SPLIFY2_SEED="$T/none" envs sh "$ROOT/files/usr/sbin/splify2-seed" 2>&1);$?"
seed_reset; : > "$PLUG/needs-unsigned"; rm -f "$SEED/unsigned"
check "семя: без метки unsigned архив ставится без --unsigned, неподписанный менеджер отклоняет" "yes" \
    "$(seed --no-reload | grep -q '^failed lang-en' && echo yes || echo no)"

# ---- шлюз приложения и упаковка (по тексту: ucode на машине стенда нет) --------------------------------------------------
API="$ROOT/files/www/cgi-bin/splify2-api"
check "шлюз: маршрут /v1/plugin/<id>/<метод> ведёт в plugin_call" "yes;yes" \
    "$(grep -q 'v1\\/plugin\\/(\[a-z0-9\]\[a-z0-9-\]\*)\\/(\[a-z\]\[a-z0-9_\]\*)\$' "$API" && echo yes || echo no);$(grep -q "call(me, 'plugin_call'" "$API" && echo yes || echo no)"
check "  отказы плагинной части — статусами HTTP (все слова code)" "yes" \
    "$(for c in bad_request not_installed no_method disabled unavailable busy timeout failed; do grep -q "$c: [0-9]" "$API" || echo "нет $c"; done | grep -q . && echo no || echo yes)"
check "  новый шлюзовой путь не ломает прежние: /v1/call, /v1/batch, /v1/jobs на месте" "3" \
    "$(grep -c "path == '/v1/batch'\|v1\\\\/call\|v1\\\\/jobs" "$API")"
check "build.sh кладёт plugin-rpcd исполняемым и сверяет его наличие" "yes;yes" \
    "$(grep -q 'plugin-rpcd "\$PKG/usr/lib/splify2/plugin-rpcd"' "$ROOT/build.sh" && echo yes || echo no);$(grep -q 'test -x "\$PKG/usr/lib/splify2/plugin-rpcd"' "$ROOT/build.sh" && echo yes || echo no)"
check "postinst приводит объекты плагинов до перечитки rpcd" "yes" \
    "$(awk '/splify2-plugin-sync --no-reload/ { s = NR } /^\/etc\/init.d\/rpcd reload/ { r = NR } END { print (s && r && s < r) ? "yes" : "no" }' "$ROOT/build.sh")"
check "prerm убирает объекты плагинов" "yes" \
    "$(grep -q 'splify2.p.\*' "$ROOT/build.sh" && grep -q 'splify2-p-\*.json' "$ROOT/build.sh" && echo yes || echo no)"
check "все шелл-файлы плагинов проходят разбор dash" "ok" \
    "$(for f in files/usr/lib/splify2/plugin.sh files/usr/lib/splify2/plugin-rpcd files/usr/lib/splify2/rpcd/m-plugin.sh files/usr/sbin/splify2-plugin-sync files/usr/sbin/splify2-seed tests/stub/steer-plugin; do dash -n "$ROOT/$f" 2>&1 || echo "$f"; done | grep -q . && echo bad || echo ok)"

# ---- настройки плагина по его схеме (plugin_settings_get / plugin_settings_set) ---------------------------
# Манифест объявляет обязательную схему: "splify2": {"settings": {"schema": "<файл>"}}; значения — в
# conf/<id>/settings.json, файле, который читает сам плагин. Каркас рисует форму по схеме.
plug_reset
PLUGIN_CONF_DIR="$PLUG/conf"; export PLUGIN_CONF_DIR
install_plugin recheck 1.0.0
python3 - "$PLUG/lib/recheck/plugin.json" <<'PY'
import json, sys
p = sys.argv[1]; d = json.load(open(p))
d["splify2"] = {"settings": {"schema": "luci/settings.schema.json"}}
json.dump(d, open(p, "w"))
PY
mkdir -p "$PLUG/lib/recheck/luci"
printf '%s\n' '{"type":"object","properties":{"epoch":{"type":"integer","minimum":1},"token":{"type":"string","x-secret":true}}}' > "$PLUG/lib/recheck/luci/settings.schema.json"
out="$(rpcd plugin_settings_get '{"id":"recheck"}')"
check "plugin_settings_get: схема из манифеста, значений пока нет" "true;object;{}" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["schema"]["type"]');$(printf '%s' "$out" | pj 'd["values"]')"
out="$(rpcd plugin_settings_set '{"id":"recheck","values":{"epoch":3,"token":"s3cret"}}')"
check "plugin_settings_set: записано" "true" "$(printf '%s' "$out" | pj 'd["ok"]')"
check "  файл настроек — в conf/<id>/settings.json" '{"epoch": 3, "token": "s3cret"}' \
    "$(python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))))' "$PLUG/conf/recheck/settings.json")"
check "plugin_settings_get: значения читаются обратно" "3" "$(rpcd plugin_settings_get '{"id":"recheck"}' | pj 'd["values"]["epoch"]')"
check "plugin_settings_set: не объект — отказ, файл прежний" "false;bad_request;3" \
    "$(rpcd plugin_settings_set '{"id":"recheck","values":"x"}' | pj 'd["ok"]');$(rpcd plugin_settings_set '{"id":"recheck","values":[1]}' | pj 'd["code"]');$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["epoch"])' "$PLUG/conf/recheck/settings.json")"
check "plugin_settings_get: плагина нет — not_installed" "not_installed" "$(rpcd plugin_settings_get '{"id":"nope"}' | pj 'd["code"]')"
check "plugin_settings_set: плагина нет — not_installed" "not_installed" "$(rpcd plugin_settings_set '{"id":"nope","values":{}}' | pj 'd["code"]')"
check "plugin_settings_get: недопустимое имя" "bad_request" "$(rpcd plugin_settings_get '{"id":"../x"}' | pj 'd["code"]')"
install_plugin vless 2.1.1
check "plugin_settings_get: у плагина нет схемы настроек — no_settings" "no_settings" "$(rpcd plugin_settings_get '{"id":"vless"}' | pj 'd["code"]')"
python3 - "$PLUG/lib/vless/plugin.json" <<'PY'
import json, sys
p = sys.argv[1]; d = json.load(open(p))
d["splify2"] = {"settings": {"schema": "../../etc/passwd"}}
json.dump(d, open(p, "w"))
PY
check "plugin_settings_get: путь схемы вне каталога плагина — отказ" "no_settings" "$(rpcd plugin_settings_get '{"id":"vless"}' | pj 'd["code"]')"
unset PLUGIN_CONF_DIR

# ---- словари каркаса от плагинов (i18n_get) -------------------------------------------------------------
plug_reset
install_plugin lang-ru 1.0.0
mkdir -p "$PLUG/lib/lang-ru/i18n/core"
printf '%s\n' '{"Add":"Добавить","{n} outputs":{"one":"{n} выход","other":"{n} выхода"}}' > "$PLUG/lib/lang-ru/i18n/core/ru.json"
install_plugin lang-x 1.0.0 disabled
mkdir -p "$PLUG/lib/lang-x/i18n/core"
printf '%s\n' '{"Add":"X"}' > "$PLUG/lib/lang-x/i18n/core/ru.json"
install_plugin lang-bad 1.0.0
mkdir -p "$PLUG/lib/lang-bad/i18n/core"
printf 'не json\n' > "$PLUG/lib/lang-bad/i18n/core/ru.json"
out="$(rpcd i18n_get '{"lang":"ru"}')"
check "i18n_get: словарь включённого плагина" "true;ru;lang-ru;Добавить" \
    "$(printf '%s' "$out" | pj 'd["ok"]');$(printf '%s' "$out" | pj 'd["lang"]');$(printf '%s' "$out" | pj 'd["dicts"][0]["plugin"]');$(printf '%s' "$out" | pj 'd["dicts"][0]["dict"]["Add"]')"
check "  форма множественного числа едет объектом" "{n} выход" "$(printf '%s' "$out" | pj 'd["dicts"][0]["dict"]["{n} outputs"]["one"]')"
check "  выключенный плагин и негодный файл не попадают, словарь один" "1" "$(printf '%s' "$out" | pj 'len(d["dicts"])')"
check "i18n_get: языка нет ни у кого — пустой массив, не отказ" "true;[]" \
    "$(rpcd i18n_get '{"lang":"de"}' | pj 'd["ok"]');$(rpcd i18n_get '{"lang":"de"}' | pj 'd["dicts"]')"
check "i18n_get: язык с регионом" "true" "$(rpcd i18n_get '{"lang":"pt-BR"}' | pj 'd["ok"]')"
check "i18n_get: код языка не по форме — отказ" "false;false;false" \
    "$(rpcd i18n_get '{"lang":"../x"}' | pj 'd["ok"]');$(rpcd i18n_get '{"lang":"r u"}' | pj 'd["ok"]');$(rpcd i18n_get '{}' | pj 'd["ok"]')"
# Ответ i18n_get — из кэша на язык, пока проход согласия свеж; словарь или состав плагинов сменились — пересчёт.
rpcd plugins_list >/dev/null; sleep 1.1; rpcd plugins_list >/dev/null
rpcd i18n_get '{"lang":"ru"}' >/dev/null
check "i18n_get: ответ ложится в кэш на язык" "yes;Добавить" \
    "$([ -f "$PLUG/run/ext.reg.i18n.ru" ] && echo yes || echo no);$(rpcd i18n_get '{"lang":"ru"}' | pj 'd["dicts"][0]["dict"]["Add"]')"
sleep 1.1
printf '%s\n' '{"Add":"Прибавить"}' > "$PLUG/lib/lang-ru/i18n/core/ru.json"
check "  словарь сменился — новые слова" "Прибавить" "$(rpcd i18n_get '{"lang":"ru"}' | pj 'd["dicts"][0]["dict"]["Add"]')"
sleep 1.1; rpcd plugins_list >/dev/null; rpcd i18n_get '{"lang":"ru"}' >/dev/null
rpcd plugin_disable '{"id":"lang-ru"}' >/dev/null
check "  плагин выключили — его словаря нет" "0" "$(rpcd i18n_get '{"lang":"ru"}' | pj 'len(d["dicts"])')"

echo
if [ "$fails" -ne 0 ]; then
    echo "ЕСТЬ ПРОВАЛЫ: $fails"
    exit 1
fi
echo "все проверки прошли"
