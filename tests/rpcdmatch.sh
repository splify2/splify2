#!/bin/sh
# Стенд для ubus-объекта splify2 (files/usr/libexec/rpcd/splify2).
#
# Зачем именно так — ровно та же причина, что у listsmatch.sh: скрипт целиком состоит из
# обращений к системе (apk, wget, ubus, uci, jsonfilter, /etc/init.d), поэтому «вызвать
# функцию и посмотреть на результат» здесь не работает. Стенд поднимает окружение в
# каталоге-песочнице, подменяет внешние команды заглушками в PATH, а абсолютные пути —
# швами (JSHN_SH, INITD, OPENWRT_RELEASE и остальные). Скрипт запускается настоящий,
# целиком, как его запускает rpcd.
#
# Отличие от listsmatch.sh одно: скрипт подключает /usr/share/libubox/jshn.sh, которого
# на машине разработчика нет. Его заменяет tests/stub/jshn.sh — см. шапку того файла.
#
# Заглушки протоколируют вызовы в файлы внутри песочницы, и большая часть проверок —
# именно про ПОРЯДОК вызовов, а не про ответ: находка I-049 в том и состоит, что порядок
# apk del / apk add неверен, а ответ при этом честный.
#
# Запуск: sh tests/rpcdmatch.sh (нужен python3).
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRIPT="$ROOT/files/usr/libexec/rpcd/splify2"
# Объект разнесён по файлам: диспетчер (SCRIPT), общие помощники и группы методов в
# usr/lib/splify2/rpcd. Проверки по ТЕКСТУ объекта смотрят во все его файлы разом.
RPCD_DIR="$ROOT/files/usr/lib/splify2/rpcd"
RPCD_ALL="$SCRIPT $RPCD_DIR/common.sh $RPCD_DIR/m-*.sh"
rpcd_src() { cat $RPCD_ALL; }  # shellcheck disable=SC2086
T="$(mktemp -d /tmp/rpcdmatch.XXXXXX)"
trap 'rm -rf "$T"' EXIT INT TERM

fails=0
check() {  # ОПИСАНИЕ ОЖИДАЕМОЕ ПОЛУЧЕННОЕ
    if [ "$2" = "$3" ]; then
        printf '%-64s ok\n' "$1"
    else
        printf '%-64s ПРОВАЛ\n' "$1"
        printf '    ожидалось: %s\n    получено:  %s\n' "$2" "$3"
        fails=$((fails + 1))
    fi
}

mkdir -p "$T/bin" "$T/lists/domains" "$T/etc" "$T/var"

# ---- заглушки внешних команд -------------------------------------------------
# apk: протоколирует каждый вызов первым словом. Поведение `add` задаётся снаружи,
# переменными APK_ADD_RC и APK_ADD_OUT, — иначе отказ установки нечем воспроизвести.
cat > "$T/bin/apk" <<'EOF'
#!/bin/sh
case "$1" in
    del) echo "del $2" >> "$SANDBOX/apk.log"; exit 0 ;;
    # Индексы apk живут в /var/cache/apk, то есть в tmpfs, и перезагрузку не переживают; без
    # них `apk add` файла с зависимостями отвечает «unable to select packages» (снято с
    # роутера). APK_NEED_INDEX=1 воспроизводит это: `add` отказывает, пока `update` не оставит
    # след.
    update) echo "update" >> "$SANDBOX/apk.log"; : > "$SANDBOX/apk.index"; exit 0 ;;
    add)
        echo "add $*" >> "$SANDBOX/apk.log"
        if [ "${APK_NEED_INDEX:-0}" = 1 ] && [ ! -f "$SANDBOX/apk.index" ]; then
            echo "ERROR: unable to select packages:" >&2
            echo "  https-dns-proxy (no such package):" >&2
            exit 1
        fi
        [ -n "${APK_ADD_OUT:-}" ] && echo "$APK_ADD_OUT" >&2
        exit "${APK_ADD_RC:-0}"
        ;;
    list)
        # APK_LIST — свой перечень установленного (ядро 2.0, прежнее 1.5.9, коннектор); без него —
        # прежний: steer-extended 0.9.5 и интерфейс.
        if [ -n "${APK_LIST:-}" ]; then printf '%s\n' "$APK_LIST"; exit 0; fi
        echo "steer-extended-0.9.5-r1 aarch64_cortex-a53 {steer-extended}"
        echo "luci-app-splify2-0.7.6-r1 all {luci-app-splify2}"
        ;;
    --print-arch) echo "aarch64" ;;
esac
exit 0
EOF

# /etc/init.d/steer: тот же протокол, но с ПАМЯТЬЮ. enable/disable оставляют след на
# диске, а enabled его читает — иначе «после остановки автозапуск снят» проверялось бы
# против заглушки, которая всегда отвечает одно и то же, то есть ни против чего.
# ENGINE_ENABLED задаёт лишь начальное состояние.
cat > "$T/bin/initd-steer" <<'EOF'
#!/bin/sh
echo "$1" >> "$SANDBOX/initd.log"
case "$1" in
    enable)  rm -f "$SANDBOX/disabled" ;;
    disable) : > "$SANDBOX/disabled" ;;
    enabled) [ -f "$SANDBOX/disabled" ] && exit 1; exit "${ENGINE_ENABLED:-0}" ;;
esac
exit 0
EOF

cat > "$T/bin/initd-rpcd" <<'EOF'
#!/bin/sh
echo "$1" >> "$SANDBOX/rpcd-initd.log"
exit 0
EOF

# wget: два разных запроса — список релизов у GitHub API и сам пакет.
# В списке намеренно есть теги НЕ вида X.Y.Z: ровно их steer_install потом отвергает.
cat > "$T/bin/wget" <<'EOF'
#!/bin/sh
out=""; url=""
while [ $# -gt 0 ]; do
    case "$1" in
        -qO-) shift ;;
        -qO)  out="$2"; shift 2 ;;
        --timeout=*) shift ;;
        http*) url="$1"; shift ;;
        *) shift ;;
    esac
done
echo "$url" >> "$SANDBOX/wget.log"
case "$url" in
    *api.github.com*)
        # Список релизов. Теперь с ЗАГОЛОВКАМИ: у выпуска есть кодовое имя («26.9 Andromeda»),
        # и приезжает оно полем `name`, а не тегом — в теге и в имени файла пакета пробелу
        # места нет. В наборе намеренно есть релиз без заголовка (null) и заголовок с
        # вертикальной чертой: обе ветки отката на число проверяются ниже.
        #
        # GH_FAIL=1 — «хост не отвечает вовсе»: так это и выглядит у человека, которому
        # закрыли api.github.com или у которого за CGNAT выбрали неавторизованный лимит
        # (splify2#5). Отличается от GH_BODY='не json' тем, что ответа нет, а не что он плох.
        [ -n "${GH_FAIL:-}" ] && exit 1
        #
        # Уезжает в ФАЙЛ, когда его просят (-qO файл), и в поток, когда просят поток: список
        # версий читается jsonfilter-ом, а тому нужен файл.
        if [ -n "${GH_BODY:-}" ]; then body="$GH_BODY"; else
            body='[{"tag_name": "v26.9", "name": "26.9 Andromeda"},{"tag_name": "v0.9.6", "name": null},{"tag_name": "v0.9.5-rc1", "name": "0.9.5 rc1"},{"tag_name": "v0.9.4", "name": "0.9.4 | старьё"},{"tag_name": "nightly", "name": "nightly"}]'
        fi
        if [ -n "$out" ]; then printf '%s\n' "$body" > "$out"; else printf '%s\n' "$body"; fi
        ;;
    *)
        [ -n "$out" ] && echo "пакет" > "$out"
        ;;
esac
exit 0
EOF

# jsonfilter: поддерживаются те выражения, которые встречаются на проверяемых путях.
# Выражений в одном вызове бывает НЕСКОЛЬКО (-e ... -e ...), и настоящий jsonfilter
# печатает совпадения по всем. Пока заглушка запоминала только последнее, проверка
# недоверенной спеки смотрела бы на одно поле из пяти — то есть была бы зелёной по
# недосмотру заглушки, а не по существу.
cat > "$T/bin/jsonfilter" <<'EOF'
#!/bin/sh
file=""; str=""; exprs=""
while [ $# -gt 0 ]; do
    case "$1" in
        -i) file="$2"; shift 2 ;;
        -s) str="$2"; shift 2 ;;
        -e) exprs="$exprs$2
"; shift 2 ;;
        *) shift ;;
    esac
done
# Без -i и -s настоящий jsonfilter читает ПОТОК — так его и зовут в скрипте
# (`steer status | jsonfilter -e ...`). Поток вычитывается здесь, потому что дальше
# стандартный ввод занят программой python.
if [ -z "$file" ] && [ -z "$str" ]; then str="$(cat)"; fi
# Выражения уезжают переменной окружения, а не потоком: программу python читает как раз
# со стандартного ввода (`python3 -` плюс heredoc), и труба до неё не доходит.
EXPRS="$exprs" python3 - "$file" "$str" <<'PY'
import json, os, re, sys
path, raw = sys.argv[1], sys.argv[2]
try:
    d = json.loads(raw) if raw else json.load(open(path, encoding='utf-8'))
except Exception:
    sys.exit(1)

def render(v):
    if isinstance(v, bool):          return 'true' if v else 'false'
    if isinstance(v, (dict, list)):  return json.dumps(v, ensure_ascii=False)
    return str(v)

def walk(cur, parts):
    if not parts:
        if cur is not None:
            yield cur
        return
    p, rest = parts[0], parts[1:]
    if p == '*':
        items = cur if isinstance(cur, list) else list(cur.values()) if isinstance(cur, dict) else []
        for it in items:
            yield from walk(it, rest)
    elif isinstance(cur, list) and p.isdigit():
        i = int(p)
        if 0 <= i < len(cur):
            yield from walk(cur[i], rest)
    elif isinstance(cur, dict) and p in cur:
        yield from walk(cur[p], rest)

for expr in os.environ.get('EXPRS', '').splitlines():
    if not expr:
        continue
    m = re.match(r"@\.(categories|domain_lists)\[@\.id='([^']*)'\]\.([a-z_]+)$", expr)
    if m:
        for e in d.get(m.group(1), []):
            if e.get('id') == m.group(2) and m.group(3) in e:
                print(e[m.group(3)])
        continue
    # Поле записи, найденной ПО ПУТИ СПИСКА: так доскачивание спрашивает ссылку набора —
    # ему известен путь из спеки, а не идентификатор.
    m = re.match(r"@\.(categories|domain_lists)\[@\.file='([^']*)'\]\.([a-z_]+)$", expr)
    if m:
        for e in d.get(m.group(1), []):
            if e.get('file') == m.group(2) and m.group(3) in e:
                print(e[m.group(3)])
        continue
    # Общий обход: точки — шаги пути, [*] — «все элементы массива или все значения
    # объекта». Ровно тот набор выражений, который встречается в скрипте.
    # Числовой индекс массива (`@[0].tag_name`) — им читается список релизов GitHub.
    # Приводится к обычному шагу пути: скобки становятся точками, а walk() ниже понимает
    # цифровой шаг как индекс в списке.
    # Грамматика настоящего jsonfilter: голый шаг пути — LABEL [a-zA-Z_][a-zA-Z0-9_]*; имя с
    # дефисом или точкой годится только в скобках `['имя']`. Заглушка этому раньше не
    # следовала и делила путь по точкам как угодно — из-за чего стенд не видел, что имя
    # выхода `de-1` ломает каждый запрос по нему (I-284).
    norm = expr.replace('@.', '', 1).replace('[*]', '.*')
    norm = re.sub(r"\[(['\"])([^'\"]*)\1\]", lambda m: '.\x00' + m.group(2), norm)
    norm = norm.replace('[', '.').replace(']', '')
    parts = [x for x in norm.split('.') if x and x != '@']
    bad = False
    clean = []
    for x in parts:
        if x.startswith('\x00'):
            clean.append(x[1:])
        elif x == '*' or x.isdigit() or re.match(r'^[A-Za-z_][A-Za-z0-9_]*$', x):
            clean.append(x)
        else:
            bad = True
    if bad:
        sys.stderr.write('Syntax error\n')
        sys.exit(1)
    for v in walk(d, clean):
        print(render(v))
PY
EOF

printf '#!/bin/sh\nexit 0\n' > "$T/bin/logger"
# uci: маленькое, но НАСТОЯЩЕЕ хранилище — «ключ=значение» в файле песочницы.
#
# Раньше заглушка отвечала одним `exit 1`, то есть «настройки нет никогда». Этого хватало,
# пока настройки только записывались; методу sub_quota она нужна на ЧТЕНИЕ — ссылку подписки
# он берёт из uci и ниоткуда больше, и на молчащей заглушке метод не мог ничего спросить, а
# проверка была бы зелёной при любом поведении.
cat > "$T/bin/uci" <<'EOF'
#!/bin/sh
# Заглушка uci: плоское хранилище «ключ=значение» построчно.
#
# СРАВНЕНИЕ ИДЁТ `case`, А НЕ `grep`, и это не стилистика. Настоящий uci называет безымянную
# секцию «@xsteer_home[0]» — проверено на живом роутере, — а в шаблоне grep квадратные скобки
# означают класс символов: «^network.@xsteer_home[0]=» совпадает с «network.@xsteer_home0=» и не
# совпадает с тем, что искали. Заглушка на grep поэтому «не находила» секцию, которую настоящий
# uci находит, и скрывала бы обратную ошибку — код, который ищет секцию по имени вместо типа.
# В `case` подстановка в кавычках сравнивается буквально.
S="$SANDBOX/uci.store"
[ -f "$S" ] || : > "$S"
while [ $# -gt 0 ]; do
    case "$1" in -*) shift ;; *) break ;; esac
done
# «@тип[-1]» у настоящего uci — последняя секция этого типа. Без этого код зоны фаервола
# (`uci add firewall zone` и следом `set firewall.@zone[-1].name=…`) писал в заглушку ключи с
# буквальным «[-1]», и ни одна проверка зон не проверяла ничего — они и не были написаны.
resolve() {  # КЛЮЧ -> ключ с подставленным номером последней секции
    case "$1" in
        *"[-1]"*)
            pfx="${1%%.@*}"; rest="${1#*.@}"; typ="${rest%%\[*}"; tl="${rest#*\]}"
            max=-1
            while IFS= read -r line; do
                case "$line" in "$pfx.@$typ["*"]=$typ")
                    n="${line#*\[}"; n="${n%%\]*}"; [ "$n" -gt "$max" ] && max="$n" ;;
                esac
            done < "$S"
            printf '%s' "$pfx.@$typ[$max]$tl" ;;
        *) printf '%s' "$1" ;;
    esac
}
case "${1:-}" in
    get)
        key="$(resolve "${2:-}")"
        v=""; found=0
        while IFS= read -r line; do
            case "$line" in "$key="*) v="${line#*=}"; found=1 ;; esac
        done < "$S"
        [ "$found" = 1 ] || exit 1
        printf '%s\n' "$v"
        ;;
    set)
        k="$(resolve "${2%%=*}")"; v="${2#*=}"
        # Отказ записи ОДНОГО ключа — кончилось место, испорченный файл настройки. Задаётся
        # снаружи точным ключом; без этого ветку «запись не удалась» нечем исполнить.
        [ -n "${UCI_SET_FAIL:-}" ] && [ "$k" = "$UCI_SET_FAIL" ] && exit 1
        : > "$S.t"
        while IFS= read -r line; do
            case "$line" in "$k="*) continue ;; esac
            printf '%s\n' "$line" >> "$S.t"
        done < "$S"
        printf '%s=%s\n' "$k" "$v" >> "$S.t"
        mv "$S.t" "$S"
        ;;
    delete)
        # Удаление СЕКЦИИ уносит и её опции: «network.cfg1» это и строка типа, и все
        # «network.cfg1.*». Без этого удалённый пир оставлял бы за собой свои поля, и
        # следующий `show` находил бы половину секции.
        key="$(resolve "${2:-}")"
        : > "$S.t"
        while IFS= read -r line; do
            case "$line" in "$key="*|"$key".*) continue ;; esac
            printf '%s\n' "$line" >> "$S.t"
        done < "$S"
        mv "$S.t" "$S"
        ;;
    show)
        # Формат тот же, что у настоящего uci: значение опции в кавычках, тип секции без них.
        # Разница значима — по ней метод отличает секцию от её полей.
        pfx="${2:-}"
        while IFS= read -r line; do
            k="${line%%=*}"; v="${line#*=}"
            case "$k" in "$pfx"|"$pfx".*) ;; *) continue ;; esac
            case "$k" in
                *.*.*) printf "%s='%s'\n" "$k" "$v" ;;
                *) printf '%s=%s\n' "$k" "$v" ;;
            esac
        done < "$S"
        ;;
    add)
        # Имя безымянной секции — то, что печатает настоящий uci: @<тип>[<номер>]. Считаются
        # СТРОКИ СЕКЦИЙ («…=тип»), а не все строки с этим префиксом: опции секций тоже
        # начинаются с «@zone[», и счёт по ним давал @zone[9] после трёх зон.
        i=0
        while IFS= read -r line; do
            case "$line" in "${2:-}.@${3:-}["*"]=${3:-}") i=$((i + 1)) ;; esac
        done < "$S"
        n="@${3:-}[$i]"
        printf '%s.%s=%s\n' "${2:-}" "$n" "${3:-}" >> "$S"
        printf '%s\n' "$n"
        ;;
    add_list)
        # Список хранится ОДНОЙ строкой через пробел — ровно так его отдаёт `uci get`.
        k="$(resolve "${2%%=*}")"; v="${2#*=}"
        old=""
        while IFS= read -r line; do
            case "$line" in "$k="*) old="${line#*=}" ;; esac
        done < "$S"
        : > "$S.t"
        while IFS= read -r line; do
            case "$line" in "$k="*) continue ;; esac
            printf '%s\n' "$line" >> "$S.t"
        done < "$S"
        if [ -n "$old" ]; then printf '%s=%s %s\n' "$k" "$old" "$v" >> "$S.t"
        else printf '%s=%s\n' "$k" "$v" >> "$S.t"; fi
        mv "$S.t" "$S"
        ;;
    commit) : ;;
esac
exit 0
EOF
# ubus: код возврата прежний (на машине разработчика его нет, и скрипт обязан это
# переживать), но вызовы теперь протоколируются — сигнал экземпляру виден только так.
# nft: ничего не делает, но записывает всё, что ему дали — и аргументами, и потоком.
# opkg: воспроизводит беду свежей прошивки — списков пакетов нет, и зависимость локального
# файла не находится. После `opkg update` установка проходит.
cat > "$T/bin/ifup" <<'EOF'
#!/bin/sh
echo "$*" >> "$SANDBOX/ifup.log"
exit 0
EOF
chmod +x "$T/bin/ifup"
cat > "$T/bin/opkg" <<'EOF'
#!/bin/sh
echo "$*" >> "$SANDBOX/opkg.log"
case "$1" in
    update) : > "$SANDBOX/opkg.lists"; exit 0 ;;
    install)
        if [ -f "$SANDBOX/opkg.lists" ]; then
            echo "Installing steer"; exit 0
        fi
        echo "Collected errors:"
        echo " * pkg_hash_check_unresolved: cannot find dependency ip-full for steer"
        exit 1
        ;;
    list-installed) exit 0 ;;
esac
exit 0
EOF

cat > "$T/bin/nft" <<'EOF'
#!/bin/sh
echo "$*" >> "$SANDBOX/nft.log"
case "$*" in *-f\ -*) cat >> "$SANDBOX/nft.log" ;; esac
exit 0
EOF

cat > "$T/bin/ubus" <<'EOF'
#!/bin/sh
echo "$*" >> "$SANDBOX/ubus.log"
exit 1
EOF
# curl: им ходит download(), то есть и списки издателя, и «свой список по ссылке».
# Протокол отдельный от wget: через wget идут пакеты и GitHub API, и смешивать их в
# одном журнале значило бы проверять «что-то скачалось» вместо «скачалось это».
cat > "$T/bin/curl" <<'EOF'
#!/bin/sh
out=""; url=""; dump=""; head=0
while [ $# -gt 0 ]; do
    case "$1" in
        -o) out="$2"; shift 2 ;;
        # -fsSI: запрос ОДНИХ заголовков, которым обновляется остаток трафика подписки.
        # Заголовки при этом уезжают в stdout, а не в файл -D, и тела нет вовсе — поэтому
        # ветка отдельная: без неё стенд не отличил бы «спросили заголовки» от «скачали
        # подписку заново».
        -fsSI|-I) head=1; shift ;;
        # Заголовки ЗАПРОСА протоколируются отдельным файлом: подписка уходит с
        # идентификатором устройства, и проверить это можно только так — в URL его нет.
        -H) echo "$2" >> "$SANDBOX/curl.hdrs"; shift 2 ;;
        # -D: сюда curl складывает заголовки ОТВЕТА. Стенд подставляет их через
        # CURL_RESP_HDRS — иначе сигналы панели («HWID не назван», «лимит устройств»)
        # нечем воспроизвести.
        -D) dump="$2"; shift 2 ;;
        http*) url="$1"; shift ;;
        *) shift ;;
    esac
done
echo "$url" >> "$SANDBOX/curl.log"
if [ "$head" = 1 ]; then
    echo "$url" >> "$SANDBOX/curl.head.log"
    printf 'HTTP/2 200\r\n%s\r\n' "${CURL_HEAD_HDRS-${CURL_RESP_HDRS:-}}"
    exit "${CURL_HEAD_RC:-0}"
fi
[ -n "$dump" ] && printf 'HTTP/2 200\r\n%s\r\n' "${CURL_RESP_HDRS:-}" > "$dump"
# Перечень выпусков splify2/releases: у каждого из трёх адресов version.json свой файл в песочнице
# (rel-raw.json, rel-cdn.json, rel-pages.json). Файла нет — адрес не отвечает: так по умолчанию,
# и все прежние проверки идут прежним путём (api.github.com).
case "$url" in
    *version.json)
        case "$url" in
            *raw.githubusercontent.com*) f="$SANDBOX/rel-raw.json" ;;
            *cdn.jsdelivr.net*)          f="$SANDBOX/rel-cdn.json" ;;
            *splify2.github.io*)         f="$SANDBOX/rel-pages.json" ;;
            *)                           f="" ;;
        esac
        [ -n "$f" ] && [ -f "$f" ] && [ -n "$out" ] && { cp "$f" "$out"; exit 0; }
        exit 22 ;;
esac
# Ответы по образцу адреса: «образец<TAB>файл» в curl.serve; образец из curl.fail — отказ.
# Нужны файлам выпуска: у адресов из version.json разное содержимое, и сверка sha256 видна только так.
if [ -f "$SANDBOX/curl.fail" ]; then
    while IFS= read -r pat; do
        [ -n "$pat" ] || continue
        case "$url" in *"$pat"*) exit 22 ;; esac
    done < "$SANDBOX/curl.fail"
fi
if [ -f "$SANDBOX/curl.serve" ] && [ -n "$out" ]; then
    while IFS='	' read -r pat src; do
        [ -n "$pat" ] || continue
        case "$url" in *"$pat"*) cp "$src" "$out"; exit 0 ;; esac
    done < "$SANDBOX/curl.serve"
fi
if [ -n "$out" ]; then
    case "$url" in
        # Набор sing-box: тело двоичное и заглушке безразлично — его разбирает движок,
        # который здесь тоже заглушка. Важно, что за набором ходили по ЕГО ссылке.
        *.srs) printf 'SRS\0\0' > "$out" ;;
        *) if [ -n "${CURL_BODY:-}" ]; then printf '%s\n' "$CURL_BODY" > "$out"
           else printf 'remote.example\n10.1.0.0/16\n' > "$out"
           fi ;;
    esac
fi
exit "${CURL_RC:-0}"
EOF
# steer: журналирует, ЧЕМ его позвали, и умеет отказать. Нужно ровно для одной мысли —
# восстановление из архива проверяет спеку компилятором (`apply --dry-run`) и НЕ применяет
# её (`apply --spec` без dry-run). Различить это можно только по журналу вызовов.
#
# Подкоманда `outputs` отвечает ПО СПЕКЕ, а не молчанием, и это не украшение стенда:
# имена выходов скрипт узнаёт только отсюда, поэтому на молчащей заглушке любая проверка
# признака пересборки туннелей была бы зелёной при любом поведении скрипта.
cat > "$T/bin/steer" <<'EOF'
#!/bin/sh
echo "$*" >> "$SANDBOX/steer.log"
[ -n "${STEER_ERR:-}" ] && echo "$STEER_ERR" >&2
# Проверка узла: движок пишет предупреждения в stderr, а JSON — в stdout. Стенду нужно уметь
# воспроизводить обе половины сразу: именно их смешение и ломало ответ.
case "${1:-}" in
    # Разбор набора sing-box: движок кладёт домены в --out, подсети в --prefixes-out.
    # Содержимое поданного файла заглушке не важно — важно, что её вообще позвали и что
    # половины разошлись по разным файлам, а не слились в одну.
    srs-read)
        _o=""; _p=""; _m=""
        shift
        while [ $# -gt 0 ]; do
            case "$1" in
                --out) _o="$2"; shift 2 ;;
                --prefixes-out) _p="$2"; shift 2 ;;
                --meta-out) _m="$2"; shift 2 ;;
                *) shift ;;
            esac
        done
        [ -n "$_o" ] && printf 'srs-domain.example\n' > "$_o"
        [ -n "$_p" ] && printf '203.0.113.0/24\n' > "$_p"
        [ -n "$_m" ] && : > "$_m"
        exit 0
        ;;
    vless-probe|vless-nodes|hysteria2-probe|hysteria2-nodes|proxy-probe|proxy-nodes)
        # Ядро до --insecure (steer 2.0.0): флага не знает и отвечает так, как ответил бы разбор
        # аргументов, — кодом 2 и словами «неизвестный флаг».
        if [ -n "${STEER_NO_INSECURE:-}" ]; then
            for _a in "$@"; do
                [ "$_a" = --insecure ] && { echo "steer: неизвестный флаг: --insecure (подсказка: steer $1 --help)" >&2; exit 2; }
            done
        fi
        [ -n "${STEER_NOISE:-}" ] && echo "$STEER_NOISE" >&2
        [ -n "${STEER_JSON:-}" ] && printf '%s\n' "$STEER_JSON"
        exit "${STEER_RC:-0}"
        ;;
    # ПОДПИСКА. Скачивание, разбор заголовков панели, идентификатор устройства и арифметика
    # остатка трафика живут в ДВИЖКЕ (steer sub-fetch / sub-quota / sub-hwid), а не здесь: см.
    # steer/src/ext/subfetch.c и стенд steer/tests/subfetchmatch.c, где всё это и проверяется.
    #
    # Заглушке поэтому незачем повторять поведение движка — и повторять его было бы вредно:
    # проверялась бы заглушка, а не код. Она делает ровно то, что важно этому стенду:
    # протоколирует аргументы (по ним видно, ЧТО именно спросил объект rpcd), кладёт файлы туда,
    # куда просили, и отдаёт заданный ответ.
    # ССЫЛКА xs://. Заглушка НЕ разбирает формат и не должна: разбор живёт в движке и проверяется
    # его собственным стендом (steer/tests/xslinkmatch.c) плюс побайтовой сверкой с половиной на
    # Go. Здесь важно другое — что метод rpcd зовёт движок правильно (ссылка приходит стандартным
    # ВВОДОМ, а не аргументом: аргументы видны в списке процессов) и что он делает с ответом.
    xsteer-link)
        shift
        _src="${1:-}"
        if [ "$_src" = "-" ]; then
            _in="$(cat)"
            echo "stdin=$_in" >> "$SANDBOX/steer.log"
            case "${XS_LINK_RC:-0}" in
                0) printf '%s\n' "${XS_CONF_OUT:-[Interface]
PrivateKey = 6Gtidge6FqhO/0LhrAWpRiyYaKdLZF/gib/HePLC9GU=
Address = 10.77.0.5/24
SNI = www.microsoft.com

[Peer]
PublicKey = QYkH5bWOsEOCgIMldHPATSG7yvNyJ8st7o/HMelWKxs=
AllowedIPs = 10.77.0.0/24, 192.168.9.0/24
Endpoint = 198.51.100.9:8443
PersistentKeepalive = 25}" ;;
                *) echo "${XS_LINK_ERR:-приватный ключ в ссылке негоден}" >&2 ;;
            esac
            exit "${XS_LINK_RC:-0}"
        fi
        case "${XS_LINK_RC:-0}" in
            0) printf '%s\n' "${XS_LINK_OUT:-xs://PRIV@198.51.100.9:8443?pk=PUB&ip=10.77.0.5/24}" ;;
            *) echo "${XS_LINK_ERR:-файл не разобрался}" >&2 ;;
        esac
        exit "${XS_LINK_RC:-0}"
        ;;
    # Команды демона (`steer ctl check`): ответ — одна строка JSON, как у настоящего сокета.
    ctl)
        cat > /dev/null
        [ -n "${CTL_RESP:-}" ] && printf '%s\n' "$CTL_RESP"
        exit "${CTL_RC:-0}"
        ;;
    sub-hwid)
        printf '{"hwid":"%s","os":"OpenWrt 25.12.5","model":"Xiaomi AX3000T"}\n' \
               "${STEER_HWID-splify2-9c53221f0abc9c53}"
        exit 0
        ;;
    sub-fetch)
        shift
        _out=""; _info=""; _url=""
        while [ $# -gt 0 ]; do
            case "$1" in
                --out) _out="$2"; shift 2 ;;
                --info) _info="$2"; shift 2 ;;
                *) _url="$1"; shift ;;
            esac
        done
        printf '%s %s %s\n' "$_url" "$_out" "$_info" >> "$SANDBOX/subfetch.log"
        if [ -n "${STEER_SUB_RC:-}" ] && [ "$STEER_SUB_RC" != 0 ]; then
            printf '{"ok":false,"error":"подписка не скачалась"}\n'
            exit "$STEER_SUB_RC"
        fi
        [ -n "$_out" ] && printf '%s\n' "${STEER_SUB_BODY:-vless://k@h:443#n}" > "$_out"
        if [ -n "$_info" ]; then
            if [ -n "${STEER_SUB_INFO:-}" ]; then printf '%s\n' "$STEER_SUB_INFO" > "$_info"
            else rm -f "$_info"
            fi
        fi
        if [ -n "${STEER_SUB_JSON:-}" ]; then
            printf '%s\n' "$STEER_SUB_JSON"
        else
            printf '{"ok":true,"url":"%s","usable":1,"title":"","hwid_sent":true}\n' "$_url"
        fi
        exit 0
        ;;
    sub-quota)
        shift
        _info=""; _url=""
        while [ $# -gt 0 ]; do
            case "$1" in
                --info) _info="$2"; shift 2 ;;
                *) _url="$1"; shift ;;
            esac
        done
        printf '%s %s\n' "$_url" "$_info" >> "$SANDBOX/subquota.log"
        [ -n "${STEER_QUOTA_RC:-}" ] && [ "$STEER_QUOTA_RC" != 0 ] && exit "$STEER_QUOTA_RC"
        if [ -n "$_info" ]; then
            if [ -n "${STEER_SUB_INFO:-}" ]; then printf '%s\n' "$STEER_SUB_INFO" > "$_info"
            else rm -f "$_info"
            fi
        fi
        printf '{"ok":true,"asked":true}\n'
        exit 0
        ;;
esac
# status: собирается из спеки, чтобы у выходов была метка и признак `up`.
# Проверки состояния: заглушка отвечает так же, как движок, — документом с приговорами.
# Нужна для круга опроса: он спрашивает их по просьбе, и «пришло/не пришло» без ответа
# заглушки не отличить от «движок старый».
if [ "$1" = diag ]; then
    # ЧЕМ ИМЕННО ЗВАЛИ — записывается: проверки описывают РАБОТАЮЩЕЕ состояние, и по какой
    # спеке их считают, важнее их ответа. По задуманной спеке они врут на любых
    # неприменённых правках («apply не довёл набор до ядра», хотя apply никто не нажимал).
    _ds=""
    while [ $# -gt 0 ]; do case "$1" in --spec) _ds="$2"; shift 2 ;; *) shift ;; esac; done
    printf '%s\n' "$_ds" >> "$SANDBOX/diag-spec.log"
    printf '{"schema":1,"checks":[{"id":"table","verdict":"ok","what":"таблица на месте","why":""}],"warn":0,"fail":0}\n'
    exit 0
fi
if [ "$1" = status ]; then
    spec=""
    while [ $# -gt 0 ]; do case "$1" in --spec) spec="$2"; shift 2 ;; *) shift ;; esac; done
    [ -s "$spec" ] && python3 - "$spec" <<'PYEOF'
import json, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    raise SystemExit(0)
outs, mark = {}, 0x00100000
for name, o in (d.get('outputs') or {}).items():
    if not isinstance(o, dict):
        continue
    if o.get('kind') == 'direct':
        outs[name] = {'kind': 'direct'}
    else:
        outs[name] = {'kind': o.get('kind'), 'up': True, 'mark': f'0x{mark:08x}', 'table': 300}
        mark <<= 1
print(json.dumps({'schema': 1, 'outputs': outs, 'channels': []}, ensure_ascii=False))
PYEOF
    exit 0
fi
if [ "$1" = outputs ]; then
    spec=""; kind=""; obfs=0; devs=0
    while [ $# -gt 0 ]; do
        case "$1" in
            --spec) spec="$2"; shift 2 ;;
            --kind) kind="$2"; shift 2 ;;
            --obfs) obfs=1; shift ;;
            --devices) devs=1; shift ;;
            *) shift ;;
        esac
    done
    [ -s "$spec" ] && KIND="$kind" OBFS="$obfs" DEVS="$devs" python3 - "$spec" <<'PYEOF'
import json, os, sys
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    raise SystemExit(0)
for name, o in (d.get('outputs') or {}).items():
    if not isinstance(o, dict):
        continue
    # Спека v2: туннель — kind tunnel с protocol, и вид у ядра называется протоколом
    # (`--kind trojan`), как в его `status`.
    kind = o.get('protocol') if o.get('kind') == 'tunnel' else o.get('kind')
    if os.environ.get('OBFS') == '1':
        if o.get('obfs'):
            print(name)
    elif not os.environ.get('KIND') or kind == os.environ['KIND']:
        # --devices печатает УСТРОЙСТВО, а не имя выхода: у vless и xsteer оно выводится из
        # имени (не длиннее IFNAMSIZ), но может быть задано в спеке явно. Выход без
        # устройства (kind=direct) движок при этом пропускает.
        if os.environ.get('DEVS') == '1':
            dev = o.get('device') or (name[:15] if o.get('kind') != 'direct' else '')
            if dev:
                print(dev)
        else:
            print(name)
PYEOF
fi
exit "${STEER_RC:-0}"
EOF
chmod +x "$T/bin"/*

# ---- фикстуры ----------------------------------------------------------------
cat > "$T/etc/manifest.json" <<'EOF'
{
  "base_url": "https://example.invalid/lists",
  "categories":   [ { "id": "news", "file": "news.lst" } ],
  "domain_lists": [ { "id": "news", "file": "domains/news.lst" } ]
}
EOF

cat > "$T/etc/spec.json" <<EOF
{ "schema": 1,
  "channels": [ { "name": "c1", "match": { "prefixes_files": ["$T/lists/news.lst"] } } ] }
EOF

printf '10.0.0.0/8\n'  > "$T/lists/news.lst"
printf 'example.org\n' > "$T/lists/domains/news.lst"

# Поддельное /sys/class/net. Три случая нарочно: физический порт с постоянным MAC (он и
# должен победить), мост с ТЕМ ЖЕ адресом и без ссылки `device` (виртуальное — не наше) и
# физический wifi с адресом «назначен локально» (такой ядро выдумывает, после перезагрузки
# он другой).
mkdir -p "$T/sys/class/net/eth0/device" "$T/sys/class/net/br-lan" "$T/sys/class/net/wlan0/device"
printf '9C:53:22:1F:0A:BC\n' > "$T/sys/class/net/eth0/address"
printf '9c:53:22:1f:0a:bc\n' > "$T/sys/class/net/br-lan/address"
printf '0a:11:22:33:44:55\n' > "$T/sys/class/net/wlan0/address"
printf 'Xiaomi AX3000T\n'    > "$T/etc/sysinfo-model"

# Поддельное /sys/class/net для перечня СЕТЕЙ КЛИЕНТОВ (splify2#16). Набор списан с
# роутера человека из обращения: домашний мост, порт внутри этого моста, wan, туннель
# Tailscale и мост ZeroTier. Каждое устройство здесь отвечает на свой вопрос отбора.
mkdir -p "$T/sysnet/lo" "$T/sysnet/br-lan" "$T/sysnet/lan1" "$T/sysnet/wan" \
         "$T/sysnet/tailscale0" "$T/sysnet/ztrfyzwvfa" "$T/sysnet/br-guest"
ln -s ../br-lan "$T/sysnet/lan1/master"          # порт внутри моста — не своя сеть
for d in lo br-lan lan1 wan tailscale0 ztrfyzwvfa; do printf 'up\n' > "$T/sysnet/$d/operstate"; done
printf 'down\n' > "$T/sysnet/br-guest/operstate"  # гостевой мост поднимут позже

# Туннельные устройства — отдельной фикстурой (шов OUT_SYSNET): метод `devices` отвечает на
# другой вопрос, чем client_nets, и отбирает по /sys/class/net/*/type. 65534 — ARPHRD_NONE
# (wireguard, tun), у моста и порта тип другой, и в перечень они попасть не должны.
# Счётчики устройств — своя фикстура (шов SYSNET_STATS): их читают и метод dev_stats, и круг
# опроса `live`, и до сих пор они брались из настоящего /sys, то есть стендом не проверялись
# вовсе.
mkdir -p "$T/statnet/wg0/statistics" "$T/statnet/br-lan/statistics" "$T/statnet/lo/statistics"
for d in wg0 br-lan lo; do
    printf '11\n' > "$T/statnet/$d/statistics/rx_bytes"
    printf '22\n' > "$T/statnet/$d/statistics/tx_bytes"
    printf '3\n'  > "$T/statnet/$d/statistics/rx_packets"
    printf '4\n'  > "$T/statnet/$d/statistics/tx_packets"
done
printf '223000000\n' > "$T/statnet/wg0/statistics/rx_bytes"

mkdir -p "$T/outnet/wg0" "$T/outnet/br-lan" "$T/outnet/lan1"
printf '65534\n' > "$T/outnet/wg0/type";    printf 'up\n'   > "$T/outnet/wg0/operstate"
printf 'DEVTYPE=wireguard\n' > "$T/outnet/wg0/uevent"
printf '772\n'   > "$T/outnet/br-lan/type"; printf 'up\n'   > "$T/outnet/br-lan/operstate"
printf '1\n'     > "$T/outnet/lan1/type";   printf 'up\n'   > "$T/outnet/lan1/operstate"

