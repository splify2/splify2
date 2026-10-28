#!/bin/sh
# Помощники подписок: имена, поля uci, вид источника, название продавца, остаток трафика. Подключаются группой sub
# (m-sub.sh) и службами хоста `sub` (splify2-host). Расписание автообновления сюда не входит: им владеет плагин
# subscriptions (splify2-api, хук sub_fields).

# Где в uci лежит ссылка подписки. У первой — там же, где лежала всегда: перенос ключа
# означал бы, что после обновления пакета роутер забыл свою подписку.
sub_uci_key() {  # NAME FIELD(url|kind|title|auto)
    if [ "$1" = main ]; then
        case "$2" in
            url)  printf 'splify2.main.sub_url' ;;
            kind) printf 'splify2.main.sub_kind' ;;
            auto) printf 'splify2.main.sub_auto' ;;
            *)    printf 'splify2.main.sub_title' ;;
        esac
    else
        printf 'splify2.sub_%s.%s' "$1" "$2"
    fi
}

sub_get() {  # NAME FIELD
    uci -q get "$(sub_uci_key "$1" "$2")"
}

sub_put() {  # NAME FIELD VALUE
    uci_file || return 1
    if [ "$1" = main ]; then
        uci -q get splify2.main >/dev/null 2>&1 || uci -q set splify2.main=splify2
    else
        uci -q get "splify2.sub_$1" >/dev/null 2>&1 || uci -q set "splify2.sub_$1=subscription"
    fi
    if [ -n "$3" ]; then uci -q set "$(sub_uci_key "$1" "$2")=$3"
    else uci -q delete "$(sub_uci_key "$1" "$2")" 2>/dev/null
    fi
}

# Вид источника: url — подписка, которую есть чем обновить, links — вставленные руками
# ссылки, none — источника нет.
sub_kind_of() {  # NAME
    _k="$(sub_get "$1" kind)"
    [ -n "$_k" ] || { [ -n "$(sub_get "$1" url)" ] && _k=url || _k=none; }
    printf '%s' "$_k"
}

# Название и ссылка подписки известного источника.
#
# У продавца в ссылке стоит имя его бота, а панель называет подписку как придётся — то «VPN»,
# то со снежинкой, то ещё как. Человеку это ничего не говорит, а источник опознаётся по
# ссылке однозначно, поэтому название ему даём мы, и рядом кладём ссылку на самого продавца:
# из панели человеку всё равно идти к нему, и пусть идёт по нажатию, а не поиском в переписке.
#
# ОДНО МЕСТО НА ОБА ПОЛЯ, И ЭТО ГЛАВНОЕ ЗДЕСЬ. Название знает бэкенд, ссылку рисует интерфейс,
# и соблазн опознать источник дважды — в оболочке по одному признаку, в интерфейсе по другому
# — велик. Разошлись бы они молча: подписка с чужим названием и правильной ссылкой (или
# наоборот) выглядит рабочей. Поэтому признак разбирается ровно раз, здесь, а интерфейс просто
# рисует то, что пришло.
#
# ВПИСАННОЕ ЧЕЛОВЕКОМ ИМЯ СИЛЬНЕЕ ВСЕГО (R-115). Опознанный продавец сильнее названия, которое
# назвала ПАНЕЛЬ (заголовок profile-title), но не имени, которое человек вписал или поправил:
# иначе подписку нельзя было переименовать — после каждого ответа списка возвращалось имя
# продавца. Третий параметр `own` говорит «второй параметр — сохранённое имя, а не слово
# панели»: непустое сохранённое имя остаётся как есть, а имя продавца подставляется только
# вместо пустого. Без `own` (разбор ответа панели в sub_set) название продавца сильнее.
#
# Значения возвращаются переменными, а не строкой с разделителем: разделитель пришлось бы
# выбирать таким, какого не бывает в названии, а названия у продавцов бывают любые.
sub_brand() {  # URL ЗАГОЛОВОК [own] -> SUB_BRAND_TITLE, SUB_BRAND_LINK
    SUB_BRAND_TITLE="${2:-}"
    SUB_BRAND_LINK=""
    case "${1:-}" in
        *StressKVN_bot*)
            [ "${3:-}" = own ] && [ -n "${2:-}" ] || SUB_BRAND_TITLE='☢️ StressKVN❤️'
            SUB_BRAND_LINK='https://t.me/StressKVN_bot'
            ;;
    esac
}

