#!/bin/sh
# Пакеты, выпуски и версии ядра и splify2: архитектура, перечень выпусков (version.json, api.github.com, VERSION ветки dist),
# менеджер пакетов (apk, opkg), установленные версии, протоколы ядра. Подключается группой engine (m-engine.sh) и службами
# хоста `release`, `pkg`, `engine` (splify2-host): что и когда ставить — решает плагин updater, а здесь — как.

# МИНИМАЛЬНАЯ ВЕРСИЯ ЯДРА, ПОД КОТОРУЮ СОБРАН ЭТОТ ИНТЕРФЕЙС. Одно число в одном месте: бэкенд
# отдаёт его методом engine, интерфейс сравнивает с установленным и говорит человеку, что не
# заработает, ДО того как он это обнаружит сам. По версии, а не по перечню features.
#
# 2.1.0 — интерфейс ведёт спеку в spec.yaml и читает её JSON-видом ядра (`steer spec convert
# --json`), пишет спеку v2 и не знает выходов zapret: прежнее ядро не печатает JSON-вид, и
# без него не читается и не пишется ни одна правка. Зависимость пакета от ядра не объявлена
# (см. build.sh), поэтому о несоответствии говорит интерфейс.
STEER_MIN_VERSION=2.1.0






# Архитектура ПАКЕТОВ, а не процессора.
#
# `apk --print-arch` отдаёт `aarch64`, а пакеты OpenWrt называются `aarch64_cortex-a53`:
# по первому имя файла собирается неверно, и скачивание молча не находит релиз. Верный
# источник — DISTRIB_ARCH из /etc/openwrt_release, то же значение, что показывает
# `apk list -I` в колонке архитектуры.
# Фолбэка на `apk --print-arch` здесь СОЗНАТЕЛЬНО нет, хотя он напрашивается. Он отдаёт
# `aarch64`, а в релизе нет ни одного файла с таким именем: имя собирается неверно,
# скачивание не находит пакет и отвечает «нет такой версии для aarch64» — то есть винит
# издателя в том, чего не делал. Пустой ответ честнее: и steer_versions, и steer_install
# на нём говорят «не определилась архитектура», и это правда.
pkg_arch() {
    [ -f "$OPENWRT_RELEASE" ] || return 0
    ( . "$OPENWRT_RELEASE"; printf '%s' "${DISTRIB_ARCH:-}" )
}

# ПЕРЕЧЕНЬ ВЫПУСКОВ splify2/releases — ПЕРВЫЙ ИСТОЧНИК версий и адресов файлов (решение
# владельца). version.json пишет выпуск каждого проекта: последние версии продукта (до десяти
# стабильных и текущая предварительная), у каждого файла — sha256 и адреса, сначала выпуск в
# splify2/releases, потом исходный выпуск проекта. Читается с трёх адресов по порядку
# (FETCH_REL_URLS в fetch.sh: raw.githubusercontent.com, jsDelivr, сайт splify2.github.io) и без
# счётчика запросов api.github.com. Не ответил ни один, файл не той схемы или продукта в нём нет
# — прежний путь целиком: api.github.com, затем VERSION ветки dist.
#
# Память — та же, что у перечня (GH_CACHE_TTL_MIN), и по тем же правилам: только свой файл, и
# читается он jsonfilter-ом как данные. Отказ тоже помнится на тот же срок: иначе там, где все
# три адреса закрыты, каждое открытие страницы и каждая установка ждали бы их заново.
rel_valid() {  # ФАЙЛ
    [ "$(jsonfilter -i "$1" -e '@.schema' 2>/dev/null)" = 1 ]
}

rel_fresh() {  # ФАЙЛ
    own_file "$1" && [ -z "$(find "$1" -mmin "+$GH_CACHE_TTL_MIN" 2>/dev/null)" ]
}

rel_load() {
    REL_F="${GH_CACHE:-/tmp/splify2-releases.json}.version.json"
    rel_fresh "$REL_F" && rel_valid "$REL_F" && return 0
    rel_fresh "$REL_F.none" && return 1
    rm -f "$REL_F" "$REL_F.none"
    # Срок на адрес — 20 секунд, как у прежнего похода на api.github.com, а не 60, как у пакетов:
    # файл в десятки килобайт, а там, где адрес закрыт молча, три адреса по минуте держали бы
    # страницу три минуты до запасного пути.
    _rl_t="$FETCH_TIMEOUT"; FETCH_TIMEOUT=20
    for _rl_u in $FETCH_REL_URLS; do
        fetch_once "$_rl_u" "$REL_F" || continue
        rel_valid "$REL_F" && { FETCH_TIMEOUT="$_rl_t"; return 0; }
        rm -f "$REL_F"
    done
    FETCH_TIMEOUT="$_rl_t"
    ( umask 077; : > "$REL_F.none" ) 2>/dev/null
    return 1
}