# ip: единственная подкоманда, которая нужна перечню сетей, — адреса устройства. Форма
# строки как у настоящего `ip -4 -o addr show`, включая хвост после префикса: разбор обязан
# брать второе поле, а не всю строку. У Tailscale адрес /32 — сеть из одного адреса, и это
# не выдумка стенда, а то, из-за чего перечень обязан показывать ВЫВЕДЕННУЮ сеть.
cat > "$T/bin/ip" <<'EOF'
#!/bin/sh
# Адреса: и по одному устройству, и ВСЕ РАЗОМ. Второе — то, как настоящий `ip` отвечает на
# `ip -4 -o addr show` без имени; перечень сетей клиентов спрашивает именно так, одним
# запуском вместо запуска на устройство.
all() {
    echo "3: br-lan    inet 192.168.1.1/24 brd 192.168.1.255 scope global br-lan"
    # Адрес wan подменяем из теста: бывает, что сторона провайдера сама частная (роутер за
    # роутером), и тогда «клиентом» выглядит всякий, кто пришёл оттуда.
    echo "4: wan    inet ${IP_WAN_ADDR:-46.42.17.15/22} brd 46.42.19.255 scope global wan"
    echo "9: tailscale0    inet 100.64.1.5/32 scope global tailscale0"
    echo "8: ztrfyzwvfa    inet 10.147.17.20/24 brd 10.147.17.255 scope global ztrfyzwvfa"
    echo "1: lo    inet 127.0.0.1/8 scope host lo"
}
dev=""
for a in "$@"; do dev="$a"; done
case "$1" in rule|route) exit 0 ;; esac
case "$dev" in
    show)       all ;;
    br-lan)     all | grep " br-lan " ;;
    wan)        all | grep " wan " ;;
    tailscale0) all | grep " tailscale0 " ;;
    ztrfyzwvfa) all | grep " ztrfyzwvfa " ;;
    lo)         all | grep " lo " ;;
esac
exit 0
EOF
chmod +x "$T/bin/ip"

# ---- вызов настоящего скрипта -------------------------------------------------
# Один вход на все проверки: разница между ними — только в фикстурах и переменных.
# Вызов БЕЗ завершающего перевода строки — ровно так передаёт запрос ubus.
#
# Разница не косметическая: `read` на входе без перевода строки возвращает НЕНУЛЕВОЙ код,
# уже заполнив переменную, и обработчик, написанный как `read -r input || input=''`, затирал
# прочитанное. Метод молча отвечал по первой подписке, а на экране у второй стояли чужие
# числа. Стенд всё это время передавал вход с переводом строки и потому ловушку не видел.
rpcd_raw() {  # МЕТОД JSON_ЗАПРОСА
    RPCD_NO_NEWLINE=1 rpcd "$@"
}

rpcd() {  # МЕТОД [JSON_ЗАПРОСА]  — вызов метода; для перечня методов есть rpcd_list
    if [ "${RPCD_NO_NEWLINE:-0}" = 1 ]; then printf '%s' "${2:-}"; else printf '%s\n' "${2:-}"; fi | env \
        SANDBOX="$T" \
        PATH="$T/bin:$PATH" \
        JSHN_SH="$ROOT/tests/stub/jshn.sh" FETCH_SH="$ROOT/files/usr/lib/splify2/fetch.sh" \
        FAST_SH="$ROOT/files/usr/lib/splify2/fast.sh" \
        RPCD_LIB="$ROOT/files/usr/lib/splify2/rpcd" \
        AD_SH="${AD_SH_FIXTURE:-$ROOT/files/usr/share/splify2/allow-domains.sh}" \
        AD_STAMP="$T/etc/allow-domains.tag" AD_TMP="$T/srs-tmp" \
        AD_BASE="${AD_BASE_FIXTURE:-file://$T/adrel}" AD_TAG_DEFAULT="${AD_TAG_FIXTURE:-2026-08-31_16-18}" \
        SYSNET_STATS="${SYSNET_STATS_FIXTURE:-$T/statnet}" \
        CONNTRACK="${CONNTRACK_FIXTURE:-$T/nf_conntrack}" \
        STEER="$T/bin/steer" \
        SPEC="$T/etc/spec.json" \
        LISTS="$T/lists" \
        SUB="$T/etc/sub.txt" \
        SUBS_DIR="$T/etc/subs" \
        MANIFEST="$T/etc/manifest.json" \
        INITD="$T/bin/initd-steer" \
        STEER_INIT="$T/bin/initd-steer" \
        RPCD_INITD="$T/bin/initd-rpcd" \
        FW_OWNED="$T/etc/fw-owned" \
        OPENWRT_RELEASE="${OPENWRT_RELEASE_FIXTURE:-$T/etc/openwrt_release}" \
        APPLIED="$T/etc/spec.applied.json" \
        HWID_SYSNET="${HWID_SYSNET_FIXTURE:-$T/sys/class/net}" \
        SYSNET="${SYSNET_FIXTURE:-$T/sysnet}" \
        OUT_SYSNET="${OUT_SYSNET_FIXTURE:-$T/outnet}" \
        UCI_SPLIFY2="${UCI_SPLIFY2_FIXTURE:-$T/etc/config/splify2}" \
        XS_STATE_DIR="$T/var/lib/steer" \
        XS_RUN="$T/var/run/xsteer" \
        SYSINFO_MODEL="$T/etc/sysinfo-model" \
        STEER_HWID="${STEER_HWID-splify2-9c53221f0abc9c53}" \
        STEER_SUB_JSON="${STEER_SUB_JSON-}" \
        STEER_SUB_INFO="${STEER_SUB_INFO-}" \
        STEER_SUB_BODY="${STEER_SUB_BODY-vless://k@h:443#n}" \
        STEER_SUB_RC="${STEER_SUB_RC:-0}" \
        STEER_QUOTA_RC="${STEER_QUOTA_RC:-0}" \
        CURL_RESP_HDRS="${CURL_RESP_HDRS:-}" \
        CURL_HEAD_HDRS="${CURL_HEAD_HDRS-}" \
        CURL_HEAD_RC="${CURL_HEAD_RC:-0}" \
        CURL_BODY="${CURL_BODY:-}" \
        CURL_RC="${CURL_RC:-0}" \
        APPLIED="$T/etc/spec.applied.json" \
        BACKUP_OUT="$T/var/backup.out" \
        BACKUP_IN="$T/var/backup.in" \
        BACKUP_MAX_BYTES="${BACKUP_MAX_BYTES:-262144}" \
        STEER_RC="${STEER_RC:-0}" \
        GH_BODY="${GH_BODY-}" \
        GH_FAIL="${GH_FAIL-}" \
        GH_CACHE="$T/var/releases.json" \
        GH_CACHE_TTL_MIN="${GH_CACHE_TTL_MIN:-0}" \
        STEER_ERR="${STEER_ERR:-}" \
        APK_ADD_RC="${APK_ADD_RC:-0}" \
        APK_ADD_OUT="${APK_ADD_OUT:-}" \
        PM_FIXTURE="${PM_FIXTURE:-}" \
        UPDATE_LISTS="${UPDATE_LISTS:-$T/bin/update-lists}" \
        ENGINE_ENABLED="${ENGINE_ENABLED:-0}" \
        APK_LIST="${APK_LIST:-}" \
        MODULE_DIR="${MODULE_DIR_FIXTURE:-$T/mods}" \
        SINGBOX_INITD="${SINGBOX_INITD_FIXTURE:-$T/box/none}" \
        sh "$SCRIPT" call "$1" 2>"$T/stderr"
}

rpcd_list() {
    env SANDBOX="$T" PATH="$T/bin:$PATH" JSHN_SH="$ROOT/tests/stub/jshn.sh" FETCH_SH="$ROOT/files/usr/lib/splify2/fetch.sh" \
        sh "$SCRIPT" list 2>"$T/stderr"
}

# Булево печатается как в JSON (true/false), а не как в python (True/False): иначе
# проверка сравнивала бы ожидание с языком, на котором написана сама проверка.
# Значение uci из хранилища заглушки. Прямо файлом, а не через `$T/bin/uci`: тот работает
# только с SANDBOX в окружении, а проверкам удобнее спрашивать снаружи вызова.
uci_get() {  # КЛЮЧ
    # `case`, а не grep: в имени безымянной секции есть квадратные скобки — см. шапку заглушки uci.
    _v=""
    while IFS= read -r _l; do
        case "$_l" in "$1="*) _v="${_l#*=}" ;; esac
    done < "$T/uci.store"
    printf '%s' "$_v"
}
uci_set() {  # КЛЮЧ ЗНАЧЕНИЕ
    : > "$T/uci.store.t"
    while IFS= read -r _l; do
        case "$_l" in "$1="*) continue ;; esac
        printf '%s\n' "$_l" >> "$T/uci.store.t"
    done < "$T/uci.store" 2>/dev/null
    printf '%s=%s\n' "$1" "$2" >> "$T/uci.store.t"
    mv "$T/uci.store.t" "$T/uci.store"
}

jget() {  # ПОЛЕ < JSON
    python3 -c 'import json,sys
try: d = json.load(sys.stdin)
except Exception: print("НЕ JSON"); raise SystemExit
v = d
for k in sys.argv[1].split("."):   # вложенное поле — через точку: game.gv
    v = v.get(k) if isinstance(v, dict) else None
print("" if v is None else json.dumps(v, ensure_ascii=False) if isinstance(v,(list,dict,bool)) else v)' "$1"
}

# Вложенное поле ответа: объектами приезжают и остаток трафика подписки, и названия релизов
# («версия → название»). Сравнивать такой ответ целиком строкой значило бы привязать проверку к
# порядку ключей.
jqget() {  # ОБЪЕКТ ПОЛЕ < JSON
    python3 -c 'import json,sys
try: d = json.load(sys.stdin)
except Exception: print("НЕ JSON"); raise SystemExit
o = d.get(sys.argv[1]) or {}
v = o.get(sys.argv[2])
print("" if v is None else json.dumps(v, ensure_ascii=False) if isinstance(v,(list,dict,bool)) else v)' "$1" "$2"
}

# Поле объекта из массива — по ИМЕНИ, а не по номеру: порядок массива `outputs` задаёт
# движок, и привязка проверки к нулевому элементу сломалась бы от появления второго выхода.
# Отдельная функция, а не jsonfilter: его в окружении стенда нет, он есть только заглушкой
# в PATH объекта rpcd.
jout() {  # ВЫХОД ПОЛЕ < JSON
    python3 -c 'import json,sys
try: d = json.load(sys.stdin)
except Exception: print("НЕ JSON"); raise SystemExit
for o in (d.get("outputs") or []):
    if isinstance(o, dict) and o.get("name") == sys.argv[1]:
        v = o.get(sys.argv[2])
        print("" if v is None else json.dumps(v, ensure_ascii=False) if isinstance(v,(list,dict,bool)) else v)
        raise SystemExit
print("НЕТ ВЫХОДА")' "$1" "$2"
}

reset_logs() { rm -f "$T/apk.log" "$T/initd.log" "$T/wget.log" "$T/curl.log" "$T/rpcd-initd.log" "$T/disabled"; : > "$T/apk.log"; : > "$T/initd.log"; }

# Только то, что init.d МЕНЯЕТ. Запросы состояния (enabled) в протоколе тоже есть — их
# делает сам скрипт, чтобы отчитаться, — но к порядку действий они не относятся.
custom_domains_path()  { printf '%s/lists/custom/domains/%s.lst' "$T" "$1"; }
custom_prefixes_path() { printf '%s/lists/custom/%s.lst' "$T" "$1"; }

initd_actions() { grep -v '^enabled$' "$T/initd.log" | awk '{printf "%s ", $1}' | sed 's/ $//'; }

# ---- сам скрипт вообще запускается --------------------------------------------
# Первая проверка стенда — про стенд: пока она красная, все остальные бессмысленны.
out="$(rpcd_list)"
check "объект отвечает списком методов (стенд поднялся)" \
      "yes" "$(printf '%s' "$out" | python3 -c 'import json,sys
try: print("yes" if "steer_install" in json.load(sys.stdin) else "no")
except Exception: print("не JSON")')"
# ---- унаследованный дескриптор с двузначным номером не убивает объект -------------------
# Объект первой же командой закрывает все дескрипторы старше 2 (дальше по файлу — зачем). На
# runner'е GitHub у процесса оказался унаследованный дескриптор 142, и `eval "exec 142>&-"`
# под dash — это не отказ перенаправления, а СИНТАКСИЧЕСКАЯ ошибка, а она в eval у
# неинтерактивной оболочки фатальна: объект умирал молча до первой печати, и все 483 проверки
# краснели одним махом. На машине стенда таких дескрипторов не бывает, на роутере (busybox ash)
# двузначные номера законны — поэтому увидеть это можно было только на runner'е. Здесь
# дескриптор 142 подсовывается объекту нарочно, через python: оболочка стенда сама его открыть
# не может по той же причине.
out="$(python3 - "$SCRIPT" "$ROOT/tests/stub/jshn.sh" "$T" <<'PY'
import os, subprocess, sys
script, jshn, t = sys.argv[1:4]
fd = os.open("/dev/null", os.O_RDONLY)
os.dup2(fd, 142)
os.set_inheritable(142, True)
env = dict(os.environ, SANDBOX=t, PATH=t + "/bin:" + os.environ["PATH"], JSHN_SH=jshn)
r = subprocess.run(["sh", script, "list"], env=env, pass_fds=[142], capture_output=True, text=True)
sys.stdout.write(r.stdout)
PY
)"
check "объект переживает унаследованный дескриптор 142 (runner GitHub)" "yes" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys
try: print("yes" if "steer_install" in json.load(sys.stdin) else "no")
except Exception: print("не JSON")')"

# Не поднялся — сказать, ПОЧЕМУ, тут же: stderr объекта иначе лежит в $T/stderr и уходит вместе
# с песочницей, и на чужой машине (runner релиза) остаётся только «не JSON» без причины.
if ! printf '%s' "$out" | python3 -c 'import json,sys; json.load(sys.stdin)' >/dev/null 2>&1; then
    echo "--- stdout объекта (первые строки):"; printf '%s\n' "$out" | head -5
    echo "--- stderr объекта:"; head -20 "$T/stderr" 2>/dev/null
    # Молчание с обеих сторон — значит оболочка умерла до первой печати. Тогда трасса: где именно.
    echo "--- какой sh: $(command -v sh) → $(readlink -f "$(command -v sh)")"
    echo "--- sh -x объекта (хвост):"
    env SANDBOX="$T" PATH="$T/bin:$PATH" JSHN_SH="$ROOT/tests/stub/jshn.sh" FETCH_SH="$ROOT/files/usr/lib/splify2/fetch.sh" \
        sh -x "$SCRIPT" list 2>&1 | tail -40
fi

# ---- I-049: установка не должна снимать работающий пакет ----------------------
# Сценарий: стоит рабочий 0.9.5-extended, ставим 0.9.6-extended, apk отказывает.
# На роутере `apk del` уже запустил pre-deinstall, а тот остановил и ОТКЛЮЧИЛ сервис
# и снёс таблицу nft. Значит роутер остаётся без маршрутизации, и перезагрузка не спасёт.
cat > "$T/etc/openwrt_release" <<'EOF'
DISTRIB_ARCH='aarch64_cortex-a53'
EOF

# Отказ НЕ по конфликту: нет зависимости. apk печатает про это тем же «unable to select
# packages», что и про конфликт, — поэтому по одному этому тексту снимать работающий
# движок нельзя, и проверка сторожит именно это различие.
reset_logs
out="$(APK_ADD_RC=1 APK_ADD_OUT='ERROR: unable to select packages: steer-extended-0.9.6-r1: required package nftables missing' \
       rpcd steer_install '{"version":"0.9.6","extended":true}')"

check "при отказе установки первым вызовом apk идёт add, а не del (I-049)" \
      "add" "$(awk 'NR==1{print $1}' "$T/apk.log")"

check "при отказе установки рабочий пакет не снят (I-049)" \
      "" "$(grep -c '^del' "$T/apk.log" | sed 's/^0$//')"

check "при отказе установки ответ отрицательный" \
      "false" "$(printf '%s' "$out" | jget ok)"

# Успешное обновление в пределах одного варианта — самый частый путь. Через удаление
# он проходить не должен вовсе: окна без маршрутизации не возникает.
reset_logs
out="$(rpcd steer_install '{"version":"0.9.6","extended":true}')"
check "обновление того же варианта не проходит через apk del (I-049)" \
      "" "$(grep -c '^del' "$T/apk.log" | sed 's/^0$//')"
check "успешная установка отчитывается положительно" \
      "true" "$(printf '%s' "$out" | jget ok)"

# Смена варианта: базовый и расширенный владеют одним /usr/sbin/steer, apk отвергает
# такое по конфликту. Вот здесь удаление законно — но только после того, как apk отказал,
# и с обязательной повторной попыткой.
reset_logs
out="$(APK_ADD_RC=1 APK_ADD_OUT='ERROR: package steer conflicts with steer-extended' \
       rpcd steer_install '{"version":"0.9.6","extended":false}')"
check "на конфликте вариантов: add, потом del, потом add ещё раз (I-049)" \
      "add del del add" "$(awk '{printf "%s ", $1}' "$T/apk.log" | sed 's/ $//')"
check "если и повторная установка не удалась, ответ говорит про снятый пакет (I-049)" \
      "yes" "$(printf '%s' "$out" | jget error | grep -qi 'снят\|удал' && echo yes || echo no)"

# ---- I-050: архитектура пакетов, а не архитектура apk -------------------------
# На роутере верный источник — DISTRIB_ARCH. Фолбэк на `apk --print-arch` отдаёт
# `aarch64`, которого нет ни в одном из двенадцати имён релиза: имя файла собирается
# неверно и скачивание молча не находит пакет.
out="$(OPENWRT_RELEASE_FIXTURE="$T/etc/nonexistent" rpcd steer_versions)"
check "без openwrt_release архитектура не выдумывается из apk (I-050)" \
      "" "$(printf '%s' "$out" | jget arch)"

out="$(rpcd steer_versions)"
check "с openwrt_release архитектура берётся из DISTRIB_ARCH" \
      "aarch64_cortex-a53" "$(printf '%s' "$out" | jget arch)"

# ---- I-052: список версий не шире, чем принимает установка --------------------
# steer_install отвергает всё, что не вида X.Y.Z. Значит тег с суффиксом, дойдя до
# выпадающего списка, будет выбран как «свежая» — и отвергнут собственным бэкендом.
out="$(rpcd steer_versions)"
check "тег с суффиксом до выпадающего списка не доходит (I-052)" \
      '["26.9", "0.9.6", "0.9.4"]' "$(printf '%s' "$out" | jget versions)"

# ---- I-042 (половина в rpcd): отказ удаления виден в ответе -------------------
# Здесь скрипт уже прав, и проверка сторожевая: интерфейс отчитывается об успехе
# независимо от ответа, и чинить надо его — но только пока ответ остаётся честным.
out="$(rpcd list_remove '{"id":"news","kind":"prefixes"}')"
check "занятый каналом список не удаляется" \
      "false" "$(printf '%s' "$out" | jget ok)"
check "причина отказа названа словами (I-042)" \
      "yes" "$(printf '%s' "$out" | jget error | grep -qi 'использ' && echo yes || echo no)"
check "файл списка на месте" "10.0.0.0/8" "$(cat "$T/lists/news.lst")"

# ---- R-017: «остановить всё» одним действием ----------------------------------
# Просьба из публичного теста дословно: «жизненно необходима кнопка Остановить, причём
# всё — и сервис, и движок». Решение владельца: stop + disable, то есть перезагрузка
# состояние не возвращает, и обратное действие тоже должно быть.
reset_logs
out="$(rpcd engine_stop)"
check "остановка действительно останавливает и отключает (R-017)" \
      "stop disable" "$(initd_actions)"
check "остановка отчитывается положительно (R-017)" \
      "true" "$(printf '%s' "$out" | jget ok)"
check "после остановки автозапуск снят (R-017)" \
      "false" "$(printf '%s' "$out" | jget enabled)"

reset_logs
out="$(rpcd engine_start)"
check "запуск включает автозапуск и поднимает сервис (R-017)" \
      "enable start" "$(initd_actions)"
check "после запуска автозапуск на месте (R-017)" \
      "true" "$(printf '%s' "$out" | jget enabled)"

# Подпись тумблера обязана читать состояние, а не помнить своё: между двумя открытиями
# страницы движок могли остановить из консоли.
out="$(ENGINE_ENABLED=0 rpcd engine)"
check "engine сообщает, включён ли автозапуск (R-017)" \
      "true" "$(printf '%s' "$out" | jget enabled)"
out="$(ENGINE_ENABLED=1 rpcd engine)"
check "engine видит снятый автозапуск (R-017)" \
      "false" "$(printf '%s' "$out" | jget enabled)"

# ---- минимальная версия движка, под которую собран интерфейс ---------------------------
# Интерфейс 26.9 опирается на умения движка, появившиеся после выпуска 1.3.0, а обновление
# интерфейса движок не трогает. Число одно и живёт в бэкенде (STEER_MIN_VERSION): метод
# engine отдаёт его, карточка сравнивает. Стенд сверяет ответ с константой в файле, а не с
# числом в себе — иначе он повторял бы ту же ошибку, что ловит.
out="$(rpcd engine)"
check "engine называет минимальную версию движка (цифры и точки)" "yes" \
      "$(printf '%s' "$out" | jget min_version | grep -qE '^[0-9]+(\.[0-9]+)+$' && echo yes || echo no)"
check "минимум — та константа, что объявлена в m-engine.sh" \
      "$(sed -n 's/^STEER_MIN_VERSION=//p' "$ROOT/files/usr/lib/splify2/rpcd/m-engine.sh")" \
      "$(printf '%s' "$out" | jget min_version)"
# Интерфейс пишет спеку v2 (ui/src/lib/specv2.ts), а её читает только ядро 2.0: 1.5.x отвечает
# на неё отказом, и минимум младше 2.0.0 одобрял бы ядро, на котором не применится ничего.
check "минимум — не младше 2.0.0: спеку v2 читает только ядро 2.0" "2.0.0" \
      "$(printf '%s\n%s\n' "$(printf '%s' "$out" | jget min_version)" 2.0.0 | sort -V | head -n 1)"

# ---- версия интерфейса — без сети, вместе с ядром ---------------------------------------
# «Сейчас: luci-app-splify2 …» и подпись рельса брались только из splify2_versions, а он перед
# ответом идёт в сеть за перечнем выпусков: снято с QEMU-стенда без DNS — 26 секунд на вызов,
# пока они идут, карточка писала «Сейчас: luci-app-splify2 ?», рельс — одно «Bode». Установленный
# пакет — местное знание, и отдаёт его engine, который страница спрашивает сразу.
reset_logs
out="$(rpcd engine)"
check "engine называет установленную версию интерфейса" "0.7.6" "$(printf '%s' "$out" | jget ui_version)"
check "и в сеть за ней не ходит" "0" "$(cat "$T/wget.log" "$T/curl.log" 2>/dev/null | grep -c .)"
mv "$T/bin/steer" "$T/bin/steer.away"
out="$(rpcd engine)"
mv "$T/bin/steer.away" "$T/bin/steer"
check "ядра нет — версия интерфейса всё равно названа" "false;0.7.6" \
      "$(printf '%s' "$out" | jget present);$(printf '%s' "$out" | jget ui_version)"

# ---- модули ядра 2.0: перечень с proxy, VLESS — по модулю ------------------------------
# Модули — бинарники steer-<модуль> рядом с steerd (MODULE_DIR на стенде). steer-proxy (trojan,
# shadowsocks, socks, http, vmess) — такой же модуль, как остальные: без него в перечне выход
# прокси выглядел бы так, будто модуля нет, хотя он стоит.
mkdir -p "$T/mods"
for m in vless proxy; do printf '#!/bin/sh\n' > "$T/mods/steer-$m"; chmod +x "$T/mods/steer-$m"; done
CORE_LIST="steer-core-2.0.0-r1 aarch64_cortex-a53 {steer-core}
steer-vless-2.0.0-r1 aarch64_cortex-a53 {steer-vless}
steer-proxy-2.0.0-r1 aarch64_cortex-a53 {steer-proxy}"
out="$(APK_LIST="$CORE_LIST" rpcd engine)"
check "engine называет модуль proxy среди стоящих" '["vless", "proxy"]' "$(printf '%s' "$out" | jget modules)"
check "VLESS — по модулю steer-vless" "true" "$(printf '%s' "$out" | jget vless)"
# Без модуля steer-vless ядро 2.0 VLESS не умеет, что бы ни печатал его отказ: признак — файл
# модуля, а не подстрока «steer-extended» в тексте `steer vless ''` (заглушка там молчит, и
# прежний разбор принимал молчание за «умеет»).
rm -f "$T/mods/steer-vless"
: > "$T/steer.log"
out="$(APK_LIST="$CORE_LIST" rpcd engine)"
check "ядро 2.0 без steer-vless VLESS не умеет" "false" "$(printf '%s' "$out" | jget vless)"
check "и отказ ядра для этого не спрашивали" "0" "$(grep -c '^vless' "$T/steer.log" 2>/dev/null || true)"
# Прежнее ядро 1.x — один бинарник: клиент VLESS вшит в пакет steer-extended.
out="$(APK_LIST="steer-extended-1.5.9-r1 aarch64_cortex-a53 {steer-extended}" rpcd engine)"
check "ядро 1.x: VLESS — по пакету steer-extended" "true" "$(printf '%s' "$out" | jget vless)"
out="$(APK_LIST="steer-1.5.9-r1 aarch64_cortex-a53 {steer}" rpcd engine)"
check "ядро 1.x без steer-extended VLESS не умеет" "false" "$(printf '%s' "$out" | jget vless)"
rm -rf "$T/mods"

# ---- steer-box-connector: ядро занято podkop/forkop -----------------------------------
# Коннектор ставит свою службу /etc/init.d/sing-box и держит steerd сам. splify2 видит его по
# этой службе (то же слово, что ищут скрипты пакетов ядра), говорит, кем занято ядро, и не
# поднимает службу steer поверх: ни запуском, ни применением спеки, ни установкой пакетов ядра.
mkdir -p "$T/box"
printf '#!/bin/sh /etc/rc.common\n# sing-box от steer-box-connector\n' > "$T/box/sing-box"
printf '#!/bin/sh\n' > "$T/box/forkop"
out="$(SINGBOX_INITD_FIXTURE="$T/box/sing-box" rpcd engine)"
check "коннектор: engine называет, кем занято ядро" "forkop" "$(printf '%s' "$out" | jget busy)"
out="$(rpcd engine)"
check "без коннектора поля busy нет" "" "$(printf '%s' "$out" | jget busy)"
printf '#!/bin/sh /etc/rc.common\n# sing-box upstream\n' > "$T/box/sing-box.up"
out="$(SINGBOX_INITD_FIXTURE="$T/box/sing-box.up" rpcd engine)"
check "чужой sing-box (не коннектор) ядро не занимает" "" "$(printf '%s' "$out" | jget busy)"
reset_logs
out="$(SINGBOX_INITD_FIXTURE="$T/box/sing-box" rpcd engine_start)"
check "коннектор: запуск службы steer отвергнут" "false" "$(printf '%s' "$out" | jget ok)"
check "и служба steer не тронута" "" "$(initd_actions)"
check "отказ называет, кем занято ядро" "ядро занято: forkop" "$(printf '%s' "$out" | jget error)"
: > "$T/steer.log"
out="$(SINGBOX_INITD_FIXTURE="$T/box/sing-box" rpcd apply)"
check "коннектор: применение спеки отвергнуто" "false" "$(printf '%s' "$out" | jget ok)"
check "и steer apply не звали" "0" "$(grep -c '^apply' "$T/steer.log")"
reset_logs
out="$(SINGBOX_INITD_FIXTURE="$T/box/sing-box" rpcd steer_install '{"version":"2.0.0"}')"
check "коннектор: установка ядра отвергнута до скачивания" "false;0" \
      "$(printf '%s' "$out" | jget ok);$(cat "$T/wget.log" "$T/curl.log" 2>/dev/null | grep -c .)"
printf '#!/bin/sh\n' > "$T/box/podkop"
out="$(SINGBOX_INITD_FIXTURE="$T/box/sing-box" rpcd engine)"
check "podkop и forkop рядом — названы оба" "podkop, forkop" "$(printf '%s' "$out" | jget busy)"
rm -rf "$T/box"

# ---- R-042: интерфейс должен уметь обновлять сам себя --------------------------
# Движок из интерфейса ставится с первого дня, а сам интерфейс — нет: его обновляли
# только руками через ssh. Пакетов нет в feeds, поэтому «apk upgrade» их не видит, и
# другого пути, кроме как сходить в релизы самому, не существует.
reset_logs
out="$(rpcd splify2_versions)"
check "версии интерфейса берутся из релизов splify2 (R-042)" \
      "yes" "$(grep -c 'api.github.com/repos/splify2/splify2' "$T/wget.log" >/dev/null 2>&1 && grep -q 'splify2/splify2' "$T/wget.log" && echo yes || echo no)"
check "тег с суффиксом отсеивается и здесь (R-042)" \
      '["26.9", "0.9.6", "0.9.4"]' "$(printf '%s' "$out" | jget versions)"
# ---- версии формата «26.9 Andromeda» ------------------------------------------------
# Выпуск называется кодовым именем, а ставится числом, и это две разные строки: в имени файла
# пакета и в теге пробелу места нет ни у apk, ни у opkg, ни в URL. Пока бэкенд отдавал одни
# числа, список версий не сходился ни со страницей релизов, ни с тем, как о выпуске говорят.
out="$(rpcd steer_versions)"
check "версия из двух частей не отсеивается: «26.9» — не хуже «1.2.0»" "yes" \
      "$(printf '%s' "$out" | jget versions | grep -q '"26.9"' && echo yes || echo no)"
check "первой идёт самая свежая — по порядку релизов, а не по строке" "26.9" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["versions"][0])')"
check "название выпуска приезжает рядом с версией" "26.9 Andromeda" \
      "$(printf '%s' "$out" | jqget names 26.9)"
# Заголовка у релиза нет вовсе (в ответе null) — показываем число. Пустая строка на экране
# была бы версией без имени, то есть строкой, по которой нечего выбрать.
check "релиз без заголовка называется своим числом" "0.9.6" \
      "$(printf '%s' "$out" | jqget names 0.9.6)"
# Вертикальная черта — разделитель во внутренней разметке названий; заголовок с ней ломал бы
# поиск по версии. Отказываться из-за заголовка от самого релиза нельзя: ставится он по версии.
check "заголовок с вертикальной чертой откатывается на число" "0.9.4" \
      "$(printf '%s' "$out" | jqget names 0.9.4)"
check "у отсеянного тега названия нет: его нет и в версиях" "" \
      "$(printf '%s' "$out" | jqget names nightly)"

out="$(rpcd splify2_versions)"
check "интерфейс отдаёт названия тем же полем" "26.9 Andromeda" \
      "$(printf '%s' "$out" | jqget names 26.9)"

# GitHub не ответил — ни версий, ни названий, и метод обязан ОТВЕТИТЬ, а не умереть: без
# списка карточка движка показывает «Переустановить», и это верно, а не поломка.
out="$(GH_BODY='не json' rpcd steer_versions)"
check "нечитаемый ответ GitHub не роняет метод" "true;[];{}" \
      "$([ -n "$out" ] && echo true || echo false);$(printf '%s' "$out" | jget versions);$(printf '%s' "$out" | jget names)"

# Память перечня выпусков. Поход на GitHub стоит полторы секунды там, где он закрыт, и шёл при
# каждом открытии страницы; теперь ответ живёт шесть часов. Стенд в остальных проверках
# память выключает (GH_CACHE_TTL_MIN=0), потому что подменяет ответы GitHub от проверки к
# проверке; здесь включает и смотрит, что второй вызов на GitHub не ходит.
reset_logs
rm -f "$T"/var/releases.json.*.cache
GH_CACHE_TTL_MIN=360 rpcd steer_versions >/dev/null
out="$(GH_CACHE_TTL_MIN=360 rpcd steer_versions)"
check "второй вызов версий движка берёт память, а не GitHub" "1" \
      "$(grep -c 'api.github.com/repos/splify2/steer' "$T/wget.log")"
check "и отдаёт то же самое" "26.9 Andromeda" "$(printf '%s' "$out" | jqget names 26.9)"
rm -f "$T"/var/releases.json.*.cache

# ПАМЯТЬ — ДАННЫЕ, А НЕ КОД. Файл памяти лежит в /tmp под предсказуемым именем, а /tmp на роутере
# пишут все процессы, включая непривилегированные (nobody у https-dns-proxy, dnsmasq, logd).
# Пока память читалась через `.`, любой из них мог положить туда строку с командой и дождаться,
# когда объект rpcd (root) откроет страницу версий. Здесь такая строка подложена заранее:
# команда не должна выполниться, а версии не должны браться из подложенного файла.
rm -f "$T/pwned"
printf 'GH_VERS=%s; touch "%s"\nGH_NAMES=x\nGH_NOTE=x\n' "'9.9'" "$T/pwned" > "$T/var/releases.json.splify2_steer.cache"
# Подложивший — не мы: файл отдаётся чужому владельцу (nobody), как оно и было бы на роутере.
# Без прав на chown (стенд не под root) вторая проверка пропускается — первая от прав не зависит.
chown 65534 "$T/var/releases.json.splify2_steer.cache" 2>/dev/null && chowned=1 || chowned=0
out="$(GH_CACHE_TTL_MIN=360 rpcd steer_versions)"
check "память версий не исполняется как код" "no" "$([ -e "$T/pwned" ] && echo yes || echo no)"
[ "$chowned" = 1 ] && check "чужой файл на месте памяти не читается — версии спрошены у GitHub" "26.9 Andromeda" \
      "$(printf '%s' "$out" | jqget names 26.9)"
rm -f "$T"/var/releases.json.*.cache "$T/pwned"

# ---- splify2#15: перечень версий переживает закрытый api.github.com ------------------
# Пакеты и списки обход получили ещё в запуске 59 (общая download() с лестницей «зеркало →
# contents API → архив → туннель»), а ПЕРЕЧЕНЬ версий остался спрошенным у одного хоста.
# Там, где api.github.com закрыт или где за CGNAT выбран его неавторизованный лимит (60
# запросов в час на адрес — так и пришла splify2#5), обе карточки показывали пустой список:
# обновиться из интерфейса нельзя, хотя сам пакет с зеркала скачался бы. Установщик этот
# путь имеет с запуска 48 (R-048, VERSION в main вторым источником) — бэкенд не имел.
reset_logs
out="$(GH_FAIL=1 CURL_BODY='1.2.9' rpcd steer_versions)"
check "api.github.com молчит — версия берётся из VERSION (splify2#15)" '["1.2.9"]' \
      "$(printf '%s' "$out" | jget versions)"
check "запасной путь идёт общей download() и спрашивает ветку dist, а не main" \
      "https://raw.githubusercontent.com/splify2/steer/dist/VERSION" \
      "$(grep 'VERSION' "$T/curl.log" | head -1)"
check "почему список короткий — сказано словами, а не пустотой" "yes" \
      "$(printf '%s' "$out" | jget note | grep -q 'VERSION' && echo yes || echo no)"
check "единственная версия называет себя сама" "1.2.9" \
      "$(printf '%s' "$out" | jqget names 1.2.9)"

out="$(GH_FAIL=1 CURL_BODY='1.2.9' rpcd splify2_versions)"
check "интерфейс берёт свою версию тем же путём (splify2#15)" '["1.2.9"]' \
      "$(printf '%s' "$out" | jget versions)"

# VERSION содержит ТОЛЬКО цифры и точки — на это стоит барьер в build.sh. Всё остальное
# отвергается целиком: подставить мусор в имя файла пакета хуже, чем остаться без версии.
out="$(GH_FAIL=1 CURL_BODY='v1.2.9-rc1' rpcd steer_versions)"
check "VERSION не вида «цифры и точки» не берётся" "[]" \
      "$(printf '%s' "$out" | jget versions)"

# Не ответил никто. Метод обязан ОТВЕТИТЬ пустым списком: карточка на нём говорит «список
# версий не пришёл», и это правда, а падение метода выглядело бы как поломка интерфейса.
out="$(GH_FAIL=1 CURL_RC=1 rpcd steer_versions)"
check "не ответил никто — метод всё равно отвечает" "true;[]" \
      "$([ -n "$out" ] && echo true || echo false);$(printf '%s' "$out" | jget versions)"

# Обычный путь запасным не подменяется: пока API отвечает, VERSION не спрашивается вовсе.
reset_logs
out="$(rpcd steer_versions)"
check "API ответил — за VERSION никто не ходит" "" \
      "$(grep 'VERSION' "$T/curl.log" 2>/dev/null | head -1)"
check "API ответил — примечания нет" "" "$(printf '%s' "$out" | jget note)"

out="$(rpcd splify2_versions)"
check "установленная версия названа, чтобы было с чем сравнить (R-042)" \
      "0.7.6" "$(printf '%s' "$out" | jget current)"

reset_logs
out="$(rpcd splify2_install '{"version":"0.7.7"}')"
# Журнал теперь curl.log, а не wget.log: пакеты качаются общей download() (splify2#15),
# у которой есть обход закрытого githubusercontent — своим wget этот метод больше не ходит.
check "качается noarch-пакет интерфейса (R-042)" \
      "https://github.com/splify2/splify2/releases/download/v0.7.7/luci-app-splify2-0.7.7-1_noarch.apk" \
      "$(grep 'luci-app-splify2' "$T/curl.log" | head -1)"
check "установка интерфейса идёт тем же порядком: add первым (R-042)" \
      "add" "$(awk 'NR==1{print $1}' "$T/apk.log")"
check "после установки rpcd перезапускается, иначе новый ACL не подхватится (R-042)" \
      "yes" "$(grep -q restart "$T/rpcd-initd.log" 2>/dev/null && echo yes || echo no)"
check "установка интерфейса отчитывается положительно (R-042)" \
      "true" "$(printf '%s' "$out" | jget ok)"

reset_logs
out="$(rpcd splify2_install '{"version":"нет-такой"}')"
check "версия не вида X.Y.Z отвергается до скачивания (R-042)" \
      "false" "$(printf '%s' "$out" | jget ok)"
check "при отказе по версии ничего не качалось (R-042)" \
      "" "$(cat "$T/wget.log" "$T/curl.log" 2>/dev/null | grep -c . | sed 's/^0$//')"

# ---- I-255: конфликт, в котором названного пакета нет, его не снимает --------
# Ветка снятия заведена под замену steer ↔ steer-extended: там менеджер называет
# мешающий пакет по имени, и снять его — это и есть смысл. У splify2_install имя для
# снятия одно — сам luci-app-splify2, и конфликт ip-full ↔ ip-tiny (26.9 требует
# ip-full, на роутере стоит ip-tiny) к нему отношения не имеет: повторная попытка
# упадёт по той же причине, а интерфейс останется снятым.
#
# `unable to select packages` в тексте — не случайность: именно так apk печатает и
# конфликт тоже, поэтому pkg_add_file на нём обновляет индексы и пробует ещё раз
# (add update add). Проверяется, что к этой паре не добавляется del.
reset_logs
out="$(APK_ADD_RC=1 APK_ADD_OUT='ERROR: unable to select packages:
  ip-tiny-6.11.0-r1:
    conflicts: ip-full-6.11.0-r1
    satisfies: luci-app-splify2-26.9-1[ip-full]' \
       rpcd splify2_install '{"version":"26.9"}')"
check "чужой конфликт не снимает интерфейс (I-255)" \
      "add update add" "$(awk '{printf "%s ", $1}' "$T/apk.log" | sed 's/ $//')"
check "чужой конфликт: ответ не рапортует о снятом пакете (I-255)" \
      "false" "$(printf '%s' "$out" | jget removed)"
check "чужой конфликт: причина отказа доезжает до человека целиком (I-255)" \
      "yes" "$(printf '%s' "$out" | jget error | grep -q 'ip-full' && echo yes || echo no)"

# То же на установке движка: конфликт между чужими пакетами не повод снимать
# работающий steer — это ровно I-049, но по другой ветке разбора.
reset_logs
out="$(APK_ADD_RC=1 APK_ADD_OUT='ERROR: package ip-tiny conflicts with ip-full' \
       rpcd steer_install '{"version":"0.9.6","extended":false}')"