# Занята ли подписка выходом. Удалять файл, на который ссылается выход, нельзя молча: движок
# читает его при подъёме, и правило осталось бы вести в туннель без единого узла.
sub_used_by() {  # PATH -> ЧИСЛО
    # Одно число и всегда. Прежняя запись (`grep -c ... || echo 0`) печатала ДВА нуля:
    # grep без совпадений и печатает 0, и выходит с ненулевым кодом, то есть срабатывала и
    # ветка `||`. Дальше это уезжало в json_add_int и роняло весь ответ — метод отдавал
    # пустоту, а интерфейс показывал «подписок нет».
    _u=0
    if spec_have; then
        # `subscription` — ключ спеки v2, `sub_file` — прежней v1 (до переноса интерфейсом).
        _u="$(jsonfilter -i "$(spec_json)" -e '@.outputs[*].subscription' -e '@.outputs[*].sub_file' 2>/dev/null |
              grep -Fx -c -- "$1" 2>/dev/null)"
    fi
    case "${_u:-}" in ''|*[!0-9]*) _u=0 ;; esac
    printf '%s' "$_u"
}

# Сколько ЛОКАЦИЙ подписки занято выходами.
#
# ЗАЧЕМ ОТДЕЛЬНО ОТ sub_used_by. Тот считает выходы, и число у него верное, но отвечает оно
# не на тот вопрос, который человек задаёт карточке. Выход бывает пулом: один выход берёт из
# подписки две локации (Эстонию и Финляндию), и карточка честно писала «выходов: 1», а
# человек, только что выбравший в пуле две строки, читал это как «занята одна» и считал
# счётчик сломанным. Теперь рядом стоит второе число — сколько именно локаций взято, — и
# спорить не о чем: видно и сколько выходов, и сколько строк они держат.
#
# Обход по ИМЕНАМ выходов, а не одним выражением: `@.outputs[*].nodes[*]` вернул бы номера
# всех выходов сразу, без разбора, чьи они, — то есть посчитал бы и чужие. Выходов единицы,
# лишние вызовы jsonfilter здесь ничего не стоят.
# Какие выходы читают этот файл узлов. Нужно затем, чтобы обновлённую подписку перечитал
# именно тот туннель, который ею живёт, а не все подряд: сигнал '*' однажды уже убивал
# работающий туннель при каждом сохранении.
# Имена выходов — КЛЮЧИ объекта outputs (I-328). Прежде они брались из поля `name` внутри
# выхода, а его пишет только интерфейс: в контракте спеки (steer/docs/contract-v1.md) такого поля
# нет, и спека, положенная руками или заготовка SPEC_EMPTY, его не несёт — у неё не находилось
# ни одного выхода. jsonfilter ключей не печатает, поэтому jshn, и в подсобной оболочке: звать
# эти функции будут посреди сборки ответа через тот же jshn, и его состояние трогать нельзя.
spec_output_names() {  # -> имена выходов по одному на строку
    spec_have || return 0
    (
        json_load "$(cat "$(spec_json)" 2>/dev/null)" 2>/dev/null || exit 0
        json_select outputs 2>/dev/null || exit 0
        json_get_keys _son_k
        for _son in $_son_k; do printf '%s\n' "$_son"; done
    )
}

sub_outputs_using() {  # PATH -> имена выходов по одному на строку
    spec_have || return 0
    for _oo in $(spec_output_names); do
        [ "$(spec_out_sub "$_oo")" = "$1" ] || continue
        printf '%s\n' "$_oo"
    done
}

sub_nodes_used() {  # PATH -> ЧИСЛО
    _un=0
    spec_have || { printf '0'; return; }
    # Одним проходом по спеке (jshn в подоболочке), а не по два запуска jsonfilter и три подоболочки на
    # каждый выход каждой подписки: на роутере с десятком выходов и парой подписок это сотни запусков
    # на один ответ sub_list, а его зовёт и расписание, и страница.
    _un="$(
        json_load "$(cat "$(spec_json)" 2>/dev/null)" 2>/dev/null || { echo 0; exit 0; }
        json_select outputs 2>/dev/null || { echo 0; exit 0; }
        json_get_keys _un_k
        _un_t=0
        for _un_o in $_un_k; do
            json_select "$_un_o" 2>/dev/null || continue
            # Обнуляется перед чтением: json_get_var на отсутствующем ключе оставляет прежнее значение.
            _un_p=''
            json_get_var _un_p subscription
            [ -n "$_un_p" ] || json_get_var _un_p sub_file
            if [ "$_un_p" = "$1" ] && json_select nodes 2>/dev/null; then
                json_get_keys _un_nk
                for _un_x in $_un_nk; do _un_t=$((_un_t + 1)); done
                json_select ..
            fi
            json_select ..
        done
        echo "$_un_t"
    )"
    case "${_un:-}" in ''|*[!0-9]*) _un=0 ;; esac
    printf '%s' "$_un"
}