# Перечень версий продукта из version.json — в GH_VERS/GH_NAMES, предварительная — в GH_PRE.
# Отбор тот же, что у api.github.com ниже (только цифры и точки — то, что примет установка).
# Названия выпуска в version.json может не быть — тогда версия называет себя сама; поле `name`
# читается по версиям, только если оно есть хоть у одной (иначе лишних запусков jsonfilter нет).
gh_load_rel() {  # ПРОДУКТ
    rel_load || return 1
    _gr_p="@.products['$1']"
    _gr_v="$(jsonfilter -i "$REL_F" -e "$_gr_p.versions[*].version" 2>/dev/null)"
    [ -n "$_gr_v" ] || return 1
    _gr_any="$(jsonfilter -i "$REL_F" -e "$_gr_p.versions[*].name" 2>/dev/null)"
    _gr_i=0
    while IFS= read -r _gr_ver; do
        _gr_name=""
        [ -z "$_gr_any" ] || _gr_name="$(jsonfilter -i "$REL_F" -e "$_gr_p.versions[$_gr_i].name" 2>/dev/null)"
        _gr_i=$((_gr_i + 1))
        case "$_gr_ver" in ''|*[!0-9.]*) continue ;; esac
        # Черта — разделитель разметки GH_NAMES, перевод строки сломал бы память (строка на поле).
        case "$_gr_name" in ''|*"|"*|*"
"*) _gr_name="$_gr_ver" ;; esac
        GH_VERS="$GH_VERS$_gr_ver "
        GH_NAMES="$GH_NAMES$_gr_ver=$_gr_name|"
    done <<EOF
$_gr_v
EOF
    GH_PRE="$(jsonfilter -i "$REL_F" -e "$_gr_p.prerelease" 2>/dev/null)"
    case " $GH_VERS" in *" $GH_PRE "*) ;; *) GH_PRE="" ;; esac
    [ -n "$GH_VERS" ] && return 0
    GH_NAMES="|"; GH_PRE=""
    return 1
}

# Файл выпуска по version.json: sha256 — в REL_SUM, адреса по порядку — в REL_URLS (через
# пробел). Версия и файл ищутся по значению: имена пакетов (steer-core и модули) лежат в
# перечне как есть, а имя файла собирается так же, как для
# выпусков. Адрес берётся, только если он https, из безопасных знаков (дальше он перебирается
# словами, и `*` или `?` раскрылись бы как шаблон) и кончается именем файла.
rel_asset() {  # ПРОДУКТ ВЕРСИЯ ИМЯ_ФАЙЛА
    REL_SUM=""; REL_URLS=""
    rel_load || return 1
    _ra_p="@.products['$1'].versions"
    _ra_i=0; _ra_hit=""
    while IFS= read -r _ra_x; do
        [ "$_ra_x" = "$2" ] && { _ra_hit=1; break; }
        _ra_i=$((_ra_i + 1))
    done <<EOF
$(jsonfilter -i "$REL_F" -e "$_ra_p[*].version" 2>/dev/null)
EOF
    [ -n "$_ra_hit" ] || return 1
    _ra_p="$_ra_p[$_ra_i].assets"
    _ra_j=0; _ra_hit=""
    while IFS= read -r _ra_x; do
        [ "$_ra_x" = "$3" ] && { _ra_hit=1; break; }
        _ra_j=$((_ra_j + 1))
    done <<EOF
$(jsonfilter -i "$REL_F" -e "$_ra_p[*].name" 2>/dev/null)
EOF
    [ -n "$_ra_hit" ] || return 1
    while IFS= read -r _ra_x; do
        case "$_ra_x" in
            https://*[!A-Za-z0-9._~:/%+@=-]*) ;;
            https://?*/"$3") REL_URLS="$REL_URLS $_ra_x" ;;
            *[!0-9a-f]*) ;;
            *) [ "${#_ra_x}" = 64 ] && REL_SUM="$_ra_x" ;;
        esac
    done <<EOF