check "чужой конфликт не снимает движок (I-255)" \
      "" "$(grep -c '^del' "$T/apk.log" | sed 's/^0$//')"

# ---- перечень выпусков splify2/releases: version.json раньше api.github.com ------------------
# Решение владельца: версии ядра и интерфейса и адреса их файлов роутер берёт СНАЧАЛА из
# version.json репозитория splify2/releases (raw.githubusercontent.com → jsDelivr → сайт), а
# api.github.com и VERSION ветки dist остаются запасным путём — в прежнем порядке. Файл качается
# по urls из version.json по порядку со сверкой sha256, потом — прежней лестницей по имени.
printf 'PKG-REL\n' > "$T/body-rel"; printf 'PKG-SRC\n' > "$T/body-src"
relsum() { sha256sum "$1" | cut -d' ' -f1; }
mkrel() {  # ФАЙЛ SHA256_ФАЙЛОВ
    python3 - "$1" "$2" <<'PY'
import json, sys
out, s = sys.argv[1], sys.argv[2]
def v(prod, ver, src, names, ch="stable", **kw):
    tag = f"{prod}-v{ver}"
    e = {"version": ver, "channel": ch, "date": "2026-09-25", "tag": tag,
         "source": f"https://github.com/{src}/releases/tag/v{ver}",
         "changelog": f"changelogs/{prod}/{ver}.md",
         "assets": [{"name": n, "size": 8, "sha256": s,
                     "urls": [f"https://github.com/splify2/releases/releases/download/{tag}/{n}",
                              f"https://github.com/{src}/releases/download/v{ver}/{n}"]} for n in names]}
    e.update(kw)
    return e
A = "aarch64_cortex-a53"
doc = {"schema": 1, "updated": "2026-10-02T10:17:36Z", "products": {
  "steer": {"title": "Ядро steer", "repo": "splify2/steer", "stable": "1.5.9", "prerelease": "2.0.0",
            "versions": [v("steer", "2.0.0", "splify2/steer", [f"steer-core-2.0.0-1_{A}.apk"], "prerelease"),
                         v("steer", "1.5.9", "splify2/steer", [f"steer-1.5.9-1_{A}.apk", f"steer-extended-1.5.9-1_{A}.apk"]),
                         v("steer", "1.5.8-rc1", "splify2/steer", [f"steer-1.5.8-rc1-1_{A}.apk"]),
                         v("steer", "1.5.7", "splify2/steer", [f"steer-extended-1.5.7-1_{A}.apk"], name="1.5.7 Vega")]},
  "splify2": {"title": "splify2", "repo": "splify2/splify2", "stable": "26.9.2", "prerelease": None,
              "versions": [v("splify2", "26.9.2", "splify2/splify2", ["luci-app-splify2-26.9.2-1_noarch.apk"]),
                           v("splify2", "26.9.1", "splify2/splify2", ["luci-app-splify2-26.9.1-1_noarch.apk"])]}}}
json.dump(doc, open(out, "w"), ensure_ascii=False, indent=1)
PY
}
relclean() { rm -f "$T"/rel-*.json "$T"/var/releases.json.* "$T/curl.serve" "$T/curl.fail"; }

relclean; reset_logs
mkrel "$T/rel-raw.json" "$(relsum "$T/body-rel")"
out="$(rpcd steer_versions)"
check "версии ядра — из version.json: предварительная, стабильные, без «-rc»" '["2.0.0", "1.5.9", "1.5.7"]' \
      "$(printf '%s' "$out" | jget versions)"
check "к api.github.com при живом version.json не ходили" "0" "$(cat "$T/wget.log" 2>/dev/null | grep -c 'api.github.com')"
check "version.json спрошен первым — на raw.githubusercontent.com" \
      "https://raw.githubusercontent.com/splify2/releases/main/version.json" "$(head -1 "$T/curl.log")"
check "предварительная названа полем prerelease" "2.0.0" "$(printf '%s' "$out" | jget prerelease)"
check "название выпуска из version.json, если оно там есть" "1.5.7 Vega" "$(printf '%s' "$out" | jqget names 1.5.7)"
check "без названия версия называет себя сама" "1.5.9" "$(printf '%s' "$out" | jqget names 1.5.9)"
check "на основном пути примечания нет" "" "$(printf '%s' "$out" | jget note)"
rm -f "$T"/var/releases.json.*
out="$(rpcd splify2_versions)"
check "версии интерфейса — оттуда же" '["26.9.2", "26.9.1"]' "$(printf '%s' "$out" | jget versions)"
check "у интерфейса предварительной нет — и поля нет" "" "$(printf '%s' "$out" | jget prerelease)"

# Адреса по порядку: raw молчит — jsDelivr, молчат оба — сайт.
relclean; reset_logs
mkrel "$T/rel-pages.json" "$(relsum "$T/body-rel")"
out="$(rpcd steer_versions)"
check "raw и jsDelivr молчат — version.json с splify2.github.io" '["2.0.0", "1.5.9", "1.5.7"]' \
      "$(printf '%s' "$out" | jget versions)"
check "адреса version.json — по порядку" \
      "raw.githubusercontent.com cdn.jsdelivr.net splify2.github.io" \
      "$(grep 'version.json' "$T/curl.log" | sed 's|https://\([^/]*\)/.*|\1|' | tr '\n' ' ' | sed 's/ $//')"

# Откат: недоступен, битый, без нужного продукта — прежний путь (api.github.com, названия оттуда).
relclean; reset_logs
out="$(rpcd steer_versions)"
check "version.json недоступен — версии из api.github.com, как раньше" "26.9 Andromeda" \
      "$(printf '%s' "$out" | jqget names 26.9)"
relclean; reset_logs
printf '<html>не json</html>\n' > "$T/rel-raw.json"
printf '{"schema": 2, "products": {}}\n' > "$T/rel-cdn.json"
out="$(rpcd steer_versions)"
check "битый version.json и чужая схема — версии из api.github.com" '["26.9", "0.9.6", "0.9.4"]' \
      "$(printf '%s' "$out" | jget versions)"
relclean; reset_logs
printf '{"schema": 1, "products": {"xsteer": {"stable": "1.4.3", "prerelease": null, "versions": []}}}\n' > "$T/rel-raw.json"
out="$(rpcd steer_versions)"
check "в version.json нет ядра — версии из api.github.com" "26.9 Andromeda" \
      "$(printf '%s' "$out" | jqget names 26.9)"
relclean; reset_logs
out="$(GH_FAIL=1 CURL_BODY='1.2.9' rpcd steer_versions)"
check "молчат и version.json, и api.github.com — VERSION ветки dist, как раньше" '["1.2.9"]' \
      "$(printf '%s' "$out" | jget versions)"

# ---- установка: адреса из version.json, сверка sha256 -----------------------------------
EXT=steer-extended-1.5.9-1_aarch64_cortex-a53.apk
relclean; reset_logs
mkrel "$T/rel-raw.json" "$(relsum "$T/body-rel")"
printf 'splify2/releases/releases/download\t%s\nsplify2/steer/releases/download\t%s\n' "$T/body-rel" "$T/body-src" > "$T/curl.serve"
out="$(rpcd steer_install '{"version":"1.5.9","extended":true}')"
check "ядро качается с первого адреса version.json — выпуска в splify2/releases" \
      "https://github.com/splify2/releases/releases/download/steer-v1.5.9/$EXT" \
      "$(grep "$EXT" "$T/curl.log" | head -1)"
check "сумма сошлась — второй адрес не спрашивали, установка удалась" "1;true" \
      "$(grep -c "$EXT" "$T/curl.log");$(printf '%s' "$out" | jget ok)"

relclean; reset_logs
mkrel "$T/rel-raw.json" "$(relsum "$T/body-src")"
printf 'splify2/releases/releases/download\t%s\nsplify2/steer/releases/download\t%s\n' "$T/body-rel" "$T/body-src" > "$T/curl.serve"
out="$(rpcd steer_install '{"version":"1.5.9","extended":true}')"
check "сумма первого не сошлась — взят второй адрес, установка удалась" \
      "https://github.com/splify2/steer/releases/download/v1.5.9/$EXT;true" \
      "$(grep "$EXT" "$T/curl.log" | sed -n 2p);$(printf '%s' "$out" | jget ok)"
check "о несовпадении сказано в via" "yes" \
      "$(printf '%s' "$out" | jget via | grep -q 'контрольная сумма' && echo yes || echo no)"

relclean; reset_logs
mkrel "$T/rel-raw.json" "$(printf 'другое\n' | sha256sum | cut -d' ' -f1)"
printf 'splify2/releases/releases/download\t%s\nsplify2/steer/releases/download\t%s\n' "$T/body-rel" "$T/body-src" > "$T/curl.serve"
printf 'gitlab.com\napi.github.com\ncodeload.github.com\n' > "$T/curl.fail"
out="$(rpcd steer_install '{"version":"1.5.9","extended":true}')"
check "сумма не сошлась нигде — не ставится" "false;0" \
      "$(printf '%s' "$out" | jget ok);$(grep -c '^add' "$T/apk.log")"

relclean; reset_logs
mkrel "$T/rel-raw.json" "$(relsum "$T/body-rel")"
printf 'splify2/releases/releases/download\t%s\n' "$T/body-rel" > "$T/curl.serve"
out="$(rpcd splify2_install '{"version":"26.9.2"}')"
check "интерфейс качается с первого адреса version.json" \
      "https://github.com/splify2/releases/releases/download/splify2-v26.9.2/luci-app-splify2-26.9.2-1_noarch.apk" \
      "$(grep 'luci-app-splify2' "$T/curl.log" | head -1)"

# Версии нет в version.json (ушла из перечня) — прежний адрес выпуска проекта первым.
relclean; reset_logs
mkrel "$T/rel-raw.json" "$(relsum "$T/body-rel")"
out="$(rpcd splify2_install '{"version":"26.8"}')"
check "версии нет в version.json — прямой адрес выпуска, как раньше" \
      "https://github.com/splify2/splify2/releases/download/v26.8/luci-app-splify2-26.8-1_noarch.apk" \
      "$(grep 'luci-app-splify2' "$T/curl.log" | head -1)"
relclean; reset_logs

# ---- ядро 2.0: steer-core и модули одной транзакцией, переход с 1.5.9 ------------------
# В 2.0 пакета steer нет: ядро — steer-core, протоколы — модули steer-<модуль>, каждый зависит от
# steer-core точной версии. Значит, обновление ставит ядро и ВСЕ стоящие модули одной версией и
# одной `apk add`, добавляя то, что нужно спеке; переход с steer-extended 1.5.9 не теряет вшитое в
# него (vless, xsteer, obfs, tgws), а прежний пакет снимается в той же транзакции (`!имя`).
mkrel2() {  # ФАЙЛ SHA256
    python3 - "$1" "$2" <<'PY2'
import json, sys
out, s = sys.argv[1], sys.argv[2]
A = "aarch64_cortex-a53"
mods = ["core", "vless", "hysteria2", "proxy", "xsteer", "obfs", "tgws"]
def v(ver):
    tag = f"steer-v{ver}"
    return {"version": ver, "channel": "stable", "tag": tag,
            "assets": [{"name": f"steer-{m}-{ver}-1_{A}.apk", "size": 8, "sha256": s,
                        "urls": [f"https://github.com/splify2/releases/releases/download/{tag}/steer-{m}-{ver}-1_{A}.apk"]}
                       for m in mods]}
doc = {"schema": 1, "products": {"steer": {"stable": "2.0.1", "prerelease": None,
       "versions": [v("2.0.1"), v("2.0.0")]}}}
json.dump(doc, open(out, "w"))
PY2
}
apk_adds() { grep '^add' "$T/apk.log" | sed 's|/tmp/steer-\([a-z0-9]*\)-[0-9.]*-1_aarch64_cortex-a53.apk|\1|g; s/^add add //; s/^--allow-untrusted --force-overwrite //'; }
spec_keep="$T/etc/spec.json.keep2"; cp "$T/etc/spec.json" "$spec_keep" 2>/dev/null || rm -f "$spec_keep"
rm -f "$T/etc/spec.json"
relclean; reset_logs
mkrel2 "$T/rel-raw.json" "$(relsum "$T/body-rel")"
printf 'splify2/releases/releases/download\t%s\n' "$T/body-rel" > "$T/curl.serve"
out="$(APK_LIST="steer-extended-1.5.9-r1 aarch64_cortex-a53 {steer-extended}" rpcd steer_install '{"version":"2.0.1"}')"
check "1.5.9 extended → 2.0: ядро и вшитые модули одной apk add, прежний снят в ней же" \
      "core vless xsteer obfs tgws !steer-extended" "$(apk_adds)"
check "  запрет !steer-extended убран из world после успеха" "del steer-extended" "$(grep '^del' "$T/apk.log")"
check "  ответ: ok, ядро, состав модулей" 'true;steer-core 2.0.1;["vless", "xsteer", "obfs", "tgws"]' \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget installed);$(printf '%s' "$out" | jget modules)"

reset_logs
printf '{"version":2,"outputs":{"direct":{"kind":"direct"},"t":{"kind":"tunnel","protocol":"trojan","subscription":"s"},"o":{"kind":"interface","device":"wg0","obfs":{"server":"a:1","listen":"b:2"}}}}\n' > "$T/etc/spec.json"
out="$(APK_LIST="steer-1.5.9-r1 aarch64_cortex-a53 {steer}" rpcd steer_install '{"version":"2.0.1","modules":"hysteria2"}')"
check "1.5.9 basic → 2.0: просимый модуль и нужные спеке (proxy, obfs)" "steer|core hysteria2 proxy obfs" \
      "$(apk_adds | tr '\n' '|' | sed 's/|$//')"
check "  имя steer снято с закрепления до и убрано из world после" "del steer" "$(grep '^del' "$T/apk.log")"
check "  после установки служба перезапущена (спека есть)" "true" "$(printf '%s' "$out" | jget restarted)"

reset_logs
mkdir -p "$T/mods"; for m in vless proxy; do printf '#!/bin/sh\n' > "$T/mods/steer-$m"; chmod +x "$T/mods/steer-$m"; done
rm -f "$T/etc/spec.json"
out="$(APK_LIST="$CORE_LIST" rpcd steer_install '{"version":"2.0.1"}')"
check "2.0.0 → 2.0.1: ядро и все стоящие модули одной версией, без снятий" "core vless proxy;" \
      "$(apk_adds);$(grep -c '^del' "$T/apk.log" | sed 's/^0$//')"
check "  без спеки служба не перезапускается" "false" "$(printf '%s' "$out" | jget restarted)"

reset_logs
printf 'steer-proxy-2.0.1\n' > "$T/curl.fail"
out="$(APK_LIST="$CORE_LIST" rpcd steer_install '{"version":"2.0.1"}')"
check "модуль не скачался — не ставится ничего" "false;0" \
      "$(printf '%s' "$out" | jget ok);$(grep -c '^add' "$T/apk.log")"
check "  отказ называет файл" "yes" \
      "$(printf '%s' "$out" | jget error | grep -q 'steer-proxy-2.0.1-1_aarch64_cortex-a53.apk' && echo yes || echo no)"
check "  скачанное до отказа убрано из /tmp" "0" "$(ls /tmp/steer-core-2.0.1-1_aarch64_cortex-a53.apk 2>/dev/null | grep -c .)"
rm -f "$T/curl.fail"
out="$(rpcd steer_install '{"version":"2.0.1","modules":"vless wireguard"}')"
check "неизвестный модуль отвергается до скачивания" "неизвестный модуль: wireguard" "$(printf '%s' "$out" | jget error)"

# opkg: транзакций и запретов нет — на конфликте прежний пакет снимается и установка повторяется,
# но файлы те же и все сразу.
rm -rf "$T/mods"; rm -f "$T/opkg.log"; : > "$T/opkg.lists"
cp "$T/bin/opkg" "$T/bin/opkg.orig"
cat > "$T/bin/opkg" <<'EOF2'
#!/bin/sh
echo "$*" >> "$SANDBOX/opkg.log"
case "$1" in
    install)
        if grep -q '^remove steer-extended' "$SANDBOX/opkg.log"; then exit 0; fi
        echo " * check_conflicts_for: The following packages conflict with steer-core:"
        echo " * check_conflicts_for:   steer-extended *"
        exit 1 ;;
    list-installed) echo "steer-extended - 1.5.9-1" ;;
esac
exit 0
EOF2
chmod +x "$T/bin/opkg"
out="$(PM_FIXTURE=opkg rpcd steer_install '{"version":"2.0.1"}')"
check "opkg 1.5.9 extended → 2.0: install всех файлов, remove прежнего, install снова" \
      "install|remove|install" "$(awk '$1 != "list-installed" {print $1}' "$T/opkg.log" | tr '\n' '|' | sed 's/|$//')"
check "  в установке — ядро и вшитые модули (ipk)" "5" \
      "$(grep '^install' "$T/opkg.log" | head -1 | tr ' ' '\n' | grep -c '2.0.1-1_aarch64_cortex-a53.ipk')"
check "  установка удалась" "true" "$(printf '%s' "$out" | jget ok)"
mv "$T/bin/opkg.orig" "$T/bin/opkg"; rm -f "$T/opkg.lists" "$T/opkg.log"
rm -rf "$T/mods"; relclean; reset_logs
[ -f "$spec_keep" ] && mv "$spec_keep" "$T/etc/spec.json"

# ---- модули ядра 2.0: перечень, установка и снятие одного --------------------------------
# Карточка модулей в «О ПО»: что стоит и какой версии, что нужно спеке. Модуль ставится той же
# версией, что steer-core; снять нужный спеке нельзя — отказ называет выходы.
spec_keep="$T/etc/spec.json.keep3"; cp "$T/etc/spec.json" "$spec_keep" 2>/dev/null || rm -f "$spec_keep"
mkdir -p "$T/mods"; for m in vless proxy; do printf '#!/bin/sh\n' > "$T/mods/steer-$m"; chmod +x "$T/mods/steer-$m"; done
printf '{"version":2,"outputs":{"nl":{"kind":"tunnel","protocol":"vless","subscription":"s"},"t":{"kind":"tunnel","protocol":"trojan","subscription":"s"},"t2":{"kind":"tunnel","protocol":"vmess","subscription":"s"}}}\n' > "$T/etc/spec.json"
out="$(APK_LIST="$CORE_LIST" rpcd steer_modules)"
mod_field() {  # МОДУЛЬ ПОЛЕ < JSON
    python3 -c 'import json,sys
d=json.load(sys.stdin)
for m in d.get("modules", []):
    if m.get("name")==sys.argv[1]:
        v=m.get(sys.argv[2]); print("" if v is None else json.dumps(v, ensure_ascii=False) if isinstance(v,bool) else v)' "$1" "$2"
}
check "steer_modules: версия ядра" "2.0.0" "$(printf '%s' "$out" | jget core)"
check "steer_modules: шесть модулей по порядку" "vless hysteria2 proxy xsteer obfs tgws" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; print(" ".join(m["name"] for m in json.load(sys.stdin)["modules"]))')"
check "  proxy стоит, версия пакета, нужен выходам t и t2" "true;2.0.0;true;t, t2" \
      "$(printf '%s' "$out" | mod_field proxy installed);$(printf '%s' "$out" | mod_field proxy version);$(printf '%s' "$out" | mod_field proxy needed);$(printf '%s' "$out" | mod_field proxy outputs)"
check "  hysteria2 не стоит и не нужен" "false;false" \
      "$(printf '%s' "$out" | mod_field hysteria2 installed);$(printf '%s' "$out" | mod_field hysteria2 needed)"

relclean; reset_logs
mkrel2 "$T/rel-raw.json" "$(relsum "$T/body-rel")"
printf 'splify2/releases/releases/download\t%s\n' "$T/body-rel" > "$T/curl.serve"
out="$(APK_LIST="$CORE_LIST" rpcd steer_module_add '{"module":"hysteria2"}')"
check "модуль ставится версией стоящего ядра, один файл" "hysteria2" "$(apk_adds)"
check "  ответ: ok и что встало" "true;steer-hysteria2 2.0.0" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget installed)"
out="$(APK_LIST="steer-extended-1.5.9-r1 x {steer-extended}" rpcd steer_module_add '{"module":"hysteria2"}')"
check "без steer-core модуль ставить некуда" "нет ядра steer-core" "$(printf '%s' "$out" | jget error)"

reset_logs
out="$(APK_LIST="$CORE_LIST" rpcd steer_module_del '{"module":"proxy"}')"
check "снять модуль, нужный спеке, нельзя — названы выходы" "false;модуль нужен выходам: t, t2" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget error)"
check "  и пакет не трогали" "0" "$(grep -c '^del' "$T/apk.log")"
out="$(APK_LIST="$CORE_LIST
steer-xsteer-2.0.0-r1 x {steer-xsteer}" rpcd steer_module_del '{"module":"hysteria2"}')"
check "ненужный спеке модуль снимается" "del steer-hysteria2" "$(grep '^del' "$T/apk.log")"
reset_logs
out="$(APK_LIST="$CORE_LIST
steer-extended-2.0.0-r1 x {steer-extended}" rpcd steer_module_del '{"module":"hysteria2"}')"
check "мета-пакет steer-extended снимается вместе с модулем" "del steer-extended|del steer-hysteria2" \
      "$(grep '^del' "$T/apk.log" | tr '\n' '|' | sed 's/|$//')"
out="$(rpcd steer_module_add '{"module":"../x"}')"
check "незнакомый модуль отвергается" "false" "$(printf '%s' "$out" | jget ok)"
mkdir -p "$T/box"; printf '# steer-box-connector\n' > "$T/box/sing-box"
reset_logs
out="$(SINGBOX_INITD_FIXTURE="$T/box/sing-box" APK_LIST="$CORE_LIST" rpcd steer_module_add '{"module":"hysteria2"}')"
check "коннектор: модули не трогаются" "false;0" "$(printf '%s' "$out" | jget ok);$(grep -c . "$T/apk.log")"
rm -rf "$T/box" "$T/mods"; relclean; reset_logs
rm -f "$T/etc/spec.json"; [ -f "$spec_keep" ] && mv "$spec_keep" "$T/etc/spec.json"
for m in steer_modules steer_module_add steer_module_del; do
    check "метод $m в перечне и в ACL" "yes;yes" \
          "$(rpcd_list | grep -q "\"$m\"" && echo yes || echo no);$(grep -q "\"$m\"" "$ROOT/luci/root/usr/share/rpcd/acl.d/luci-app-splify2.json" && echo yes || echo no)"
done

# ---- R-037: свои списки доменов и адресов -------------------------------------
# Вопрос задан снаружи (splicicd#8): маршрутизировать можно только то, что опубликовал
# издатель. Движок сопоставляет исключительно по файлам, а каталог рисуется из манифеста,
# поэтому свой .lst в /etc/steer/lists был виден local_lists — и не предлагался ни одному
# правилу.
#
# Три способа ввода по решению владельца: текстом, файлом (тем же методом по частям) и
# по ссылке. Чужой текст на входе движка обязан быть проверен здесь: спека применится, а
# канал молча останется пустым, если формат не тот.
out="$(rpcd list_put '{"name":"мой","kind":"domains","text":"example.org"}')"
check "имя не из латиницы, цифр и дефиса отвергается (R-037)" \
      "false" "$(printf '%s' "$out" | jget ok)"

out="$(rpcd list_put '{"name":"../../etc/passwd","kind":"domains","text":"example.org"}')"
check "выйти из каталога списков именем нельзя (R-037)" \
      "false" "$(printf '%s' "$out" | jget ok)"

out="$(rpcd list_put '{"name":"mine","kind":"domains","text":"Example.ORG\nsub.example.net\n# коммент\n\nне домен!\n"}')"
check "доменный список принят (R-037)" "true" "$(printf '%s' "$out" | jget ok)"
check "домены приведены к нижнему регистру, мусор отброшен (R-037)" \
      "example.org sub.example.net" "$(tr '\n' ' ' < "$T/lists/custom/domains/mine.lst" | sed 's/ $//')"
check "сколько строк отброшено — сказано числом, а не молчанием (R-037)" \
      "1" "$(printf '%s' "$out" | jget dropped)"

out="$(rpcd list_put '{"name":"nets","kind":"prefixes","text":"10.0.0.0/8\n192.0.2.1\nexample.org\n"}')"
check "адресный список принят (R-037)" "true" "$(printf '%s' "$out" | jget ok)"
check "одиночный адрес дополняется до /32, домен отброшен (R-037)" \
      "10.0.0.0/8 192.0.2.1/32" "$(tr '\n' ' ' < "$T/lists/custom/nets.lst" | sed 's/ $//')"

# Дописывание по частям — то, чем загружается файл: ubus не резиновый, и большой список
# приезжает несколькими вызовами.
rpcd list_put '{"name":"mine","kind":"domains","text":"second.example\n","append":true}' >/dev/null
check "append дописывает, а не затирает (R-037)" \
      "example.org sub.example.net second.example" \
      "$(tr '\n' ' ' < "$T/lists/custom/domains/mine.lst" | sed 's/ $//')"

out="$(rpcd list_put '{"name":"mine","kind":"domains","text":"only.example\n"}')"
check "без append список заменяется целиком (R-037)" \
      "only.example" "$(tr '\n' ' ' < "$T/lists/custom/domains/mine.lst" | sed 's/ $//')"

reset_logs
out="$(rpcd list_put '{"name":"remote","kind":"domains","url":"https://example.invalid/my.lst"}')"
check "по ссылке качает роутер (R-037)" \
      "yes" "$(grep -q 'example.invalid/my.lst' "$T/curl.log" 2>/dev/null && echo yes || echo no)"
check "скачанное по ссылке проходит ту же проверку формата (R-037)" \
      "remote.example" "$(tr '\n' ' ' < "$T/lists/custom/domains/remote.lst" | sed 's/ $//')"

out="$(rpcd list_put '{"name":"empty","kind":"prefixes","text":"вообще не список\n"}')"
check "список, из которого не осталось ни строки, не создаётся (R-037)" \
      "false" "$(printf '%s' "$out" | jget ok)"
check "и файла после этого нет (R-037)" \
      "нет" "$([ -f "$T/lists/custom/empty.lst" ] && echo есть || echo нет)"

# Удалять свой список тоже надо уметь: list_remove искал файл только через манифест,
# поэтому своего в нём нет и удалить его было нечем.
out="$(rpcd list_remove '{"name":"nets"}')"
check "свой список удаляется по имени (R-037)" "true" "$(printf '%s' "$out" | jget ok)"
check "доменный и адресный с одним именем не схлопываются (R-037)" \
      "разные" "$([ "$(custom_domains_path mine)" != "$(custom_prefixes_path mine)" ] && echo разные || echo одно)"
check "файл действительно убран (R-037)" \
      "нет" "$([ -f "$T/lists/custom/nets.lst" ] && echo есть || echo нет)"

# Тот же запрет, что и для списков издателя: канал, указывающий на файл, после удаления
# не скомпилируется.
rpcd list_put '{"name":"used","kind":"prefixes","text":"10.0.0.0/8\n"}' >/dev/null
python3 - "$T/etc/spec.json" "$T/lists/custom/used.lst" <<'PY'
import json, sys
d = json.load(open(sys.argv[1]))
d['channels'][0]['match']['prefixes_files'].append(sys.argv[2])
json.dump(d, open(sys.argv[1], 'w'))
PY
out="$(rpcd list_remove '{"name":"used"}')"
check "занятый каналом свой список не удаляется (R-037)" \
      "false" "$(printf '%s' "$out" | jget ok)"

# ---- ОТКУДА взялся свой список, и правка по этому же разделению ----------------
#
# Изменить свой список было нечем: рядом с ним стояла одна кнопка — удалить. А правят три
# способа ввода по-разному, и это не оформление: у файла меняют ФАЙЛ, у ссылки — ССЫЛКУ, у
# набранного руками — сами ЗАПИСИ. Не зная происхождения, интерфейс вынужден предлагать все
# три всем — то есть предлагать заменить файл на двадцать тысяч строк тем, что человек
# наберёт в текстовом поле.
reset_logs
rpcd list_put '{"name":"fromfile","kind":"prefixes","text":"10.9.0.0/16\n","source":"file","filename":"blocked.txt"}' >/dev/null
out="$(rpcd list_custom)"
check "происхождение «файл» запомнено вместе с именем файла" \
      "file blocked.txt" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys
for l in json.load(sys.stdin)["lists"]:
    if l["name"] == "fromfile": print(l["source"], l["filename"])')"

# Длинное имя файла обрезается до 64 байт — и не посреди буквы (I-329). `cut -c` считает байты,
# и кириллическое имя с нечётным числом латинских букв впереди резалось на половине последней
# буквы: на экран уезжал обломок, который браузер показывает знаком «�».
rpcd list_put "{\"name\":\"longname\",\"kind\":\"prefixes\",\"text\":\"10.9.0.0/16\\n\",\"source\":\"file\",\"filename\":\"a$(printf 'я%.0s' $(seq 40))\"}" >/dev/null
check "длинное имя файла обрезано по букве, а не по байту" "ok 63" \
      "$(rpcd list_custom | python3 -c 'import json,sys
b = sys.stdin.buffer.read()
try: d = json.loads(b.decode("utf-8"))
except Exception as e: print("битый UTF-8:", e); sys.exit()
for l in d["lists"]:
    if l["name"] == "longname":
        f = l["filename"]; print("ok" if f == "a" + "я" * 31 else f, len(f.encode()))')"
rpcd list_remove '{"name":"longname","kind":"prefixes"}' >/dev/null

rpcd list_put '{"name":"fromurl","kind":"domains","url":"https://example.invalid/my.lst","source":"url"}' >/dev/null
out="$(rpcd list_custom)"
check "происхождение «ссылка» запомнено вместе со ссылкой" \
      "url https://example.invalid/my.lst" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys
for l in json.load(sys.stdin)["lists"]:
    if l["name"] == "fromurl": print(l["source"], l["url"])')"

# Поля `source` нет вовсе — так шлёт интерфейс постарше. Считаем по тому, что пришло: ссылка
# значит ссылку, текст значит «руками». Это ровно прежнее поведение, только теперь записанное.
rpcd list_put '{"name":"oldway","kind":"prefixes","text":"10.8.0.0/16\n"}' >/dev/null
out="$(rpcd list_custom)"
check "без поля source происхождение выводится из того, что пришло" \
      "text" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys
for l in json.load(sys.stdin)["lists"]:
    if l["name"] == "oldway": print(l["source"])')"

# Запись о происхождении НЕ должна выглядеть ещё одним списком: и local_lists, и сборка архива
# обходят каталог по `*.lst`, а записи вида «source=file» санитайзер отбросил бы все до одной.
out="$(rpcd local_lists)"
check "запись о происхождении не видна как список" \
      "нет" \
      "$(printf '%s' "$out" | grep -q '\.src' && echo есть || echo нет)"

# Порции запомнились по ПЕРВОЙ, а не по последней: порции — это один и тот же файл, и запись
# при каждой означала бы, что имя файла берётся от куска, который его не несёт.
rpcd list_put '{"name":"chunked","kind":"prefixes","text":"10.1.0.0/16\n","source":"file","filename":"big.txt"}' >/dev/null
rpcd list_put '{"name":"chunked","kind":"prefixes","text":"10.2.0.0/16\n","append":true,"source":"file"}' >/dev/null
out="$(rpcd list_custom)"
check "имя файла не теряется на следующих порциях" \
      "file big.txt" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys
for l in json.load(sys.stdin)["lists"]:
    if l["name"] == "chunked": print(l["source"], l["filename"])')"

# Записи обратно: редактор набранного руками обязан показать то, что лежит на роутере.
# Пустое поле вместо записей — это не «начни заново», а предложение молча потерять набранное.
out="$(rpcd list_get '{"name":"oldway","kind":"prefixes"}')"
check "записи своего списка читаются обратно" "10.8.0.0/16" \
      "$(printf '%s' "$out" | jget text | tr -d '\n')"
check "и признак конца выставлен" "true" "$(printf '%s' "$out" | jget eof)"

# Порции нарезаются по БАЙТАМ и приезжают байт в байт. Потерянный на границе перевод строки
# склеивает две записи в одну («10.0.0.0/810.1.0.0/8»), и обе исчезают из канала молча.
printf '10.0.0.0/8\n10.1.0.0/8\n10.2.0.0/8\n' > "$T/lists/custom/bytes.lst"
first="$(rpcd list_get '{"name":"bytes","kind":"prefixes","offset":0}')"
out="$( { printf '%s\n' '{"name":"bytes","kind":"prefixes","offset":0}'; } | env \
    SANDBOX="$T" PATH="$T/bin:$PATH" \
    JSHN_SH="$ROOT/tests/stub/jshn.sh" FETCH_SH="$ROOT/files/usr/lib/splify2/fetch.sh" \
    FAST_SH="$ROOT/files/usr/lib/splify2/fast.sh" \
    STEER="$T/bin/steer" SPEC="$T/etc/spec.json" LISTS="$T/lists" \
    SUB="$T/etc/sub.txt" MANIFEST="$T/etc/manifest.json" RPCD_LIB="$RPCD_DIR" \
    LIST_CHUNK=11 sh "$SCRIPT" call list_get 2>/dev/null)"
check "первый кусок ровно в предел и с переводом строки на конце" "10.0.0.0/8" \
      "$(printf '%s' "$out" | jget text | tr -d '\n')"
check "и конец файла на первом куске не объявлен" "false" "$(printf '%s' "$out" | jget eof)"
check "следующее смещение — по СЧИТАННЫМ байтам" "11" "$(printf '%s' "$out" | jget next)"
check "весь файл одним куском отдаётся целиком" "3" \
      "$(printf '%s' "$first" | jget text | grep -c .)"

# Правке подлежит только СВОЙ список: список издателя приезжает по расписанию, и всякая
# правка была бы стёрта следующим обновлением молча. Читать его этим методом нельзя вовсе —
# он смотрит только в custom/.
printf '1.2.3.0/24\n' > "$T/lists/news.lst"
out="$(rpcd list_get '{"name":"news","kind":"prefixes"}')"
check "список издателя этим методом не читается" "false" "$(printf '%s' "$out" | jget ok)"

out="$(rpcd list_get '{"name":"../../etc/passwd","kind":"prefixes"}')"
check "выйти из каталога списков именем нельзя и здесь" "false" "$(printf '%s' "$out" | jget ok)"

# Удаление списка снимает и запись о происхождении: оставленная, она переехала бы на
# СЛЕДУЮЩИЙ список того же имени и рассказала бы про него чужую правду.
rpcd list_remove '{"name":"fromfile","kind":"prefixes"}' >/dev/null
check "запись о происхождении удалена вместе со списком" "нет" \
      "$([ -f "$T/lists/custom/fromfile.lst.src" ] && echo есть || echo нет)"

# Метод, которого нет в ACL, вызвать из LuCI нельзя — метод есть, а кнопка не работает.
acl="$ROOT/luci/root/usr/share/rpcd/acl.d/luci-app-splify2.json"
check "правка списков разрешена в ACL на чтение" "yes" \
      "$(python3 -c 'import json,sys
r = json.load(open(sys.argv[1]))["luci-app-splify2"]["read"]["ubus"]["splify2"]
print("yes" if "list_custom" in r and "list_get" in r else "no")' "$acl")"

# Метод, которого нет в списке методов, ubus не покажет вовсе.
out="$(rpcd_list)"
check "методы правки списков объявлены в списке" "yes" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys
d = json.load(sys.stdin)
print("yes" if "list_custom" in d and "list_get" in d else "no")')"
check "оба метода объявлены в списке (R-017)" \
      "yes" "$(printf '%s' "$out" | python3 -c 'import json,sys
d = json.load(sys.stdin)
print("yes" if "engine_stop" in d and "engine_start" in d else "no")')"

# Метод, которого нет в ACL, вызвать из LuCI нельзя — метод есть, а кнопка не работает.
acl="$ROOT/luci/root/usr/share/rpcd/acl.d/luci-app-splify2.json"
check "оба метода разрешены в ACL на запись (R-017)" \
      "yes" "$(python3 -c 'import json,sys
w = json.load(open(sys.argv[1]))["luci-app-splify2"]["write"]["ubus"]["splify2"]
print("yes" if "engine_stop" in w and "engine_start" in w else "no")' "$acl")"

# ---- путь из манифеста издателя не выходит за каталог списков -----------------
#
# Поле `file` приходит из интернета (манифест издателя, адрес которого вдобавок
# переопределяется через uci), а local_path снимала только ведущие слэши. `..` проходил
# насквозь: `file` вида `../../../etc/crontabs/root` давал запись файла ОТ ROOT куда
# угодно — крон, rc.local, сам этот скрипт, — содержимым с того же издателя. Тем же путём
# list_remove удалял любой файл.
#
# Для СВОИХ списков эта мысль додумана давно (list_put проверяет имя), для чужих не была.
cat > "$T/etc/manifest.json" <<'EOF'
{
  "base_url": "https://example.invalid/lists",
  "categories":   [ { "id": "evil", "file": "../../../trav-probe/cron.txt" },
                    { "id": "hack", "file": "a/../../b.lst" },
                    { "id": "shell", "file": "x;id>/tmp/p.lst" },
                    { "id": "news", "file": "news.lst" } ],
  "domain_lists": [ { "id": "news", "file": "domains/news.lst" } ]
}
EOF
rm -rf /tmp/trav-probe
for id in evil hack shell; do
    out="$(rpcd list_fetch "{\"id\":\"$id\",\"kind\":\"prefixes\"}")"
    check "list_fetch отвергает путь «$id» из манифеста" \
          "no" "$(printf '%s' "$out" | grep -q '"ok":true' && echo yes || echo no)"
done
check "ни один файл вне каталога списков не создан" "no" \
      "$([ -e /tmp/trav-probe ] && echo yes || echo no)"

# То же для удаления: раньше проверка «занят каналом» сравнивала уже подменённый путь.
out="$(rpcd list_remove '{"id":"evil","kind":"prefixes"}')"
check "list_remove отвергает путь с .. из манифеста" \
      "no" "$(printf '%s' "$out" | grep -q '"ok":true' && echo yes || echo no)"

# Законные пути обязаны продолжать работать — иначе заслон стоил бы больше, чем спас.
check "обычный путь манифеста по-прежнему принимается" "yes" \
      "$(rpcd list_fetch '{"id":"news","kind":"domains"}' | grep -q '"path"' && echo yes || echo no)"

# ---- предел размера не обходится дописыванием по частям ------------------------
#
# LIST_MAX_BYTES проверялся для каждого вызова отдельно, а интерфейс грузит файл кусками
# по тысяче строк с append. Число кусков не ограничено ничем, то есть предел, заведённый
# ради overlay в 6,9 МБ, обходился самым обычным способом им пользоваться.
big="$(awk 'BEGIN { while (i++ < 30000) print "10.0." int(i/256) "." (i%256) "/32" }')"
rpcd list_put "$(printf '{"name":"grow","kind":"prefixes","text":"%s"}' "$(printf '%s' "$big" | tr '\n' '@' | sed 's/@/\\n/g')")" >/dev/null
first="$(wc -c < "$T/lists/custom/grow.lst" 2>/dev/null || echo 0)"
i=0
while [ "$i" -lt 8 ]; do
    rpcd list_put "$(printf '{"name":"grow","kind":"prefixes","append":true,"text":"%s"}' "$(printf '%s' "$big" | tr '\n' '@' | sed 's/@/\\n/g')")" >/dev/null
    i=$((i + 1))
done
grown="$(wc -c < "$T/lists/custom/grow.lst" 2>/dev/null || echo 0)"
check "дописывание не переваливает за предел размера" "yes" \
      "$([ "$grown" -le 1048576 ] && echo yes || echo no)"