hwid() {
    if [ -z "$HWID_CACHED" ]; then
        HWID_CACHED="$("$STEER" sub-hwid 2>/dev/null | jsonfilter -e '@.hwid' 2>/dev/null)"
        # Пустой ответ законен: «не из чего считать» — ни одного физического порта с
        # постоянным MAC. Признак «уже спрашивали» ставится отдельно, чтобы пустой ответ не
        # приводил к повторному запуску движка при каждом обращении.
        HWID_CACHED="${HWID_CACHED:--}"
    fi
    [ "$HWID_CACHED" = "-" ] && return 1
    printf '%s\n' "$HWID_CACHED"
}

# Остаток трафика в ответ. Ничего не запрашивает — только читает запомненное.
sub_userinfo_emit() {
    [ -s "$SUB_INFO" ] || return 1
    _up=""; _dn=""; _tot=""; _exp=""; _at=""; _at0=""; _used0=""
    while IFS='=' read -r _k _v; do
        case "$_k" in
            upload)   _up="$_v" ;;
            download) _dn="$_v" ;;
            total)    _tot="$_v" ;;
            expire)   _exp="$_v" ;;
            at)       _at="$_v" ;;
            at0)      _at0="$_v" ;;
            used0)    _used0="$_v" ;;
        esac
    done < "$SUB_INFO"
    json_add_object quota
    # Байты — СТРОКАМИ. 200 ГБ это 2·10^11, а json_add_int у jshn 32-битный: подписка на
    # 200 ГБ приехала бы обрезанным числом, и обзор показал бы остаток, которого нет. Тот же
    # довод, по которому строками отдаются счётчики dev_stats.
    json_add_string up "${_up:-}"
    json_add_string down "${_dn:-}"
    json_add_string total "${_tot:-}"
    # Срок и время опроса — unix-время, в int32 оно влезает до 2038 года.
    json_add_int expire "${_exp:-0}"
    json_add_int at "${_at:-0}"
    # Первое наблюдение периода: по нему и по нынешнему считается измеренный темп расхода.
    # Отдаётся вместе с числами, а не вычисляется здесь: делить и предсказывать — работа
    # интерфейса, а второе место, где то же число считается иначе, разойдётся с первым.
    json_add_int since "${_at0:-0}"
    json_add_string since_used "${_used0:-0}"
    json_close_object
    return 0
}

sub_fetch() {  # URL
    SUB_ANSWER="$("$STEER" sub-fetch "$1" --out "$SUB" --info "$SUB_INFO" 2>/dev/null)"
    case "$SUB_ANSWER" in '{'*) ;; *) return 1 ;; esac
    [ "$(sub_answer ok)" = "true" ]
}

# Поле ответа движка. Пустая строка, если поля нет: у отказа нет ни названия, ни остатка, и
# отличать «поля нет» от «поле пустое» вызывающему здесь не нужно.
sub_answer() {  # ПОЛЕ
    [ -n "$SUB_ANSWER" ] || return 1
    printf '%s' "$SUB_ANSWER" | jsonfilter -e "@.$1" 2>/dev/null
}

# Спросить у панели ОДИН остаток трафика, не подменяя подписку. Тоже вызовом движка: та же
# проба заголовков, та же арифметика периода, тот же файл.
sub_quota_ask() {  # URL
    "$STEER" sub-quota "$1" --info "$SUB_INFO" >/dev/null 2>&1 || return 1
    # Числа теперь лежат в файле — сказать остаётся только, нашлось ли в нём что-нибудь.
    [ -s "$SUB_INFO" ]
}

# Схемы ссылок узлов, которые читает ядро: VLESS, hysteria2 (и короткая hy2), прокси steer-proxy
# (trojan, ss, socks/socks4/socks4a/socks5, vmess). Прокси http:// и https:// сюда НЕ входят: в
# поле адреса подписки они и есть подписка, а ссылками узлов приходят отдельным полем `links`.
SUB_LINK_RE='vless|hysteria2|hy2|trojan|ss|socks|socks4|socks4a|socks5|vmess'
# Прокси http(s):// — только «адрес:порт» (с именем и паролем, параметрами и #именем): адрес
# подписки (https://панель/sub/…) порта обычно не несёт, и вставленный не в то поле, он здесь
# отвергается, а не ложится в файл узлом, которого ядро не разберёт. Та же строка — в
# state_check_sub (службы хоста splify2-host, архив настроек).
SUB_HTTP_PROXY_RE='https?://([^/@ ]+@)?(\[[0-9A-Fa-f:]+\]|[^/:@ ]+):[0-9]+/?([?#].*)?'