$(jsonfilter -i "$REL_F" -e "$_ra_p[$_ra_j].sha256" -e "$_ra_p[$_ra_j].urls[*]" 2>/dev/null)
EOF
    [ -n "$REL_URLS" ]
}

gh_load() {  # ВЛАДЕЛЕЦ/РЕПОЗИТОРИЙ
    GH_VERS=""
    GH_NAMES="|"
    GH_NOTE=""
    GH_PRE=""
    _gl_c="${GH_CACHE:-/tmp/splify2-releases.json}.$(printf '%s' "$1" | tr -c 'A-Za-z0-9' '_').cache"
    # ПАМЯТЬ — ДАННЫЕ, А НЕ КОД, и только СВОЯ. Файл лежит в /tmp под предсказуемым именем, а
    # /tmp на роутере пишут все процессы, включая непривилегированные (nobody у
    # https-dns-proxy, dnsmasq, logd). Прежняя редакция читала его через `.`, то есть
    # исполняла от root всё, что туда положили; любой процесс роутера мог дождаться открытия
    # страницы версий. Теперь три строки читаются как текст (версии, имена, примечание — по
    # строке на поле, переводов строки внутри полей не бывает), а файл чужого владельца не
    # читается вовсе: подложить нам список версий тоже никому не полагается.
    if own_file "$_gl_c" && [ -z "$(find "$_gl_c" -mmin "+$GH_CACHE_TTL_MIN" 2>/dev/null)" ]; then
        GH_VERS="$(sed -n '1p' "$_gl_c" 2>/dev/null)"
        GH_NAMES="$(sed -n '2p' "$_gl_c" 2>/dev/null)"
        GH_NOTE="$(sed -n '3p' "$_gl_c" 2>/dev/null)"
        GH_PRE="$(sed -n '4p' "$_gl_c" 2>/dev/null)"
        [ -n "$GH_VERS" ] && return 0
        GH_VERS=""; GH_NAMES="|"; GH_NOTE=""; GH_PRE=""
    fi
    # Продукт в version.json называется как репозиторий без владельца: steer, splify2.
    gh_load_rel "${1#*/}" || gh_load_api "$1" || gh_load_version "$1" || return 1
    rm -f "$_gl_c"
    ( umask 077; printf '%s\n%s\n%s\n%s\n' "$GH_VERS" "$GH_NAMES" "$GH_NOTE" "$GH_PRE" > "$_gl_c" 2>/dev/null )
    return 0
}

gh_load_api() {  # ВЛАДЕЛЕЦ/РЕПОЗИТОРИЙ
    # Файл — свой у каждого вызова (mktemp: имя с номером процесса в /tmp предсказуемо): страница
    # «Интерфейс» спрашивает версии ядра и самого себя разом, и на общем имени второй вызов стирал и
    # перезаписывал файл первого — тот разбирал версии чужого репозитория.
    _f="$(mktemp "${GH_CACHE:-/tmp/splify2-releases.json}.api.XXXXXX" 2>/dev/null)" || return 1
    wget -qO "$_f" --timeout=20 \
        "https://api.github.com/repos/$1/releases?per_page=10" 2>/dev/null || {
            rm -f "$_f"; return 1; }
    [ -s "$_f" ] || { rm -f "$_f"; return 1; }
    _nl='
'
    _i=0
    while [ "$_i" -lt 10 ]; do
        # Два поля ОДНИМ запуском jsonfilter: он печатает по строке на выражение и в порядке
        # выражений. Двадцать запусков вместо десяти стоили бы роутеру вдвое больше процессов
        # ради того же ответа. Разбор по строкам — подстановкой, а не sed: ещё двадцать
        # процессов на то, что оболочка умеет сама.
        _both="$(jsonfilter -i "$_f" -e "@[$_i].tag_name" -e "@[$_i].name" 2>/dev/null)"
        _tag="${_both%%"$_nl"*}"
        [ -n "$_tag" ] || break
        _name="${_both#*"$_nl"}"
        # Строки одна — значит названия у релиза нет вовсе (в ответе `null`): jsonfilter в
        # этом случае не печатает ничего, и вторая строка не появляется.
        [ "$_name" != "$_both" ] || _name=""
        _ver="${_tag#v}"
        _i=$((_i + 1))
        case "$_ver" in ''|*[!0-9.]*) continue ;; esac
        # Название с вертикальной чертой сломало бы разметку GH_NAMES — тогда обходимся
        # числом. Отказываться от релиза из-за его заголовка было бы хуже: ставится он всё
        # равно по версии.
        case "$_name" in ''|*"|"*) _name="$_ver" ;; esac
        GH_VERS="$GH_VERS$_ver "
        GH_NAMES="$GH_NAMES$_ver=$_name|"
    done
    rm -f "$_f"
    [ -n "$GH_VERS" ]
}