check "и первая порция при этом легла" "yes" \
      "$([ "$first" -gt 0 ] && echo yes || echo no)"

# ---- свой список: диапазоны октетов и длина префикса ---------------------------
# Форма проверялась, значения — нет: 10.0.0.256 и 192.168.0.0/40 проходили как верные.
# Движок их тоже пропускает, а отвергал уже nft — целиком весь ruleset одной транзакцией,
# сообщением про синтаксис nft, по которому не понять, какая строка виновата.
rpcd list_put '{"name":"ranges","kind":"prefixes","text":"10.0.0.1\n10.0.0.256\n300.1.1.1\n192.168.0.0/24\n192.168.0.0/40"}' >/dev/null
check "негодные октеты и длина префикса отброшены" "10.0.0.1/32
192.168.0.0/24" "$(cat "$T/lists/custom/ranges.lst" 2>/dev/null)"

# ---- kind объявлен в сигнатуре list_fetch --------------------------------------
# rpcd отсекает поля, которых нет в сигнатуре. Реализация kind читает, а объявлен он не
# был: доменный запрос уходил бы в фолбэк, где адресные категории проверяются первыми, и
# для id, живущего в обоих пространствах (news, hodca), скачивался бы адресный файл под
# именем доменного. Это I-011, вернувшийся с другой стороны.
check "list_fetch объявляет kind" "yes" \
      "$(rpcd_list | grep -A4 '"list_fetch"' | grep -q '"kind"' && echo yes || echo no)"

# ---- набор выходов vless изменился — экземпляры пересобираются -------------------
# Сигнал уходит экземпляру `vless_<выход>`, а у только что созданного или
# переименованного выхода экземпляра ещё нет, и сигналить некому. Для обфускации это
# давно различается (params против instances), для vless — не различалось, и новый
# туннель не поднимался до перезагрузки на конфигурации с доменными каналами.
#
# Признак читает apply, а пишет spec_set — и это ДВА РАЗНЫХ вызова, между которыми
# сохранений бывает много: автосохранение зовёт spec_set после каждой правки, а применение
# нажимают один раз. Пока признак перезаписывался, «instances» терялось первой же
# следующей правкой того же выхода (выбор узла даёт params), и apply сигналил экземпляру,
# которого нет: туннель не поднимался до перезапуска движка. Поэтому проверки ниже — про
# поведение стенда, а не про текст скрипта: два сохранения подряд, потом apply.
spec_req() {  # СПЕКА_JSON → запрос spec_set
    python3 -c 'import json,sys; print(json.dumps({"spec": sys.argv[1]}))' "$1"
}
vless_spec() {  # [НОМЕР_УЗЛА] → спека с одним выходом kind=vless
    python3 -c 'import json,sys
o = {"kind": "vless", "sub_file": sys.argv[1]}
if len(sys.argv) > 2 and sys.argv[2]:
    o["node"] = int(sys.argv[2])
print(json.dumps({"schema": 1, "outputs": {"vpn": o}, "channels": []}))' "$T/etc/sub.txt" "${1:-}"
}

printf 'vless://key@host:443#node\n' > "$T/etc/sub.txt"
printf '{"schema":1,"outputs":{},"channels":[]}\n' > "$T/etc/spec.json"
out="$(rpcd spec_set "$(spec_req "$(vless_spec)")")"
check "выход vless сохранён" "true" "$(printf '%s' "$out" | jget ok)"
# Помощников (клиент vless, обфускатор) с версии 1.8 держит демон движка: `steer apply` через
# него сверяет прежнюю спеку с новой и перезапускает ровно тех, у кого что-то изменилось.
# Объект rpcd больше не шлёт сигналы экземплярам procd `vless_*`/`obfs_*` (их нет) и не
# пересобирает набор экземпляров — ни при новом выходе, ни при смене узла.
: > "$T/initd.log"; : > "$T/ubus.log"
out="$(rpcd apply)"
check "apply не сигналит экземплярам procd" "0" "$(grep -c 'signal' "$T/ubus.log")"
check "и не пересобирает набор экземпляров" "0" "$(grep -c '^start$' "$T/initd.log")"
out="$(rpcd spec_set "$(spec_req "$(vless_spec 2)")")"
: > "$T/initd.log"; : > "$T/ubus.log"
out="$(rpcd apply)"
check "смена узла тоже без сигналов: узел перечитывает демон" "0;0" \
      "$(grep -c 'signal' "$T/ubus.log");$(grep -c '^start$' "$T/initd.log")"
check "признаков перезапуска на диске не остаётся" "no" \
      "$([ -e "$T/var/vless-dirty" ] || [ -e "$T/var/obfs-dirty" ] && echo yes || echo no)"

# ВРЕМЕННЫЕ ФАЙЛЫ В /tmp — ТОЛЬКО mktemp. Имя вида /tmp/splify2-что-то.$$ предсказуемо: PID виден в
# /proc, и непривилегированный процесс роутера успевает создать файл или каталог с этим именем до
# нас — тогда разложенные разделы архива лежат в чужом каталоге и подменяются между проверкой и
# копированием (аргументы nfqws от root), а `: > файл` у специальной встроенной роняет весь метод
# без JSON, когда /tmp полон. Барьер текстом: таких имён в объекте не остаётся.
check "rpcd: временных имён вида /tmp/…\$\$ не осталось" "" \
      "$(grep -n '/tmp/[A-Za-z0-9_.${}-]*\.\$\$' $RPCD_ALL | sed 's/^/ /' | tr '\n' ';')"

# ИМЯ ВЫХОДА — ТОЛЬКО ИМЯ. vless_nodes и vless_probe отдают аргумент движку как есть, а движок
# трактует аргумент с ведущим `/` как путь к файлу подписки: `{"output":"/etc/passwd"}` читал
# любой файл роутера, и его строки уезжали в ответ примерами пропусков. Рубеж «путь — только
# свой» стоял лишь на поле `sub`. outbound_probe подставлял имя в регулярное выражение sed без
# проверки, тогда как соседний outbound_geo проверяет состав имени.
: > "$T/steer.log"
out="$(rpcd vless_nodes '{"output":"/etc/passwd"}')"
check "vless_nodes: путь вместо имени выхода — отказ" "false" "$(printf '%s' "$out" | jget ok)"
check "vless_nodes: движок с путём не вызывался" "0" "$(grep -c 'vless-nodes /etc/passwd' "$T/steer.log")"
out="$(rpcd vless_probe '{"output":"--spec","node":0}')"
check "vless_probe: флаг вместо имени выхода — отказ" "false" "$(printf '%s' "$out" | jget ok)"
out="$(rpcd outbound_probe '{"output":"a/b"}')"
check "outbound_probe: имя с косой — отказ" "false" "$(printf '%s' "$out" | jget ok)"

# БЕЗ curl страна и отклик выходов не меряются вовсе, и обзор молча оставлял пустые строки
# (splify2#32): «выход молчит» и «мерить нечем» выглядели одинаково. Ответ обязан сказать
# второе полем curl=false — и не говорить его там, где curl есть.
export GEO_CURL=/nonexistent/curl
out="$(rpcd outbound_geo '{"output":"vless"}')"
check "outbound_geo без curl: так и сказано" "false" "$(printf '%s' "$out" | jget curl)"
out="$(rpcd outbound_geo '{"output":"vless","fresh":true}')"
check "outbound_geo без curl, свежий запрос: так и сказано" "false" "$(printf '%s' "$out" | jget curl)"
unset GEO_CURL
out="$(rpcd outbound_geo '{"output":"vless"}')"
check "outbound_geo с curl: поля curl нет" "" "$(printf '%s' "$out" | jget curl)"

# ИМЯ ПОДПИСКИ НЕ ЛАТИНИЦЕЙ. sub_slug оставлял от «Дом» пустоту (tr побайтно превращал каждый
# байт UTF-8 в подчёркивание, sed снимал хвост), а sub_use на пустом имени подставлял main —
# то есть вторая подписка человека молча ПЕРЕЗАПИСЫВАЛА основную, а sub_del по такому имени
# удалял её. Два разных нелатинских имени обязаны дать два разных имени файла, и ни одно из
# них — не main.
out="$(rpcd sub_set '{"name":"main","url":"vless://main@h:443#m"}')"
out="$(rpcd sub_set '{"name":"Дом","url":"vless://dom@h:443#d"}')"
dom_name="$(printf '%s' "$out" | jget name)"
out="$(rpcd sub_set '{"name":"Работа","url":"vless://rab@h:443#r"}')"
rab_name="$(printf '%s' "$out" | jget name)"
check "нелатинское имя подписки не превращается в main" "no" "$([ "$dom_name" = main ] && echo yes || echo no)"
check "два нелатинских имени различимы" "no" "$([ "$dom_name" = "$rab_name" ] && echo yes || echo no)"
check "основная подписка при этом не тронута" "yes" \
      "$(grep -q 'vless://main@' "$T/etc/sub.txt" 2>/dev/null && echo yes || echo no)"
# Убираем за собой: перечень подписок ниже проверяется на точный состав.
rpcd sub_del "{\"name\":\"$dom_name\"}" >/dev/null 2>&1
rpcd sub_del "{\"name\":\"$rab_name\"}" >/dev/null 2>&1

# Новая подписка перечитывается демоном: sub_set просит у него `steer reload`, но только когда
# сохранённое равно применённому (иначе перезагрузка применила бы чужие неприменённые правки).
printf '{"schema":1,"outputs":{},"channels":[]}\n' > "$T/etc/spec.json"
cp "$T/etc/spec.json" "$T/etc/spec.applied.json"
out="$(rpcd spec_set "$(spec_req "$(vless_spec)")")"
cp "$T/etc/spec.json" "$T/etc/spec.applied.json"
: > "$T/steer.log"
out="$(rpcd sub_set '{"url":"vless://key@host:443#node"}')"
check "смена подписки при чистой спеке просит перезагрузку у демона" "1" \
      "$(grep -c '^reload' "$T/steer.log")"
out="$(rpcd spec_set "$(spec_req "$(vless_spec 3)")")"
: > "$T/steer.log"
out="$(rpcd sub_set '{"url":"vless://key@host:443#node"}')"
check "а при неприменённых правках — нет, применит кнопка" "0" \
      "$(grep -c '^reload' "$T/steer.log")"

# ---- кандидат спеки готовится РЯДОМ с целевым файлом ----------------------------
# Спека — единственный файл, где лежит вся настройка, и подменяется она mv. Но mv атомарен
# только ВНУТРИ одной файловой системы: на роутере /tmp — tmpfs, а /etc — overlay, всегда
# разные, и busybox делает copy+unlink. То есть назначение открывается на запись и
# заполняется по частям: обрыв на середине (overlay на целевых устройствах 6,9 МБ)
# оставляет на месте рабочей спеки обрубок, который движок при следующей загрузке
# отвергнет, — ровно то, что --dry-run в этой же функции обещает предотвратить. Кандидат
# рядом с назначением делает mv настоящим rename: либо старый файл, либо новый.
#
# Проверяется не текст скрипта, а путь, который скрипт СВОИМИ РУКАМИ отдал движку на
# проверку: заглушка steer протоколирует свои аргументы, и `--spec` в строке dry-run — это
# и есть кандидат. Такая проверка переживает переименование переменной и не зеленеет от
# комментария о том, как правильно.
printf '{"schema":1,"outputs":{},"channels":[]}\n' > "$T/etc/spec.json"
: > "$T/steer.log"
out="$(rpcd spec_set "$(spec_req "$(vless_spec)")")"
cand="$(awk '$1 == "apply" && $2 == "--dry-run" { print $4 }' "$T/steer.log" | tail -1)"
#
# Утверждение здесь именно «в каталоге назначения», а не «не в /tmp»: песочница стенда
# сама живёт в /tmp, и проверка на /tmp была бы красной на верном коде. Мерить нужно
# отношение кандидата к назначению — оно и решает, рождается mv из rename или из копии.
check "кандидат спеки лежит в каталоге назначения" "$T/etc" "$(dirname "$cand")"
check "имя кандидата растёт от имени спеки" "yes" \
      "$(case "$cand" in "$T/etc/spec.json".*) echo yes ;; *) echo no ;; esac)"
# Кандидат обязан исчезать в ОБОИХ исходах. Он лежит рядом с настоящей спекой, и
# оставленный после отказа он копится в /etc, а имя у него отличается от рабочего одним
# суффиксом — такой файл легко принять за настоящий.
check "после успеха кандидата не остаётся" "" \
      "$(ls "$T/etc"/spec.json.new.* 2>/dev/null)"
: > "$T/steer.log"
out="$(STEER_RC=1 STEER_ERR='bad spec' rpcd spec_set "$(spec_req "$(vless_spec 1)")")"
check "отвергнутая спека не сохраняется" "false" "$(printf '%s' "$out" | jget ok)"
check "после отказа кандидата не остаётся" "" \
      "$(ls "$T/etc"/spec.json.new.* 2>/dev/null)"

# Проверка через демона (`steer ctl check`), когда его сокет есть: отказ приходит в поле stderr
# ответа, успех — code 0, а отказ самого демона (поле error) не считается проверкой и
# переходит на прямой dry-run. Без сокета — прямой dry-run, как выше.
: > "$T/steer.sock"
: > "$T/steer.log"
out="$(STEER_SOCK="$T/steer.sock" CTL_RESP='{"v":1,"cmd":"check","code":1,"stdout":"","stderr":"отказ демона"}' \
    rpcd spec_set "$(spec_req "$(vless_spec 1)")")"
check "отказ через демона: спека не сохраняется" "false" "$(printf '%s' "$out" | jget ok)"
check "отказ через демона: причина из ответа" "yes" \
      "$(printf '%s' "$out" | grep -q 'отказ демона' && echo yes || echo no)"
check "через демона dry-run напрямую не зовётся" "0" "$(grep -c '^apply --dry-run' "$T/steer.log")"
out="$(STEER_SOCK="$T/steer.sock" CTL_RESP='{"v":1,"cmd":"check","code":0,"stdout":"","stderr":""}' \
    rpcd spec_set "$(spec_req "$(vless_spec 1)")")"
check "успех через демона: спека сохранена" "true" "$(printf '%s' "$out" | jget ok)"
: > "$T/steer.log"
out="$(STEER_SOCK="$T/steer.sock" CTL_RESP='{"v":1,"cmd":"check","error":"internal","message":"занят"}' \
    rpcd spec_set "$(spec_req "$(vless_spec 1)")")"
check "отказ самого демона: проверка падает на прямой dry-run" "1" "$(grep -c '^apply --dry-run' "$T/steer.log")"
rm -f "$T/steer.sock"

# Фикстуры возвращаются к исходным: проверки ниже писаны против них.
printf '{"schema":1,"outputs":{},"channels":[]}\n' > "$T/etc/spec.json"
rm -f "$T/var/vless-dirty" "$T/var/obfs-dirty" "$T/etc/spec.applied.json"

# ---- файл настройки uci заводится, не убивая метод -------------------------------
# Отказ перенаправления у СПЕЦИАЛЬНОЙ встроенной команды (`: > файл`) завершает оболочку
# целиком — так требует POSIX и так делает ash. Значит там, где каталога нет или на overlay
# кончилось место, метод умирал БЕЗ ОТВЕТА: ни ok, ни ошибки, а интерфейс показывал «нет
# ответа» на пустом месте. Урок записан в запуске 46 у backup_put и там же исправлен, а
# sub_set и ui_set остались с прежней строкой — до этого стенда их ответ не проверялся вовсе,
# потому что пути /etc/config/splify2 не было шва.
# ---- порядок перенаправлений у wc (I-085) --------------------------------------
# Правило одно: `wc -c 2>/dev/null < файл`, а не `wc -c < файл 2>/dev/null`. Оболочка
# применяет перенаправления слева направо и делает это сама, до запуска команды, поэтому во
# второй форме отсутствующий файл разбирается тогда, когда stderr ещё свой.
#
# Сначала опыт, который объясняет барьер: без него это выглядело бы придиркой к порядку слов.
check "неверный порядок заставляет оболочку говорить вслух" "yes" \
      "$(sh -c 'wc -c < /nonexistent/nope 2>/dev/null' 2>&1 >/dev/null | grep -qi 'open' && echo yes || echo no)"
check "верный порядок молчит" "" \
      "$(sh -c 'wc -c 2>/dev/null < /nonexistent/nope' 2>&1 >/dev/null)"
# И барьер: в скрипте не осталось ни одного места с неверным порядком. Кавычка в шаблоне
# отсекает объяснение в комментарии, где неверная форма названа нарочно.
check "в скрипте не осталось неверного порядка" "0" \
      "$(grep -c 'wc -c < "' "$SCRIPT")"
# Значение при отсутствующем файле — нуль, а не пустая строка: пустая уезжает в json_add_int
# и делает ответ битым JSON вместо «мусора рядом с ответом».
check "размер отсутствующего файла считается нулём, а не пустотой" "0" \
      "$(sh -c 'echo "$(wc -c 2>/dev/null < /nonexistent/nope || echo 0)"')"

check "путь файла настройки — шов, а не литерал" "1" \
      "$(grep -c '^UCI_SPLIFY2=' "$SCRIPT")"
check "прямых путей /etc/config/splify2 в коде не осталось" "1" \
      "$(grep -c '/etc/config/splify2' "$SCRIPT")"
# Десять мест: sub_set, sub_put (ключи подписок), ветка настроек, ui_get|ui_set,
# fetch_mode|fetch_mode_set, lists_source|lists_source_set, zm_fix|zm_fix_set, doh_tunnel_set,
# telemetry_set и sub_auto. Число растёт вместе с методами, которые пишут в uci, — и это ровно
# тот случай, когда барьер должен ломаться: новый метод обязан заводить файл той же функцией.
#
# Девятым telemetry_set стал не потому, что метод новый, а потому, что он единственный звал
# uci_file БЕЗ проверки — как и `uci set` с `uci commit` рядом. Ответ `ok 1` у него значил не
# «согласие записано», а «дошли до конца функции»: на роутере с заполненным флешем ползунок
# переезжал, страница показывала успех, а в конфигурации оставалось прежнее значение.
check "файл заводится одной функцией на все места" "8" \
      "$(rpcd_src | grep -c '^ *uci_file ||')"
check "перенаправлением файл больше не заводится" "0" \
      "$(rpcd_src | grep -c ': > "\?/etc/config')"
# И поведением: на недоступном каталоге метод обязан ОТВЕТИТЬ отказом, а не умереть.
out="$(UCI_SPLIFY2_FIXTURE=/proc/nonexistent/splify2 rpcd sub_set '{"url":"vless://k@h:443#n"}')"
check "недоступный файл настройки — отказ с причиной, а не тишина" "yes" \
      "$(printf '%s' "$out" | jget error | grep -q 'кончилось место' && echo yes || echo no)"

# ---- подписку скачивает ДВИЖОК, а не этот файл -----------------------------------
#
# Скачивание, заголовки запроса с идентификатором устройства, разбор ответных заголовков,
# base64 названия, арифметика остатка трафика и повтор за другим форматом переехали в
# steer sub-fetch / sub-quota / sub-hwid. Причина — в шапке steer/src/ext/subfetch.c;
# проверяется всё это стендом steer/tests/subfetchmatch.c, где есть и поддельный curl, и
# поддельный каталог устройств.
#
# ЗДЕСЬ проверяется другая граница, и только она: что объект rpcd спрашивает движок теми
# аргументами, какими нужно, и что ответ движка доходит наверх не пересказанным. Повторять
# здесь проверки движка значило бы проверять заглушку.
rm -f "$T/subfetch.log" "$T/curl.log" "$T/etc/sub.txt"
out="$(rpcd sub_set '{"url":"https://panel.invalid/sub/abc"}')"
check "подписка скачалась" "true" "$(printf '%s' "$out" | jget ok)"
check "скачивал движок, и ему названы оба пути" \
      "https://panel.invalid/sub/abc $T/etc/sub.txt $T/etc/sub.userinfo" \
      "$(tail -1 "$T/subfetch.log")"
# Своего скачивания подписки в объекте не осталось. Проверяется отсутствием обращений curl:
# через curl здесь ходят только списки, и запрос к панели среди них был бы вторым путём
# наружу со своими заголовками — тем самым, ради устранения которого работа и переехала.
check "объект к панели сам не ходит" "no" \
      "$([ -f "$T/curl.log" ] && echo yes || echo no)"

# Идентификатор устройства тоже спрашивается у движка. Постоянство и рецептура — его забота
# (стенд subfetchmatch); здесь важно, что объект НЕ считает его сам и отдаёт как есть.
check "sub_info отдаёт идентификатор от движка" "splify2-9c53221f0abc9c53" \
      "$(rpcd sub_info | jget hwid)"
check "и sub_list тоже" "splify2-9c53221f0abc9c53" "$(rpcd sub_list | jget hwid)"
check "пустой ответ движка не превращается в выдуманный" "" \
      "$(STEER_HWID='' rpcd sub_info | jget hwid)"
# Свои реализации хеша и base64 из объекта убраны: они были там ровно потому, что на роутере
# нет ни sha256sum наверняка, ни base64 вовсе, — а у движка и то, и другое есть в C.
# Проверяется именно рецептура HWID, а не всякий хеш: отпечатки спеки (vless_fingerprint,
# obfs_fingerprint) считаются md5sum-ом законно и никуда не переезжали.
check "идентификатор устройства в объекте больше не считается" "0" \
      "$(grep -c "splify2:%s" "$SCRIPT")"
check "и base64 в awk из объекта убран" "0" \
      "$(grep -c 'b64_decode' "$SCRIPT")"

# ССЫЛКА ИЗ ОТВЕТА, А НЕ ТА, ЧТО ПРОСИЛИ. Движок мог перезапросить подписку с суффиксом
# /json — панели с привязкой к устройствам выбирают формат ответа по клиенту, — и обновлять
# в следующий раз надо по ТОЙ ссылке. Прежде это правило дублировалось в объекте строкой
# `url="${url%/}/json"`, то есть оболочка повторяла решение, которое приняла не она.
out="$(STEER_SUB_JSON='{"ok":true,"url":"https://panel.invalid/sub/abc/json","usable":9,"title":"Панель","hwid_sent":true}' \
       rpcd sub_set '{"url":"https://panel.invalid/sub/abc"}')"
check "сохранена ссылка из ответа движка" "https://panel.invalid/sub/abc/json" \
      "$(rpcd sub_info | jget url)"
check "и число пригодных узлов доехало" "9" "$(printf '%s' "$out" | jget usable)"
check "название от панели взято движком и сохранено" "Панель" \
      "$(uci_get splify2.main.sub_title)"

# Название, которое дал ЧЕЛОВЕК, ответом панели не переписывается: он его для того и вписал.
out="$(STEER_SUB_JSON='{"ok":true,"url":"https://panel.invalid/s","usable":1,"title":"Панель"}' \
       rpcd sub_set '{"url":"https://panel.invalid/s","title":"моё"}')"
check "своё название сильнее панельного" "моё" "$(uci_get splify2.main.sub_title)"

# Слово панели про устройство доходит до человека дословно. Что именно она сказала — решает
# движок по своим заголовкам; объект обязан не потерять это по дороге.
out="$(STEER_SUB_JSON='{"ok":true,"url":"https://panel.invalid/s","usable":0,"warn":"панель не увидела идентификатора устройства и отдала заглушку вместо узлов"}' \
       rpcd sub_set '{"url":"https://panel.invalid/s"}')"
check "предупреждение движка доехало до ответа" "yes" \
      "$(printf '%s' "$out" | jget warn | grep -q 'не увидела идентификатора' && echo yes || echo no)"
out="$(STEER_SUB_JSON='{"ok":true,"url":"https://panel.invalid/s","usable":1}' \
       rpcd sub_set '{"url":"https://panel.invalid/s"}')"
check "на исправном ответе предупреждения нет" "" "$(printf '%s' "$out" | jget warn)"

# ОТКАЗ ДВИЖКА — отказ метода, и настройка при этом не пишется: сохранённая ссылка на
# подписку, которая не скачалась, выглядит настроенной и молча не работает.
uci_set splify2.main.sub_url "https://panel.invalid/prev"
out="$(STEER_SUB_RC=1 rpcd sub_set '{"url":"https://panel.invalid/broken"}')"
check "отказ движка — отказ метода" "false" "$(printf '%s' "$out" | jget ok)"
check "и причина названа" "yes" \
      "$(printf '%s' "$out" | jget error | grep -q 'не скачалась' && echo yes || echo no)"
check "прежняя ссылка не подменена" "https://panel.invalid/prev" \
      "$(uci_get splify2.main.sub_url)"

# Вставленные руками ссылки vless:// никуда не ходят — значит и движок для них не зовётся:
# скачивать нечего, и запуск процесса был бы работой без вопроса.
rm -f "$T/subfetch.log"
out="$(rpcd sub_set '{"url":"vless://key@host:443#node"}')"
check "для ссылок vless:// движок не зовётся" "links;no" \
      "$(printf '%s' "$out" | jget kind);$([ -f "$T/subfetch.log" ] && echo yes || echo no)"

# ПРОКСИ steer-proxy: ссылки trojan://, ss://, socks*://, vmess:// принимаются вставкой так же,
# как vless:// — файл подписки один, протокол узла различает ядро. А прокси http(s):// по виду
# не отличить от адреса подписки, поэтому он приходит ОТДЕЛЬНЫМ полем `links` (решение владельца
# 2026-10-02) и не скачивается.
rm -f "$T/subfetch.log"
out="$(rpcd sub_set '{"name":"px1","url":"trojan://p@h:443#t ss://YWVzLTEyOC1nY206cA@h:8388#s socks5://h:1080#k vmess://eyJhZGQiOiJoIn0="}')"
check "trojan, ss, socks, vmess вставкой — ссылки, без скачивания" "true;links;no" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget kind);$([ -f "$T/subfetch.log" ] && echo yes || echo no)"
check "все четыре ссылки — строками файла подписки" "4" "$(grep -c '://' "$T/etc/subs/px1.txt" 2>/dev/null)"
rm -f "$T/subfetch.log"
out="$(rpcd sub_set '{"name":"px2","links":"http://u:p@h:3128#ht https://h:443?sni=x#hs"}')"
check "прокси http(s):// отдельным полем — ссылки, а не подписка" "true;links;no" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget kind);$([ -f "$T/subfetch.log" ] && echo yes || echo no)"
check "и обе лежат в файле подписки" "http://u:p@h:3128#ht;https://h:443?sni=x#hs" \
      "$(tr '\n' ';' < "$T/etc/subs/px2.txt" 2>/dev/null | sed 's/;$//')"
check "у подписки из ссылок адреса для обновления нет" "" "$(uci_get splify2.sub_px2.url)"
out="$(rpcd sub_set '{"name":"px3","url":"vless://k@h:443#v","links":"http://h:3128#ht"}')"
check "ссылки узлов и прокси http — вместе одной подпиской" "2" "$(grep -c '://' "$T/etc/subs/px3.txt" 2>/dev/null)"
out="$(rpcd sub_set '{"name":"px4","url":"https://panel.invalid/sub","links":"http://h:3128#ht"}')"
check "адрес подписки вместе со ссылками — отказ, а не потеря одного из двух" "false" "$(printf '%s' "$out" | jget ok)"
out="$(rpcd sub_set '{"name":"px5","links":"ftp://h/x"}')"
check "в поле ссылок без единой ссылки узла — отказ" "false" "$(printf '%s' "$out" | jget ok)"
for _n in px1 px2 px3; do rpcd sub_del "{\"name\":\"$_n\"}" > /dev/null; done

# ---- автообновление подписки -------------------------------------------------
#
# Подписка обновлялась только по нажатию, и человек с панелью, у которой узлы меняются за
# час, узнавал об этом отказом туннеля. Теперь у каждой подписки свой интервал, а расписание
# смотрит по часам, кому пора. Здесь проверяются пределы, отметка времени и — главное — то,
# что туннель перечитывает узлы ТОЛЬКО когда они изменились: иначе обновление по часам
# означало бы обрыв связи по часам.
out="$(rpcd sub_set '{"url":"https://panel.invalid/sub/auto","name":"auto1"}')"
check "подписка для проверки автообновления заведена" "true" "$(printf '%s' "$out" | jget ok)"

out="$(rpcd sub_auto '{"name":"auto1","minutes":10}')"
check "интервал чаще получаса отвергнут" "false" "$(printf '%s' "$out" | jget ok)"
out="$(rpcd sub_auto '{"name":"auto1","minutes":5000}')"
check "интервал дольше трёх суток отвергнут" "false" "$(printf '%s' "$out" | jget ok)"
out="$(rpcd sub_auto '{"name":"auto1","minutes":"каждый час"}')"
check "интервал не числом отвергнут" "false" "$(printf '%s' "$out" | jget ok)"

rm -f "$T/etc/subs/auto1.auto"
out="$(rpcd sub_auto '{"name":"auto1","minutes":60}')"
check "час принят" "true;60" "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget auto)"
check "отметка времени поставлена сразу" "yes"       "$([ -s "$T/etc/subs/auto1.auto" ] && echo yes || echo no)"
check "перечень называет интервал" "60"       "$(rpcd sub_list | python3 -c 'import json,sys
print(next(d.get("auto") for d in json.load(sys.stdin)["subs"] if d["name"]=="auto1"))')"

# Отметка ставится ОТ МОМЕНТА НАСТРОЙКИ, а не от давно просроченного прошлого: иначе выбор
# «раз в трое суток» обновлял бы подписку немедленно, при первом же тике расписания.
check "сразу после настройки обновлять не пора" "yes"       "$(now=$(date -u +%s); at=$(cat "$T/etc/subs/auto1.auto"); [ $((now - at)) -lt 60 ] && echo yes || echo no)"

out="$(rpcd sub_auto '{"name":"auto1","minutes":0}')"
check "ноль выключает обновление" "true;0"       "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget auto)"

out="$(rpcd sub_set '{"url":"vless://k@h:443#n","name":"hand1"}')"
out="$(rpcd sub_auto '{"name":"hand1","minutes":60}')"
check "ссылкам vless:// интервал не назначить" "false" "$(printf '%s' "$out" | jget ok)"

# Обновление по сохранённой ссылке. Узлы прежние — туннель не трогаем.
# Первое обновление узлы МЕНЯЕТ (в файле лежал образец от sub_set) — журнал вызовов движка
# чистим после него: проверяем второе, где узлы те же самые.
cp "$T/etc/spec.json" "$T/etc/spec.applied.json"
out="$(STEER_SUB_BODY='vless://same@h:443#n' rpcd sub_refresh '{"name":"auto1"}')"
: > "$T/steer.log"
out="$(STEER_SUB_BODY='vless://same@h:443#n' rpcd sub_refresh '{"name":"auto1"}')"
check "узлы прежние — обновление это говорит" "true;false"       "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget changed)"
check "и у демона перечитать не просит" "0"       "$(grep -c '^reload' "$T/steer.log")"

# Узлы сменились — вот тогда просит.
out="$(STEER_SUB_BODY='vless://other@h:443#n' rpcd sub_refresh '{"name":"auto1"}')"
check "узлы сменились — обновление это говорит" "true;true"       "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget changed)"
check "и просит у демона перечитать" "1"       "$(grep -c '^reload' "$T/steer.log")"

out="$(rpcd sub_refresh '{"name":"hand1"}')"
check "ссылки vless:// обновлять нечем" "false" "$(printf '%s' "$out" | jget ok)"

# ЖИВОЙ ТУННЕЛЬ ПЕРЕЧИТЫВАЕТ УЗЛЫ САМ. Ждать, пока человек нажмёт «Применить», нельзя:
# обновление затем и по часам, чтобы он в него не вмешивался. Сигнал уходит ИМЕННО тому
# экземпляру, который живёт этой подпиской.
# Подписка здесь снова ССЫЛОЧНАЯ: выше её оставили вставленными руками vless://, а такую
# обновлять нечем — и проверка молча проверяла бы отказ вместо перезапуска.
out="$(rpcd sub_set '{"url":"https://panel.invalid/sub/main"}')"
# Спека здесь своя, с полем `name` внутри выхода: именно так её пишет интерфейс и так она
# лежит на роутере. Общая заготовка vless_spec имени не кладёт — ей оно не нужно, а здесь
# по нему и находится, какой туннель живёт этой подпиской.
python3 -c 'import json,sys
print(json.dumps({"schema":1,"outputs":{"vpn":{"name":"vpn","kind":"vless","sub_file":sys.argv[1]}},"channels":[]}))' \
    "$T/etc/sub.txt" > "$T/etc/spec.json"
cp "$T/etc/spec.json" "$T/etc/spec.applied.json"
: > "$T/steer.log"
out="$(STEER_SUB_BODY='vless://fresh@h:443#n' rpcd sub_refresh '{"name":"main"}')"
check "обновление по расписанию просит демон перечитать подписки" "1" \
      "$(grep -c '^reload' "$T/steer.log")"
# ВЫХОД ОПОЗНАЁТСЯ ПО КЛЮЧУ, а не по полю `name` (I-328). Поле `name` внутри выхода пишет
# только интерфейс; в контракте спеки его нет, и спека, положенная руками или пустая заготовка
# fast.sh, его не несёт. Счёт по `name` у такой спеки не находил ни одного выхода: туннель не
# получал сигнала перечитать узлы, а карточка говорила «локаций занято: 0».
python3 -c 'import json,sys
print(json.dumps({"schema":1,"outputs":{"vpn":{"kind":"vless","sub_file":sys.argv[1],"nodes":[0,1]}},"channels":[]}))' \
    "$T/etc/sub.txt" > "$T/etc/spec.json"
cp "$T/etc/spec.json" "$T/etc/spec.applied.json"
: > "$T/steer.log"
out="$(STEER_SUB_BODY='vless://fresher@h:443#n' rpcd sub_refresh '{"name":"main"}')"
check "выход без поля name: подписку перечитывает демон, выход посчитан" "1;1" \
      "$(printf '%s' "$out" | jget restarted);$(grep -c '^reload' "$T/steer.log")"
check "выход без поля name: занятые локации подписки посчитаны" "1;2" \
      "$(rpcd sub_list | python3 -c 'import json,sys
d=next(d for d in json.load(sys.stdin)["subs"] if d["name"]=="main"); print("%s;%s" % (d["used"], d["used_nodes"]))')"
# Не записалась новая ссылка — прежняя остаётся (I-329). Запись была `[ url ] && sub_put … ||
# sub_put … url ""`: отказ ПЕРВОЙ ветки запускал вторую, и та стирала ссылку, по которой
# подписка обновлялась, — обновлять становилось нечем.
out="$(UCI_SET_FAIL=splify2.main.sub_url rpcd sub_set '{"url":"https://second.invalid/sub","name":"main"}')"
check "sub_set: отказ записи ссылки не стирает прежнюю" "https://panel.invalid/sub/main" \
      "$(uci_get splify2.main.sub_url)"

# Панель молчит — отметка всё равно свежая: повторять поход каждые десять минут при мёртвой
# панели значит стучаться к ней 144 раза в сутки вместо одного-двух.
printf '0\n' > "$T/etc/subs/auto1.auto"
out="$(STEER_SUB_RC=1 rpcd sub_refresh '{"name":"auto1"}')"
check "неудача обновления названа отказом" "false" "$(printf '%s' "$out" | jget ok)"
check "и отметка попытки всё равно обновлена" "yes"       "$(now=$(date -u +%s); at=$(cat "$T/etc/subs/auto1.auto" 2>/dev/null || echo 0); [ $((now - at)) -lt 60 ] && echo yes || echo no)"

rpcd sub_del '{"name":"auto1"}' >/dev/null 2>&1
rpcd sub_del '{"name":"hand1"}' >/dev/null 2>&1
check "удаление подписки уносит и отметку" "no"       "$([ -e "$T/etc/subs/auto1.auto" ] && echo yes || echo no)"

# ---- несколько подписок ------------------------------------------------------
#
# Подписок на роутере бывает несколько: у человека две панели, и локации из обеих он
# складывает в пулы. Первая осталась на прежнем месте (/etc/steer/sub.txt) — на этот путь
# ссылаются выходы в спеках установленных роутеров.
rm -rf "$T/etc/subs"
out="$(rpcd sub_set '{"url":"https://panel.invalid/sub/second","name":"blue"}')"
check "вторая подписка легла своим файлом" "yes" \
      "$([ -s "$T/etc/subs/blue.txt" ] && echo yes || echo no)"
check "первую она не тронула" "yes" \
      "$([ -s "$T/etc/sub.txt" ] && echo yes || echo no)"
check "перечень называет обе" "blue main" \
      "$(rpcd sub_list | python3 -c 'import json,sys
print(" ".join(sorted(d["name"] for d in json.load(sys.stdin)["subs"])))')"

# ЛОВУШКА, ради которой заведён rpcd_raw: ubus передаёт запрос без завершающего перевода
# строки. Обработчик обязан прочитать имя и в этом случае — иначе он молча отвечает по
# первой подписке, и на экране у второй стоят чужие числа (поймано на роутере).
check "имя подписки читается и без перевода строки на входе" "blue" \
      "$(rpcd_raw sub_info '{"name":"blue"}' | jget name)"
check "и путь тогда её собственный" "$T/etc/subs/blue.txt" \
      "$(rpcd_raw sub_info '{"name":"blue"}' | jget path)"

# Занятую выходом не удаляем: движок читает файл узлов при подъёме, и снос под живым выходом
# оставил бы правило вести в туннель без единого узла.
cat > "$T/etc/spec.json" <<JSON
{"schema":1,"outputs":{"vl":{"name":"vl","kind":"vless","sub_file":"$T/etc/subs/blue.txt","node":-1}},"channels":[]}
JSON
out="$(rpcd sub_del '{"name":"blue"}')"
check "занятая подписка не удаляется" "false" "$(printf '%s' "$out" | jget ok)"
check "и сказано, сколькими выходами занята" "yes" \
      "$(printf '%s' "$out" | jget error | grep -q 'занята выходами' && echo yes || echo no)"
printf '%s\n' '{"schema":1,"outputs":{},"channels":[]}' > "$T/etc/spec.json"
out="$(rpcd sub_del '{"name":"blue"}')"
check "свободная — удаляется вместе с файлом" "true;no" \
      "$(printf '%s' "$out" | jget ok);$([ -e "$T/etc/subs/blue.txt" ] && echo yes || echo no)"

# ---- НЕСКОЛЬКО ПОДПИСОК: каждая со своей парой файлов --------------------------
#
# Подписок на роутере бывает несколько, и главное свойство здесь — что движку называются
# пути ИМЕННО ЭТОЙ подписки. Ошибка была бы молчаливой в худшем виде: остаток второй панели,
# записанный поверх остатка первой, выглядит как правда, а узлы, скачанные в чужой файл,
# уводят трафик к другому поставщику.
rm -f "$T/subfetch.log" "$T/subquota.log"
rm -rf "$T/etc/subs"
# Первая подписка заводится ЗДЕСЬ, а не берётся из состояния предыдущих проверок: те
# оставляли её то ссылками vless://, то вовсе без ссылки, и проверка «первую не тронуло»
# смотрела бы не на то.
rpcd sub_set '{"url":"https://first.invalid/sub"}' >/dev/null
out="$(rpcd sub_set '{"url":"https://second.invalid/sub","name":"green"}')"
check "второй подписке названы её собственные пути" \
      "https://second.invalid/sub $T/etc/subs/green.txt $T/etc/subs/green.userinfo" \
      "$(tail -1 "$T/subfetch.log")"
check "и файл лёг именно туда" "yes" \
      "$([ -s "$T/etc/subs/green.txt" ] && echo yes || echo no)"
check "первую это не тронуло" "yes" \
      "$([ -s "$T/etc/sub.txt" ] && echo yes || echo no)"
