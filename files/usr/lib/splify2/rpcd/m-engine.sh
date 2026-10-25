#!/bin/sh
# Часть объекта rpcd splify2 — подключается диспетчером /usr/libexec/rpcd/splify2 по имени
# метода. ЗАЧЕМ ФАЙЛОВ НЕСКОЛЬКО. busybox ash разбирает файл целиком, и объект в 4500 строк
# стоил 110 мс разбора на КАЖДЫЙ вызов — при том, что сам ответ считается за 30-90 мс.
# Диспетчер разбирает только себя, общие помощники (common.sh) и группу вызванного метода.
# Переменные и швы для стендов объявлены в диспетчере и здесь доступны как есть.

# МИНИМАЛЬНАЯ ВЕРСИЯ ЯДРА, ПОД КОТОРУЮ СОБРАН ЭТОТ ИНТЕРФЕЙС. Одно число в одном месте: бэкенд
# отдаёт его методом engine, интерфейс сравнивает с установленным и говорит человеку, что не
# заработает, ДО того как он это обнаружит сам. По версии, а не по перечню features.
#
# 2.1.0 — интерфейс ведёт спеку в spec.yaml и читает её JSON-видом ядра (`steer spec convert
# --json`), пишет спеку v2 и не знает выходов zapret: прежнее ядро не печатает JSON-вид, и
# без него не читается и не пишется ни одна правка. Зависимость пакета от ядра не объявлена
# (см. build.sh), поэтому о несоответствии говорит интерфейс.
STEER_MIN_VERSION=2.1.0



# Этой группе нужно скачивание (fetch.sh): подключается здесь, а не каждым вызовом объекта.
need_fetch


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
    # а снятие по нему сняло бы работающий luci-app-splify2 и оставило человека без
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

# МОДУЛИ ЯДРА 2.0: имя модуля — пакет steer-<имя> и бинарник steer-<имя> рядом с steerd. Порядок —
# порядок показа в карточке модулей.
STEER_MODULES="vless hysteria2 proxy xsteer obfs tgws"