# Запасной источник перечня: файл VERSION в главной ветке репозитория.
#
# ЗАЧЕМ. splify2#15. Пакеты и списки обход блокировки уже имеют — их берёт общая download()
# с лестницей «зеркало gitlab.com → contents API → архив через codeload → туннель». А сам
# ПЕРЕЧЕНЬ версий спрашивался у одного-единственного хоста, api.github.com. Там, где его
# закрыли, и там, где за CGNAT соседи выбрали неавторизованный лимит в 60 запросов в час
# (так и пришла splify2#5), обе карточки показывали пустой список: обновиться из интерфейса
# было нельзя, хотя пакет с зеркала скачался бы прекрасно. Установщик этот путь имеет
# давно (R-048), бэкенд — не имел, и асимметрия была ровно наоборот полезной: установить
# получалось, а обновить нет.
#
# ПОЧЕМУ VERSION, А НЕ СПИСОК РЕЛИЗОВ С ЗЕРКАЛА. Зеркалирование копирует коммиты, ветки и
# теги; релизы GitHub живут вне репозитория и на зеркало не переезжают. Зато VERSION в
# главной ветке содержит ровно то число, которое релизный workflow записал перед выкладкой
# пакетов, — и берётся оно через ту же download(), то есть все обходы достаются даром.
#
# ЧТО ЭТОТ ПУТЬ НЕ ДАЁТ. Одну версию вместо десяти и без названия выпуска: выбрать старую
# отсюда нельзя. Это честно сказано полем `note` — молчание здесь читалось бы как «релиз
# всего один».
gh_load_version() {  # ВЛАДЕЛЕЦ/РЕПОЗИТОРИЙ
    _vf="$(mktemp "${GH_CACHE:-/tmp/splify2-releases.json}.version.XXXXXX" 2>/dev/null)" || return 1
    # Ветка dist, а не main: в dist VERSION пишет только релизный workflow, рядом с пакетами
    # и тем же числом, что в теге, — то есть он равен последнему выпуску по построению.
    # VERSION в main двигают руками между выпусками (у steer он ушёл на три версии вперёд
    # релиза, у самого splify2 — на целый выпуск), и версия оттуда попадала в список
    # «свежей», а «Установить» отвечало «не скачалось»: файла с таким именем в релизах нет.
    download "https://raw.githubusercontent.com/$1/${FETCH_DIST_BRANCH:-dist}/VERSION" "$_vf" || {
        rm -f "$_vf"; return 1; }
    # Первая строка без хвостовых пробелов. Состав проверяется целиком: в VERSION бывают
    # только цифры и точки (на это стоит барьер в build.sh), и подставить в имя файла
    # пакета что-то другое хуже, чем остаться без версии и сказать об этом.
    _vv="$(sed -n '1{s/[[:space:]]*$//;p;}' "$_vf" 2>/dev/null)"
    rm -f "$_vf"
    case "${_vv:-}" in ''|*[!0-9.]*) return 1 ;; esac
    GH_VERS="$_vv "
    GH_NAMES="|$_vv=$_vv|"
    GH_NOTE="список релизов не отдали — версия взята из VERSION ветки ${FETCH_DIST_BRANCH:-dist}${FETCH_NOTE:+ ($FETCH_NOTE)}"
    return 0
}

# Название выпуска по его версии — в GH_NAME. Через переменную, а не печатью: `$(...)` на
# каждую версию это ещё десять подоболочек там, где хватает подстановки.
gh_name_of() {  # ВЕРСИЯ
    GH_NAME="$1"
    _t="${GH_NAMES#*|$1=}"
    [ "$_t" = "$GH_NAMES" ] || GH_NAME="${_t%%|*}"
}