# Ссылка второй подписки живёт в своей секции uci, а не поверх первой.
check "ссылка второй подписки в своей секции" "https://second.invalid/sub" \
      "$(uci_get splify2.sub_green.url)"
check "и ссылка первой на месте" "https://first.invalid/sub" \
      "$(uci_get splify2.main.sub_url)"

# Узлы подписки БЕЗ выхода: редактор выхода показывает локации подписки до того, как на неё
# заведён хоть один выход. Движку уходит путь к файлу вместо имени выхода, и путь принимается
# только свой — из перечня подписок роутера: иначе метод читал бы с диска что угодно.
: > "$T/steer.log"
out="$(STEER_JSON='{"output":"","sub_file":"x","node":-1,"chosen":[],"nodes":[]}' \
       rpcd vless_nodes "{\"sub\":\"$T/etc/subs/green.txt\"}")"
check "узлы подписки спрашиваются у движка путём к её файлу" \
      "vless-nodes $T/etc/subs/green.txt --spec $T/etc/spec.json" "$(tail -1 "$T/steer.log")"
check "и ответ движка отдан дословно" "x" "$(printf '%s' "$out" | jget sub_file)"
out="$(rpcd vless_nodes '{"sub":"/etc/passwd"}')"
check "чужой путь вместо подписки отвергается" "false" "$(printf '%s' "$out" | jget ok)"
# Смешанная подписка (46 ссылок vless:// и 5 hysteria2://, первая — vless; ключи выдуманы): файл
# один, клиенты два. Бэкенд не делит узлы сам — каждый метод отдаёт движку тот же путь своей
# командой, и ответ каждого клиента приходит дословно: узлы VLESS и hysteria2 редактор
# складывает уже сам.
cp "$T/etc/subs/green.txt" "$T/green.keep"
: > "$T/etc/subs/green.txt"
_i=1
while [ "$_i" -le 46 ]; do
    printf 'vless://00000000-0000-0000-0000-%012d@v%d.example.invalid:443?security=tls&sni=x.example.invalid#vless-%d\n' "$_i" "$_i" "$_i" >> "$T/etc/subs/green.txt"
    _i=$((_i + 1))
done
_i=1
while [ "$_i" -le 5 ]; do
    printf 'hysteria2://00000000-0000-0000-0000-%012d@h%d.example.invalid:443/?sni=x.example.invalid&fm=%%7B%%22quicParams%%22%%3A%%7B%%22debug%%22%%3Afalse%%7D%%7D#hy-%d\n' "$_i" "$_i" "$_i" >> "$T/etc/subs/green.txt"
    _i=$((_i + 1))
done
check "в смешанной подписке 51 ссылка" "51" "$(grep -c '://' "$T/etc/subs/green.txt")"
: > "$T/steer.log"
out="$(STEER_JSON='{"output":"","usable":5,"skipped":0,"foreign":46,"nodes":[{"index":0,"name":"hy-1"}]}' \
       rpcd hysteria2_nodes "{\"sub\":\"$T/etc/subs/green.txt\"}")"
check "смешанная подписка: hysteria2_nodes зовёт hysteria2-nodes по тому же файлу" \
      "hysteria2-nodes $T/etc/subs/green.txt --spec $T/etc/spec.json" "$(tail -1 "$T/steer.log")"
check "и ответ hysteria2-клиента дословно" "5" "$(printf '%s' "$out" | jget usable)"
out="$(STEER_JSON='{"output":"","usable":46,"skipped":0,"foreign":5,"nodes":[]}' \
       rpcd vless_nodes "{\"sub\":\"$T/etc/subs/green.txt\"}")"
check "смешанная подписка: vless_nodes зовёт vless-nodes по тому же файлу" \
      "vless-nodes $T/etc/subs/green.txt --spec $T/etc/spec.json" "$(tail -1 "$T/steer.log")"
check "и ответ VLESS-клиента сообщает о чужих ссылках" "5" "$(printf '%s' "$out" | jget foreign)"
: > "$T/steer.log"
rpcd hysteria2_probe "{\"sub\":\"$T/etc/subs/green.txt\",\"node\":3}" > /dev/null
check "проба узла hysteria2 идёт командой hysteria2-probe" "1" "$(grep -c '^hysteria2-probe ' "$T/steer.log")"
check "и не командой vless-probe" "0" "$(grep -c '^vless-probe ' "$T/steer.log")"
# Прокси steer-proxy (trojan, ss, socks, http, vmess) — третий клиент той же подписки: свои
# методы proxy_nodes/proxy_probe, тот же рубеж «путь — только свой», ответ ядра дословно.
printf 'trojan://p@t.example.invalid:443?security=tls&sni=t.example.invalid#tr-1\n' >> "$T/etc/subs/green.txt"
: > "$T/steer.log"
out="$(STEER_JSON='{"output":"","usable":1,"skipped":0,"foreign":51,"nodes":[{"index":0,"name":"tr-1","type":"trojan"}]}' \
       rpcd proxy_nodes "{\"sub\":\"$T/etc/subs/green.txt\"}")"
check "прокси: proxy_nodes зовёт proxy-nodes по файлу подписки" \
      "proxy-nodes $T/etc/subs/green.txt --spec $T/etc/spec.json" "$(tail -1 "$T/steer.log")"
check "и ответ прокси-клиента дословно" "trojan" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["nodes"][0]["type"])')"
: > "$T/steer.log"
rpcd proxy_probe "{\"sub\":\"$T/etc/subs/green.txt\",\"node\":0}" > /dev/null
check "проба узла прокси идёт командой proxy-probe с номером узла" \
      "proxy-probe $T/etc/subs/green.txt --node 0 --timeout 6 --spec $T/etc/spec.json" "$(tail -1 "$T/steer.log")"
out="$(rpcd proxy_nodes '{"sub":"/etc/passwd"}')"
check "proxy_nodes: чужой путь вместо подписки отвергается" "false" "$(printf '%s' "$out" | jget ok)"
out="$(rpcd proxy_probe '{"output":"--spec","node":0}')"
check "proxy_probe: флаг вместо имени выхода — отказ" "false" "$(printf '%s' "$out" | jget ok)"
check "proxy_nodes и proxy_probe объявлены в списке ubus" "yes;yes" \
      "$(rpcd_list | grep -q '"proxy_nodes"' && echo yes || echo no);$(rpcd_list | grep -q '"proxy_probe"' && echo yes || echo no)"
# УЗЛЫ С allowInsecure. Узел TLS с allowInsecure ядро берёт только у выхода с `insecure: true`, а
# номера считает среди пригодных; перечень и проверка ПО ФАЙЛУ без флага такие узлы не видят, и
# номера у выхода с insecure расходятся с номерами в редакторе. Редактор, у которого включено «Не
# проверять сертификат узла», просит `insecure` — бэкенд передаёт ядру `--insecure` (vless и прокси;
# у hysteria2 флаг ничего не меняет, а ядро до него его отвергло бы). Ядро до флага отвечает
# «неизвестный флаг» кодом 2 — тогда спрашивается без флага, как прежде.
: > "$T/steer.log"
STEER_JSON='{"output":"","nodes":[]}' rpcd vless_nodes "{\"sub\":\"$T/etc/subs/green.txt\",\"insecure\":true}" > /dev/null
check "insecure: vless_nodes по файлу передаёт ядру --insecure" \
      "vless-nodes $T/etc/subs/green.txt --insecure --spec $T/etc/spec.json" "$(tail -1 "$T/steer.log")"
: > "$T/steer.log"
STEER_JSON='{"output":"","nodes":[]}' rpcd proxy_nodes "{\"sub\":\"$T/etc/subs/green.txt\",\"insecure\":true}" > /dev/null
check "insecure: proxy_nodes по файлу передаёт ядру --insecure" \
      "proxy-nodes $T/etc/subs/green.txt --insecure --spec $T/etc/spec.json" "$(tail -1 "$T/steer.log")"
: > "$T/steer.log"
rpcd vless_probe "{\"sub\":\"$T/etc/subs/green.txt\",\"node\":2,\"insecure\":true}" > /dev/null
rpcd proxy_probe "{\"sub\":\"$T/etc/subs/green.txt\",\"node\":0,\"insecure\":true}" > /dev/null
check "insecure: проверка узла по файлу — с тем же флагом (номера те же)" \
      "vless-probe $T/etc/subs/green.txt --insecure --node 2 --timeout 6 --spec $T/etc/spec.json;proxy-probe $T/etc/subs/green.txt --insecure --node 0 --timeout 6 --spec $T/etc/spec.json" \
      "$(sed -n 1p "$T/steer.log");$(sed -n 2p "$T/steer.log")"
: > "$T/steer.log"
rpcd vless_nodes "{\"sub\":\"$T/etc/subs/green.txt\",\"insecure\":false}" > /dev/null
rpcd hysteria2_nodes "{\"sub\":\"$T/etc/subs/green.txt\",\"insecure\":true}" > /dev/null
rpcd vless_nodes '{"output":"vl","insecure":true}' > /dev/null
check "без insecure, у hysteria2 и по имени выхода — флага нет" "0" "$(grep -c -- '--insecure' "$T/steer.log")"
: > "$T/steer.log"
out="$(STEER_NO_INSECURE=1 STEER_JSON='{"output":"","sub_file":"old","nodes":[]}' \
       rpcd vless_nodes "{\"sub\":\"$T/etc/subs/green.txt\",\"insecure\":true}")"
check "ядро без --insecure: спрошено ещё раз без флага, ответ — его" \
      "2;vless-nodes $T/etc/subs/green.txt --spec $T/etc/spec.json;old" \
      "$(wc -l < "$T/steer.log" | tr -d ' ');$(tail -1 "$T/steer.log");$(printf '%s' "$out" | jget sub_file)"
: > "$T/steer.log"
out="$(STEER_NO_INSECURE=1 STEER_JSON='{"output":"","results":[],"working":-1}' \
       rpcd proxy_probe "{\"sub\":\"$T/etc/subs/green.txt\",\"node\":0,\"insecure\":true}")"
check "и у проверки узла" "2;proxy-probe $T/etc/subs/green.txt --node 0 --timeout 6 --spec $T/etc/spec.json;-1" \
      "$(wc -l < "$T/steer.log" | tr -d ' ');$(tail -1 "$T/steer.log");$(printf '%s' "$out" | jget working)"
: > "$T/steer.log"
out="$(STEER_RC=2 STEER_ERR='steer: vless-nodes: подписка пуста' rpcd vless_nodes "{\"sub\":\"$T/etc/subs/green.txt\",\"insecure\":true}")"
check "другой отказ ядра кодом 2 — без повтора, словами ядра" "1;false" \
      "$(wc -l < "$T/steer.log" | tr -d ' ');$(printf '%s' "$out" | jget ok)"
check "insecure объявлен у vless_nodes, vless_probe, proxy_nodes, proxy_probe" "4" \
      "$(rpcd_list | python3 -c 'import json,sys; d=json.load(sys.stdin); print(sum(1 for m in ("vless_nodes","vless_probe","proxy_nodes","proxy_probe") if "insecure" in d.get(m,{})))')"
mv "$T/green.keep" "$T/etc/subs/green.txt"
# Остаток второй подписки спрашивается по ЕЁ файлу: общий файл означал бы, что обзор
# показывает остаток одной панели под именем другой.
out="$(rpcd sub_quota '{"name":"green"}')"
check "остаток второй подписки спрошен по её файлу" \
      "https://second.invalid/sub $T/etc/subs/green.userinfo" \
      "$(tail -1 "$T/subquota.log")"
# Имя, которого нет, в путь не превращается: оно чистится до латиницы и цифр, потому что
# становится и именем файла, и именем секции uci.
out="$(rpcd sub_set '{"url":"https://third.invalid/sub","name":"../../etc/passwd"}')"
check "имя подписки не выходит за каталог" "no" \
      "$(tail -1 "$T/subfetch.log" | grep -q '/etc/passwd' && echo yes || echo no)"

# ---- остаток трафика: файл как контракт между движком и объектом ------------------
#
# Панель говорит остаток ЗАГОЛОВКОМ ответа, и больше нигде. Спрашивает его и разбирает
# ДВИЖОК (steer sub-fetch / sub-quota), он же считает точку отсчёта периода и решает, когда
# период начался заново; всё это проверяется в steer/tests/subfetchmatch.c.
#
# Между движком и объектом остаётся ФАЙЛ — `<подписка>.userinfo`, «ключ=значение» по строке.
# Он и есть контракт: объект читает его, собирая ответы sub_info и sub_list, и не ходит за
# числами наружу. Здесь проверяется именно эта половина.
USERINFO='upload=1288490188
download=139458183168
total=214748364800
expire=1789200000
at=1789000000
at0=1788000000
used0=1073741824'
rm -f "$T/etc/sub.userinfo"
out="$(STEER_SUB_INFO="$USERINFO" rpcd sub_set '{"url":"https://panel.invalid/sub/abc"}')"
check "остаток приезжает в ответе на «Обновить»" "214748364800" \
      "$(printf '%s' "$out" | jqget quota total)"
check "разобраны обе половины расхода" "1288490188;139458183168" \
      "$(printf '%s' "$out" | jqget quota up);$(printf '%s' "$out" | jqget quota down)"
check "срок подписки разобран" "1789200000" "$(printf '%s' "$out" | jqget quota expire)"
# Точка отсчёта периода доезжает как есть: делить и предсказывать — работа интерфейса, а
# второе место, где тот же темп считается иначе, разойдётся с первым.
check "точка отсчёта периода отдана вместе с числами" "1788000000;1073741824" \
      "$(printf '%s' "$out" | jqget quota since);$(printf '%s' "$out" | jqget quota since_used)"
# Байты — СТРОКАМИ: 200 ГБ не влезают в int32 у jshn, и обрезанное число выглядело бы
# законным остатком. Проверяется именно тип, а не значение: значение сверено выше.
check "объёмы отданы строками, а не числами" "yes" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; print("yes" if isinstance(json.load(sys.stdin)["quota"]["total"], str) else "no")')"
check "sub_info отдаёт запомненный остаток без запроса наружу" "214748364800" \
      "$(rpcd sub_info | jqget quota total)"
rm -f "$T/subfetch.log" "$T/subquota.log"
rpcd sub_info > /dev/null
check "и правда не спрашивает движок" "no" \
      "$([ -f "$T/subfetch.log" ] || [ -f "$T/subquota.log" ] && echo yes || echo no)"
check "sub_list отдаёт тот же остаток" "214748364800" \
      "$(rpcd sub_list | python3 -c 'import json,sys
for d in json.load(sys.stdin)["subs"]:
    if d["name"] == "main": print(d["quota"]["total"])')"

# Пустое значение в файле значит «панель этого не сообщала» и НЕ равно нулю: подписка без
# ограничения объёма не должна выглядеть исчерпанной.
out="$(STEER_SUB_INFO='upload=5
download=5
total=
expire=1789200000
at=1789000000
at0=1789000000
used0=10' rpcd sub_set '{"url":"https://panel.invalid/sub/abc"}')"
check "неназванный объём отдан пустой строкой, а не нулём" "" \
      "$(printf '%s' "$out" | jqget quota total)"

# Файла нет — поля `quota` нет вовсе. Пустая полоса «осталось 0 из 0» была бы выдумкой
# интерфейса, а не ответом панели.
out="$(STEER_SUB_INFO='' rpcd sub_set '{"url":"https://panel.invalid/sub/abc"}')"
check "молчание панели не оставляет прежних чисел" ";" \
      "$(printf '%s' "$out" | jget quota);$(rpcd sub_info | jget quota)"

# sub_quota — обновление остатка БЕЗ подмены подписки. Метод зовут при открытии обзора, и
# подменять там узлы нельзя: движку поэтому даётся только путь остатка, а не путь подписки.
out="$(STEER_SUB_INFO="$USERINFO" rpcd sub_set '{"url":"https://panel.invalid/sub/abc"}')"
sub_before="$(cat "$T/etc/sub.txt")"
rm -f "$T/subfetch.log" "$T/subquota.log" "$T/var/vless-dirty"
out="$(STEER_SUB_INFO="$USERINFO" rpcd sub_quota)"
check "остаток обновлён" "true;true;139458183168" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget asked);$(printf '%s' "$out" | jqget quota down)"
check "движок спрошен про остаток, а не про подписку" "no" \
      "$([ -f "$T/subfetch.log" ] && echo yes || echo no)"
check "и путь остатка ему назван" "https://panel.invalid/sub/abc $T/etc/sub.userinfo" \
      "$(tail -1 "$T/subquota.log")"
check "файл подписки не подменён" "$sub_before" "$(cat "$T/etc/sub.txt")"
check "клиента перечитывать не просят" "no" \
      "$([ -f "$T/var/vless-dirty" ] && echo yes || echo no)"

# Движок отказал — это не отказ метода: человек ничего не сделал не так, и красная ошибка на
# исправной настройке хуже честного «панель не сообщает остаток».
out="$(STEER_QUOTA_RC=1 rpcd sub_quota)"
check "отказ движка не делает метод отказом" "true;true" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget asked)"
check "и причина названа словами" "yes" \
      "$(printf '%s' "$out" | jget why | grep -q 'не сообщила остаток' && echo yes || echo no)"

# Узлы вставлены ссылками vless:// — спрашивать некого, и движок не зовётся вовсе: у ссылки
# нет панели, а значит и заголовков.
out="$(rpcd sub_set '{"url":"vless://key@host:443#node"}')"
rm -f "$T/subquota.log"
out="$(rpcd sub_quota)"
check "для ссылок vless:// остаток не выдумывается" "true;false;no" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget asked);$([ -f "$T/subquota.log" ] && echo yes || echo no)"
check "и сказано, почему" "yes" \
      "$(printf '%s' "$out" | jget why | grep -q 'сообщает панель' && echo yes || echo no)"

# Метод обязан быть объявлен и в перечне, и в ACL — иначе rpcd его не отдаст, а сборка
# splify2 упадёт на своей же проверке.
check "sub_quota объявлен в перечне методов" "yes" \
      "$(rpcd_list | grep -q '"sub_quota"' && echo yes || echo no)"
check "sub_quota разрешён в ACL" "yes" \
      "$(grep -q '"sub_quota"' "$ROOT/luci/root/usr/share/rpcd/acl.d/luci-app-splify2.json" && echo yes || echo no)"

# И обратное свойство: за СПИСКАМИ идентификатор устройства не уходит. Издателю списков
# незачем знать, какой у человека роутер, — это другой сервер и другая надобность.
rm -f "$T/curl.hdrs"
rpcd list_fetch '{"id":"news","kind":"prefixes"}' >/dev/null
check "за списками идентификатор устройства не уходит" "no" \
      "$([ -s "$T/curl.hdrs" ] && echo yes || echo no)"
printf '{"schema":1,"outputs":{},"channels":[]}\n' > "$T/etc/spec.json"
rm -f "$T/var/vless-dirty" "$T/var/obfs-dirty"

# ---- списки доскачиваются перед КАЖДОЙ проверкой спеки ----------------------------
# Движок умирает на отсутствующем файле списка, и делает это в ДВУХ местах: при
# `apply --dry-run` внутри spec_set (проверка до записи) и при настоящем apply. Пока
# доскачивание стояло только в apply, выбор нового сервиса не сохранялся вообще: автосохранение
# звало spec_set, dry-run падал с «cannot read a channel's list», правка откатывалась — и
# человек видел ошибку применения там, где ничего не применял. Проверяется поэтому не наличие
# загрузки, а её место: перед каждой проверкой.
check "доскачивание вынесено в общую функцию" "yes" \
      "$(rpcd_src | grep -q '^fetch_missing_lists()' && echo yes || echo no)"
# Мест стало три: к spec_set и apply добавилось восстановление из архива (backup_put) —
# оно тоже проверяет спеку компилятором, а на чистом роутере зеркал категорий ещё нет, и в
# архив они намеренно не едут. Проверка на число, а не на перечень имён: имена ниже.
check "функция вызывается трижды: spec_set, apply, backup_put" "3" \
      "$(rpcd_src | grep -c 'fetch_missing_lists "')"
# spec_set и apply живут в группе spec, восстановление — в группе backup.
set_line=$(grep -n 'set_warn="$(fetch_missing_lists' "$RPCD_DIR/m-spec.sh" | cut -d: -f1)
dry_line=$(grep -n 'engine_check "$tmp"' "$RPCD_DIR/m-spec.sh" | cut -d: -f1)
check "в spec_set загрузка идёт ДО проверки движком" "yes" \
      "$([ -n "$set_line" ] && [ -n "$dry_line" ] && [ "$set_line" -lt "$dry_line" ] && echo yes || echo no)"
# Порядок ищется ВНУТРИ ветки, а не по всему файлу: `fetch_warn=` встречается и в apply, и
# в backup_put, и общий `grep -n` отдал бы два номера строк, на которых `[` спотыкается о
# «Illegal number». Расхождение такого рода стенд однажды уже прятал.
apply_body="$(sed -n '/^    apply)/,/^        ;;/p' "$RPCD_DIR/m-spec.sh")"
apply_fetch=$(printf '%s\n' "$apply_body" | grep -n 'fetch_missing_lists' | head -1 | cut -d: -f1)
apply_run=$(printf '%s\n' "$apply_body" | grep -n 'apply --spec "$SPEC" 2>&1)"; rc=' | head -1 | cut -d: -f1)
check "в apply загрузка идёт ДО применения" "yes" \
      "$([ -n "$apply_fetch" ] && [ -n "$apply_run" ] && [ "$apply_fetch" -lt "$apply_run" ] && echo yes || echo no)"
put_body="$(sed -n '/^    backup_put)/,/^        ;;/p' "$RPCD_DIR/m-backup.sh")"
put_fetch=$(printf '%s\n' "$put_body" | grep -n 'fetch_missing_lists' | head -1 | cut -d: -f1)
put_dry=$(printf '%s\n' "$put_body" | grep -n 'apply --dry-run --spec "$D/spec"' | head -1 | cut -d: -f1)
check "в восстановлении загрузка идёт ДО проверки движком" "yes" \
      "$([ -n "$put_fetch" ] && [ -n "$put_dry" ] && [ "$put_fetch" -lt "$put_dry" ] && echo yes || echo no)"
# Сообщение об отказе обязано называть ПРИЧИНУ, а не только следствие: «cannot read a
# channel's list» отправляет искать испорченный файл, которого никогда не было.
check "при неудачной загрузке причина ставится перед ошибкой движка" "yes" \
      "$(rpcd_src | grep -q 'fail "${set_warn:+$set_warn; }' && echo yes || echo no)"

# ДОСКАЧИВАНИЕ ЗНАЕТ ПРО НАБОРЫ КАТАЛОГА. Качальщиков в продукте три — кнопка в каталоге,
# ночное обновление и вот это доскачивание перед проверкой спеки, — и научить надо было все
# три. Пока третий не знал про `format: "srs"`, «Применить» честно ходило по несуществующему
# адресу `base_url` плюс путь и сообщало, что список не скачался; снято с живого роутера:
# «raw.githubusercontent.com не ответил ни напрямую, ни через выход wg0» на файле
# itdoginfo/domains/geoblock.srs.lst.
cat > "$T/etc/manifest.json" <<'MF'
{
  "base_url": "https://example.invalid/lists",
  "categories": [
    { "id": "src:tg", "file": "cat/tg.srs.lst", "format": "srs",
      "url": "https://github.com/some/repo/releases/download/2026-01-01/tg.srs" }
  ],
  "domain_lists": [
    { "id": "svc_src_tg", "kind": "domains", "file": "cat/domains/tg.srs.lst", "format": "srs",
      "same_as_ip": ["src:tg"],
      "url": "https://github.com/some/repo/releases/download/2026-01-01/tg.srs" }
  ]
}
MF
rm -rf "$T/lists/cat"
: > "$T/curl.log"
cat > "$T/etc/spec.json" <<SPEC
{ "schema": 1, "outputs": {}, "channels": [
  { "name": "c", "out": "direct",
    "match": { "prefixes_files": ["$T/lists/cat/tg.srs.lst"],
               "domains_files":  ["$T/lists/cat/domains/tg.srs.lst"] } } ] }
SPEC
out="$(rpcd apply)"
check "набор каталога скачан по своей ссылке" "1" \
      "$(grep -c '/releases/download/2026-01-01/tg.srs$' "$T/curl.log")"
check "и по base_url за ним не ходили" "0" \
      "$(grep -c 'example.invalid/lists/cat' "$T/curl.log")"
check "подсети легли по своему пути" "203.0.113.0/24" \
      "$(cat "$T/lists/cat/tg.srs.lst" 2>/dev/null)"
check "домены — по своему" "srs-domain.example" \
      "$(cat "$T/lists/cat/domains/tg.srs.lst" 2>/dev/null)"
check "набор скачан ОДИН раз на обе половины" "1" \
      "$(grep -c '/tg.srs$' "$T/curl.log")"

# ---- R-005: архив настроек ----------------------------------------------------
# Бекапа и переноса настроек не было вовсе, а штатный архив системы настройки splify2 не
# содержит (I-037). Проверяются обе половины: ЧТО уезжает в архив (и чего в нём быть не
# должно) и разбор ПРИСЛАННОГО файла — недоверенного ввода.
#
# Отдельный вход: собрать запрос из документа. Экранирует его python — руками собирать JSON
# с переводами строк значило бы проверять своё экранирование, а не скрипт.
backup_req() {  # < ДОКУМЕНТ на stdin
    python3 -c 'import json,sys; print(json.dumps({"text": sys.stdin.read(), "append": False, "final": True}))'
}
backup_put() {  # < ДОКУМЕНТ на stdin
    rpcd backup_put "$(backup_req)"
}

# Значение поля БЕЗ добавленного перевода строки: куски архива склеиваются байт в байт, и
# лишний перевод строки на каждой границе испортил бы файл ровно так, как это незаметно.
jraw() {  # ПОЛЕ < JSON
    python3 -c 'import json,sys
d = json.load(sys.stdin)
v = d.get(sys.argv[1])
sys.stdout.write("" if v is None else v if isinstance(v, str) else str(v))' "$1"
}

# Прочитать архив целиком, склеивая куски. Число кусков пишется В ФАЙЛ, а не в переменную:
# функцию зовут через подстановку, то есть в подоболочке, откуда переменная не вернётся.
backup_doc() {
    off=0; n=0
    : > "$T/doc-all.txt"
    while [ "$n" -lt 64 ]; do
        r="$(rpcd backup_get "{\"offset\":$off}")"
        printf '%s' "$r" | jraw text >> "$T/doc-all.txt"
        n=$((n + 1))
        [ "$(printf '%s' "$r" | jget eof)" = true ] && break
        nxt="$(printf '%s' "$r" | jget next)"
        [ "$nxt" -gt "$off" ] || break
        off="$nxt"
    done
    printf '%s' "$n" > "$T/doc-parts"
    cat "$T/doc-all.txt"
}

# Фикстуры этого раздела ставятся с нуля: свои списки выше оставили после себя в том числе
# «grow» размером под мегабайт, и проверять на нём состав архива значило бы проверять
# последствия чужой проверки.
rm -rf "$T/lists/custom"
mkdir -p "$(dirname "$(custom_domains_path x)")" "$(dirname "$(custom_prefixes_path x)")"
printf '10.9.0.0/16\n' > "$(custom_prefixes_path mine-a)"
printf 'own.example\n' > "$(custom_domains_path mine-d)"
printf 'vless://k@h:443#node\n' > "$T/etc/sub.txt"
# Свой список, который заведомо не влезает в один кусок ubus: без него протокол смещений
# проверялся бы на архиве, приезжающем целиком, то есть не проверялся бы вовсе.
awk 'BEGIN { for (i = 0; i < 1200; i++) printf "host%d.example\n", i }' > "$(custom_domains_path mine-big)"
# Ключи туннелей, стратегии обхода и вторая подписка. Ровно то, чего в архиве не было и без
# чего восстановленный роутер не работает: приватный ключ пира xsteer взять больше негде
# (панель его не печатает, а сгенерировать заново — это уже другой пир), стратегия обхода
# выбрана человеком опытом, а вторая подписка живёт своим файлом со своим остатком.
#
# XSTEER_DIR экспортируется, а не стоит в общем списке швов у rpcd(): список общий для всех
# разделов стенда, а этот каталог нужен одному — архиву.
export XSTEER_DIR="$T/etc/steer-xsteer"
mkdir -p "$XSTEER_DIR" "$T/etc/steer-zapret" "$T/etc/subs"
# Стратегия обхода лежит на диске (её мог поставить прежний выпуск), но в архив больше не
# едет: обход DPI из splify2 убран, и файл принадлежит тому, кто его положил.
printf '%s\n' '[Interface]' \
  'PrivateKey = 6Gtidge6FqhO/0LhrAWpRiyYaKdLZF/gib/HePLC9GU=' \
  'Address = 10.77.0.5/24' 'SNI = www.microsoft.com' '' '[Peer]' \
  'PublicKey = QYkH5bWOsEOCgIMldHPATSG7yvNyJ8st7o/HMelWKxs=' \
  'Endpoint = 198.51.100.9:8443' 'AllowedIPs = 10.77.0.0/24, 192.168.9.0/24' \
  > "$XSTEER_DIR/home.conf"
printf '%s\n' '#v1' '--filter-tcp=443' '--dpi-desync=fake,split2' > "$T/etc/steer-zapret/yt.opts"
printf 'vless://k2@h2:443#second\n' > "$T/etc/subs/work.txt"
# Выбор у групп «вручную» — файл ядра рядом со спекой. Чужая строка в нём в архив не едет:
# разборщик восстановления отверг бы из-за неё архив целиком.
printf '%s\n' 'eu wg1' 'мусор; reboot' > "$T/etc/select"
uci_set splify2.sub_work subscription
uci_set splify2.sub_work.url 'https://panel.example.net/sub/2'
uci_set splify2.sub_work.kind url
# Все восемь полей, а не три: перечень получается тем же способом, каким его находят в
# коде, — `grep -rhoE 'splify2\.(main|sub_[a-z_]*)\.[a-z_]+' files/`.
for _kv in 'sub_url=https://panel.example.net/sub/1' 'sub_kind=url' 'wizard=step3' \
           'sub_title=Моя панель' 'manifest_url=https://example.net/categories.json' \
           'fetch_via_tunnel=always' 'list_shrink_factor=4' 'geo_url=https://example.net/trace'; do
    uci_set "splify2.main.${_kv%%=*}" "${_kv#*=}"
done

# АРХИВ НАСТРОЕК С ПРИВАТНЫМИ КЛЮЧАМИ СОБИРАЕТСЯ ЗАКРЫТЫМ, ДАЖЕ ЕСЛИ ФАЙЛ ПОДЛОЖИЛИ. umask действует
# только при создании: чужой процесс, создавший /tmp/splify2-backup.out заранее с правами 0644,
# читал архив (ключи xsteer, ссылки vless с ключами) весь срок выгрузки, а fs.protected_regular на
# роутере выключен. Файл обязан пересоздаваться и после сборки иметь наши права.
rm -f "$T/var/backup.out"; : > "$T/var/backup.out"; chmod 644 "$T/var/backup.out"
out="$(rpcd backup_get '{"offset":0}')"
check "архив: подложенный открытый файл пересоздан закрытым" "600" "$(stat -c %a "$T/var/backup.out" 2>/dev/null)"
rm -f "$T/var/backup.out"

doc="$(backup_doc)"
check "архив приезжает несколькими кусками и склеивается" "yes" \
      "$([ "$(cat "$T/doc-parts")" -gt 1 ] && echo yes || echo no)"
check "склеенный архив не потерял ни строки на границах кусков" "1200" \
      "$(printf '%s\n' "$doc" | grep -c '^host[0-9]*\.example$')"
check "архив начинается своим заголовком с версией" "splify2-backup 3" \
      "$(printf '%s\n' "$doc" | head -1)"
check "в архиве есть спека, подписка и оба своих списка" "yes" \
      "$(printf '%s\n' "$doc" | grep -q '^\[spec\]$' &&
         printf '%s\n' "$doc" | grep -q '^\[sub\]$' &&
         printf '%s\n' "$doc" | grep -q '^\[list prefixes mine-a\]$' &&
         printf '%s\n' "$doc" | grep -q '^\[list domains mine-d\]$' && echo yes || echo no)"
# Главное свойство экспорта: 284 КБ зеркал категорий издателя в него не едут. Проверяется не
# размер, а состав — списка издателя нет ни заголовком, ни содержимым.
check "зеркал категорий издателя в архиве нет (284 КБ, I-037)" "no" \
      "$(printf '%s\n' "$doc" | grep -qE '^(\[list (prefixes|domains) news\]|10\.0\.0\.0/8|example\.org)$' && echo yes || echo no)"
check "выбор у групп «вручную» уезжает в архив, чужая строка — нет" "yes;no" \
      "$(printf '%s\n' "$doc" | grep -q '^\[select\]$' && printf '%s\n' "$doc" | grep -qx 'eu wg1' && echo yes || echo no);$(printf '%s\n' "$doc" | grep -q 'reboot' && echo yes || echo no)"
check "в архиве есть и большой свой список, и оба маленьких" "yes" \
      "$(printf '%s\n' "$doc" | grep -q '^\[list domains mine-big\]$' && echo yes || echo no)"

# Приватный ключ пира — то, без чего восстановленный роутер туннель не поднимает вовсе.
# Содержимое едет ДОСЛОВНО, вместе со своими строками в квадратных скобках: файл читает
# движок и читает строго, а пересобирать его здесь значило бы завести вторую реализацию
# формата WireGuard.
check "ключи xsteer уезжают в архив дословно" "yes" \
      "$(printf '%s\n' "$doc" | grep -q '^\[xsteer home\]$' &&
         printf '%s\n' "$doc" | grep -q '^\[Interface\]$' &&
         printf '%s\n' "$doc" | grep -q '^PrivateKey = 6Gtidge6' && echo yes || echo no)"
check "стратегии обхода DPI в архив больше не уезжают" "no" \
      "$(printf '%s\n' "$doc" | grep -q '^\[zapret ' && echo yes || echo no)"
# Вторая подписка — это файл И ссылка на панель: без ссылки восстановленную подписку нечем
# обновить, то есть она приезжает мёртвой.
check "именованная подписка уезжает и файлом, и ссылкой" "yes" \
      "$(printf '%s\n' "$doc" | grep -q '^\[sub work\]$' &&
         printf '%s\n' "$doc" | grep -qx 'sub_work.url=https://panel.example.net/sub/2' &&
         printf '%s\n' "$doc" | grep -qx 'sub_work.kind=url' && echo yes || echo no)"
check "в архив уезжают все восемь полей uci, а не три" "8" \
      "$(printf '%s\n' "$doc" | grep -cE '^(sub_url|sub_kind|wizard|sub_title|manifest_url|fetch_via_tunnel|list_shrink_factor|geo_url)=')"
# Шапка архива предупреждала про ссылки vless://. С приватными ключами туннелей это верно
# сильнее, и сказать об этом обязана сама шапка: файл человек уносит на флешке и в переписке.
check "шапка предупреждает и о приватных ключах" "yes" \
      "$(printf '%s\n' "$doc" | sed -n '1,10p' | grep -q 'приватные ключи' && echo yes || echo no)"

# OpenWrt 25.12 по умолчанию собирает busybox БЕЗ stat («stat: not found» на QEMU-стенде
# 25.12.5): проверка владельца и прав через stat отвечала «чужой», и архив не выгружался и не
# восстанавливался вовсе — «архив собрался с чужими правами». Заглушка stat здесь — такой
# роутер: команды нет.
printf '#!/bin/sh\necho "sh: stat: not found" >&2\nexit 127\n' > "$T/bin/stat"; chmod +x "$T/bin/stat"
out="$(rpcd backup_get '{"offset":0}')"
check "архив выгружается и без stat (busybox OpenWrt 25.12)" "true" "$(printf '%s' "$out" | jget ok)"
rm -f "$T/var/backup.out"
out="$(printf '%s\n' 'splify2-backup 3' '[select]' 'eu wg1' | backup_put)"
check "архив восстанавливается и без stat" "true" "$(printf '%s' "$out" | jget ok)"
rm -f "$T/bin/stat"
: > "$T/var/backup.out"; chmod 644 "$T/var/backup.out"
out="$(rpcd backup_get '{"offset":0}')"
check "подложенный открытый файл и без stat пересоздаётся закрытым" "600" \
      "$(stat -c %a "$T/var/backup.out" 2>/dev/null)"
rm -f "$T/var/backup.out"

# Экспорт не отдаёт файл, который его же импорт откажется принять: иначе человек узнал бы
# об этом в тот день, когда бекап понадобился.
out="$(BACKUP_MAX_BYTES=1024 rpcd backup_get '{"offset":0}')"
check "слишком большой архив не отдаётся, а объясняется" "yes" \
      "$(printf '%s' "$out" | jget error | grep -q 'не влезают в архив' && echo yes || echo no)"

# ---- разбор недоверенного файла -----------------------------------------------
# Каждая проверка ниже — про отказ, и про отказ ДО записи на диск. Импорт делает spec.json
# источником, которого не касался root (I-003), поэтому «принять, а посмотреть потом» здесь
# не годится: спека уезжает в командные строки и движка, и этого самого скрипта.
out="$(printf 'просто текст\n' | backup_put)"
check "чужой файл не принимается" "false" "$(printf '%s' "$out" | jget ok)"
check "причина отказа названа словами" "yes" \
      "$(printf '%s' "$out" | jget error | grep -q 'не файл настроек' && echo yes || echo no)"

out="$(printf '%s\n' 'splify2-backup 1' '[evil]' 'x' | backup_put)"
check "непонятный раздел отвергает файл целиком" "false" "$(printf '%s' "$out" | jget ok)"

out="$(printf '%s\n' 'splify2-backup 9' '[options]' 'sub_kind=none' | backup_put)"
check "архив чужой версии не разбирается наугад" "false" "$(printf '%s' "$out" | jget ok)"

out="$(printf '%s\n' 'splify2-backup 1' 'строка вне раздела' | backup_put)"
check "строка вне раздела отвергается" "false" "$(printf '%s' "$out" | jget ok)"

# Путь за пределы каталогов настроек. Спека несёт пути к файлам списков и к файлу подписки,
# то есть присланный файл может попросить движок читать что угодно.
out="$(printf '%s\n' 'splify2-backup 1' '[spec]' \
  '{"schema":1,"outputs":{},"channels":[{"name":"c","out":"direct","match":{"prefixes_files":["/etc/shadow"]}}]}' |
  backup_put)"
check "список вне каталога списков отвергается" "yes" \
      "$(printf '%s' "$out" | jget error | grep -q 'вне каталога' && echo yes || echo no)"

out="$(printf '%s\n' 'splify2-backup 1' '[spec]' \
  '{"schema":1,"outputs":{},"channels":[{"name":"c","out":"direct","match":{"domains_file":"/etc/steer/lists/../../shadow"}}]}' |
  backup_put)"
check "путь с .. отвергается и в коротком написании поля" "false" "$(printf '%s' "$out" | jget ok)"

out="$(printf '%s\n' 'splify2-backup 1' '[spec]' \
  '{"schema":1,"outputs":{"vpn":{"kind":"vless","sub_file":"/etc/passwd"}},"channels":[]}' | backup_put)"
check "файл подписки вне каталогов настроек отвергается" "false" "$(printf '%s' "$out" | jget ok)"

# I-003: движок подставляет lan_device в popen("ip -4 -o addr show ...") без фильтрации. Пока
# спеку писал только root, это была теоретическая слабость; принятый файл делает её входом.
out="$(printf '%s\n' 'splify2-backup 1' '[spec]' \
  '{"schema":1,"lan_device":"br-lan; reboot","outputs":{},"channels":[]}' | backup_put)"