# Какие модули стоят: файл рядом с ядром ИЛИ пакет в базе менеджера (PKGS, если его уже прочли).
# Только по файлу — мало: пакет модуля, чей файл пропал или ещё не лёг, держит зависимость на
# прежнее ядро, а в транзакцию обновления не попадает — apk отказывает всей установке (I-560).
mods_present() {
    _mp=""
    for _m in $STEER_MODULES; do
        if [ -x "${MODULE_DIR:-${STEER%/*}}/steer-$_m" ] || { [ -n "${PKGS:-}" ] && pkg_in "steer-$_m" >/dev/null; }; then
            _mp="$_mp $_m"
        fi
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

case "$2" in

    engine)
        # Что за ядро стоит, какие модули рядом с ним и умеет ли оно VLESS.
        #
        # Сначала — есть ли ядро вообще: без него модулей нет, и признаки ниже были бы
        # ответом о файлах, которым некому служить.
        # Состояние сервиса добывается ДО json_init: engine_running разбирает ответ ubus
        # через json_load, а он затирает документ, который мы бы в этот момент собирали.
        svc_enabled="$(engine_enabled)"
        svc_running="$(engine_running)"
        # Ядро ведёт steer-box-connector (podkop, forkop) — см. box_busy в common.sh.
        busy=""
        box_busy && busy="$BOX_BY"
        # Версия САМОГО интерфейса (пакет luci-app-splify2) — здесь, а не только в
        # splify2_versions: тот перед ответом идёт в сеть за перечнем выпусков, и там, где сети
        # нет, «Сейчас» в карточке интерфейса и подпись рельса ждали её десятки секунд (снято с
        # QEMU-стенда без DNS: 26 с на вызов). Установленный пакет — местное знание.
        ui_ver="$(pkg_version luci-app-splify2)"
        if [ ! -x "$STEER" ]; then
            json_init
            json_add_boolean present 0
            json_add_string ui_version "$ui_ver"
            [ -n "$busy" ] && json_add_string busy "$busy"
            json_add_boolean vless 0
            json_add_boolean enabled "$svc_enabled"
            json_add_boolean running "$svc_running"
            json_dump
            exit 0
        fi
        # МОДУЛИ ЯДРА 2.0 — отдельные бинарники рядом с steerd (STEER_MODULES), каждый из своего
        # пакета steer-<модуль>. Наличие спрашивается у файла, а не у базы пакетов: так отвечает
        # и ядро, которое видит модуль, и ручная установка мимо менеджера.
        mods="$(mods_present)"
        # VLESS — по модулю steer-vless.
        vless=0
        case " $mods " in *" vless "*) vless=1 ;; esac
        json_init
        json_add_boolean present 1
        json_add_boolean vless "$vless"
        json_add_array modules
        for m in $mods; do json_add_string "" "$m"; done
        json_close_array
        # Автозапуск и работа — разные вещи, и тумблеру нужны обе. Движок могли
        # остановить из консоли между двумя открытиями страницы, поэтому подпись обязана
        # читать состояние, а не помнить своё.
        json_add_boolean enabled "$svc_enabled"
        json_add_boolean running "$svc_running"
        [ -n "$busy" ] && json_add_string busy "$busy"
        json_add_string arch "$(pkg_arch)"
        # Через pkg_version, а не своим разбором `apk list`: на opkg-роутере тот отдавал пустоту.
        json_add_string version "$(pkg_version steer-core)"
        # Не старше какой версии должен быть движок — см. STEER_MIN_VERSION в шапке файла.
        json_add_string min_version "$STEER_MIN_VERSION"
        json_add_string ui_version "$ui_ver"
        json_dump
        ;;

    purge)
        # «Удалить splify2» одной кнопкой: следы (splify2-purge) и затем сами пакеты.
        #
        # Вход: {plan, keep_config}. С plan=true — ТОЛЬКО план: команда зовётся без --yes и
        # ничего не меняет; ответ — перечень пунктов, примечания и пакеты, которые будут сняты.
        # Без plan — запуск.
        #
        # ЗАПУСК ОТСОЕДИНЁННЫЙ, и это главное. Метод исполняется внутри rpcd, а снимаемый пакет
        # (luci-app-splify2) — это сам этот скрипт и страница; к тому же снятие занимает
        # секунды, а rpcd убивает вызов по сроку. Поэтому задание пишется в файл и запускается
        # в своём сеансе (setsid) с закрытыми дескрипторами, а метод отвечает сразу. Тот же
        # приём, что у перезапуска rpcd в splify2_install: пауза, чтобы ответ успел дойти до
        # браузера, прежде чем что-то исчезнет. Файл задания читается shell-ом по мере
        # исполнения, но он лежит в /tmp, а не в пакете, и снимается самим заданием в конце.
        read -r input
        pg_plan="$(jsonfilter -s "$input" -e '@.plan' 2>/dev/null)"
        pg_keep="$(jsonfilter -s "$input" -e '@.keep_config' 2>/dev/null)"
        pg_flag=""; [ "$pg_keep" = true ] && pg_flag="--keep-config"
        PKGS="$(pkg_list)"
        pg_pkgs=""
        # Ядро ведёт steer-box-connector: он и пакеты ядра — не наши, а снятие steer-core унесло бы и
        # сам коннектор как зависимый. Снимаются только пакеты самого splify2.
        pg_re="$PKG_OURS"
        box_busy && pg_re='^(splify2.*|luci-app-splify2|luci-i18n-splify2-.*)$'
        for pg_n in $(printf '%s\n' "$PKGS" | cut -d' ' -f1 | grep -E "$pg_re"); do
            pg_pkgs="$pg_pkgs $pg_n"
        done
        pg_pkgs="${pg_pkgs# }"
        json_init
        if [ ! -x "$PURGE_BIN" ]; then
            json_add_boolean ok 0; json_add_string error "нет команды удаления ($PURGE_BIN)"; json_dump; exit 0
        fi
        if [ "$pg_plan" = true ]; then
            pg_out="$("$PURGE_BIN" $pg_flag 2>&1)"
            json_add_boolean ok 1
            json_add_boolean plan 1
            json_add_boolean keep_config "$([ -n "$pg_flag" ] && echo 1 || echo 0)"
            json_add_array items
            pg_items="$(printf '%s\n' "$pg_out" | sed -n 's/^splify2-purge: будет сделано: //p')"
            while IFS= read -r pg_l; do
                [ -n "$pg_l" ] && json_add_string "" "$pg_l"
            done <<EOF