# Оба поля ответа: `versions` — чем ставить, `names` — как называется. Массив и объект, а не
# два массива: параллельные списки расходятся молча, а по версии название находится всегда.
gh_add_releases() {
    json_add_array versions
    for _v in $GH_VERS; do json_add_string "" "$_v"; done
    json_close_array
    json_add_object names
    for _v in $GH_VERS; do gh_name_of "$_v"; json_add_string "$_v" "$GH_NAME"; done
    json_close_object
    # Почему список такой, какой есть. Только когда есть что сказать: примечание на здоровом
    # пути было бы шумом, а на больном — единственным объяснением, почему версия одна.
    [ -n "$GH_NOTE" ] && json_add_string note "$GH_NOTE"
    # Какая из версий предварительная — по полю prerelease перечня выпусков, а не по виду строки.
    [ -n "$GH_PRE" ] && json_add_string prerelease "$GH_PRE"
    return 0
}

# Расширение файла пакета для этого менеджера и суффикс архитектуры у пакета без
# бинарного кода: apk называет такой noarch, opkg — all.
pkg_ext()    { if [ "$PM" = apk ]; then echo apk; else echo ipk; fi; }

pkg_noarch() { if [ "$PM" = apk ]; then echo noarch.apk; else echo all.ipk; fi; }

# Установленная версия пакета по его имени.
#
# Форматы вывода разные: `apk list -I` печатает «имя-1.2.3-r1 ...», `opkg list-installed`
# — «имя - 1.2.3-1». Разбирается каждый своим выражением, а не одним «на всякий случай»:
# общее выражение здесь молча выдавало бы пустоту на одном из двух.
# Версия установленного пакета — С ПАМЯТЬЮ. `apk list -I` перебирает базу пакетов и стоит на
# роутере триста миллисекунд, а спрашивают её на каждом открытии страницы (метод engine).
# Ответ меняется только вместе с базой пакетов, поэтому запоминается в /tmp до тех пор, пока
# файл базы не станет новее записи: ставить и снимать пакеты мимо базы нечем.
pkg_version() {  # ИМЯ_ПАКЕТА
    _pv_db="${PKG_DB:-/lib/apk/db/installed}"
    [ "$PM" = opkg ] && _pv_db="${PKG_DB:-/usr/lib/opkg/status}"
    _pv_c="/tmp/splify2-pkgver-$1"
    # Только свой файл: чужой в /tmp мог бы подсунуть интерфейсу любую строку версии (own_file).
    if [ -f "$_pv_db" ] && own_file "$_pv_c" && [ "$_pv_c" -nt "$_pv_db" ]; then
        cat "$_pv_c"
        return 0
    fi
    _pv_v="$(case "$PM" in
        apk)  apk list -I 2>/dev/null | sed -n "s/^$1-\([0-9][^ ]*\)-r.*/\1/p" | head -1 ;;
        opkg) opkg list-installed 2>/dev/null | sed -n "s/^$1 - \([0-9][^ ]*\)/\1/p" | head -1 ;;
    esac)"
    [ -f "$_pv_db" ] && printf '%s' "$_pv_v" > "$_pv_c" 2>/dev/null
    printf '%s' "$_pv_v"
}

# ФАЙЛЫ — один или несколько через пробел (пути в /tmp, без пробелов): ядро и его модули
# ставятся одной транзакцией.
pkg_install() {  # ФАЙЛЫ [ИМЯ_ДЛЯ_СНЯТИЯ...]
    file="$1"; shift
    # shellcheck disable=SC2086 — файлы и добавки разбираются словами нарочно
    PKG_OUT="$(pkg_add_file $file)"
    rc=$?
    PKG_REMOVED=0
    [ "$rc" = 0 ] && return 0
    # Шаблон намеренно узкий — только слово «конфликт». `unable to select packages` сюда
    # не годится, хотя apk печатает его и при конфликте тоже: это его общий текст на
    # любую неудовлетворимую зависимость, включая «нет nftables». Снимать по нему
    # рабочий пакет значило бы вернуть ровно ту поломку, ради которой порядок и
    # переставлен.
    #
    # Узости одного слова, однако, мало. Смысл ветки — замена пакета, который менеджер
    # называет мешающим по имени: снятие названного и есть разрешение конфликта. Конфликт МЕЖДУ ЧУЖИМИ пакетами
    # (26.9 требует ip-full, на роутере стоит ip-tiny) выглядит в выводе точно так же —
    # а снятие по нему сняло бы работающий splify2 и оставило человека без
    # интерфейса, потому что повторная попытка упадёт по той же самой причине. Поэтому
    # смотрим не на весь вывод, а на строки, где сказано про конфликт, и снимаем только
    # те имена, которые в них названы. Имя устанавливаемого пакета в выводе есть всегда
    # — оно стоит заголовком разбора, — и подстрочный поиск по всему тексту принял бы
    # чужой конфликт за свой.
    _pi_conf="$(printf '%s\n' "$PKG_OUT" | grep -e conflict -e Conflict -e конфликт -e КОНФЛИКТ)"
    [ -n "$_pi_conf" ] || return "$rc"
    _pi_named=""
    for n in "$@"; do
        case "$_pi_conf" in *"$n"*) _pi_named="$_pi_named $n" ;; esac
    done
    [ -n "$_pi_named" ] || return "$rc"
    for n in $_pi_named; do pkg_del "$n"; done
    PKG_REMOVED=1
    # shellcheck disable=SC2086
    PKG_OUT="$(pkg_add_file $file)"
    return $?
}