check "lan_device с метасимволами отвергается (I-003)" "yes" \
      "$(printf '%s' "$out" | jget error | grep -q 'lan_device' && echo yes || echo no)"

# Та же слабость через МНОЖЕСТВЕННУЮ форму (splify2#16). Проверка по одному ключу
# `lan_device` мимо `lan_devices` — это дыра ровно того вида, ради которой её и писали:
# поле в спеке новое, проверка старая, и недоверенный архив снова проезжает.
out="$(printf '%s\n' 'splify2-backup 1' '[spec]' \
  '{"schema":1,"lan_devices":["br-lan","tailscale0; reboot"],"outputs":{},"channels":[]}' | backup_put)"
check "lan_devices с метасимволами отвергается (splify2#16)" "yes" \
      "$(printf '%s' "$out" | jget error | grep -q 'lan_device' && echo yes || echo no)"

out="$(printf '%s\n' 'splify2-backup 1' '[spec]' \
  '{"schema":1,"lan_devices":["br-lan","tailscale0"],"outputs":{"direct":{"kind":"direct"}},"channels":[]}' | backup_put)"
check "годный перечень устройств принимается" "true" "$(printf '%s' "$out" | jget ok)"

# Имя выхода уезжает в командную строку этого же скрипта: `ubus call service signal
# {"instance":"vless_$o"}` и ensure_vless_zone.
out="$(printf '%s\n' 'splify2-backup 1' '[spec]' \
  '{"schema":1,"outputs":{"vpn; reboot":{"kind":"direct"}},"channels":[]}' | backup_put)"
check "имя выхода с метасимволами отвергается" "false" "$(printf '%s' "$out" | jget ok)"

out="$(printf '%s\n' 'splify2-backup 1' '[spec]' \
  '{"schema":1,"outputs":{},"channels":[{"name":"a\nb","out":"direct","match":{"any":true}}]}' | backup_put)"
check "экранированный перевод строки в спеке отвергается" "false" "$(printf '%s' "$out" | jget ok)"

out="$(printf '%s\n' 'splify2-backup 1' '[sub]' 'http://example.org/list' | backup_put)"
check "подписка не из vless:// и не base64 отвергается" "false" "$(printf '%s' "$out" | jget ok)"
# Ссылки прокси steer-proxy в архиве — законная подписка (их кладёт sub_set), в том числе прокси
# http(s):// «адрес:порт»; адрес панели (http://… без порта) — по-прежнему нет. Проверка до
# спеки: архив с одной подпиской проверяется и отвергается ДО записи, значит проверка формы —
# по ответу: «подписка: ждём …» есть или нет.
out="$(printf '%s\n' 'splify2-backup 1' '[sub]' 'trojan://p@h:443#t' 'ss://YWVzLTEyOC1nY206cA@h:8388#s' 'http://u:p@h:3128#ht' 'https://h:443?sni=x#hs' 'vmess://eyJhZGQiOiJoIn0=' | backup_put)"
check "подписка из ссылок прокси в архиве принимается" "no" \
      "$(printf '%s' "$out" | jget error | grep -q 'подписка: ждём' && echo yes || echo no)"

out="$(printf '%s\n' 'splify2-backup 1' '[options]' 'sub_url=https://x/$(reboot)' | backup_put)"
check "ссылка подписки с подстановкой отвергается" "false" "$(printf '%s' "$out" | jget ok)"

out="$(printf '%s\n' 'splify2-backup 1' '[options]' 'root_password=x' | backup_put)"
check "неизвестное поле настроек отвергается" "yes" \
      "$(printf '%s' "$out" | jget error | grep -q 'непонятная настройка' && echo yes || echo no)"

# Управляющий байт внутри строки: ровно то, чем можно спрятать строку от построчного
# разборщика. Собирается python-ом, потому что в тексте стенда его быть не должно.
req="$(python3 -c 'import json; print(json.dumps({"text":"splify2-backup 1\n[sub]\nvless://" + chr(1) + "\n","append":False,"final":True}))')"
out="$(rpcd backup_put "$req")"
check "двоичные данные в архиве отвергаются" "yes" \
      "$(printf '%s' "$out" | jget error | grep -q 'двоичные' && echo yes || echo no)"

# Предел считается по НАКОПЛЕННОМУ, а не по куску: иначе он обходится двадцатью кусками по
# пределу каждый (ровно эта ошибка уже была в list_put). Предел на время проверки уменьшается
# швом — иначе фикстурой была бы четверть мегабайта текста.
req="$(python3 -c 'import json; print(json.dumps({"text":"splify2-backup 1\n","append":False,"final":False}))')"
out="$(BACKUP_MAX_BYTES=40 rpcd backup_put "$req")"
check "первый кусок в пределах предела принимается" "true" "$(printf '%s' "$out" | jget ok)"
# I-085, первая половина. Метод rpcd отвечает СТАНДАРТНЫМ ВЫВОДОМ, поэтому лишняя строка рядом
# с ответом — не косметика: она уезжает в журнал rpcd, а на части сборок и клиенту, который
# ждёт JSON. Накопитель на первом куске ещё не существует, и раньше именно здесь оболочка
# жаловалась вслух: `wc -c < файл 2>/dev/null` разбирает перенаправление ДО того, как stderr
# уедет в /dev/null, — значит жалобу печатает оболочка, а не `wc`.
check "отсутствующий накопитель не заставляет оболочку говорить вслух" "" \
      "$(grep -i 'cannot open\|can.t open\|No such file' "$T/stderr" 2>/dev/null | head -1)"
req="$(python3 -c 'import json; print(json.dumps({"text":"[options]\nsub_kind=none\n","append":True,"final":True}))')"
out="$(BACKUP_MAX_BYTES=40 rpcd backup_put "$req")"
check "предел считается по накопленному, а не по куску" "yes" \
      "$(printf '%s' "$out" | jget error | grep -q 'больше' && echo yes || echo no)"

# ---- годный архив восстанавливается -------------------------------------------
rm -f "$T/var/backup.in" "$T/etc/spec.applied.json" "$T/var/vless-dirty"
: > "$T/steer.log"
printf '{"schema":1,"outputs":{},"channels":[]}\n' > "$T/etc/spec.json"
out="$(printf '%s\n' \
  'splify2-backup 1' \
  '# комментарий' \
  '[spec]' \
  '{"schema":1,"lan_device":"br-lan","outputs":{"direct":{"kind":"direct"}},"channels":[]}' \
  '[sub]' \
  'vless://key@host:443#node' \
  '[list domains mine-d]' \
  'Example.ORG' \
  'это не домен вовсе' \
  '[list prefixes mine-a]' \
  '10.9.0.0/16' \
  '10.9.0.256' \
  '[options]' \
  'sub_kind=links' | backup_put)"
check "годный архив принимается" "true" "$(printf '%s' "$out" | jget ok)"
check "спека из архива легла на место" "yes" \
      "$(grep -q 'br-lan' "$T/etc/spec.json" && echo yes || echo no)"
check "подписка из архива легла на место" "yes" \
      "$(grep -q '^vless://key@host:443#node$' "$T/etc/sub.txt" && echo yes || echo no)"
# Списки проходят ТЕМ ЖЕ санитайзером, что и list_put: домен приводится к нижнему регистру,
# негодные строки отбрасываются и считаются числом.
check "свой доменный список восстановлен и приведён к нижнему регистру" "example.org" \
      "$(cat "$(custom_domains_path mine-d)")"
check "негодные строки списков отброшены и сосчитаны" "2" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; print(sum(l["dropped"] for l in json.load(sys.stdin)["lists"]))')"
# Главное свойство импорта: он НЕ применяет. Компилятор спрашивается (--dry-run), применение
# остаётся за человеком — модель проекта «сохранено ≠ применено».
check "спека проверена компилятором" "1" "$(grep -c 'apply --dry-run' "$T/steer.log")"
check "восстановление ничего не применяет" "0" "$(grep -c 'apply --spec' "$T/steer.log")"
# Без снимка применённого пилюля «Применить · N» показала бы ноль: applied_get в его
# отсутствие отдаёт саму спеку, то есть восстановленное выглядело бы применённым.
check "снимок применённого снят с ПРЕЖНЕЙ спеки" "yes" \
      "$([ -s "$T/etc/spec.applied.json" ] && ! grep -q 'br-lan' "$T/etc/spec.applied.json" && echo yes || echo no)"
check "накопленный файл убран за собой" "no" \
      "$([ -f "$T/var/backup.in" ] && echo yes || echo no)"
# Заголовок у архива выше — намеренно ПРЕЖНЕЙ версии: у людей уже лежат файлы, собранные
# до появления ключей и стратегий, и обновление пакета не имеет права превратить их в
# нечитаемые. Проверка отдельной строкой, чтобы отказ читался как «сломали старые архивы»,
# а не как «сломалось восстановление вообще».
check "архив прежнего формата (1) по-прежнему принимается" "true" "$(printf '%s' "$out" | jget ok)"

# ---- формат 2: ключи туннелей, стратегии обхода и именованные подписки ------------
# Проверяется методом целиком: присланный архив → файлы на диске и поля в uci. Каталоги
# перед этим сносятся, иначе «восстановлено» было бы не отличить от «лежало и раньше».
rm -f "$T/var/backup.in"
rm -rf "$XSTEER_DIR" "$T/etc/steer-zapret" "$T/etc/subs"
: > "$T/uci.store"
: > "$T/steer.log"
out="$(printf '%s\n' \
  'splify2-backup 2' \
  '[spec]' \
  '{"schema":1,"outputs":{},"channels":[]}' \
  '[xsteer home]' \
  '[Interface]' \
  'PrivateKey = 6Gtidge6FqhO/0LhrAWpRiyYaKdLZF/gib/HePLC9GU=' \
  'Address = 10.77.0.5/24' \
  '' \
  '[Peer]' \
  'PublicKey = QYkH5bWOsEOCgIMldHPATSG7yvNyJ8st7o/HMelWKxs=' \
  'Endpoint = 198.51.100.9:8443' \
  '[zapret yt]' \
  '#v1' \
  '--filter-tcp=443' \
  '[sub work]' \
  'vless://k2@h2:443#second' \
  '[options]' \
  'sub_title=Моя панель' \
  'zm_fix=0' \
  'list_shrink_factor=4' \
  'geo_url=https://example.net/trace' \
  'sub_work.url=https://panel.example.net/sub/2' \
  'sub_work.kind=url' | backup_put)"
check "архив нового формата принимается" "true" "$(printf '%s' "$out" | jget ok)"
check "приватный ключ туннеля лёг на место дословно" "yes" \
      "$(grep -qx 'PrivateKey = 6Gtidge6FqhO/0LhrAWpRiyYaKdLZF/gib/HePLC9GU=' "$XSTEER_DIR/home.conf" &&
         grep -qx '\[Peer\]' "$XSTEER_DIR/home.conf" && echo yes || echo no)"
# Файл с приватным ключом не читается всеми: он попадает в каталог, который движок держит
# закрытым, и восстановление не имеет права раскрыть его шире, чем создало бы само.
check "восстановленный ключ закрыт от чужих глаз" "600" \
      "$(stat -c %a "$XSTEER_DIR/home.conf" 2>/dev/null)"
check "раздел стратегии обхода из старого архива принят и не восстановлен" "no" \
      "$([ -e "$T/etc/steer-zapret/yt.opts" ] && echo yes || echo no)"
check "именованная подписка легла своим файлом" "yes" \
      "$(grep -qx 'vless://k2@h2:443#second' "$T/etc/subs/work.txt" && echo yes || echo no)"
check "ссылка именованной подписки легла в свою секцию uci" "https://panel.example.net/sub/2;url;subscription" \
      "$(uci_get splify2.sub_work.url);$(uci_get splify2.sub_work.kind);$(uci_get splify2.sub_work)"
check "остальные поля uci восстановлены, а не только три прежних; поле фикса Zapret Manager отброшено" "Моя панель;;4;https://example.net/trace" \
      "$(uci_get splify2.main.sub_title);$(uci_get splify2.main.zm_fix);$(uci_get splify2.main.list_shrink_factor);$(uci_get splify2.main.geo_url)"
check "в ответе сказано, что именно восстановлено" "1;1" \
      "$(printf '%s' "$out" | jget xsteer);$(printf '%s' "$out" | jget subs)"

# ---- формат 3: выбор у групп «вручную» ------------------------------------------------
# Без него восстановленная группа pick: manual вела бы трафик через член по умолчанию, а не
# через тот, что выбрал человек. Ложится файлом `select` рядом со спекой — там его ищет ядро.
rm -f "$T/etc/select"
out="$(printf '%s\n' 'splify2-backup 3' '[select]' 'eu wg1' 'fast.pool nl-2' | backup_put)"
check "выбор у групп восстановлен рядом со спекой" "true;eu wg1|fast.pool nl-2|" \
      "$(printf '%s' "$out" | jget select);$(tr '\n' '|' < "$T/etc/select" 2>/dev/null)"
out="$(printf '%s\n' 'splify2-backup 3' '[select]' 'eu wg1; reboot' | backup_put)"
check "чужая строка в выборе у групп отвергает файл" "false;eu wg1|fast.pool nl-2|" \
      "$(printf '%s' "$out" | jget ok);$(tr '\n' '|' < "$T/etc/select" 2>/dev/null)"

# Выход, ссылающийся на ИМЕНОВАННУЮ подписку, отвергался проверкой путей: она знала только
# /etc/steer/sub.txt и каталог списков. То есть архив роутера с двумя подписками нельзя было
# вернуть на этот же роутер — а именно за этим архив и нужен.
out="$(printf '%s\n' 'splify2-backup 2' '[spec]' \
  "{\"schema\":1,\"outputs\":{\"vpn\":{\"kind\":\"vless\",\"sub_file\":\"$T/etc/subs/work.txt\"}},\"channels\":[]}" |
  backup_put)"
check "выход на именованную подписку не считается путём наружу" "true" "$(printf '%s' "$out" | jget ok)"

# Дальше — отказы. Каталог с ключами попадает в руки root: его читает движок. Принять туда
# что угодно из присланного файла нельзя.
out="$(printf '%s\n' 'splify2-backup 2' '[xsteer home]' '[Interface]' 'PrivateKey = k' \
  'ключ = значение; reboot' | backup_put)"
check "чужая строка в настройке туннеля отвергает файл" "yes" \
      "$(printf '%s' "$out" | jget error | grep -q 'туннел' && echo yes || echo no)"

out="$(printf '%s\n' 'splify2-backup 2' '[xsteer home]' '[Interface]' 'Address = 10.77.0.5/24' | backup_put)"
check "настройка туннеля без приватного ключа отвергается" "false" "$(printf '%s' "$out" | jget ok)"

out="$(printf '%s\n' 'splify2-backup 2' '[options]' 'geo_url=https://x/$(reboot)' | backup_put)"
check "подстановка в адресе измерителя отвергается" "false" "$(printf '%s' "$out" | jget ok)"

out="$(printf '%s\n' 'splify2-backup 2' '[options]' 'fetch_via_tunnel=да' | backup_put)"
check "нечисловое значение выключателя отвергается" "false" "$(printf '%s' "$out" | jget ok)"

out="$(printf '%s\n' 'splify2-backup 2' '[sub work]' 'http://example.org/list' | backup_put)"
check "именованная подписка не из vless:// отвергается" "false" "$(printf '%s' "$out" | jget ok)"

# Раздел стратегии обхода из архива прежнего выпуска сам по себе ничего не восстанавливает:
# в архиве больше нечего принимать, и отказ говорит об этом словами.
out="$(printf '%s\n' 'splify2-backup 2' '[zapret yt]' | backup_put)"
check "архив только со стратегией обхода не годится" "false" "$(printf '%s' "$out" | jget ok)"

# Восстановление продолжается там, где остановились: следующие проверки этого раздела ждут
# спеку и подписку на месте.
printf '{"schema":1,"outputs":{},"channels":[]}\n' > "$T/etc/spec.json"

# Отказ компилятора не выдаётся за успех, и в ответе сказано, что списки уже восстановлены:
# порядок записи (списки и подписка раньше спеки) продиктован тем, что движок читает их при
# dry-run, и умалчивать об этом было бы нечестно.
: > "$T/steer.log"
printf '%s\n' 'splify2-backup 1' '[spec]' '{"schema":1,"outputs":{},"channels":[]}' > "$T/doc.txt"
out="$(STEER_RC=1 STEER_ERR='cannot read a channel list' rpcd backup_put "$(backup_req < "$T/doc.txt")")"
check "отказ компилятора не выдаётся за восстановление" "false" "$(printf '%s' "$out" | jget ok)"
check "в отказе сказано, что списки и подписка уже восстановлены" "yes" \
      "$(printf '%s' "$out" | jget error | grep -q 'уже восстановлены' && echo yes || echo no)"

# Архив, собранный экспортом, обязан приниматься импортом. Круг замкнут: разойдись эти два
# конца — бекап остался бы файлом, который некуда вернуть.
: > "$T/steer.log"
backup_doc > "$T/roundtrip.txt"
out="$(rpcd backup_put "$(backup_req < "$T/roundtrip.txt")")"
check "свой же архив принимается обратно (круг замкнут)" "true" "$(printf '%s' "$out" | jget ok)"

# ---- бэкенд знает оба менеджера пакетов ------------------------------------------
# Установщик ставит .ipk через opkg на OpenWrt 23.05, и бэкенд обязан уметь то же:
# иначе карточка движка показывает пустую версию, а «Установить» возвращает пустую
# ошибку (apk нет, rc 127, вывод пуст).
check "бэкенд определяет менеджер пакетов" "yes" \
      "$(grep -q 'elif command -v opkg' "$SCRIPT" && echo yes || echo no)"
check "версия пакета читается обоими способами" "yes" \
      "$(rpcd_src | grep -q 'opkg list-installed' && echo yes || echo no)"
pkg_src="$(grep -l '^pkg_install()' $RPCD_ALL | head -1)"
check "установка идёт через обёртку, а не через apk напрямую" "0" \
      "$(sed -n '/^pkg_install()/,$p' "$pkg_src" | grep -c 'apk add\|apk del')"
check "имена файлов пакетов зависят от менеджера" "yes" \
      "$(rpcd_src | grep -q 'pkg_ext)' && rpcd_src | grep -q 'pkg_noarch)' && echo yes || echo no)"

# ---- заголовки об устройстве чистит ДВИЖОК ---------------------------------------
#
# Раньше здесь стояла проверка под busybox: `tr -cd '[:print:]'` у coreutils работает, а у
# busybox НЕТ — он классов не знает и разбирает их как обычный набор символов, из-за чего
# «TP-Link Archer C6U v1» уезжал в панель строкой «inrr». Проверка на машине разработчика
# этого не видела: на GNU tr обе строки проходят целиком.
#
# Теперь чистка живёт в C (steer/src/ext/subfetch.c, hdr_clean) и проверяется в
# steer/tests/subfetchmatch.c, где этой ловушки нет по построению — байты сравниваются
# напрямую, а не через чужую реализацию `tr`. Здесь остаётся убедиться, что своей чистки в
# объекте не осталось: вторая реализация вернула бы и ловушку.
check "чистки заголовков в объекте больше нет" "0" "$(grep -c '^hdr_clean()' "$SCRIPT")"
check "и заголовков устройства объект не собирает" "0" \
      "$(grep -c 'x-device-model\|x-ver-os' "$SCRIPT")"

# ---- откуда качать списки и обновления (splify2#15) --------------------------------
# Обход по хостам самого GitHub спасает установку, но списки решает не лучшим образом:
# contents API — лишний запрос, а при исчерпанном лимите приезжает архив ветки целиком ради
# одного файла. Поэтому у человека есть выбор: ходить сразу через туннель. Здесь проверяется
# не карточка, а её опора — что выбор доезжает до uci тем значением, которое понимает
# скачивание, и что мусор отвергается ДО записи.
#
# uci на время этих проверок настоящий (файловый): общая заглушка отвечает отказом на всё, и
# на ней круг «записал — прочитал» проверить нечем.
cp "$T/bin/uci" "$T/bin/uci.stub"
cat > "$T/bin/uci" <<'STUB'
#!/bin/sh
# Ровно то, чем пользуется скрипт: get/set/delete/commit по ключу вида a.b.c.
store="$SANDBOX/uci.store"
[ -f "$store" ] || : > "$store"
q=0; [ "${1:-}" = "-q" ] && { q=1; shift; }
cmd="${1:-}"; arg="${2:-}"
case "$cmd" in
    get)
        v="$(grep "^$arg=" "$store" | tail -1)"
        [ -n "$v" ] || exit 1
        printf '%s\n' "${v#*=}"
        ;;
    set)
        key="${arg%%=*}"; val="${arg#*=}"
        [ "$key" = "$val" ] && val=""
        grep -v "^$key=" "$store" > "$store.new" 2>/dev/null || : > "$store.new"
        printf '%s=%s\n' "$key" "$val" >> "$store.new"
        mv "$store.new" "$store"
        ;;
    delete)
        grep -v "^$arg=" "$store" > "$store.new" 2>/dev/null || : > "$store.new"
        mv "$store.new" "$store"
        ;;
    commit) ;;
    *) exit 1 ;;
esac
exit 0
STUB
chmod +x "$T/bin/uci"
rm -f "$T/uci.store"

out="$(rpcd fetch_mode)"
check "по умолчанию туннель не трогается" "off" "$(printf '%s' "$out" | jget mode)"
check "имя выхода отдаётся полем, даже когда его нет" "" "$(printf '%s' "$out" | jget out)"

out="$(rpcd fetch_mode_set '{"mode":"always"}')"
check "выбор принят" "true;always" \
      "$(printf '%s' "$out" | jget ok);$(printf '%s' "$out" | jget mode)"
check "и записан именно тем значением, которое читает скачивание" "always" \
      "$(grep '^splify2.main.fetch_via_tunnel=' "$T/uci.store" | tail -1 | cut -d= -f2)"
check "прочитан обратно" "always" "$(rpcd fetch_mode | jget mode)"

out="$(rpcd fetch_mode_set '{"mode":"через туннель"}')"
check "чужое значение отвергается" "false" "$(printf '%s' "$out" | jget ok)"
check "в отказе названы допустимые" "yes" \
      "$(printf '%s' "$out" | jget error | grep -q 'always или off' && echo yes || echo no)"
check "и в uci ничего не изменилось" "always" \
      "$(grep '^splify2.main.fetch_via_tunnel=' "$T/uci.store" | tail -1 | cut -d= -f2)"

out="$(rpcd fetch_mode_set '{"mode":"off"}')"
check "выключается обратно" "off" "$(rpcd fetch_mode | jget mode)"

# Копией, а не переносом. Ниже по файлу общая заглушка восстанавливается ещё дважды
# (`cp "$T/bin/uci.stub" ...`), и перенос уносил образец — восстановление молча падало в
# запасную ветку «uci отвечает отказом на всё». Проверки, писавшие после этого в uci, шли
# против команды, которая не умеет ничего: зелёными они были не по существу.
cp "$T/bin/uci.stub" "$T/bin/uci"

mkdir -p "$T/etc"

# ЧУЖАЯ ПРИСТАВКА В id — ЭТО ДРУГОЙ ИСТОЧНИК, А НЕ ОШИБКА. Каталог списков даёт своим
# записям приставку («itdoginfo:telegram»), и такой id обязан дойти до манифеста. Пока ветка
# зашитого издателя отвечала на любую чужую приставку отказом, каталог показывал список, а
# «Загрузить» говорило «неизвестный источник» — поймано на живом роутере.
printf '{"base_url":"https://example.invalid/l","categories":[{"id":"other:x","file":"other/x.lst"}],"domain_lists":[]}\n' \
    > "$T/etc/manifest.json"
out="$(rpcd list_fetch '{"id":"other:x","kind":"prefixes"}')"
check "чужая приставка не отвергается сходу" "no" \
      "$(printf '%s' "$out" | grep -q 'неизвестный источник' && echo yes || echo no)"
check "и список ищется в манифесте" "true" "$(printf '%s' "$out" | jget ok)"
# То же для удаления: кнопка «Удалить с роутера» в каталоге шлёт тот же id, и пока удаление
# знало только приставку зашитого издателя, любой список каталога убрать было нельзя.
out="$(rpcd list_remove '{"id":"other:x","kind":"prefixes"}')"
check "удаление: чужая приставка не отвергается" "true" "$(printf '%s' "$out" | jget ok)"
check "удаление: файл списка ушёл с диска" "no" "$([ -e "$T/lists/other/x.lst" ] && echo yes || echo no)"

# ---- спека заводится сама, если её нет ------------------------------------------------
#
# ЧТО ЗДЕСЬ СТОРОЖИТСЯ. Без /etc/steer/spec.json движок не поднимается вовсе (его init-скрипт:
# «no /etc/steer/spec.json — nothing to apply»): ни правил, ни резолвера доменных каналов, ни
# маршрутов выходов, — а пульт в это время говорит «Загрузка…» и объявляет исправный движок
# сломанным. Заводит её установка, но скрипт uci-defaults исполняется ОДИН раз, и всё, что
# случилось после него, ему уже не поправить: ручная чистка /etc/steer, обновление прошивки
# без keep.d, установка интерфейса первым на роутер без движка.
#
# Поэтому оборона стоит и в самом частом чтении (тот же довод, что у uci_file: объявить
# настройку обязан пакет, но полагаться только на него нельзя). Проверяется ОБОИМИ вызовами
# круга опроса: спека появляется в первую же секунду после открытия страницы.
#
# ВЫХОД `direct` В НЕЙ ЕСТЬ СРАЗУ: «пустить напрямую» — не настройка, а то, что роутер делает
# без нас, и правилу-исключению нужен адрес назначения.
rm -f "$T/etc/spec.json"
reset_logs
out="$(rpcd spec_get)"
check "спеки нет — она заводится чтением" "yes" \
      "$([ -s "$T/etc/spec.json" ] && echo yes || echo no)"
check "и служба ядра поднята" "start" "$(initd_actions)"
check "и в ней есть постоянный выход direct" "direct" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(",".join(k for k,v in d["outputs"].items() if v.get("kind")=="direct"))')"
check "правил в ней нет — это точная запись того, что есть" "0" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; print(len(json.load(sys.stdin).get("rules", [])))')"
check "и это спека v2, а не прежняя" "2" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')"
# Рядом лежит spec.yaml — спека ведётся руками: второй файл не заводится вовсе, и запись через
# интерфейс отвергается словами (движок при двух спеках не читает ни одну).
rm -f "$T/etc/spec.json"
printf 'version: 2\n' > "$T/etc/spec.yaml"
rpcd spec_get >/dev/null
check "при spec.yaml рядом второй файл не заводится" "no" "$([ -s "$T/etc/spec.json" ] && echo yes || echo no)"
rm -f "$T/etc/spec.yaml"
# Ядро ведёт steer-box-connector: своя спека не заводится и служба steer не поднимается — иначе
# открытие страницы ставило бы службу steer со своей спекой рядом с ядром коннектора, а сам
# коннектор при следующем запуске отказывался бы работать (podkop/forkop без маршрутизации).
mkdir -p "$T/box"
printf '#!/bin/sh /etc/rc.common\n# sing-box от steer-box-connector\n' > "$T/box/sing-box"
reset_logs
out="$(SINGBOX_INITD_FIXTURE="$T/box/sing-box" rpcd spec_get)"
check "коннектор: спека чтением не заводится" "no" "$([ -s "$T/etc/spec.json" ] && echo yes || echo no)"
check "коннектор: служба steer не тронута" "" "$(initd_actions)"
check "коннектор: чтение отдаёт пустую спеку" "2" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')"
SINGBOX_INITD_FIXTURE="$T/box/sing-box" rpcd live >/dev/null
check "коннектор: круг опроса спеку не заводит" "no" "$([ -s "$T/etc/spec.json" ] && echo yes || echo no)"
rm -rf "$T/box"
printf 'version: 2\n' > "$T/etc/spec.yaml"
out="$(rpcd spec_set '{"spec":"{\"version\":2}"}')"
check "запись спеки при двух файлах отвергается" "false" "$(printf '%s' "$out" | jget ok)"
check "и причина названа" "yes" "$(printf '%s' "$out" | jget error | grep -q 'spec.yaml' && echo yes || echo no)"
rm -f "$T/etc/spec.yaml"
printf '{"version":2}\n' > "$T/etc/spec.json"
# Прежняя v1 перед заменой на v2 остаётся копией рядом — один раз, старейшая.
printf '{"schema":1,"outputs":{},"channels":[]}\n' > "$T/etc/spec.json"
rm -f "$T/etc/spec.json.v1.bak"
out="$(rpcd spec_set '{"spec":"{\"version\":2}"}')"
check "v1 перед заменой на v2 сохранена копией" "yes" "$(grep -q schema "$T/etc/spec.json.v1.bak" && echo yes || echo no)"
out="$(rpcd spec_set '{"spec":"{\"version\":2,\"outputs\":{}}"}')"
check "а вторая замена копию не затирает" "yes" "$(grep -q schema "$T/etc/spec.json.v1.bak" && echo yes || echo no)"
printf '{"schema":1,"outputs":{},"channels":[{"name":"чужой","out":"vl","match":{"any":true}}]}\n' \
    > "$T/etc/spec.json"
rpcd spec_get >/dev/null
check "готовую спеку оборона не трогает" "1" \
      "$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["channels"]))' "$T/etc/spec.json")"
rm -f "$T/etc/spec.json"
rpcd live '{"fast":true}' >/dev/null
check "круг опроса заводит спеку так же" "yes" \
      "$([ -s "$T/etc/spec.json" ] && echo yes || echo no)"

# ---- opkg: пустые списки пакетов не должны валить установку -------------------------
# С живого роутера: «cannot find dependency ip-full for steer», хотя пакет скачан и лежит
# рядом. У opkg зависимости локального файла ищутся в СПИСКАХ ПАКЕТОВ, а на свежей прошивке
# их нет — списки не переживают перезагрузку.
rm -f "$T/opkg.lists" "$T/opkg.log"
out="$(PM_FIXTURE=opkg rpcd steer_install '{"version":"1.2.4","extended":false}')"
check "после отказа по зависимости списки обновляются" "1" \
      "$(grep -c '^update' "$T/opkg.log")"
check "и установка повторяется" "2" "$(grep -c '^install' "$T/opkg.log")"
check "человеку сказано, что списки были пусты" "yes" \
      "$(printf '%s' "$out" | jget output | grep -q 'списки пакетов были пусты' && echo yes || echo no)"

# ---- apk: то же самое, и прежний комментарий здесь утверждал обратное ----------------
# «На apk этого нет вовсе» — было неправдой: индексы apk лежат в /var/cache/apk, это tmpfs,
# и после перезагрузки `apk add` файла с зависимостями отвечает «unable to select packages»
# (проверено на роутере с 25.12: индексы убраны — отказ, `apk update` — установка). У 26.9
# зависимостей две (https-dns-proxy, ip-full), у 1.2.5 не было ни одной, так что до этого
# выпуска ветка apk просто не встречала отказа.
rm -f "$T/apk.index" "$T/apk.log"
out="$(PM_FIXTURE=apk APK_NEED_INDEX=1 rpcd steer_install '{"version":"1.2.4","extended":false}')"
check "apk: после отказа по зависимости индексы обновляются" "1" \
      "$(grep -c '^update' "$T/apk.log")"
check "apk: и установка повторяется" "2" "$(grep -c '^add' "$T/apk.log")"
check "apk: человеку сказано, что списки были пусты" "yes" \
      "$(printf '%s' "$out" | jget output | grep -q 'списки пакетов были пусты' && echo yes || echo no)"
check "apk: повторная установка удалась" "true" "$(printf '%s' "$out" | jget ok)"
rm -f "$T/apk.index"

# ---- кнопка «Обновить списки» в каталоге ---------------------------------------------
# Метод не делает работу сам, а зовёт splify2-update-lists — тот же, что ходит по
# расписанию. Проверяется здесь то, что ломается молча: числа в ответе считаются по
# отчёту прогона, а не выдумываются, и неудачный прогон не выдаётся за успех.
cat > "$T/bin/update-lists" <<'EOF'
#!/bin/sh
printf 'youtube.lst: обновлён (100 записей)\nrkn.lst: обновлён (3 записи)\nправила применены\n' >> "$REPORT"
exit 0
EOF
chmod +x "$T/bin/update-lists"
out="$(rpcd lists_update)"
check "прогон удался" "true" "$(printf '%s' "$out" | jget ok)"
check "обновлённые посчитаны по отчёту" "2" "$(printf '%s' "$out" | jget updated)"
check "строки прогона отданы интерфейсу" "yes"       "$(printf '%s' "$out" | jget lines | grep -q 'правила применены' && echo yes || echo no)"

cat > "$T/bin/update-lists" <<'EOF'
#!/bin/sh
printf 'rkn.lst: не скачался, оставлен прежний\n' >> "$REPORT"
exit 1
EOF
chmod +x "$T/bin/update-lists"
out="$(rpcd lists_update)"
check "неудача прогона не выдаётся за успех" "false" "$(printf '%s' "$out" | jget ok)"
check "неудавшиеся посчитаны" "1" "$(printf '%s' "$out" | jget failed)"

cat > "$T/bin/update-lists" <<'EOF'
#!/bin/sh
printf 'изменений нет\n' >> "$REPORT"
exit 0
EOF
chmod +x "$T/bin/update-lists"
out="$(rpcd lists_update)"
check "прогон без изменений — успех, а не отказ" "true" "$(printf '%s' "$out" | jget ok)"
check "и обновлённых в нём ноль" "0" "$(printf '%s' "$out" | jget updated)"

rm -f "$T/bin/update-lists"
out="$(rpcd lists_update)"
check "без обновлятора метод честно отказывается" "false" "$(printf '%s' "$out" | jget ok)"

check "метод объявлен в списке ubus" "yes"       "$(rpcd_list | grep -q lists_update && echo yes || echo no)"