$pg_items
EOF
            json_close_array
            json_add_array notes
            pg_notes="$(printf '%s\n' "$pg_out" | grep '^splify2-purge: ' | grep -v -e 'будет сделано: ' -e 'ничего не удалено' -e 'чтобы удалить' -e 'пакеты этот скрипт' -e 'следов не найдено' | sed 's/^splify2-purge: //')"
            while IFS= read -r pg_l; do
                [ -n "$pg_l" ] && json_add_string "" "$pg_l"
            done <<EOF
$pg_notes
EOF
            json_close_array
            json_add_array packages
            for pg_n in $pg_pkgs; do json_add_string "" "$pg_n"; done
            json_close_array
            json_dump; exit 0
        fi
        pg_job="$(mktemp /tmp/splify2-purge-job.XXXXXX)"
        {
            printf '#!/bin/sh\n'
            printf 'sleep %s\n' "$PURGE_DELAY"
            printf '"%s" --yes %s\n' "$PURGE_BIN" "$pg_flag"
            # Модули и расширения — раньше основного пакета: в таком порядке менеджер не
            # откажет из-за зависимостей. luci-app-splify2 и steer — последними.
            pg_first=""; pg_last=""
            for pg_n in $pg_pkgs; do
                case "$pg_n" in luci-app-splify2|steer) pg_last="$pg_last $pg_n" ;; *) pg_first="$pg_first $pg_n" ;; esac
            done
            for pg_n in $pg_first $pg_last; do
                printf '%s\n' "$(pkg_del_cmd "$pg_n")"
            done
            printf '"%s" restart\n' "$RPCD_INITD"
            printf 'rm -f "$0"\n'
        } > "$pg_job"
        chmod 700 "$pg_job"
        if command -v setsid >/dev/null 2>&1; then
            ( setsid sh "$pg_job" </dev/null >"$PURGE_LOG" 2>&1 & )
        else
            ( sh "$pg_job" </dev/null >"$PURGE_LOG" 2>&1 & )
        fi
        json_add_boolean ok 1
        json_add_boolean started 1
        json_add_boolean keep_config "$([ -n "$pg_flag" ] && echo 1 || echo 0)"
        json_add_string log "$PURGE_LOG"
        json_dump
        ;;

    engine_stop)
        # «Остановить всё» — одно действие вместо консоли.
        #
        # Просьба из публичного теста звучала дословно так: «жизненно необходима кнопка
        # Остановить, причём всё — и сервис, и движок». До неё вернуть роутер в состояние
        # «как будто не установлено» можно было только по ssh.
        #
        # disable, а не только stop. Разница не косметическая: без него перезагрузка
        # поднимает движок обратно, и человек, нажавший «остановить всё», получает его
        # снова — молча и без объяснения, почему кнопка «не сработала». Именно поэтому
        # обратное действие обязано быть рядом: снятый автозапуск сам не вернётся.
        #
        # Правила из ядра убирать отдельно не нужно: stop_service движка сносит таблицу
        # nft и вычищает ip rule сам.
        "$INITD" stop >/dev/null 2>&1
        "$INITD" disable >/dev/null 2>&1
        en="$(engine_enabled)"; run="$(engine_running)"
        json_init
        json_add_boolean ok 1
        json_add_boolean enabled "$en"
        json_add_boolean running "$run"
        json_dump
        ;;

    engine_start)
        # Обратная половина тумблера. enable перед start, а не после: иначе состояние
        # «работает, но после перезагрузки не поднимется» существует между двумя
        # вызовами, и увидеть его можно ровно в тот момент, когда роутер перезагрузили.
        #
        # Ядро ведёт steer-box-connector — службу steer поверх него не поднимаем: она делила бы с
        # его steerd таблицу nft и метки (box_busy).
        if box_busy; then
            en="$(engine_enabled)"; run="$(engine_running)"
            json_init
            json_add_boolean ok 0
            json_add_string error "ядро занято: $BOX_BY"
            json_add_string busy "$BOX_BY"
            json_add_boolean enabled "$en"
            json_add_boolean running "$run"
            json_dump
            exit 0
        fi
        "$INITD" enable >/dev/null 2>&1
        "$INITD" start >/dev/null 2>&1
        en="$(engine_enabled)"; run="$(engine_running)"
        json_init
        json_add_boolean ok 1
        json_add_boolean enabled "$en"
        json_add_boolean running "$run"
        json_dump
        ;;

    steer_versions)
        # Какие версии движка можно поставить и как они называются.
        gh_load splify2/steer
        json_init
        json_add_string arch "$(pkg_arch)"
        gh_add_releases
        json_dump
        ;;

    splify2_versions)
        # Какие версии САМОГО интерфейса можно поставить.
        #
        # Зачем это вообще нужно. Ни один из пакетов проекта не лежит в feeds OpenWrt,
        # поэтому `apk upgrade` их не видит и обновить интерфейс можно было только по
        # ssh — при том что движок из интерфейса ставится с первого дня. Асимметрия
        # заметная: обновлять умели то, что реже меняется.
        gh_load splify2/splify2
        json_init
        json_add_string current "$(pkg_version luci-app-splify2)"
        gh_add_releases
        json_dump
        ;;

    splify2_install)
        # Скачать и поставить интерфейс выбранной версии.
        #
        # Пакет один и он noarch: интерфейс — это собранный бандл и shell-скрипты, под
        # архитектуру здесь ничего не собирается. Поэтому ни выбора варианта, ни
        # pkg_arch тут нет, и единственный отказ до сети — по виду версии.
        read -r input
        ver="$(jsonfilter -s "$input" -e '@.version' 2>/dev/null)"
        json_init
        case "$ver" in
            ''|*[!0-9.]*) json_add_boolean ok 0; json_add_string error "в версии допустимы только цифры и точки"; json_dump; exit 0 ;;
        esac
        name="luci-app-splify2-${ver}-1_$(pkg_noarch)"
        url="https://github.com/splify2/splify2/releases/download/v${ver}/${name}"
        tmp="/tmp/${name}"
        rm -f "$tmp"
        # Сначала адреса и sha256 из перечня выпусков (rel_asset), затем прежняя лестница
        # download() по этой же ссылке, а не свой wget: ссылка перенаправляет на
        # release-assets.githubusercontent.com, и там, где этот хост закрыт, обновление из
        # интерфейса не работало вовсе (splify2#15).
        rel_asset splify2 "$ver" "$name"
        if ! download_rel "$tmp" "$REL_SUM" "$url" $REL_URLS; then
            rm -f "$tmp"
            json_add_boolean ok 0
            json_add_string error "не скачалось: $name (нет такой версии?)${FETCH_NOTE:+ — $FETCH_NOTE}"
            json_dump; exit 0
        fi
        [ -n "$FETCH_NOTE" ] && json_add_string via "$FETCH_NOTE"
        pkg_install "$tmp" luci-app-splify2
        rc=$?
        rm -f "$tmp"
        if [ "$rc" != 0 ]; then
            json_add_boolean ok 0
            json_add_string error "$PKG_OUT"
            json_add_boolean removed "$PKG_REMOVED"
            json_dump; exit 0
        fi
        # Перезапуск rpcd — обязательная часть, а не любезность: список методов ubus и
        # ACL читаются им при старте, поэтому без перезапуска новая версия интерфейса
        # обращается к методам, которых работающий rpcd ещё не знает. Выглядит это как
        # «обновился и всё сломалось».
        #
        # В фоне и с задержкой, потому что этот процесс — сам rpcd: перезапусти его
        # сейчас, и ответ, который мы вот-вот напечатаем, до браузера не доедет.
        # Подоболочка отвязана от потоков вызова целиком (`</dev/null >/dev/null 2>&1`), а не только
        # команда внутри неё: пока подоболочка спит с открытым стандартным выводом, конец ответа
        # для rpcd не наступает, и перезапуск мог унести ответ раньше, чем он дойдёт до браузера.
        ( sleep 2; "$RPCD_INITD" restart ) </dev/null >/dev/null 2>&1 &
        json_add_boolean ok 1
        json_add_string installed "$name"
        # Вывод менеджера пакетов отдаётся и на УСПЕХЕ, а не только в отказе. Причина не в
        # полноте: в этом выводе печатает свои строки post-install пакета, и там сказано
        # единственное, чего интерфейс знать не может, — что netifd держит прежний набор
        # опций протокола и новые до `/etc/init.d/network restart` не действуют. Пока
        # $PKG_OUT на успехе выбрасывался, эта строка существовала только в терминале того,
        # кто ставит пакет руками, — то есть для человека с браузером её не было вовсе.
        json_add_string output "$PKG_OUT"
        # Страницу придётся перезагрузить: бандл у браузера в кеше, а его версия
        # читается из build-id.txt при загрузке документа (см. home.js).
        json_add_boolean reload_needed 1
        json_dump
        ;;

    steer_install)
        # Скачать и поставить ядро выбранной версии: пакет steer-core и модули steer-<модуль>
        # ОДНОЙ транзакцией.
        read -r input
        ver="$(jsonfilter -s "$input" -e '@.version' 2>/dev/null)"
        want="$(jsonfilter -s "$input" -e '@.modules' 2>/dev/null)"
        arch="$(pkg_arch)"
        # Ядро ведёт steer-box-connector: его пакет зависит от steer-core точной версии, и пакеты
        # ядра здесь — его, а не наши (box_busy).
        box_busy && fail "ядро занято: $BOX_BY"
        case "$ver" in ''|*[!0-9.]*) fail "в версии допустимы только цифры и точки" ;; esac
        [ "$(printf '%s\n%s\n' "$ver" "$STEER_MIN_VERSION" | sort -V | head -n 1)" = "$STEER_MIN_VERSION" ] ||
            fail "интерфейс работает с ядром не старше $STEER_MIN_VERSION"
        [ -n "$arch" ] || fail "не определилась архитектура"

        # Модуль зависит от steer-core ТОЧНОЙ версии (формат событий ядра и модуля между
        # выпусками не обещан), поэтому обновить ядро, оставив хоть один стоящий модуль прежним,
        # менеджер не даст. Состав транзакции:
        #   - модули, которые попросили (`modules` — имена через пробел или запятую);
        #   - модули, которые уже стоят: без них транзакция не пройдёт, а снимать их без спроса
        #     нельзя;
        #   - модули, которые нужны спеке (spec_mods): ядро без них её не примет.
        # kmod-tun (зависимость модулей с TUN) менеджер берёт из фидов сам.
        PKGS="$(pkg_list)"
        spec_mods
        for m in $(printf '%s' "$want" | tr ',' ' '); do
            case " $STEER_MODULES " in *" $m "*) ;; *) fail "неизвестный модуль: $m" ;; esac
        done
        have=" $want $(mods_present) $SPEC_MODS "
        have="$(printf '%s' "$have" | tr ',' ' ')"
        mods=""
        for m in $STEER_MODULES; do
            case "$have" in *" $m "*) mods="$mods $m" ;; esac
        done
        mods="${mods# }"

        FETCH_VIA=""; files=""
        for p in steer-core $(for m in $mods; do printf 'steer-%s ' "$m"; done); do
            name="$p-${ver}-1_${arch}.$(pkg_ext)"
            if ! steer_fetch "$ver" "$name"; then
                rm -f $files
                fail "не скачалось: $name (нет такой версии для $arch?)${FETCH_NOTE:+ — $FETCH_NOTE}"
            fi
            files="$files /tmp/$name"
        done

        # Место на флеше — до apk (flash_room_ok, common.sh).
        # shellcheck disable=SC2086
        if ! flash_room_ok $files; then
            # shellcheck disable=SC2086
            rm -f $files
            fail "$ROOM_ERR"
        fi

        pkg_install "${files# }"
        rc=$?
        out="$PKG_OUT"
        # shellcheck disable=SC2086
        rm -f $files
        json_init
        if [ "$rc" != 0 ]; then
            json_add_boolean ok 0
            json_add_string error "$out"
            json_dump; exit 0
        fi
        "$INITD" enable >/dev/null 2>&1 || true
        # Спека переезжает в spec.yaml (v1 — переведённой ядром).
        spec_migrate
        restarted=0
        if spec_have; then
            "$INITD" restart >/dev/null 2>&1 && restarted=1
        fi
        json_add_boolean ok 1
        json_add_string installed "steer-core $ver"
        json_add_array modules
        for m in $mods; do json_add_string "" "$m"; done
        json_close_array
        json_add_boolean restarted "$restarted"
        [ -n "$FETCH_VIA" ] && json_add_string via "$FETCH_VIA"
        [ -n "$out" ] && json_add_string output "$out"
        json_dump
        ;;

    steer_modules)
        # Модули ядра для карточки «Интерфейс»: какие стоят (файл модуля рядом с ядром) и какой версии
        # пакет, какие нужны спеке (такой снять нельзя — ядро её не примет) и каким выходам.
        # Плюс версия steer-core: модуль ставится той же версией, что ядро, и без steer-core
        # (ядра нет) ставить модули нечему.
        PKGS="$(pkg_list)"
        spec_mods
        have=" $(mods_present) "
        busy=""; box_busy && busy="$BOX_BY"
        json_init
        json_add_string core "$(pkg_in steer-core)"
        [ -n "$busy" ] && json_add_string busy "$busy"
        json_add_array modules
        for m in $STEER_MODULES; do
            json_add_object ""
            json_add_string name "$m"
            case "$have" in *" $m "*) json_add_boolean installed 1 ;; *) json_add_boolean installed 0 ;; esac
            v="$(pkg_in "steer-$m")"; [ -n "$v" ] && json_add_string version "$v"
            case " $SPEC_MODS " in
                *" $m "*) json_add_boolean needed 1; json_add_string outputs "$(spec_mod_outs "$m")" ;;
                *) json_add_boolean needed 0 ;;
            esac
            json_close_object
        done
        json_close_array
        json_dump
        ;;

    steer_module_add|steer_module_del)
        # Поставить или снять один модуль ядра 2.0.
        #
        # Ставится модуль ТОЙ ЖЕ версии, что стоящий steer-core: модуль зависит от него точной
        # версией, и другой менеджер не примет. Ядро само его не увидит до перезапуска — его
        # перезапускает скрипт пакета модуля, если служба включена.
        #
        # Снять модуль, который нужен спеке, нельзя: ядро отвергло бы её целиком при следующем
        # применении, а выход его вида перестал бы работать уже сейчас. Тогда отказ называет
        # выходы — их сначала убирают или переделывают. Мета-пакет steer-extended (2.0) держит
        # свои модули зависимостью — он снимается вместе с модулем, сам он ничего не несёт.
        read -r input
        m="$(jsonfilter -s "$input" -e '@.module' 2>/dev/null)"
        case " $STEER_MODULES " in *" $m "*) ;; *) fail "неизвестный модуль: $m" ;; esac
        [ -n "$m" ] || fail "неизвестный модуль: $m"
        box_busy && fail "ядро занято: $BOX_BY"
        PKGS="$(pkg_list)"
        if [ "$2" = steer_module_del ]; then
            spec_mods
            case " $SPEC_MODS " in
                *" $m "*) fail "модуль нужен выходам: $(spec_mod_outs "$m")" ;;
            esac
            if pkg_in "steer-extended" >/dev/null; then
                # Снятие мета-пакета у apk уносит и его зависимости, которых нет в /etc/apk/world: если
                # человек ставил только steer-extended, ушли бы ядро и остальные модули. Они
                # закрепляются заранее (у opkg такой записи нет — pkg_unpin ничего не делает).
                pkg_unpin steer-core
                for _k in $STEER_MODULES; do
                    [ "$_k" != "$m" ] && pkg_in "steer-$_k" >/dev/null && pkg_unpin "steer-$_k"
                done
                pkg_del steer-extended
            fi
            pkg_del "steer-$m"
            PKGS="$(pkg_list)"
            json_init
            if pkg_in "steer-$m" >/dev/null; then
                json_add_boolean ok 0
                json_add_string error "модуль steer-$m не снялся"
            else
                json_add_boolean ok 1
            fi
            json_dump
            exit 0
        fi
        cver="$(pkg_in steer-core)"
        [ -n "$cver" ] || fail "нет ядра steer-core"
        arch="$(pkg_arch)"
        [ -n "$arch" ] || fail "не определилась архитектура"
        name="steer-$m-${cver}-1_${arch}.$(pkg_ext)"
        FETCH_VIA=""
        steer_fetch "$cver" "$name" || fail "не скачалось: $name (нет такой версии для $arch?)${FETCH_NOTE:+ — $FETCH_NOTE}"
        pkg_install "/tmp/$name"
        rc=$?
        out="$PKG_OUT"
        rm -f "/tmp/$name"
        json_init
        if [ "$rc" != 0 ]; then
            json_add_boolean ok 0
            json_add_string error "$out"
            json_dump; exit 0
        fi
        json_add_boolean ok 1
        json_add_string installed "steer-$m $cver"
        [ -n "$FETCH_VIA" ] && json_add_string via "$FETCH_VIA"
        [ -n "$out" ] && json_add_string output "$out"
        json_dump
        ;;

    ui_get|ui_set)
        UI_STATE_MAX=65536
        # Память мастера: какие выходы он создал, как человек их назвал, что в каждом.
        #
        # Отдельно от спеки, и это принципиально. Спека — вход движка, и «как человек назвал
        # outbound» ему не нужно ни для чего; дописать туда своё поле значило бы, что движок
        # обязан его сохранять при любой правке, то есть управляющий слой протёк в модель.
        #
        # А знать это надо, иначе мастер не отличит свои записи от чужих. Прежде он узнавал их
        # по зашитым именам («сервисы», выход «vpn»), и на живом роутере это провалилось сразу:
        # там канал назывался funny и выход vless, настроенные руками. Мастер их не увидел и
        # предложил создать рядом второй туннель — то есть тихо развёл настройку на две.
        #
        # Хранится как непрозрачная строка: разбирать её здесь нечем и незачем, а формат
        # принадлежит интерфейсу и будет меняться вместе с ним.
        uci_file || fail "не удалось создать $UCI_SPLIFY2 — кончилось место?"
        uci -q get splify2.main >/dev/null 2>&1 || uci -q set splify2.main=splify2
        if [ "$2" = ui_set ]; then
            read -r input
            json_load "$input" 2>/dev/null || fail "неразбираемый запрос"
            json_get_var state state
            # Память мастера — несколько отметок и имён, а не хранилище: без предела туда можно
            # положить сколько угодно в настройку роутера (I-329). Отказ называет число.
            _sz="$(printf '%s' "$state" | wc -c)"
            [ "$_sz" -le "$UI_STATE_MAX" ] ||
                fail "память интерфейса больше $((UI_STATE_MAX / 1024)) КБ: $_sz байт"
            uci -q set splify2.main.wizard="$state" || fail "не удалось записать память интерфейса"
            uci_commit
            json_init; json_add_boolean ok 1; json_dump
        else
            json_init
            json_add_string state "$(uci -q get splify2.main.wizard)"
            json_dump
        fi
        ;;

    *) fail "неизвестный метод" ;;
esac