# Включён ли автозапуск. Именно это, а не «работает ли», меняет кнопка «Остановить всё»:
# без снятого автозапуска перезагрузка вернула бы движок, и человек, нажавший «остановить
# всё», получил бы его обратно молча.
engine_enabled() {
    # На роутере — по ссылке в /etc/rc.d: ровно её и ставит `enable`, а спрашивать об этом сам
    # init-скрипт значит запускать оболочку с rc.common (сотня миллисекунд на 880 МГц) на
    # каждом открытии страницы. Подменённый стендом init-скрипт спрашивается как раньше.
    if [ "$INITD" = /etc/init.d/steer ] && [ -d /etc/rc.d ]; then
        set -- /etc/rc.d/S[0-9][0-9]steer
        [ -e "$1" ] && printf 1 || printf 0
        return 0
    fi
    "$INITD" enabled >/dev/null 2>&1 && printf 1 || printf 0
}

# Работает ли хоть один экземпляр. Спрашивается у procd, а не по наличию процесса:
# у движка их несколько (сам steer и клиенты vless), и «жив ли процесс с таким именем»
# на это не отвечает.
#
# ВНИМАНИЕ: внутри json_load, поэтому вызывать только ДО json_init своего ответа — тот же
# порядок, что уже соблюдает engine_state.
engine_running() {
    r=0
    state="$(ubus call service list '{"name":"steer","verbose":true}' 2>/dev/null)"
    if [ -n "$state" ] && json_load "$state" 2>/dev/null &&
       json_select steer 2>/dev/null && json_select instances 2>/dev/null; then
        json_get_keys inames
        for nm in $inames; do
            json_select "$nm" 2>/dev/null || continue
            json_get_var run running
            [ "$run" = 1 ] && r=1
            json_select ..
        done
    fi
    printf '%s' "$r"
}

# ПРОТОКОЛЫ ЯДРА 2.1 — плагины из официального репозитория (plugin-sdk/docs/migration-2.1.md): id плагина
# совпадает с прежним именем модуля. Порядок — порядок показа в карточке модулей (steer_modules, она
# остаётся для прежнего интерфейса; вкладка «Плагины» берёт всё из plugins_list).
STEER_MODULES="vless hysteria2 proxy xsteer obfs tgws"

# Какие протоколы доступны: включённые плагины из STEER_MODULES. Спрашивается state.json менеджера, а
# не база пакетов: пакетов `steer-<модуль>` в 2.1 нет, и плагин, положенный в обход менеджера, ядро
# всё равно не регистрирует.
mods_present() {
    _mp=""
    for _m in $STEER_MODULES; do
        [ "$(plugin_state_of "$_m")" = enabled ] && _mp="$_mp $_m"
    done
    printf '%s' "${_mp# }"
}

# Установленные пакеты одним запуском менеджера: «имя версия» по строке. `apk list -I` стоит на
# роутере сотни миллисекунд, а установке ядра нужно знать о десятке имён.
pkg_list() {
    case "$PM" in
        apk)  apk list -I 2>/dev/null | sed -n 's/^\([^ ]*\)-\([0-9][^ -]*\)-r[0-9]* .*/\1 \2/p' ;;
        opkg) opkg list-installed 2>/dev/null | sed -n 's/^\([^ ]*\) - \([^ ]*\).*/\1 \2/p' | sed 's/-[0-9]*$//' ;;
    esac
}