# ---- splify2#16: не только устройства из br-lan --------------------------------------
# Человек держит роутер выходной точкой ещё и для хостов из Tailscale/ZeroTier и хочет
# применить к ним те же правила. В splify1 это был перечень интерфейсов через запятую в
# /etc/config; здесь у интерфейса не было даже перечня того, из чего выбирать: метод
# `devices` отбирает ТУННЕЛИ (кандидаты в выход), а сети клиентов не перечислял никто.
#
# Отбор здесь именно про «откуда приходят клиенты», и каждая проверка ниже — про одну
# ошибку, которую легко сделать именем: lo, порт внутри моста, wan.
#
# Какое устройство наружу — знает uci, а не имя. Фикстура ставится ЗДЕСЬ, а не в общей
# подготовке: проверки выбора «откуда качать» выше по файлу чистят хранилище uci за собой.
printf 'network.wan.device=wan\n' >> "$T/uci.store"
out="$(rpcd client_nets)"
names() { printf '%s' "$1" | python3 -c 'import json,sys
print(" ".join(d["name"] for d in json.load(sys.stdin)["nets"]))'; }
netof() { printf '%s' "$1" | python3 -c 'import json,sys
n=[d for d in json.load(sys.stdin)["nets"] if d["name"]==sys.argv[1]]
print(",".join(n[0].get("subnets") or []) if n else "НЕТ")' "$2"; }
flagof() { printf '%s' "$1" | python3 -c 'import json,sys
n=[d for d in json.load(sys.stdin)["nets"] if d["name"]==sys.argv[1]]
print(json.dumps(n[0].get(sys.argv[2])) if n else "НЕТ")' "$2" "$3"; }

check "сети клиентов перечислены по алфавиту, без lo и без портов моста (splify2#16)" \
      "br-guest br-lan tailscale0 wan ztrfyzwvfa" "$(names "$out")"
check "у моста названа его сеть, а не адрес роутера" "192.168.1.0/24" "$(netof "$out" br-lan)"
# Адрес /32 — норма для Tailscale, и выведенная сеть равна самому адресу. Прятать такое
# устройство нельзя (человек из обращения ходит именно через него), но и молчать о том, что
# из его адреса подсеть не выводится, тоже: соседей по Tailscale придётся дописать руками.
check "туннель с адресом /32 остаётся в перечне" "100.64.1.5/32" "$(netof "$out" tailscale0)"
check "мост ZeroTier — обычная сеть" "10.147.17.0/24" "$(netof "$out" ztrfyzwvfa)"
# wan назван, а не выкинут: выкинутое устройство человек ищет глазами и не находит, а
# помеченное он не выберет. Выбрать wan сетью клиентов — это увести в туннель всё, что
# роутер получает снаружи.
check "wan помечен, а не спрятан" "true" "$(flagof "$out" wan wan)"
check "домашний мост wan-ом не помечен" "false" "$(flagof "$out" br-lan wan)"
check "поднятое устройство названо поднятым" "true" "$(flagof "$out" br-lan up)"
check "опущенное — опущенным, но из перечня не исчезает" "false" "$(flagof "$out" br-guest up)"
# Устройства без адреса IPv4 (ещё не поднято) перечень отдаёт без подсетей, а не пропускает:
# выбрать его законно, сеть появится вместе с адресом.
check "у устройства без адреса подсетей нет" "" "$(netof "$out" br-guest)"
check "метод объявлен в списке ubus" "yes" "$(rpcd_list | grep -q client_nets && echo yes || echo no)"

# ---- I-161: смешанный пул не собрать, пока туннель выключен --------------------------
# Метод `devices` отвечает на «куда можно выпустить трафик» и отбирал кандидатов по
# /sys/class/net. Устройство выхода kind=vless/xsteer создаёт сам движок — вместе со своим
# процессом, а не с настройкой, — поэтому настроенная, но остановленная сейчас локация в
# перечень не попадала вовсе, и законную форму смешанного пула (устройство локации рядом с
# wg0) с экрана было не собрать. Вопрос здесь про НАСТРОЙКУ: выключенная сегодня локация
# завтра поднимется, и класть её в пул человек вправе сейчас.
cat > "$T/etc/spec.json" <<'EOF'
{ "schema": 1,
  "outputs": {
    "nl": { "kind": "vless", "sub_file": "/etc/steer/sub.txt" },
    "hub": { "kind": "xsteer", "device": "xs0" },
    "vpn": { "kind": "interface", "device": "wg0" },
    "direct": { "kind": "direct" }
  },
  "channels": [] }
EOF
out="$(rpcd devices)"
devs() { printf '%s' "$1" | python3 -c 'import json,sys
print(" ".join(d["name"] for d in json.load(sys.stdin)["devices"]))'; }
upof() { printf '%s' "$1" | python3 -c 'import json,sys
n=[d for d in json.load(sys.stdin)["devices"] if d["name"]==sys.argv[1]]
print(json.dumps(n[0]["up"]) if n else "НЕТ")' "$2"; }

check "устройство выключенной локации подписки предлагается (I-161)" "yes" \
      "$(case " $(devs "$out") " in *" nl "*) echo yes ;; *) echo no ;; esac)"
check "устройство выключенного хаба xsteer — тоже, и своим именем из спеки (I-161)" "yes" \
      "$(case " $(devs "$out") " in *" xs0 "*) echo yes ;; *) echo no ;; esac)"
check "выключенное не выдаётся за поднятое" "false" "$(upof "$out" nl)"
check "живой туннель остаётся первым и поднятым" "true" "$(upof "$out" wg0)"
# Мост и порт по-прежнему не кандидаты: выход в них молча ничего не маршрутизирует.
check "мост и порт в кандидаты не попадают" "wg0 nl xs0" "$(devs "$out")"
# Живое устройство не задваивается: движок называет то же имя, что уже прочитано из /sys.
cat > "$T/etc/spec.json" <<'EOF'
{ "schema": 1,
  "outputs": { "wg0": { "kind": "xsteer", "device": "wg0" } },
  "channels": [] }
EOF
check "устройство, которое уже есть, не задваивается" "wg0" "$(devs "$(rpcd devices)")"
printf '{"schema":1,"outputs":{},"channels":[]}\n' > "$T/etc/spec.json"

# ---- перечень своих списков: три процесса на каталог, а не два на файл ---------------
# Метод был самым дорогим у объекта: `grep -c .` и `date -r` в подстановке на КАЖДЫЙ файл, а
# файлов на роутере со всем каталогом 46 — 92 запуска процессов, 1197 мс на вызов (замер на
# стенде 10.8.1.87). Платил это человек каждый раз, открывая «Настройки» или каталог.
#
# Здесь проверяется не скорость, а то, что от неё не пострадал ответ: ключ остаётся ПУТЁМ
# относительно каталога списков (по имени файла адресный список от доменного не отличить),
# счёт остаётся счётом НЕПУСТЫХ строк, а время файла не потерялось.
#
# mktime() есть у busybox awk и у gawk, но НЕ у mawk: на машине с ним время придёт нулём, и
# проверка ниже об этом честно скажет, вместо того чтобы промолчать.
mkdir -p "$T/lists/domains" "$T/lists/custom"
printf '1.2.3.0/24\n\n5.6.7.0/24\n8.9.0.0/16\n' > "$T/lists/three.lst"
printf 'example.com\n' > "$T/lists/domains/one.lst"
out="$(rpcd local_lists)"
cnt() { printf '%s' "$1" | python3 -c 'import json,sys
print(json.load(sys.stdin)["files"].get(sys.argv[1], {}).get("count", "НЕТ"))' "$2"; }
check "счёт по непустым строкам, а не по всем" "3" "$(cnt "$out" three.lst)"
check "доменный список отличим от адресного путём" "1" "$(cnt "$out" domains/one.lst)"
check "время файла не потерялось" "yes" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys
print("yes" if json.load(sys.stdin)["files"]["three.lst"]["mtime"] > 1000000000 else "no")')"
rm -f "$T/lists/three.lst" "$T/lists/domains/one.lst"

# ---- I-157: «устройств в сети» считалось по одной подсети network.lan ----------------
# Человек отметил в перечне сетей клиентов tailscale0 и ztXXXXXX, трафик оттуда
# маршрутизируется, а в числе на обзоре его нет: считались только адреса из network.lan.
# Занижение молчаливое, при подписи «устройств в сети» — число выглядит осмысленным и потому
# убедительно врёт. Заменить одну подсеть списком нельзя: у tailscale0 адрес на роутере /32,
# и подсеть пиров из него не выводится. Считаются разные ЧАСТНЫЕ адреса-инициаторы, кроме
# адресов самого роутера.
cat > "$T/nf_conntrack" <<'EOF'
ipv4 2 udp 17 30 src=192.168.1.77 dst=192.168.1.1 sport=9 dport=53 src=192.168.1.1 dst=192.168.1.77 sport=53 dport=9 mark=0
ipv4 2 tcp 6 431999 ESTABLISHED src=192.168.1.50 dst=1.1.1.1 sport=1 dport=443 src=1.1.1.1 dst=46.42.17.15 sport=443 dport=1 mark=0
ipv4 2 tcp 6 431999 ESTABLISHED src=192.168.1.50 dst=8.8.8.8 sport=2 dport=443 src=8.8.8.8 dst=46.42.17.15 sport=443 dport=2 mark=0
ipv4 2 udp 17 30 src=192.168.9.7 dst=1.1.1.1 sport=3 dport=53 src=1.1.1.1 dst=46.42.17.15 sport=53 dport=3 mark=0
ipv4 2 tcp 6 431999 ESTABLISHED src=100.64.1.9 dst=140.82.121.4 sport=4 dport=443 src=140.82.121.4 dst=46.42.17.15 sport=443 dport=4 mark=0
ipv4 2 tcp 6 431999 ESTABLISHED src=10.147.17.31 dst=140.82.121.4 sport=5 dport=443 src=140.82.121.4 dst=46.42.17.15 sport=443 dport=5 mark=0
ipv4 2 tcp 6 431999 ESTABLISHED src=192.168.1.1 dst=1.1.1.1 sport=6 dport=443 src=1.1.1.1 dst=46.42.17.15 sport=443 dport=6 mark=0
ipv4 2 tcp 6 120 SYN_SENT src=185.200.1.7 dst=46.42.17.15 sport=7 dport=22 src=46.42.17.15 dst=185.200.1.7 sport=22 dport=7 mark=0
EOF
out="$(rpcd net_info)"
# Четыре разных частных инициатора: телефон (192.168.1.50, два соединения — одно устройство),
# гостевая сеть (192.168.9.7), пир Tailscale (100.64.1.9) и хост ZeroTier (10.147.17.31).
# НЕ считаются: адрес самого роутера (192.168.1.1), сканер из интернета (185.200.1.7) и
# устройство, которое только спросило DNS у роутера (192.168.1.77) — это соединение К нему, а
# не через него. Считались бы — здесь стояло бы семь.
check "клиенты считаются по всем сетям, а не по одной (I-157)" "4" \
      "$(printf '%s' "$out" | jget active_clients)"

# Сторона провайдера бывает частной: роутер за роутером, адрес wan вида 10.x. Тогда всякий,
# кто подключился К РОУТЕРУ оттуда, выглядел бы клиентом — на стенде 10.8.1.87 это была
# ssh-сессия, и число на обзоре росло от самого факта подключения. Подсеть wan исключается
# целиком, а домашние сети при этом считаются по-прежнему.
cat > "$T/nf_conntrack2" <<'EOF'
ipv4 2 tcp 6 431999 ESTABLISHED src=192.168.1.50 dst=1.1.1.1 sport=1 dport=443 src=1.1.1.1 dst=10.8.1.87 sport=443 dport=1 mark=0
ipv4 2 tcp 6 431999 ESTABLISHED src=10.8.0.3 dst=10.8.1.87 sport=2 dport=22 src=10.8.1.87 dst=10.8.0.3 sport=22 dport=2 mark=0
EOF
check "пришедший со стороны провайдера клиентом не считается" "1" \
      "$(IP_WAN_ADDR=10.8.1.87/16 CONNTRACK_FIXTURE="$T/nf_conntrack2" rpcd net_info | jget active_clients)"

# ---- круг опроса одним вызовом ------------------------------------------------------
# Пять вызовов на круг стоили роутеру 1220 мс, из них 630 — пятикратный разбор одного и того
# же 250-килобайтного скрипта (замер на стенде 10.8.1.87, mipsel 24kc). Метод отдаёт то же
# самое одним запуском. Проверяется здесь СОСТАВ ответа: раскладку полей читает интерфейс, и
# разъехавшись, она молча оставит экран без чисел.
cat > "$T/etc/spec.json" <<'EOF'
{ "schema": 1, "outputs": { "vpn": { "kind": "interface", "device": "wg0" } }, "channels": [] }
EOF
out="$(rpcd live)"
check "круг: состояние движка отдано дословно" "interface" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys
print(json.load(sys.stdin)["status"]["outputs"]["vpn"]["kind"])' 2>/dev/null)"
check "круг: счётчики устройств на месте" "223000000" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys
print(json.load(sys.stdin)["devices"]["wg0"]["rx"])' 2>/dev/null)"
check "круг: lo не считается устройством" "no" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys
print("yes" if "lo" in json.load(sys.stdin)["devices"] else "no")' 2>/dev/null)"
check "круг: сведения о сети на месте" "yes" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys
d=json.load(sys.stdin)["net"]; print("yes" if "uptime" in d and "active_clients" in d else "no")' 2>/dev/null)"
# Проверки движка — ТОЛЬКО по просьбе: они вдвое дороже состояния, а меняются реже. Молча
# считать их каждый круг значило бы вернуть половину сэкономленного.
check "круг: без просьбы проверок нет" "no" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys
print("yes" if "diag" in json.load(sys.stdin) else "no")' 2>/dev/null)"
# ---- по КАКОЙ спеке считаются проверки ----------------------------------------
#
# Проверки движка отвечают на вопрос «что не работает СЕЙЧАС», и половина их приговоров
# сверяет спеку с ядром: набор канала, цепочка, таблица маршрутизации. Значит сверять надо
# ПРИМЕНЁННУЮ спеку. По задуманной они врут ровно на неприменённых правках: канала в ядре
# ещё нет, и приговор говорит «apply не довёл набор до ядра — примените заново», хотя apply
# никто не нажимал. Снято с живого роутера: три неприменённых правила дали `fail 1` по
# spec.json и `fail 0` по spec.applied.json на том же ядре.
printf '{"schema":2,"outputs":{},"channels":[]}\n' > "$T/etc/spec.json"
printf '{"schema":2,"outputs":{},"channels":[]}\n' > "$T/etc/spec.applied.json"
: > "$T/diag-spec.log"
rpcd diag >/dev/null 2>&1
check "проверки движка считаются по ПРИМЕНЁННОЙ спеке" "$T/etc/spec.applied.json" \
      "$(tail -n1 "$T/diag-spec.log" 2>/dev/null)"
: > "$T/diag-spec.log"
rpcd live '{"diag":true}' >/dev/null 2>&1
check "круг опроса спрашивает проверки о том же" "$T/etc/spec.applied.json" \
      "$(tail -n1 "$T/diag-spec.log" 2>/dev/null)"
# Применённой спеки нет вовсе — до первого apply считаем применённым сохранённое: иначе
# свежепоставленный пакет показывал бы поломку, которой никто не делал (тот же довод, что у
# fast_applied_get).
rm -f "$T/etc/spec.applied.json"
: > "$T/diag-spec.log"
rpcd diag >/dev/null 2>&1
check "применённой спеки нет — проверки берут сохранённую" "$T/etc/spec.json" \
      "$(tail -n1 "$T/diag-spec.log" 2>/dev/null)"
printf '{"schema":2,"outputs":{},"channels":[]}\n' > "$T/etc/spec.applied.json"

# СНИМОК ПРИМЕНЁННОГО ЗАМЕНЯЕТСЯ ЦЕЛИКОМ ИЛИ НИКАК (I-327). `cp` открывает назначение с
# усечением и пишет в него — кончилось место посреди копии, и на диске остаётся обрезанный
# снимок, по которому applied_get и проверки движка потом читают полспеки. Заглушка cp делает
# ровно то, что делает настоящий cp на полном разделе: усекает назначение, пишет половину и
# выходит с ошибкой. Снимок обязан остаться прежним, целым.
printf '{"schema":2,"outputs":{},"channels":[],"old":1}\n' > "$T/etc/spec.applied.json"
cat > "$T/bin/cp" <<'CPEOF'
#!/bin/sh
eval "_dst=\${$#}"
head -c 10 "$1" > "$_dst"
exit 1
CPEOF
chmod +x "$T/bin/cp"
rpcd apply >/dev/null 2>&1
rm -f "$T/bin/cp"
check "apply: сорванная копия не портит прежний снимок применённого" "1" \
      "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("old"))' "$T/etc/spec.applied.json" 2>&1)"
check "apply: от сорванной копии не остаётся временных файлов" "" \
      "$(ls "$T/etc" | grep 'spec.applied.json.' || :)"
printf '{"schema":2,"outputs":{},"channels":[]}\n' > "$T/etc/spec.applied.json"

out2="$(rpcd live '{"diag":true}')"
check "круг: по просьбе проверки приходят дословно" "таблица на месте" \
      "$(printf '%s' "$out2" | python3 -c 'import json,sys
print(json.load(sys.stdin)["diag"]["checks"][0]["what"])' 2>/dev/null)"

# ---- проверки движка отдаются дословно, без наших приговоров ---------------------------
# Прежние приговоры про https-dns-proxy (спор за порт 53, молчащий DoH) убраны вместе с его
# настройкой: чужой прокси — настройка человека. Круг и метод diag дают ровно то, что сказал
# движок.
mkdir -p "$T/etc"
dj() { python3 -c 'import json,sys
d=json.load(sys.stdin)'"$1" 2>/dev/null; }
printf 'config main "config"\n\toption force_dns "1"\n' > "$T/etc/config-doh"
out="$(rpcd live '{"diag":true}')"
check "чужой https-dns-proxy не добавляет приговоров в круг" "1" \
      "$(printf '%s' "$out" | dj '
print(len(d["diag"]["checks"]))')"
check "приговор движка на месте и дословен" "таблица на месте" \
      "$(printf '%s' "$out" | dj '
print(d["diag"]["checks"][0]["what"])')"
check "счётчик fail — движка, без наших" "0" \
      "$(printf '%s' "$out" | dj '
print(d["diag"]["fail"])')"
out="$(rpcd diag)"
check "метод diag говорит то же самое" "1" \
      "$(printf '%s' "$out" | dj '
print(len(d["checks"]))')"
# Движок не ответил — честная ошибка, а не пустой объект: интерфейс покажет пустоту как
# «всё в порядке», и это худшая из возможных неправд.
# Спека, которую движок не разбирает: `steer status` не печатает ничего, и это ошибка, а не
# пустота. Пустой объект интерфейс покажет как «всё в порядке» — худшая из возможных неправд.
printf 'не json\n' > "$T/etc/spec.json"
check "круг: молчание движка — это ошибка, а не пустота" "false" \
      "$(rpcd live | jget ok)"
printf '{"schema":1,"outputs":{},"channels":[]}\n' > "$T/etc/spec.json"

check "метод объявлен в списке ubus" "yes" "$(rpcd_list | grep -q '"live"' && echo yes || echo no)"


# ---- xsteer: состояние туннелей и ссылка xs:// ---------------------------------
#
# Три метода, и у каждого своя цена ошибки.
#
# xsteer_state отвечает на вопрос, который иначе не задать: встала ли разгрузка, сколько раз
# соединение переподнималось, отвечает ли вообще процесс. Здесь важно, что «файла нет» и «файл
# лежит» РАЗЛИЧАЮТСЯ в ответе: первое означает «туннель не поднимался», второе — состояние, и
# показать одно вместо другого значит соврать про настройку роутера.
#
# xsteer_link ходит к движку в обе стороны и НЕ РАЗБИРАЕТ формат сам. Проверяется именно это: что
# ссылка уходит движку стандартным ВВОДОМ (аргументы видны в списке процессов, а в ссылке лежит
# приватный ключ) и что отказ движка доезжает до человека его словами.
#
# xsteer_link_put пишет настройку сети — единственный метод в этом файле, который это делает.
# Проверяется, что он не создаёт интерфейсов, замещает пира целиком и не трогает чужие поля.
mkdir -p "$T/var/lib/steer" "$T/var/run/xsteer"
uci_set "network.home.proto" "xsteer"
uci_set "network.home.private_key" "OLDKEY"
uci_set "network.lan.proto" "static"

check "xsteer_state: туннель из настройки виден и без файла состояния" "xs-home" \
      "$(rpcd xsteer_state | python3 -c 'import json,sys; print(json.load(sys.stdin)["tunnels"]["home"]["device"])')"
check "xsteer_state: без файла состояние ПУСТОЕ, а не выдуманное" "null" \
      "$(rpcd xsteer_state | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["tunnels"]["home"]["state"]))')"
check "xsteer_state: чужой протокол в перечень не попал" "" \
      "$(rpcd xsteer_state | python3 -c 'import json,sys; print(",".join(k for k in json.load(sys.stdin)["tunnels"] if k=="lan"))')"

cat > "$T/var/lib/steer/xsteer-xs-home.json" <<'JEOF'
{"schema":1,"out":"xs-home","up":true,"mtu":1420,"conns":2,"hub":"198.51.100.9:8443",
 "hub_key":"QYkH5bWO","handshake_age":37,"stream":false,
 "offload":{"gso":true,"gro":true,"rx":false},"mtu_confirmed":1420,"resets":3,
 "tx_packets":10,"tx_bytes":2048,"rx_packets":12,"rx_bytes":4096,"dropped":0,
 "last_down":"путь молчит"}
JEOF
check "xsteer_state: состояние движка отдано КАК ЕСТЬ, без пересборки схемы" "198.51.100.9:8443" \
      "$(rpcd xsteer_state | python3 -c 'import json,sys; print(json.load(sys.stdin)["tunnels"]["home"]["state"]["hub"])')"
check "xsteer_state: разгрузка доезжает по частям, а не одним словом" "false" \
      "$(rpcd xsteer_state | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["tunnels"]["home"]["state"]["offload"]["rx"]))')"
check "xsteer_state: возраст файла назван — по нему видно убитый процесс" "yes" \
      "$(rpcd xsteer_state | python3 -c 'import json,sys; print("yes" if "age" in json.load(sys.stdin)["tunnels"]["home"] else "no")')"

# Имя устройства из настройки, а не выведенное: файл состояния лежит под ИМЕНЕМ УСТРОЙСТВА, и
# перепутать их значит показать пустое состояние работающему туннелю.
uci_set "network.home.device_name" "xs-dom"
mv "$T/var/lib/steer/xsteer-xs-home.json" "$T/var/lib/steer/xsteer-xs-dom.json"
check "xsteer_state: заданное имя устройства уважается" "198.51.100.9:8443" \
      "$(rpcd xsteer_state | python3 -c 'import json,sys; print(json.load(sys.stdin)["tunnels"]["home"]["state"]["hub"])')"
# Файл состояния пуст или оборван — движок его как раз переписывает, или кончилось место.
# Подставленный как есть, он делал весь ответ невалидным JSON (`"state":}`), и экран терял
# состояние ВСЕХ туннелей, а не одного (I-327). Такой файл — «состояния нет», null.
: > "$T/var/lib/steer/xsteer-xs-dom.json"
check "xsteer_state: пустой файл состояния — null, ответ остаётся JSON" "null" \
      "$(rpcd xsteer_state | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["tunnels"]["home"]["state"]))' 2>&1 | tail -n1)"
printf '{"schema":1,"out":"xs-dom","up":tr' > "$T/var/lib/steer/xsteer-xs-dom.json"
check "xsteer_state: оборванный файл состояния — null, ответ остаётся JSON" "null" \
      "$(rpcd xsteer_state | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["tunnels"]["home"]["state"]))' 2>&1 | tail -n1)"
printf '{"schema":1,"out":"xs-dom","up":true}\n' > "$T/var/lib/steer/xsteer-xs-dom.json"
uci "-q" delete "network.home.device_name" 2>/dev/null || :
grep -v '^network.home.device_name=' "$T/uci.store" > "$T/uci.store.t"; mv "$T/uci.store.t" "$T/uci.store"
mv "$T/var/lib/steer/xsteer-xs-dom.json" "$T/var/lib/steer/xsteer-xs-home.json"

# ВЫХОД kind: xsteer ПОД ДЕМОНОМ ЯДРА. Его клиент — ребёнок steerd с трубой событий: файла
# состояния он не пишет, и всё, что о нём известно, — у демона в памяти (`steer ctl helper`).
# Прежде метод перечислял только туннели netifd, и выход спеки kind: xsteer на экране не
# появлялся вовсе. Перечень — по спеке (`steer outputs --kind xsteer`), состояние — ответ демона.
_xs_spec="$(cat "$T/etc/spec.json")"
printf '{"version":2,"outputs":{"xa":{"kind":"xsteer","conf":"/etc/steer/xsteer/xa.conf"},"wg":{"kind":"interface","device":"wg0"}},"rules":[]}\n' > "$T/etc/spec.json"
_xs_helper='{"schema":1,"out":"xa","helper":"xsteer","running":true,"up":true,"since":1790000000,"started":1789999990,"restarts":2,"module":"steer-xsteer","module_ver":"2.0.0"}'
_xs_resp="$(python3 -c 'import json,sys; print(json.dumps({"v":1,"cmd":"helper","code":0,"stdout":sys.argv[1]+"\n","stderr":""}))' "$_xs_helper")"
out="$(CTL_RESP="$_xs_resp" rpcd xsteer_state)"
check "xsteer_state: выход kind: xsteer под демоном виден" "xsteer 2 true" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; h=json.load(sys.stdin)["outputs"]["xa"]["helper"]; print(h["helper"], h["restarts"], json.dumps(h["up"]))' 2>&1)"
check "xsteer_state: выход другого вида в перечень xsteer не попал" "xa" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; print(",".join(json.load(sys.stdin)["outputs"]))' 2>&1)"
check "xsteer_state: туннели netifd рядом остались" "xs-home" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["tunnels"]["home"]["device"])' 2>&1)"
check "xsteer_state: спросили демона именем выхода" "yes" \
      "$(grep -q '^ctl helper xa$' "$T/steer.log" && echo yes || echo no)"
check "xsteer_state: без файла состояния у выхода под демоном — null" "null" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["outputs"]["xa"]["state"]))' 2>&1)"
# Демон не запущен или помощника нет — состояния помощника нет (null), а ответ остаётся JSON.
out="$(CTL_RESP='{"v":1,"cmd":"helper","code":1,"stdout":"","stderr":"нет помощника"}' rpcd xsteer_state)"
check "xsteer_state: помощника нет — null, ответ остаётся JSON" "null" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["outputs"]["xa"]["helper"]))' 2>&1)"
# Клиент без трубы событий (`steer supervise`, ручной запуск) пишет файл под ИМЕНЕМ ВЫХОДА.
printf '{"schema":1,"out":"xa","up":true,"hub":"198.51.100.7:443","handshake_age":5}\n' > "$T/var/lib/steer/xsteer-xa.json"
out="$(CTL_RESP='{"v":1,"cmd":"helper","code":1,"stdout":"","stderr":"нет помощника"}' rpcd xsteer_state)"
check "xsteer_state: файл состояния выхода — под именем выхода" "198.51.100.7:443" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys; print(json.load(sys.stdin)["outputs"]["xa"]["state"]["hub"])' 2>&1)"
rm -f "$T/var/lib/steer/xsteer-xa.json"
printf '%s\n' "$_xs_spec" > "$T/etc/spec.json"

# ---- ссылка наружу ----
check "xsteer_link: у выключенного интерфейса причина названа, а не пустая ссылка" "yes" \
      "$(rpcd xsteer_link '{"iface":"home"}' | jget error | grep -q 'выключен' && echo yes || echo no)"
printf '[Interface]\n' > "$T/var/run/xsteer/home.conf"
: > "$T/steer.log"
out="$(rpcd xsteer_link '{"iface":"home"}')"
check "xsteer_link: ссылка отдана" "xs://PRIV@198.51.100.9:8443?pk=PUB&ip=10.77.0.5/24" \
      "$(printf '%s' "$out" | jget link)"
check "xsteer_link: печатает её ДВИЖОК, из готового файла настройки" "yes" \
      "$(grep -q "xsteer-link $T/var/run/xsteer/home.conf --name home" "$T/steer.log" && echo yes || echo no)"
check "xsteer_link: чужой интерфейс не обслуживается" "yes" \
      "$(rpcd xsteer_link '{"iface":"lan"}' | jget error | grep -q 'не xsteer' && echo yes || echo no)"
check "xsteer_link: негодное имя отвергнуто до всякого запуска движка" "yes" \
      "$(rpcd xsteer_link '{"iface":"../etc/passwd"}' | jget error | grep -qi 'негодное' && echo yes || echo no)"
XS_LINK_RC=2 XS_LINK_ERR="это конфигурация хаба" out="$(XS_LINK_RC=2 XS_LINK_ERR="это конфигурация хаба" rpcd xsteer_link '{"iface":"home"}')"
check "xsteer_link: отказ движка доезжает его словами" "yes" \
      "$(printf '%s' "$out" | jget error | grep -q 'конфигурация хаба' && echo yes || echo no)"

# ---- ссылка внутрь: разбор ----
: > "$T/steer.log"
out="$(rpcd xsteer_link '{"link":"xs://k@198.51.100.9:8443?pk=p&ip=10.77.0.5/24"}')"
check "xsteer_link: ссылка превращается в текст настройки" "yes" \
      "$(printf '%s' "$out" | jget conf | grep -q 'PrivateKey' && echo yes || echo no)"
check "xsteer_link: ссылка уходит движку СТАНДАРТНЫМ ВВОДОМ, не аргументом" "yes" \
      "$(grep -q '^stdin=xs://k@198.51.100.9:8443' "$T/steer.log" && echo yes || echo no)"
check "xsteer_link: ссылки в аргументах движка нет вовсе" "no" \
      "$(grep '^xsteer-link' "$T/steer.log" | grep -q 'xs://' && echo yes || echo no)"
check "xsteer_link: не ссылка отвергнута до движка" "yes" \
      "$(rpcd xsteer_link '{"link":"vless://x@h:443"}' | jget error | grep -q 'не ссылка' && echo yes || echo no)"

# ---- ссылка внутрь: запись в настройку ----
: > "$T/ifup.log"
out="$(rpcd xsteer_link_put '{"iface":"home","link":"xs://k@198.51.100.9:8443?pk=p&ip=10.77.0.5/24"}')"
check "xsteer_link_put: принято" "true" "$(printf '%s' "$out" | jget ok)"
check "xsteer_link_put: хаб назван в ответе" "198.51.100.9:8443" "$(printf '%s' "$out" | jget hub)"
check "xsteer_link_put: приватный ключ взят из разбора движка" \
      "6Gtidge6FqhO/0LhrAWpRiyYaKdLZF/gib/HePLC9GU=" "$(uci_get network.home.private_key)"
check "xsteer_link_put: адрес взят оттуда же" "10.77.0.5/24" "$(uci_get network.home.addresses)"
check "xsteer_link_put: SNI перенесён" "www.microsoft.com" "$(uci_get network.home.sni)"
_peer="$(sed -n 's/^network\.\(@*[^.=]*\)=xsteer_home$/\1/p' "$T/uci.store" | head -1)"
check "xsteer_link_put: секция пира создана" "yes" "$([ -n "$_peer" ] && echo yes || echo no)"
check "xsteer_link_put: ключ хаба записан" \
      "QYkH5bWOsEOCgIMldHPATSG7yvNyJ8st7o/HMelWKxs=" "$(uci_get "network.$_peer.public_key")"
check "xsteer_link_put: хост и порт разделены" "198.51.100.9" "$(uci_get "network.$_peer.endpoint_host")"
check "xsteer_link_put: порт отдельно" "8443" "$(uci_get "network.$_peer.endpoint_port")"
check "xsteer_link_put: список AllowedIPs разобран по запятым" "10.77.0.0/24 192.168.9.0/24" \
      "$(uci_get "network.$_peer.allowed_ips")"
check "xsteer_link_put: keepalive перенесён" "25" "$(uci_get "network.$_peer.persistent_keepalive")"
check "xsteer_link_put: интерфейс поднят заново — иначе запись без действия" "yes" \
      "$(grep -q '^home$' "$T/ifup.log" && echo yes || echo no)"

# Повторный приём НЕ ПЛОДИТ пиров: пиру нужен ровно один хаб, и оставленный второй означал бы
# туннель к двум хабам сразу — состояния, которого в звезде не бывает.
rpcd xsteer_link_put '{"iface":"home","link":"xs://k@198.51.100.9:8443?pk=p&ip=10.77.0.5/24"}' >/dev/null
check "xsteer_link_put: повторный приём оставляет ровно одного пира" "1" \
      "$(grep -c '=xsteer_home$' "$T/uci.store" | tr -d ' ')"

# Интерфейса нет — метод его НЕ СОЗДАЁТ и говорит, где создать. Созданный здесь туннель остался бы
# без зоны фаервола: выглядел бы настроенным и не вёз бы трафик.
out="$(rpcd xsteer_link_put '{"iface":"newone","link":"xs://k@1.2.3.4:443?pk=p&ip=10.0.0.1/24"}')"
check "xsteer_link_put: несуществующий интерфейс не создаётся" "false" "$(printf '%s' "$out" | jget ok)"
check "xsteer_link_put: сказано, где его создать" "yes" \
      "$(printf '%s' "$out" | jget error | grep -q 'настройках сети' && echo yes || echo no)"
check "xsteer_link_put: и в настройке его не появилось" "" "$(uci_get network.newone.proto)"

out="$(XS_LINK_RC=2 XS_LINK_ERR="неизвестный параметр snii" rpcd xsteer_link_put \
       '{"iface":"home","link":"xs://k@1.2.3.4:443?snii=a"}')"
check "xsteer_link_put: негодная ссылка не портит настройку" \
      "6Gtidge6FqhO/0LhrAWpRiyYaKdLZF/gib/HePLC9GU=" "$(uci_get network.home.private_key)"
check "xsteer_link_put: отказ движка доезжает его словами" "yes" \
      "$(printf '%s' "$out" | jget error | grep -q 'snii' && echo yes || echo no)"

# ---- каталог второго издателя: allow_domains -------------------------------------
#
# Здесь проверяется НЕ содержимое каталога (оно сверяется с самой таблицей сервисов в
# listsmatch.sh), а два свойства метода как метода объекта: он объявлен там, где объявляются
# методы, и он НИЧЕГО НЕ ПИШЕТ. Второе — не придирка: метод зовёт открытие вкладки, а всё,
# что он трогает, лежит либо во флеш-разделе (отметка версий), либо в каталоге списков.
# Метод, который на опросе заводит файлы, изнашивает флеш ровно пропорционально тому, как
# часто человек открывает страницу.
for m in allow_domains; do
    check "метод $m объявлен в списке ubus" "yes" \
          "$(rpcd_list | grep -q "\"$m\"" && echo yes || echo no)"
    check "метод $m назван в ACL" "yes" \
          "$(grep -q "\"$m\"" "$ROOT/luci/root/usr/share/rpcd/acl.d/luci-app-splify2.json" \
             && echo yes || echo no)"
done

rm -rf "$T/lists" "$T/etc/allow-domains.tag" "$T/srs-tmp"
out="$(rpcd allow_domains '{}')"
check "allow_domains отвечает и на роутере без единого списка" "true" "$(printf '%s' "$out" | jget ok)"
check "и каталога списков он при этом не заводит" "нет" \
      "$([ -e "$T/lists" ] && echo есть || echo нет)"
check "и отметки версий тоже — писать ему нечего" "нет" \
      "$([ -e "$T/etc/allow-domains.tag" ] && echo есть || echo нет)"
check "и разбора наборов в /tmp не оставляет — он их не качает" "нет" \
      "$([ -e "$T/srs-tmp" ] && echo есть || echo нет)"

for m in xsteer_state xsteer_link xsteer_link_put; do
    check "метод $m объявлен в списке ubus" "yes" \
          "$(rpcd_list | grep -q "\"$m\"" && echo yes || echo no)"
    check "метод $m назван в ACL" "yes" \
          "$(grep -q "\"$m\"" "$ROOT/luci/root/usr/share/rpcd/acl.d/luci-app-splify2.json" \
             && echo yes || echo no)"
done


# ---- отчёт для поддержки: один текст, который человек вставляет в чат ---------------
#
# ЗАЧЕМ ЭТОТ РАЗДЕЛ. Части у проекта есть (приговоры diag, состояние выходов, версии,
# каталог стратегий, резолвер), а собрать их в ОДИН текст было нечем: в трекере висят
# обращения, которые начинаются с «а как узнать, что у меня стоит». Метод собирает этот
# текст сам, и проверяется здесь ДВА разных вопроса.
#
# Первый — попало ли в отчёт то, ради чего его собирают. Пустой отчёт бесполезен так же,
# как отсутствующий.
#
# Второй — И ОН ГЛАВНЫЙ — не попало ли в отчёт то, чего в публичном чате быть не должно:
# ссылка подписки с ключом, ссылки узлов, приватные ключи туннелей, имена узлов (в них
# панели прячут и сообщения, и логины) и внешний адрес роутера. Отчёт, который нельзя
# показать людям, не выполняет своей задачи вовсе — поэтому проверки на секреты стоят
# рядом с проверками на состав, а не «когда-нибудь потом».
mkdir -p "$T/etc/subs" "$T/zapret" "$T/etc/config"

# Прошивка и архитектура: обе строки из одного файла описания системы. DISTRIB_DESCRIPTION
# берётся ради версии OpenWrt — до этого метода её не спрашивал никто.
cat > "$T/etc/openwrt_release" <<'EOF'
DISTRIB_ARCH='aarch64_cortex-a53'
DISTRIB_RELEASE='24.10.0'
DISTRIB_DESCRIPTION='OpenWrt 24.10.0 r28427-6df0e3d02a'
EOF

# Номер сборки интерфейса — тот же файл, который читает загрузчик страницы на каждой
# загрузке (luci/.../view/splify2/home.js).
printf '26.9-ab12cd\n' > "$T/etc/build-id.txt"

# Спека: выход-туннель, выход-локация подписки и «напрямую», плюс два правила — адресное и
# доменное. Из неё же заглушка движка собирает `status`, поэтому состояние выходов и
# перечень правил в отчёте приезжают из одного источника, как на роутере.
cat > "$T/etc/spec.json" <<EOF
{ "schema": 1,
  "outputs": {
    "vpn":    { "kind": "interface", "device": "wg0" },
    "nl":     { "kind": "vless", "sub_file": "$T/etc/sub.txt", "node": -1 },
    "direct": { "kind": "direct" }
  },
  "channels": [
    { "name": "Новости", "match": { "prefixes_files": ["$T/lists/news.lst"] }, "out": "vpn" },
    { "name": "Соцсети", "match": { "domains_files": ["$T/lists/domains/news.lst"] }, "out": "nl" }
  ] }
EOF

# ---- СЕКРЕТЫ, которые лежат на роутере рядом и в отчёт попасть не должны -------------
# Ссылка подписки с ключом — в uci, файл подписки — со ссылкой узла и его UUID.
uci_set splify2.main.sub_url 'https://panel.example.org/sub?token=SECRETTOKEN123'
printf 'vless://8f14e45f-ceea-467a-9fb2-1111deadbeef@203.0.113.9:443?sni=a#%%F0%%9F%%87%%A9%%F0%%9F%%87%%AA-Germania-login-pupkin\n' \
    > "$T/etc/sub.txt"