# Ссылки узлов — в файл подписки, по строке на ссылку. Пробелы между ссылками — в переводы
# строк: из однострочного поля многострочная вставка приезжает склеенной пробелами. Код 1 —
# ни одной ссылки нужных схем.
sub_links_write() {  # ТЕКСТ СТРОКА_RE
    printf '%s\n' "$1" | tr ' \t' '\n\n' | grep -E "^($2)$" > "$SUB.tmp" || { rm -f "$SUB.tmp"; return 1; }
    [ -s "$SUB.tmp" ] || { rm -f "$SUB.tmp"; return 1; }
    mv "$SUB.tmp" "$SUB"
}


# ---- поля плагинов к ответам sub_list и sub_info: хук sub_fields (splify2-api) --------------------------------
#
# Расписание автообновления, «пора ли обновлять» и прочее, что плагин хочет показать рядом с подпиской, добавляет
# плагин, а не каркас. Хук зовётся ОДИН раз на ответ: ctx — {"subs":[{"name","kind","present","mtime"}…]}, ответ —
# {"ok":true,"fields":{"<имя подписки>":{"поле":значение…}}}. Значения — строка, число или флаг; перечисленные ниже
# поля строки каркас не принимает, чтобы плагин не подменил то, что отдаёт сам каркас.
SUBF_DIR=""
SUBF_RESERVED=" name title link url kind path present bytes mtime used used_nodes quota hwid "

sub_fields_cb() {  # ID КОД ФАЙЛ РЕЖИМ КРИТИЧЕСКИЙ
    [ "$2" = 0 ] && ext_is_object "$3" && cp "$3" "$SUBF_DIR/$1.json" 2>/dev/null
    return 0
}

sub_fields_run() {  # ИМЯ...
    SUBF_DIR=""
    # Подписок нет — и полей им нет: хук плагина (запуск его программы) на пустой список не зовётся.
    [ $# -gt 0 ] || return 0
    need_ext || return 0
    ext_has_hook sub_fields || return 0
    SUBF_DIR="$(mktemp -d 2>/dev/null)" || { SUBF_DIR=""; return 0; }
    _sf_ctx=""
    _sf_sep=""
    for _sf_n in "$@"; do
        sub_use "$_sf_n"
        _sf_pr=false; _sf_mt=0
        if [ -s "$SUB" ]; then _sf_pr=true; _sf_mt="$(date -r "$SUB" +%s 2>/dev/null || echo 0)"; fi
        _sf_ctx="$_sf_ctx$_sf_sep{\"name\":\"$SUB_NAME\",\"kind\":\"$(sub_kind_of "$SUB_NAME")\",\"present\":$_sf_pr,\"mtime\":${_sf_mt:-0}}"
        _sf_sep=","
    done
    ext_hook_each sub_fields "{\"subs\":[$_sf_ctx]}" sub_fields_cb
}

# Строки «поле<TAB>род<TAB>значение» одной подписки у одного плагина; подоболочка — состояние jshn основного ответа
# трогать нельзя.
sub_fields_lines() {  # ИМЯ ФАЙЛ
    (
        json_load "$(cat "$2" 2>/dev/null)" 2>/dev/null || exit 0
        json_select fields 2>/dev/null || exit 0
        json_select "$1" 2>/dev/null || exit 0
        json_get_keys _sfl_k
        for _sfl in $_sfl_k; do
            _sfl_t=''; _sfl_v=''
            json_get_type _sfl_t "$_sfl"
            json_get_var _sfl_v "$_sfl"
            printf '%s\t%s\t%s\n' "$_sfl" "$_sfl_t" "$(printf '%s' "$_sfl_v" | tr -d '\000-\037')"
        done
    )
}

# Дописать в текущий объект ответа поля, которые вернули плагины для подписки ИМЯ.
sub_fields_emit() {  # ИМЯ
    [ -n "$SUBF_DIR" ] || return 0
    for _se_f in "$SUBF_DIR"/*.json; do
        [ -f "$_se_f" ] || continue
        sub_fields_lines "$1" "$_se_f" > "$SUBF_DIR/lines" 2>/dev/null
        while IFS="$(printf '\t')" read -r _se_k _se_t _se_v; do
            case "$_se_k" in ''|[!a-z_]*|*[!a-z0-9_]*) continue ;; esac
            case "$SUBF_RESERVED" in *" $_se_k "*) continue ;; esac
            case "$_se_t" in
                string) json_add_string "$_se_k" "$_se_v" ;;
                int) case "$_se_v" in ''|*[!0-9-]*) continue ;; esac; json_add_int "$_se_k" "$_se_v" ;;
                boolean) json_add_boolean "$_se_k" "$_se_v" ;;
            esac
        done < "$SUBF_DIR/lines"
    done
    return 0
}

sub_fields_clean() {
    [ -n "$SUBF_DIR" ] && rm -rf "$SUBF_DIR"
    SUBF_DIR=""
    return 0
}