# Команда снятия пакета текстом — для отсоединённого задания (purge), которое пишется в файл.
pkg_del_cmd() {  # ИМЯ
    _pd_verb=remove; [ "$PM" = apk ] && _pd_verb=del
    printf '%s %s %s' "$PM" "$_pd_verb" "$1"
}

# Версия пакета ИМЯ в перечне PKGS (pkg_list) — точное имя, пусто, если не стоит.
pkg_in() {  # ИМЯ
    while read -r _pn _pv; do
        [ "$_pn" = "$1" ] && { printf '%s' "$_pv"; return 0; }
    done <<EOF
$PKGS
EOF
    return 1
}

# Какие модули нужны спеке: SPEC_MODS — имена через пробел, SPEC_MOD_OUTS — «модуль=выход,выход»
# через пробел. По видам выходов (docs/spec-v2.md): туннель vless и hysteria2 — свои модули,
# протоколы прокси — steer-proxy, xsteer и tgws — свои, интерфейс с obfs — steer-obfs. Спека v1
# пишет туннели своими видами (vless, hysteria2) — понимаются тоже.
#
# ВНИМАНИЕ: json_load — вызывать до json_init своего ответа.
spec_mods() {
    SPEC_MODS=""; SPEC_MOD_OUTS=""
    spec_have || return 0
    json_load "$(cat "$(spec_json)" 2>/dev/null)" 2>/dev/null || return 0
    json_select outputs 2>/dev/null || return 0
    json_get_keys _sm_keys
    for _sm_k in $_sm_keys; do
        json_select "$_sm_k" 2>/dev/null || continue
        _sm_kind=""; _sm_proto=""; _sm_ot=""
        json_get_var _sm_kind kind
        json_get_var _sm_proto protocol
        json_get_type _sm_ot obfs
        json_select ..
        [ "$_sm_kind" = tunnel ] && _sm_kind="$_sm_proto"
        case "$_sm_kind" in
            vless|hysteria2|xsteer|tgws) _sm_m="$_sm_kind" ;;
            trojan|shadowsocks|socks|http|vmess) _sm_m=proxy ;;
            interface) if [ -n "$_sm_ot" ]; then _sm_m=obfs; else _sm_m=""; fi ;;
            *) _sm_m="" ;;
        esac
        [ -n "$_sm_m" ] || continue
        case " $SPEC_MODS " in *" $_sm_m "*) ;; *) SPEC_MODS="${SPEC_MODS:+$SPEC_MODS }$_sm_m" ;; esac
        SPEC_MOD_OUTS="$SPEC_MOD_OUTS $_sm_m=$_sm_k"
    done
    return 0
}

# Выходы спеки, которым нужен МОДУЛЬ, через запятую (по SPEC_MOD_OUTS).
spec_mod_outs() {  # МОДУЛЬ
    _so=""
    for _so_p in $SPEC_MOD_OUTS; do
        [ "${_so_p%%=*}" = "$1" ] && _so="${_so:+$_so, }${_so_p#*=}"
    done
    printf '%s' "$_so"
}

# Скачать файл выпуска ядра в /tmp: адреса и sha256 из перечня выпусков, затем прежняя лестница.
steer_fetch() {  # ВЕРСИЯ ИМЯ_ФАЙЛА -> 0, файл /tmp/ИМЯ; via — в FETCH_VIA
    rm -f "/tmp/$2"
    rel_asset steer "$1" "$2"
    if download_rel "/tmp/$2" "$REL_SUM" "https://github.com/splify2/steer/releases/download/v$1/$2" $REL_URLS; then
        [ -n "$FETCH_NOTE" ] && FETCH_VIA="${FETCH_VIA:+$FETCH_VIA; }$FETCH_NOTE"
        return 0
    fi
    rm -f "/tmp/$2"
    return 1
}


# МИНИМУМ ОБНОВЛЕНИЯ В КАРКАСЕ. Версии, скачивание и установка выпусков — плагин updater; а у каркаса, если плагина нет или он
# сломан, остаётся способ обновиться руками: страница выпусков и команда установщика (он же обновляет). Метод engine отдаёт
# обе строки, интерфейс показывает их там, где плагина нет.
UPDATE_URL="${UPDATE_URL:-https://github.com/splify2/splify2/releases/latest}"
UPDATE_CMD="${UPDATE_CMD:-wget -O /tmp/splify2-install.sh https://gitlab.com/xyzmean/splify2/-/raw/main/install.sh && sh /tmp/splify2-install.sh}"