rm -f "$T/etc/subs"/*.txt
# Приватный ключ туннеля xsteer — в настройке сети и отдельным файлом.
uci_set network.home.private_key '6Gtidge6FqhO/0LhrAWpRiyYaKdLZF/gib/HePLC9GU='
mkdir -p "$T/etc/steer-xsteer"
printf '[Interface]\nPrivateKey = 6Gtidge6FqhO/0LhrAWpRiyYaKdLZF/gib/HePLC9GU=\n' \
    > "$T/etc/steer-xsteer/home.conf"

# Проверки «в отчёте нет секрета» зелены и на отчёте, которого нет вовсе, и на фикстуре без
# секрета. Поэтому сначала — что секреты в песочнице действительно лежат: иначе ниже
# проверялась бы не защита отчёта, а собственная опечатка в фикстуре.
check "фикстура: ссылка подписки с ключом лежит в настройке" "yes" \
      "$(case "$(uci_get splify2.main.sub_url)" in *SECRETTOKEN123*) echo yes ;; *) echo no ;; esac)"
check "фикстура: файл подписки несёт ссылку узла с UUID и именем" "yes" \
      "$(grep -q 'vless://8f14e45f' "$T/etc/sub.txt" && echo yes || echo no)"
check "фикстура: приватный ключ туннеля лежит в настройке сети" "yes" \
      "$(case "$(uci_get network.home.private_key)" in *6Gtidge6*) echo yes ;; *) echo no ;; esac)"

# Имена узлов приходят от ПАНЕЛИ, поэтому в ответе движка на `vless-nodes` они и подделаны
# именем с логином. Отчёт берёт оттуда только числа — это и проверяется ниже.
# STEER_NOISE — предупреждение движка перед JSON: отчёт обязан пережить его так же, как
# его переживает метод vless_nodes (json_tail).
SR_JSON='{"output":"nl","sub_file":"'"$T"'/etc/sub.txt","node":-1,"usable":3,"skipped":1,"foreign":0,
"nodes":[{"name":"🇩🇪 Germania-login-pupkin","host":"203.0.113.9","uuid":"8f14e45f-ceea-467a-9fb2-1111deadbeef"}]}'

out="$(BUILD_ID_FILE="$T/etc/build-id.txt" ZP_NFQWS_FIXTURE="$T/bin/nfqws" \
       STEER_JSON="$SR_JSON" STEER_NOISE='steer[warn]: узел 2 не ответил' \
       rpcd support_report)"
rep="$(printf '%s' "$out" | jget text)"
has() {  # ПОДСТРОКА — есть ли она в отчёте
    case "$rep" in *"$1"*) echo yes ;; *) echo no ;; esac
}

check "отчёт собран" "true" "$(printf '%s' "$out" | jget ok)"
check "отчёт — один готовый к копированию текст, а не JSON по полям" "yes" \
      "$([ "$(printf '%s\n' "$rep" | grep -c .)" -gt 15 ] && echo yes || echo no)"

# ---- состав: версии, устройство ----
check "модель роутера названа" "yes" "$(has 'Xiaomi AX3000T')"
check "версия OpenWrt названа" "yes" "$(has '24.10.0')"
check "архитектура пакетов названа" "yes" "$(has 'aarch64_cortex-a53')"
check "версия пакета интерфейса названа" "yes" "$(has '26.9-ab12cd')"
check "версия пакета движка названа" "yes" "$(has '0.9.5')"
check "вариант сборки движка назван словом, а не признаком" "yes" "$(has 'расширенн')"
check "состояние службы движка названо" "yes" "$(has 'автозапуск')"

# ---- состав: приговоры diag по-русски, а не JSON ----
check "приговоры diag попали в отчёт читаемым видом" "yes" "$(has 'таблица на месте')"
check "и не JSON'ом" "no" "$(has '"verdict"')"
check "итог проверок назван числом" "yes" "$(has 'провалов 0')"

# ---- состав: выходы и правила ----
check "выход-туннель назван" "yes" "$(has 'vpn')"
# Устройство выхода занимает в строке отдельное место, и пустое оно значит «туннель не
# поднялся» — самое частое состояние в обращениях. Проверяется именно эта половина: заглушка
# движка печатает в `status` только kind/up/mark/table, поэтому имени устройства в стенде
# взяться неоткуда, а на роутере его печатает движок (контракт steer §2: состояние выхода —
# это его запись в спеке плюс поля состояния).
check "устройство выхода названо отдельным словом" "yes" "$(has 'устройство не создано')"
check "состояние выхода названо словом" "yes" "$(has 'поднят')"
check "выход-локация подписки назван своим видом" "yes" "$(has 'vless')"
check "правила из спеки перечислены" "yes" "$(has 'Новости')"
check "и второе правило тоже" "yes" "$(has 'Соцсети')"

# ---- состав: DNS ----
check "резолвер доменов движка описан" "yes" "$(has 'резолвер доменов ядра')"
check "чужой https-dns-proxy в отчёте не читается" "no" "$(has 'https-dns-proxy')"
check "и обход DPI в отчёте не упоминается" "no" "$(has 'обход DPI')"

# ---- состав: подписка ----
check "подписка: сказано, что она есть" "yes" "$(has 'подписка')"
check "подписка: число пригодных узлов названо" "yes" "$(has 'пригодных узлов: 3')"

# ---- ГЛАВНОЕ: секретов в отчёте нет -------------------------------------------------
check "в отчёте нет ссылок узлов" "no" "$(has 'vless://')"
check "в отчёте нет ссылки подписки" "no" "$(has 'panel.example.org')"
check "в отчёте нет ключа из ссылки подписки" "no" "$(has 'SECRETTOKEN123')"
check "в отчёте нет UUID узла" "no" "$(has '8f14e45f')"
check "в отчёте нет имени узла подписки" "no" "$(has 'Germania')"
check "в отчёте нет приватного ключа туннеля" "no" "$(has '6Gtidge6')"
check "в отчёте нет адреса узла" "no" "$(has '203.0.113.9')"
# Внешний адрес роутера: тот, который отдаёт заглушка `ip` на wan. В отчёте его нет вовсе —
# ни измеренного (outbound_geo), ни взятого из настройки сети.
check "в отчёте нет внешнего адреса роутера" "no" "$(has '46.42.17.15')"
# И отдельно — что отчёт сам говорит человеку, чего в нём нет: он вставляет текст в общий
# чат и вправе это знать, не читая наш исходник.
check "отчёт сам говорит, что секретов в нём нет" "yes" "$(has 'не попали')"

# ---- ребра контракта: список ubus и ACL ---------------------------------------------
check "метод support_report объявлен в списке ubus" "yes" \
      "$(rpcd_list | grep -q '"support_report"' && echo yes || echo no)"
check "метод support_report назван в ACL" "yes" \
      "$(grep -q '"support_report"' "$ROOT/luci/root/usr/share/rpcd/acl.d/luci-app-splify2.json" \
         && echo yes || echo no)"
# Отчёт только читает состояние, поэтому он в группе read: попав в write, он потребовал бы
# от вызывающего прав, которых у страницы обзора нет.
check "и назван он именно в разделе read" "yes" \
      "$(python3 -c 'import json,sys
d = json.load(open(sys.argv[1]))["luci-app-splify2"]
print("yes" if "support_report" in d["read"]["ubus"]["splify2"] else "no")' \
        "$ROOT/luci/root/usr/share/rpcd/acl.d/luci-app-splify2.json")"

# ---- отчёт на сломанном роутере ------------------------------------------------------
# Отчёт собирают ИМЕННО ТОГДА, когда что-то не работает, поэтому он обязан собираться и без
# движка, и без спеки. Пустой ответ или отказ в этом состоянии оставил бы человека без
# единственного, что он мог показать помогающему.
mv "$T/bin/steer" "$T/bin/steer.off"
printf '{"schema":1,"outputs":{},"channels":[]}\n' > "$T/etc/spec.json"
out="$(BUILD_ID_FILE="$T/etc/build-id.txt" rpcd support_report)"
rep="$(printf '%s' "$out" | jget text)"
check "без движка отчёт всё равно собирается" "true" "$(printf '%s' "$out" | jget ok)"
check "и говорит, что движка нет" "yes" "$(has 'ядро steer: НЕ УСТАНОВЛЕНО')"
# Незнание называется незнанием: «движок не ответил» и «движка нет» — разные диагнозы, и
# второй уводит помогающего чинить не то.
check "и не выдаёт молчание diag за исправность" "yes" "$(has 'не ответило на diag')"
check "модель и прошивка при этом на месте — их знает не движок" "yes" "$(has 'Xiaomi AX3000T')"
check "пустая спека — это «правил нет», а не пустой раздел" "yes" \
      "$(has 'правил нет')"
mv "$T/bin/steer.off" "$T/bin/steer"

# Подписки нет вовсе — тоже состояние, а не пустое место: с него начинается половина
# обращений («поставил, а интернета нет»).
rm -f "$T/etc/sub.txt" "$T/etc/subs"/*.txt
uci_set splify2.main.sub_url ''
out="$(BUILD_ID_FILE="$T/etc/build-id.txt" rpcd support_report)"
rep="$(printf '%s' "$out" | jget text)"
check "отсутствие подписки названо словами" "yes" "$(has 'подписок нет')"

# ---- источники трафика: свой исходящий туннель источником быть не может ---------------
# Перечень сетей клиентов (splify2#16, выше по файлу) отдавал ВСЁ, что нашлось в /sys, кроме
# lo и портов моста. А в /sys лежат и наши СОБСТВЕННЫЕ исходящие туннели: устройство выхода
# kind=vless, wg-клиент до провайдера, туннель xsteer. Отметить такое устройство «сетью
# клиентов» человек мог прямо на экране — и получал попытку забрать трафик из того самого
# туннеля, через который сам уходит наружу, ожидая ровно обратного. Подпись экрана обещает
# «тех, кто ко мне приходит», и в этом вся ловушка: она не врёт, врёт список под ней.
#
# Два вида туннелей надо РАЗЛИЧАТЬ, и различие содержательное:
#  * через который МЫ уходим наружу (tun-vless, wg до провайдера, xsteer) — источником быть
#    не может;
#  * через который к НАМ приходят чужие устройства (сервер wireguard, Tailscale, ZeroTier) —
#    законный источник, ради него перечень и заведён.
# В /sys они выглядят одинаково (оба ARPHRD_NONE, у обоих бывает адрес /32), поэтому ниже —
# по проверке на каждый признак, которым они всё-таки различаются.
#
# НЕГОДНОЕ ОСТАЁТСЯ В ОТВЕТЕ, и это проверяется первым. Выкинутое устройство человек ищет
# глазами, не находит и решает, что перечень сломан («куда делся мой wg0») — тот же довод, по
# которому и wan помечается, а не прячется.
#
# Фикстура своя (шов SYSNET_FIXTURE): набор устройств здесь другой, чем у раздела выше, и
# дописать его туда значило бы менять ожидания уже написанных проверок. Помощники names,
# netof и flagof — оттуда же: вопрос к ответу тот же, и второй их набор разошёлся бы с первым.
mkdir -p "$T/sysnet-src/lo" "$T/sysnet-src/br-lan" "$T/sysnet-src/lan1" "$T/sysnet-src/wan" \
         "$T/sysnet-src/tun-vless" "$T/sysnet-src/wg-prov" "$T/sysnet-src/wg-b" \
         "$T/sysnet-src/wg-vpn" "$T/sysnet-src/wg-home" "$T/sysnet-src/xs-hub" \
         "$T/sysnet-src/xs-dc9" "$T/sysnet-src/tun-def" "$T/sysnet-src/tailscale0"
ln -s ../br-lan "$T/sysnet-src/lan1/master"
for d in lo br-lan lan1 wan tun-vless wg-prov wg-b wg-vpn wg-home xs-hub xs-dc9 tun-def \
         tailscale0; do
    printf 'up\n' > "$T/sysnet-src/$d/operstate"
done

# Спека с выходами всех трёх видов, у которых есть устройство. Каждый выход здесь закрывает
# свой путь, которым устройство попадает в ответ движка:
#  * tun-vless — kind=vless БЕЗ явного device: имя устройства выводится из имени выхода, и
#    знает об этом только движок, в спеке такого поля нет вовсе;
#  * vpn — kind=interface с явным `device`: wg-клиент до провайдера, самый частый выход;
#  * pool — kind=interface с `devices`: движок печатает у выхода ОДНО устройство (devices[0]),
#    поэтому второй член пула виден только в самой спеке. Он такое же наше исходящее.
cat > "$T/etc/spec.json" <<'EOF'
{ "schema": 1,
  "outputs": {
    "tun-vless": { "kind": "vless", "sub_file": "/etc/steer/sub.txt" },
    "vpn":       { "kind": "interface", "device": "wg-prov" },
    "pool":      { "kind": "interface", "devices": ["wg-prov", "wg-b"] },
    "plain":     { "kind": "direct" }
  },
  "channels": [] }
EOF

# Настройки сети: что наружу и какие интерфейсы поднимает наш обработчик netifd. Имя
# устройства у proto=xsteer берётся из `device_name`, а без него выводится приставкой
# `xs-` из имени интерфейса — ровно так его создаёт files/lib/netifd/proto/xsteer.sh, и
# проверяются оба пути: секция hub без device_name даёт xs-hub, секция dc9 — своё имя.
uci_set network.wan.device wan
uci_set network.hub.proto xsteer
uci_set network.dc9.proto xsteer
uci_set network.dc9.device_name xs-dc9

# `ip` для этого раздела: адреса И МАРШРУТ ПО УМОЛЧАНИЮ. Общая заглушка выше на `route`
# молчит — там маршруты никого не интересовали; здесь маршрут по умолчанию как раз и
# опознаёт туннель, через который роутер уходит наружу, когда о нём не сказано больше
# ничего: ни выхода в спеке, ни proto=xsteer, ни утилиты wg. Форма строки списана с живой
# машины: `default via 10.0.0.1 dev ens3 onlink`. Заглушка ставится в конце файла и после
# этого раздела ничего не проверяется — иначе её пришлось бы возвращать на место.
cat > "$T/bin/ip" <<'EOF'
#!/bin/sh
args=" $* "
case "$args" in
    *" rule "*) exit 0 ;;
    *" route "*)
        case "$args" in
            *" default "*)
                [ -n "${IP_DEFAULT_DEV:-}" ] &&
                    printf 'default via 192.0.2.1 dev %s onlink\n' "$IP_DEFAULT_DEV" ;;
        esac
        exit 0 ;;
esac
# Адреса — с хвостом после префикса, как у настоящего `ip -4 -o addr show`: разбор обязан
# брать второе поле после `inet`, а не всю строку.
echo "3: br-lan    inet 192.168.1.1/24 brd 192.168.1.255 scope global br-lan"
echo "4: wan    inet 46.42.17.15/22 brd 46.42.19.255 scope global wan"
echo "9: tailscale0    inet 100.64.1.5/32 scope global tailscale0"
echo "11: wg-home    inet 10.9.0.1/24 scope global wg-home"
echo "12: wg-vpn    inet 10.66.0.2/32 scope global wg-vpn"
exit 0
EOF
chmod +x "$T/bin/ip"

# `wg show all allowed-ips`: устройство, ключ пира и разрешённые сети через ТАБУЛЯЦИЮ, сети
# между собой — через пробел. Форма проверена на живой машине (wireguard-tools, ядерный
# wireguard): у пира-клиента там стоит 0.0.0.0/0, у пиров сервера — по адресу на пира.
#
# WG_SILENT=1 — «утилита есть, а сказать ей нечего»: нет ядерного модуля, нет прав, нет ни
# одного интерфейса. Признака тогда не существует, и перечень обязан это пережить. Случай
# «wg не установлен вовсе» стендом не проверяется: заглушка живёт в PATH, а отсутствие в
# PATH означало бы, что находится настоящий wg машины разработчика, — то есть проверка
# зависела бы от того, что поднято на ней. В объекте эта ветка закрыта `command -v wg`.
cat > "$T/bin/wg" <<'EOF'
#!/bin/sh
[ -n "${WG_SILENT:-}" ] && exit 1
case "$*" in
    "show all allowed-ips")
        printf 'wg-vpn\tKCLIENT=\t0.0.0.0/0 ::/0\n'
        printf 'wg-home\tKPEER1=\t10.9.0.2/32\n'
        printf 'wg-home\tKPEER2=\t10.9.0.3/32 192.168.5.0/24\n'
        ;;
esac
exit 0
EOF
chmod +x "$T/bin/wg"

# Причина — СТРОКОЙ, как её прочитает человек: flagof печатает JSON-значение (в кавычках),
# а здесь проверяется, что в тексте есть нужное слово.
whyof() { printf '%s' "$1" | python3 -c 'import json,sys
n=[d for d in json.load(sys.stdin)["nets"] if d["name"]==sys.argv[1]]
print(n[0].get("why", "ПОЛЯ НЕТ") if n else "НЕТ")' "$2"; }

out="$(IP_DEFAULT_DEV=tun-def SYSNET_FIXTURE="$T/sysnet-src" rpcd client_nets)"

check "негодные в источники из перечня НЕ выброшены" \
      "br-lan tailscale0 tun-def tun-vless wan wg-b wg-home wg-prov wg-vpn xs-dc9 xs-hub" \
      "$(names "$out")"
# ---- признак 1: устройство названо в спеке устройством нашего выхода (точный) ----
check "устройство выхода kind=vless источником не годится" "false" \
      "$(flagof "$out" tun-vless usable)"
check "и причина названа словами, а не кодом" "yes" \
      "$(whyof "$out" tun-vless | grep -q 'выход' && echo yes || echo no)"
check "явно названное устройство выхода kind=interface — тоже" "false" \
      "$(flagof "$out" wg-prov usable)"
check "и второе устройство пула, которого движок не печатает" "false" \
      "$(flagof "$out" wg-b usable)"
# ---- признак 2: маршрут по умолчанию ----
# Туннель, поднятый руками и никак не названный в наших настройках, опознаётся только так.
check "через устройство идёт маршрут по умолчанию — значит наружу" "false" \
      "$(flagof "$out" tun-def usable)"
check "и про маршрут в причине сказано" "yes" \
      "$(whyof "$out" tun-def | grep -q 'маршрут' && echo yes || echo no)"
# ---- признак 3: proto=xsteer в /etc/config/network ----
check "туннель proto=xsteer с выведенным именем устройства — наш" "false" \
      "$(flagof "$out" xs-hub usable)"
check "и он же, названный device_name" "false" "$(flagof "$out" xs-dc9 usable)"
# ---- признак 4: пиры wireguard ----
# ГЛАВНОЕ РАЗЛИЧЕНИЕ. Оба устройства — ядерный wireguard, в /sys неотличимы; разница в том,
# КУДА разрешён трафик пирам: весь мир (мы клиент) против адреса на пира (мы сервер).
check "wg-клиент до провайдера (у пира 0.0.0.0/0) источником не годится" "false" \
      "$(flagof "$out" wg-vpn usable)"
check "сервер wireguard для своих устройств — ЗАКОННЫЙ источник" "true" \
      "$(flagof "$out" wg-home usable)"
# ---- wan и обычные сети ----
# Забирать трафик С wan значило бы заворачивать в туннель то, что из туннеля и вышло.
check "wan источником не предлагается" "false" "$(flagof "$out" wan usable)"
check "домашний мост годится" "true" "$(flagof "$out" br-lan usable)"
check "tailscale0 годится: через него к нам как раз приходят" "true" \
      "$(flagof "$out" tailscale0 usable)"
check "у годного причины отказа нет" "" "$(whyof "$out" br-lan)"
# Причина нужна на КАЖДОМ негодном: пустая строка на экране — это серая строка без
# объяснения, то есть ровно то «куда делся мой wg0», от которого перечень и защищает.
check "у каждого негодного причина непустая" "" \
      "$(printf '%s' "$out" | python3 -c 'import json,sys
print(" ".join(d["name"] for d in json.load(sys.stdin)["nets"]
                if not d.get("usable", True) and not d.get("why")))')"
# ---- прежние поля не сломаны: их читает вкладка ----
check "wan по-прежнему помечен своим полем" "true" "$(flagof "$out" wan wan)"
check "подсеть моста на месте" "192.168.1.0/24" "$(netof "$out" br-lan)"
check "поднятость на месте" "true" "$(flagof "$out" br-lan up)"

# ---- wg молчит: признака нет, а перечень есть ----
out="$(WG_SILENT=1 IP_DEFAULT_DEV=tun-def SYSNET_FIXTURE="$T/sysnet-src" rpcd client_nets)"
check "без ответа wg перечень всё равно собирается" "true" "$(flagof "$out" br-lan usable)"
check "и законный источник не запрещён заодно" "true" "$(flagof "$out" wg-home usable)"
# Обратная сторона названа здесь честно: без wg клиент до провайдера ничем не отличается от
# сервера, и перечень его предложит. Запрещать всё ядерное wireguard «на всякий случай»
# хуже: это отняло бы у человека тот самый случай, ради которого перечень заведён. Точный
# признак остаётся на месте — заведите на этот туннель выход, и он уйдёт из источников.
check "wg-клиента без wg отличить нечем — и он остаётся предложенным" "true" \
      "$(flagof "$out" wg-vpn usable)"
# А то, что названо в спеке, молчание wg не спасает: признак спеки от wg не зависит.
check "устройство выхода негодно и без wg" "false" "$(flagof "$out" wg-prov usable)"

# ---- бэкенд старее приговора: поля просто нет ----
# Проверять здесь нечего кроме того, что поле ПЕЧАТАЕТСЯ ВСЕГДА: «поля нет» и «поле false»
# вкладка обязана различать, иначе на старом объекте она покрасила бы серым весь список.
check "приговор печатается и у годного устройства, а не только у негодного" "true" \
      "$(flagof "$out" br-lan usable)"

# ---- проброс из зон, где лежат устройства клиентов (обращение по Андромеде) ----------------
# Человек добавил tailscale0 в «Кого маршрутизируем»: движок метит пакеты с обоих устройств
# (`iifname { "br-lan", "tailscale0" }`), маршрут ведёт в туннель — а forward-цепочка fw4 пакет
# отбрасывает, потому что политика forward у fw4 применяется к ПАРЕ зон, и разрешался только
# lan -> зона туннелей. tailscale0 в своей зоне (ts) — обычная раскладка по руководствам, и
# для неё «выбрал устройство, применил, не заработало». Устройства в спеке выбираем мы, значит
# и проброс из их зон — наша забота: заводится с расписки (fw-owned), убирается, когда устройств
# из этой зоны в спеке больше нет; lan и так пробрасывается, зона туннеля сама к себе — нет.
fwd_srcs() {  # ЗОНА-ПОЛУЧАТЕЛЬ -> зоны-источники пробросов в неё, через пробел, по алфавиту
    sed -n "s/^firewall\.\(@forwarding\[[0-9]*\]\)\.dest=$1$/\1/p" "$T/uci.store" | while IFS= read -r _f; do
        uci_get "firewall.$_f.src"; echo
    done | grep . | sort | tr '\n' ' ' | sed 's/ $//'
}
rm -f "$T/uci.store" "$T/etc/fw-owned"; : > "$T/uci.store"
uci_set 'firewall.@zone[0]' zone;  uci_set 'firewall.@zone[0].name' lan; uci_set 'firewall.@zone[0].device' 'br-lan'
uci_set 'firewall.@zone[1]' zone;  uci_set 'firewall.@zone[1].name' wan; uci_set 'firewall.@zone[1].device' 'eth1'
uci_set 'firewall.@zone[2]' zone;  uci_set 'firewall.@zone[2].name' ts;  uci_set 'firewall.@zone[2].device' 'tailscale0'
uci_set 'firewall.@forwarding[0]' forwarding; uci_set 'firewall.@forwarding[0].src' lan; uci_set 'firewall.@forwarding[0].dest' wan
printf '%s\n' '{"schema":1,"lan_devices":["br-lan","tailscale0"],"outputs":{"direct":{"kind":"direct"},"vpn":{"kind":"interface","device":"wg0","on_fail":"direct"}},"channels":[]}' > "$T/etc/spec.json"
out="$(rpcd apply)"
check "apply с устройством клиентов из чужой зоны прошёл" "true" "$(printf '%s' "$out" | jget ok)"
check "проброс в зону туннелей заведён и из lan, и из зоны tailscale0" "lan ts" "$(fwd_srcs steer_iface)"
check "проброс из чужой зоны записан за нами" "yes" \
      "$(grep -qx 'fwd steer_iface ts' "$T/etc/fw-owned" 2>/dev/null && echo yes || echo no)"
check "и назван в ответе apply" "yes" \
      "$(printf '%s' "$out" | grep -q 'проброс ts -> steer_iface' && echo yes || echo no)"
# Повторный apply ничего не дублирует.
out="$(rpcd apply)"
check "второй apply проброс не дублирует" "lan ts" "$(fwd_srcs steer_iface)"
# Устройство из зоны ts ушло из спеки — наш проброс убирается, расписка снимается, lan остаётся.
printf '%s\n' '{"schema":1,"lan_devices":["br-lan"],"outputs":{"direct":{"kind":"direct"},"vpn":{"kind":"interface","device":"wg0","on_fail":"direct"}},"channels":[]}' > "$T/etc/spec.json"
out="$(rpcd apply)"
check "устройств из зоны ts в спеке нет — наш проброс убран" "lan" "$(fwd_srcs steer_iface)"
check "и расписка снята" "no" \
      "$(grep -qx 'fwd steer_iface ts' "$T/etc/fw-owned" 2>/dev/null && echo yes || echo no)"
# Зона объявлена через network, а не device: интерфейс tailscale с устройством tailscale0.
uci_set 'network.tailscale' interface; uci_set 'network.tailscale.device' 'tailscale0'
uci_set 'firewall.@zone[2].device' ''; uci_set 'firewall.@zone[2].network' 'tailscale'
printf '%s\n' '{"schema":1,"lan_devices":["br-lan","tailscale0"],"outputs":{"direct":{"kind":"direct"},"vpn":{"kind":"interface","device":"wg0","on_fail":"direct"}},"channels":[]}' > "$T/etc/spec.json"
out="$(rpcd apply)"
check "зона, заданная через network, тоже узнаётся" "lan ts" "$(fwd_srcs steer_iface)"
# Зона — ИМЕНОВАННАЯ секция (`config zone 'ts'`): так её пишут руками по руководствам, и uci
# зовёт её не «@zone[N]», а именем. До правки такая зона для нас не существовала: устройство
# клиентов считалось ничьим, проброс не заводился — то есть H-206 для неё не работал вовсе.
rm -f "$T/uci.store" "$T/etc/fw-owned"; : > "$T/uci.store"
uci_set 'firewall.@zone[0]' zone;  uci_set 'firewall.@zone[0].name' lan; uci_set 'firewall.@zone[0].device' 'br-lan'
uci_set 'firewall.ts' zone;        uci_set 'firewall.ts.name' ts;        uci_set 'firewall.ts.device' 'tailscale0'
# Правило с тем же именем — не зона, и по нему устройство искать нельзя.
uci_set 'firewall.ts_rule' rule;   uci_set 'firewall.ts_rule.name' ts;   uci_set 'firewall.ts_rule.src' ts
printf '%s\n' '{"schema":1,"lan_devices":["br-lan","tailscale0"],"outputs":{"direct":{"kind":"direct"},"vpn":{"kind":"interface","device":"wg0","on_fail":"direct"}},"channels":[]}' > "$T/etc/spec.json"
out="$(rpcd apply)"
check "именованная зона с устройством клиентов узнаётся — проброс заведён" "lan ts" "$(fwd_srcs steer_iface)"
# Проброс в нашу зону человек дописал сам именованной секцией — второго не заводим и чужой не трогаем.
rm -f "$T/uci.store" "$T/etc/fw-owned"; : > "$T/uci.store"
uci_set 'firewall.@zone[0]' zone;  uci_set 'firewall.@zone[0].name' lan; uci_set 'firewall.@zone[0].device' 'br-lan'
uci_set 'firewall.ts' zone;        uci_set 'firewall.ts.name' ts;        uci_set 'firewall.ts.device' 'tailscale0'
uci_set 'firewall.@zone[1]' zone;  uci_set 'firewall.@zone[1].name' steer_iface; uci_set 'firewall.@zone[1].device' 'wg0'
uci_set 'firewall.ts2vpn' forwarding; uci_set 'firewall.ts2vpn.src' ts; uci_set 'firewall.ts2vpn.dest' steer_iface
out="$(rpcd apply)"
check "чужой именованный проброс ts -> зона туннелей не дублируется" "1" \
      "$(grep -c '^firewall\.[^.]*\.dest=steer_iface$' "$T/uci.store" | { read -r n; echo $((n - $(grep -c '^firewall\.@forwarding\[[0-9]*\]\.src=lan$' "$T/uci.store"))); })"
check "и за нами не записан" "no" \
      "$(grep -qx 'fwd steer_iface ts' "$T/etc/fw-owned" 2>/dev/null && echo yes || echo no)"
# Оба устройства в lan — лишних пробросов нет.
rm -f "$T/uci.store" "$T/etc/fw-owned"; : > "$T/uci.store"
uci_set 'firewall.@zone[0]' zone;  uci_set 'firewall.@zone[0].name' lan; uci_set 'firewall.@zone[0].device' 'br-lan tailscale0'
out="$(rpcd apply)"
check "оба устройства в lan — проброс один" "lan" "$(fwd_srcs steer_iface)"
rm -f "$T/uci.store"; : > "$T/uci.store"

# ---- устройство клиентов БЕЗ ЗОНЫ ВОВСЕ: зону заводим мы -----------------------------------
#
# Второе обращение по Андромеде, и корень у него общий с первым: интерфейс, не входящий ни в
# одну зону, fw4 роняет дважды. `forward` — маршрутизации через нас нет совсем; `input` — до
# самого роутера с него не доходит ничего, включая завёрнутый нами DNS (заворот делает DNAT на
# адрес роутера, дальше пакет идёт через `input`). Снаружи это «выбрал tailscale0 в клиентах,
# правила стоят, а DNS не подхватывает». Без зоны поднимаются ровно те интерфейсы, из-за
# которых перечень клиентов и появился: tailscale0 и интерфейс сервера WireGuard от мастера
# OpenWrt. Условие ровно одно — СВОЕЙ ЗОНЫ НЕТ; лежащее в чужой зоне не трогаем (проверено выше).
zone_id_by_name() {  # ИМЯ_ЗОНЫ -> идентификатор секции
    sed -n 's/^firewall\.\([^.=]*\)\.name='"$1"'$/\1/p' "$T/uci.store" | while IFS= read -r _z; do
        [ "$(uci_get "firewall.$_z")" = zone ] && { printf '%s' "$_z"; return 0; }
    done
}
zone_devs() {  # ИМЯ_ЗОНЫ -> её устройства через пробел
    _zd_i="$(zone_id_by_name "$1")"
    [ -n "$_zd_i" ] || return 0
    uci_get "firewall.$_zd_i.device" | tr ' ' '\n' | grep . | sort | tr '\n' ' ' | sed 's/ $//'
}
fwd_dests() {  # ЗОНА-ИСТОЧНИК -> зоны-получатели пробросов из неё
    sed -n 's/^firewall\.\([^.=]*\)\.src='"$1"'$/\1/p' "$T/uci.store" | while IFS= read -r _f; do
        [ "$(uci_get "firewall.$_f")" = forwarding ] && { uci_get "firewall.$_f.dest"; echo; }
    done | grep . | sort | tr '\n' ' ' | sed 's/ $//'
}
rm -f "$T/uci.store" "$T/etc/fw-owned"; : > "$T/uci.store"
uci_set 'firewall.@zone[0]' zone;  uci_set 'firewall.@zone[0].name' lan; uci_set 'firewall.@zone[0].device' 'br-lan'
uci_set 'firewall.@zone[1]' zone;  uci_set 'firewall.@zone[1].name' wan; uci_set 'firewall.@zone[1].device' 'eth1'
uci_set 'firewall.@forwarding[0]' forwarding; uci_set 'firewall.@forwarding[0].src' lan; uci_set 'firewall.@forwarding[0].dest' wan
printf '%s\n' '{"schema":1,"lan_devices":["br-lan","tailscale0"],"outputs":{"direct":{"kind":"direct"},"vpn":{"kind":"interface","device":"wg0","on_fail":"direct"}},"channels":[]}' > "$T/etc/spec.json"
out="$(rpcd apply)"
check "apply с беззонным устройством клиентов прошёл" "true" "$(printf '%s' "$out" | jget ok)"
# Только беззонное: br-lan лежит в lan и остаётся там.
check "зона клиентов заведена и в ней ровно беззонное устройство" "tailscale0" "$(zone_devs steer_clients)"
check "br-lan в неё не попал" "br-lan" "$(zone_devs lan)"
# input ACCEPT — то самое отличие от зон туннелей: без него будет маршрутизация без имён.
check "у зоны клиентов input ACCEPT" "ACCEPT" "$(uci_get "firewall.$(zone_id_by_name steer_clients).input")"
check "forward ACCEPT — иначе смысла в зоне нет" "ACCEPT" "$(uci_get "firewall.$(zone_id_by_name steer_clients).forward")"
# NAT здесь не нужен: адреса клиентов транслирует зона туннеля, куда пакет уходит.
check "NAT у зоны клиентов не включается" "0" "$(uci_get "firewall.$(zone_id_by_name steer_clients).masq")"
# Пробросы — ИЗ зоны: в зону туннелей (её заводит синхронизация той зоны) и в wan, без которого
# всё, что не названо в правилах, продолжало бы молча падать.
check "из зоны клиентов пробрасывается и в туннель, и в wan" "steer_iface wan" "$(fwd_dests steer_clients)"
check "в зону туннелей пробрасывается и из lan, и из зоны клиентов" "lan steer_clients" "$(fwd_srcs steer_iface)"
# Обратных пробросов не заводим ВОВСЕ: `lan -> зона клиентов` открыл бы локальной сети доступ
# к пирам чужого туннеля, а об этом нас никто не просил.
check "в зону клиентов не пробрасывается ниоткуда" "" "$(fwd_srcs steer_clients)"
check "зона и проброс в wan записаны за нами" "yes" \
      "$(grep -qx 'zone steer_clients' "$T/etc/fw-owned" 2>/dev/null &&
         grep -qx 'fwd wan steer_clients' "$T/etc/fw-owned" 2>/dev/null && echo yes || echo no)"
# Повторный apply ничего не дублирует.
out="$(rpcd apply)"
check "второй apply зону и пробросы не дублирует" "steer_iface wan" "$(fwd_dests steer_clients)"
# Устройство ушло из спеки — зона уходит вместе с ОБОИМИ пробросами. Оставленный проброс с
# `src` на удалённую зону fw4 отвергает так же, как с `dest`, — роутер остался бы без фаервола.
printf '%s\n' '{"schema":1,"lan_devices":["br-lan"],"outputs":{"direct":{"kind":"direct"},"vpn":{"kind":"interface","device":"wg0","on_fail":"direct"}},"channels":[]}' > "$T/etc/spec.json"
out="$(rpcd apply)"
check "устройства беззонных клиентов ушли — зоны нет" "" "$(zone_id_by_name steer_clients)"
check "и ни одного проброса, её касающегося" "" "$(fwd_dests steer_clients)$(fwd_srcs steer_clients)"
check "а проброс lan -> зона туннелей остался" "lan" "$(fwd_srcs steer_iface)"
# Человек положил tailscale0 в свою зону — своей мы больше не заводим, только проброс.
rm -f "$T/uci.store" "$T/etc/fw-owned"; : > "$T/uci.store"
uci_set 'firewall.@zone[0]' zone;  uci_set 'firewall.@zone[0].name' lan; uci_set 'firewall.@zone[0].device' 'br-lan'
uci_set 'firewall.@zone[1]' zone;  uci_set 'firewall.@zone[1].name' wan; uci_set 'firewall.@zone[1].device' 'eth1'
uci_set 'firewall.ts' zone;        uci_set 'firewall.ts.name' ts;        uci_set 'firewall.ts.device' 'tailscale0'
printf '%s\n' '{"schema":1,"lan_devices":["br-lan","tailscale0"],"outputs":{"direct":{"kind":"direct"},"vpn":{"kind":"interface","device":"wg0","on_fail":"direct"}},"channels":[]}' > "$T/etc/spec.json"
out="$(rpcd apply)"
check "у устройства есть своя зона — нашей не появляется" "" "$(zone_id_by_name steer_clients)"
check "ему хватает проброса из его зоны" "lan ts" "$(fwd_srcs steer_iface)"
rm -f "$T/uci.store"; : > "$T/uci.store"

# ---- спека v2: бэкенд читает её так же, как прежнюю v1 ------------------------------------
# Интерфейс пишет v2 (`lists`, `rules`, `subscription`, `lan.devices`); до первого сохранения на
# диске может лежать v1. Читатели оболочки понимают обе формы.
mkdir -p "$T/etc/subs"
printf 'vless://k@h:443#n\n' > "$T/etc/subs/v2.txt"
cat > "$T/etc/spec.json" <<EOF
{"version":2,"lan":{"devices":["br-lan"]},
 "lists":{"a":{"domains_file":["$T/lists/domains/v2only.lst"]},"b":{"prefixes_file":["$T/lists/v2pfx.lst"]}},
 "outputs":{"direct":{"kind":"direct"},"nl":{"kind":"tunnel","protocol":"vless","subscription":"$T/etc/subs/v2.txt","nodes":[0,2]}},
 "rules":[{"name":"Новости","to":["a"],"out":"nl"},{"name":"Всё","to":"all","out":"direct","enabled":false}]}
EOF
rm -f "$T/lists/domains/v2only.lst" "$T/lists/v2pfx.lst"
printf '{"categories":[],"domain_lists":[],"base_url":"https://example.invalid/l"}\n' > "$T/etc/manifest.json"
out="$(rpcd apply)"
check "доскачивание видит файлы списков спеки v2" "yes;yes" \
      "$([ -s "$T/lists/domains/v2only.lst" ] && echo yes || echo no);$([ -s "$T/lists/v2pfx.lst" ] && echo yes || echo no)"
check "подписка выхода tunnel найдена по ключу subscription" "1;2" \
      "$(rpcd sub_list | python3 -c 'import json,sys
d=[d for d in json.load(sys.stdin)["subs"] if d["name"]=="v2"]
print("%s;%s" % (d[0]["used"], d[0]["used_nodes"]) if d else "нет")')"
rep="$(rpcd support_report | jget text)"
check "отчёт читает правила v2 с видом списка" "yes;yes;yes" \
      "$(printf '%s' "$rep" | grep -q 'Новости -> nl (доменные списки)' && echo yes || echo no);$(printf '%s' "$rep" | grep -q 'Всё -> direct (весь трафик) \[ВЫКЛЮЧЕНО\]' && echo yes || echo no);$(printf '%s' "$rep" | grep -q 'vless://' && echo no || echo yes)"
# Архив со спекой v2 принимается восстановлением.
out="$(printf '%s\n' 'splify2-backup 2' '[spec]' '{"version":2,"outputs":{"direct":{"kind":"direct"}},"rules":[{"name":"x","to":"all","out":"direct"}]}' | backup_put)"
check "архив со спекой v2 принимается" "true" "$(printf '%s' "$out" | jget ok)"
out="$(printf '%s\n' 'splify2-backup 2' '[spec]' '{"version":2,"rules":[{"name":"x","to":"all","out":"a;reboot"}]}' | backup_put)"
check "имя выхода с разделителем в правиле v2 отвергается" "false" "$(printf '%s' "$out" | jget ok)"
out="$(printf '%s\n' 'splify2-backup 2' '[spec]' '{"version":2,"lists":{"a":{"domains_file":["/etc/passwd"]}}}' | backup_put)"
check "список вне каталога списков в v2 отвергается" "false" "$(printf '%s' "$out" | jget ok)"
out="$(printf '%s\n' 'splify2-backup 2' '[spec]' '{"version":2,"dns":{"upstreams":{"g":{"url":"file:///etc/shadow"}}}}' | backup_put)"
check "чужая схема в адресе DNS отвергается" "false" "$(printf '%s' "$out" | jget ok)"
out="$(printf '%s\n' 'splify2-backup 2' '[spec]' '{"version":2,"outputs":{"t":{"kind":"awg","conf":"/etc/shadow"}}}' | backup_put)"
check "файл настройки вне каталога движка отвергается" "false" "$(printf '%s' "$out" | jget ok)"


# ---- туннели ядра без ping: hysteria2 и прокси steer-proxy -----------------------------------
# Свой TUN у hysteria2 и у прокси (trojan, shadowsocks, socks, http, vmess) поднимает ядро, ICMP
# через него не ходит. outbound_probe мерил их ping-ом через устройство и всегда отвечал «нет
# ответа»; перечень устройств их не знал (пул не собрать, пока туннель выключен), а зона фаервола
# туннелей ядра их не получала — ответы через такой туннель резал fw4 (как I-386).
cat > "$T/etc/spec.json" <<'EOF2'
{ "version": 2,
  "outputs": {
    "direct": { "kind": "direct" },
    "tr": { "kind": "tunnel", "protocol": "trojan", "subscription": "/etc/steer/sub.txt" },
    "ss": { "kind": "tunnel", "protocol": "shadowsocks", "subscription": "/etc/steer/sub.txt", "device": "ss9" },
    "hy": { "kind": "tunnel", "protocol": "hysteria2", "subscription": "/etc/steer/sub.txt" },
    "vl": { "kind": "tunnel", "protocol": "vless", "subscription": "/etc/steer/sub.txt" }
  },
  "rules": [] }
EOF2
: > "$T/steer.log"
out="$(STEER_JSON='{"output":"tr","results":[{"index":0,"name":"a","type":"trojan","ok":false,"handshake_ms":40,"ttfb_ms":-1,"why":"нет"},{"index":1,"name":"b","type":"trojan","ok":true,"handshake_ms":123,"ttfb_ms":-1,"why":"ok"}],"working":1}' \
       rpcd outbound_probe '{"output":"tr"}')"
check "outbound_probe у trojan: меряет ядро командой proxy-probe" "1" "$(grep -c '^proxy-probe tr ' "$T/steer.log")"
check "и задержка — рукопожатие ответившего узла" "ok;123" "$(printf '%s' "$out" | jget state);$(printf '%s' "$out" | jget ms)"
: > "$T/steer.log"
out="$(STEER_JSON='{"output":"hy","results":[{"index":0,"name":"h","type":"hysteria2","ok":true,"handshake_ms":77,"ttfb_ms":-1,"why":"ok"}],"working":0}' \
       rpcd outbound_probe '{"output":"hy"}')"
check "outbound_probe у hysteria2: проба hysteria2-probe, а не ping" "1;77" \
      "$(grep -c '^hysteria2-probe hy ' "$T/steer.log");$(printf '%s' "$out" | jget ms)"
out="$(STEER_JSON='{"output":"vl","results":[{"index":0,"name":"v","type":"tcp","ok":true,"handshake_ms":50,"ttfb_ms":210,"why":"ok"}],"working":0}' \
       rpcd outbound_probe '{"output":"vl"}')"
check "outbound_probe у vless: по-прежнему ответ через туннель (ttfb)" "210" "$(printf '%s' "$out" | jget ms)"
out="$(STEER_JSON='{"output":"tr","results":[{"index":0,"name":"a","type":"trojan","ok":false,"handshake_ms":40,"ttfb_ms":-1,"why":"нет"}],"working":-1}' STEER_RC=1 \
       rpcd outbound_probe '{"output":"tr"}')"
check "узел не ответил — «нет ответа», а не задержка неудачной попытки" "нет ответа;-1" \
      "$(printf '%s' "$out" | jget state);$(printf '%s' "$out" | jget ms)"
check "перечень устройств знает туннели hysteria2 и прокси" "yes;yes;yes" \
      "$(d="$(devs "$(rpcd devices)")"; for x in tr ss9 hy; do case " $d " in *" $x "*) printf yes ;; *) printf no ;; esac; [ "$x" = hy ] || printf ';'; done)"
rm -f "$T/uci.store" "$T/etc/fw-owned"; : > "$T/uci.store"
uci_set 'firewall.@zone[0]' zone;  uci_set 'firewall.@zone[0].name' lan; uci_set 'firewall.@zone[0].device' 'br-lan'
uci_set 'firewall.@zone[1]' zone;  uci_set 'firewall.@zone[1].name' wan; uci_set 'firewall.@zone[1].device' 'eth1'
out="$(rpcd apply)"
check "apply со спекой прокси прошёл" "true" "$(printf '%s' "$out" | jget ok)"
check "устройства hysteria2 и прокси — в зоне туннелей ядра, без NAT" "hy ss9 tr vl;0" \
      "$(zone_devs steer_vless);$(uci_get "firewall.$(zone_id_by_name steer_vless).masq")"
check "строка зон purge та же, что у объекта rpcd" \
      "$(sed -n 's/^FW_ZONES="\(.*\)"$/\1/p' "$SCRIPT")" \
      "$(sed -n 's/^FW_ZONES=${FW_ZONES:-"\(.*\)"}$/\1/p' "$ROOT/files/usr/sbin/splify2-purge")"
rm -f "$T/uci.store" "$T/etc/fw-owned"; : > "$T/uci.store"
printf '{"schema":1,"outputs":{},"channels":[]}\n' > "$T/etc/spec.json"

printf '\n%s\n' "$([ "$fails" -eq 0 ] && echo 'все проверки прошли' || echo "ЕСТЬ ПРОВАЛЫ: $fails")"
[ "$fails" -eq 0 ]
