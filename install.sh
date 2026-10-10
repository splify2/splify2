#!/bin/sh
# Установка splify2 на OpenWrt одной строкой.
#
#   wget -O /tmp/splify2-install.sh https://gitlab.com/xyzmean/splify2/-/raw/main/install.sh && sh /tmp/splify2-install.sh
#
# Прежняя строка через raw.githubusercontent.com осталась рабочей там, где этот хост
# доступен:
#
#   wget -O /tmp/splify2-install.sh https://raw.githubusercontent.com/splify2/splify2/main/install.sh && sh /tmp/splify2-install.sh
#
# Почему главной стало зеркало. splify2#15: у части аудитории провайдер закрыл
# `githubusercontent.com`, и закрыл его целиком — на тех же четырёх адресах Fastly
# (185.199.108-111.133) живут и `raw.`, и `objects.`, и `release-assets.`. То есть разом
# отваливается и этот скрипт, и файлы релиза, которые он скачивает: поставить splify2 с
# GitHub нельзя вообще.
#
# Репозитории зеркалятся на GitLab тем же путём, и там сырой файл отдаётся с ТОГО ЖЕ домена,
# на который человек и так ходит: отдельного хоста под содержимое, который закрывают
# отдельно, у GitLab просто нет. Плюс ни заголовка, ни счётчика запросов. Хосты самого
# GitHub (`api.` и `codeload.`, сеть 140.82.121.x) остались запасными путями внутри
# скрипта: у contents API 60 запросов в час на адрес, а codeload умеет только архив ветки
# целиком — 400 КБ ради одного файла в 24 КБ.
#
# Чужое зеркало вроде gh-proxy не годится вовсе: зеркалу пришлось бы доверить то, что роутер
# выполнит и применит как правила маршрутизации. GitLab здесь — не чужое зеркало, а вторая
# выкладка того же владельца.
#
# Скачать файлом и запустить (или `sh -c "$(wget -qO- …)"`), а не `wget … | sh`: через
# конвейер установщику достаётся не терминал, и вопрос про модули ядра он не задаёт вовсе —
# молча берёт умолчание.
#
# Что делает: определяет архитектуру, предупреждает, если на роутере стоит splify первой
# версии, ставит ядро steer, если его нет, ставит интерфейс, включает службу. Ничего не
# спрашивает, если спрашивать не о чем. Версии и адреса пакетов — из перечня выпусков
# splify2/releases (version.json, со сверкой sha256), а GitHub API и обходы выше — запасной путь.
#
# Почему ядро ставится отсюда, а не объявлено зависимостью пакета. Ядро 2.0 — пакет steer-core и
# модули протоколов (steer-vless, steer-hysteria2, steer-proxy, …), и какие модули нужны, решает
# человек: зависимость пакета умеет только «нужен steer-core», а угадать за него значит либо
# положить лишнее, либо не положить нужное и получить «выход не работает» без объяснения.
set -eu

REPO_STEER=splify2/steer
REPO_UI=splify2/splify2
TMP=/tmp/splify2-install
API=https://api.github.com/repos
RAW=https://raw.githubusercontent.com
# Обходной путь к тем же файлам, если `githubusercontent.com` закрыт (см. шапку). Ветка
# `dist` — это выкладка релизного workflow: те же пакеты, что и в релизе, только доступные
# по адресу, который не перенаправляет на Fastly.
CODELOAD=https://codeload.github.com
# Зеркало на GitLab: тот же владелец, тот же путь, сырой файл со своего домена.
MIRROR=https://gitlab.com
DIST_BRANCH=dist
# Перечень выпусков splify2/releases: один version.json с последними версиями каждого продукта,
# размером, sha256 и адресами каждого файла. Три адреса одного и того же файла, по порядку; всё
# прежнее (api.github.com, VERSION ветки dist, зеркало, хосты GitHub) — запасной путь за ним.
REL_JSON_URLS="https://raw.githubusercontent.com/splify2/releases/main/version.json https://cdn.jsdelivr.net/gh/splify2/releases@main/version.json https://splify2.github.io/releases/version.json"
TAB="$(printf '\t')"

say()  { printf '\033[1m%s\033[0m\n' "$*"; }
info() { printf '  %s\n' "$*"; }
die()  { printf '\033[1;31mОшибка:\033[0m %s\n' "$*" >&2; exit 1; }

# ---- окружение ---------------------------------------------------------------
#
# Менеджер пакетов определяется, а не предполагается. Раньше здесь стоял отказ «нужен apk:
# это OpenWrt 24.10+, на старых opkg ставьте вручную» — то есть установка одной строкой не
# работала на 23.05 и 22.03 вовсе, а именно они стоят на слабых роутерах, которые никто не
# обновит. Теперь релизы содержат оба формата, и выбор делается здесь.
#
# Дальше по скрипту менеджер вызывается через три обёртки — pm_installed, pm_add,
# pm_suffix, — а не проверкой «если apk» в каждом месте: пять таких проверок означали бы
# пятое место, где про opkg забыли.
if command -v apk >/dev/null 2>&1; then
    PM=apk
elif command -v opkg >/dev/null 2>&1; then
    PM=opkg
else
    die "не нашёл ни apk, ни opkg — это точно OpenWrt?"
fi
command -v wget >/dev/null 2>&1 || die "нужен wget"

# Список установленного. Имена пакетов в обоих менеджерах одни и те же.
# Полноценный if, а не `[ ... ] && A || B`: у той идиомы A, вернувшая ненулевой код,
# запускает ещё и B — то есть пустой список установленного у apk дёрнул бы opkg, которого
# на этой системе нет.
pm_installed() {
    if [ "$PM" = apk ]; then apk list -I 2>/dev/null
    else opkg list-installed 2>/dev/null
    fi
}

# Закрепления в /etc/apk/world, которые ни на что не указывают.
#
# `apk add ФАЙЛ` (apk 3) записывает в world не «имя», а «имя><хеш файла» — закрепление за этой
# сборкой. Если транзакция оборвалась на середине (на роутере с малым флешем — «No space left on
# device» при распаковке второго пакета набора), world уже записан с хешами НОВЫХ файлов, а в базе
# остались прежние пакеты или не появилось вовсе нового. С этой минуты ЛЮБАЯ команда apk — и наша,
# и чужая, хоть установка zapret — не решается: «unable to select packages: breaks:
# world[steer-core><Q1…]». Воспроизведено на apk 3.0.5 (как на OpenWrt 25.12.5) с tmpfs на 4–5 МБ.
#
# Чиним правкой самого файла, без apk: решатель в таком состоянии отказывает и на `apk add имя`.
# Что делаем с каждой записью «имя><хеш»:
#   - пакета с таким именем нет в базе — запись убирается: она ничего не держит;
#   - пакет стоит, но с другим хешом — становится просто «имя»;
#   - наше имя (аргумент — регулярное выражение имён) — становится «имя» всегда: закрепление за
#     файлом нужно только самой транзакции, дальше оно лишь не даёт apk увидеть пакет в фиде и
#     ломает следующую установку той же версии другой сборки.
# Записи без «><» (в том числе `!имя`) и закрепления чужих пакетов с верным хешом не трогаются.
# Пути — APK_WORLD и APK_DB: стенды подставляют свои.
PM_OURS='^(steer|steer-.*|libsteer.*|splify2.*|luci-app-splify2|luci-i18n-splify2-.*|steer-box-connector|luci-app-steer-box-connector)$'
pm_world_heal() {  # [ИМЕНА-ERE]
    [ "$PM" = apk ] || return 0
    _wh_w="${APK_WORLD:-/etc/apk/world}"; _wh_d="${APK_DB:-/lib/apk/db/installed}"
    [ -s "$_wh_w" ] && [ -s "$_wh_d" ] || return 0
    grep -q '><' "$_wh_w" 2>/dev/null || return 0
    grep -q '^P:' "$_wh_d" 2>/dev/null || return 0
    _wh_t="$_wh_w.heal.$$"
    if awk -v ours="${1:-^$}" '
        FILENAME == ARGV[1] {
            if ($0 ~ /^C:/) { c = substr($0, 3); if (p != "") id[p] = c }
            else if ($0 ~ /^P:/) { p = substr($0, 3); if (c != "") id[p] = c }
            if ($0 == "") { c = ""; p = "" }
            next
        }
        {
            i = index($0, "><")
            if (i == 0) { print; next }
            n = substr($0, 1, i - 1); q = substr($0, i + 2)
            if (!(n in id)) next
            if (n ~ ours || id[n] != q) print n; else print
        }' "$_wh_d" "$_wh_w" > "$_wh_t" 2>/dev/null; then
        cmp -s "$_wh_t" "$_wh_w" || mv "$_wh_t" "$_wh_w"
    fi
    rm -f "$_wh_t"
    return 0
}

# Установка локального файла. --allow-untrusted нужен ТОЛЬКО apk: пакеты не подписаны
# ключом репозитория OpenWrt, они лежат в GitHub Releases, а opkg подпись локального
# файла не проверяет вовсе и такого флага не знает. --force-overwrite нужен обоим:
# интерфейс кладёт файлы в /www/luci-static, и при переустановке поверх прежней версии
# менеджер видит там чужие с его точки зрения файлы.
#
# Зависимости локального файла оба менеджера ищут в СПИСКАХ ПАКЕТОВ, а на свежей прошивке их
# нет вовсе: списки opkg живут в /var, индексы apk — в /var/cache/apk, и то и другое — tmpfs,
# не переживающий перезагрузку. Тогда установка падает на «cannot find dependency ip-full for
# steer» (opkg) или «unable to select packages» (apk — снято с роутера на 25.12: индексы убраны
# — отказ, после apk update — установка), хотя сам пакет скачан и лежит рядом. Поэтому при
# такой ошибке списки обновляются и установка повторяется — один раз: если и после обновления
# зависимости нет, дело не в списках, и крутить это по кругу незачем. Прежняя редакция знала
# это только про opkg («беда, которой нет у apk») — у 1.2.5 зависимостей не было, и ветка apk
# отказа просто не встречала; у 26.9 их две (https-dns-proxy, ip-full).
pm_add() {  # ФАЙЛ... [!ИМЯ...] — одной транзакцией
    if [ "$PM" = apk ]; then
        # До: поломку прошлой оборванной установки (см. pm_world_heal) apk сам не чинит, и без
        # лечения не ставится ничто. После — при любом исходе: оборванная транзакция ломает world
        # заново, а закрепления за файлами нам не нужны.
        pm_world_heal
        out="$(apk add --allow-untrusted --force-overwrite "$@" 2>&1)"
        _pm_rc=$?
        if [ "$_pm_rc" = 0 ]; then pm_world_heal "$PM_OURS"; return 0; fi
        case "$out" in
            *"unable to select packages"*)
                pm_world_heal "$PM_OURS"
                info "нет индексов пакетов — обновляю (apk update)"
                apk update >/dev/null 2>&1
                apk add --allow-untrusted --force-overwrite "$@" >/dev/null 2>&1
                _pm_rc=$?
                pm_world_heal "$PM_OURS"
                return $_pm_rc
                ;;
        esac
        pm_world_heal "$PM_OURS"
        printf '%s\n' "$out" >&2
        return 1
    fi
    out="$(opkg install --force-overwrite "$@" 2>&1)"
    [ $? = 0 ] && return 0
    case "$out" in
        *"cannot find dependency"*|*"unresolved"*|*"incompatible with the architectures"*)
            info "нет списков пакетов — обновляю (opkg update)"
            opkg update >/dev/null 2>&1
            opkg install --force-overwrite "$@" >/dev/null 2>&1
            return $?
            ;;
    esac
    printf '%s\n' "$out" >&2
    return 1
}

# Расширение файла пакета и суффикс архитектуры у пакета без бинарного кода: apk называет
# такой noarch, opkg — all. Перепутать их значит скачать несуществующий файл.
pm_suffix() { if [ "$PM" = apk ]; then echo "noarch.apk"; else echo "all.ipk"; fi; }
pm_ext()    { if [ "$PM" = apk ]; then echo "apk"; else echo "ipk"; fi; }

# Архитектура ПАКЕТОВ, а не процессора: `apk --print-arch` отдаёт `aarch64`, а пакеты
# OpenWrt называются `aarch64_cortex-a53`. По первому имя файла собирается неверно, и
# скачивание молча не находит релиз — проверено на живом роутере.
if [ -f /etc/openwrt_release ]; then
    ARCH="$( . /etc/openwrt_release; printf '%s' "${DISTRIB_ARCH:-}" )"
fi
# Запасной путь — только для apk: у opkg своего «print-arch» нет, а DISTRIB_ARCH выше
# есть на обеих ветках OpenWrt, так что сюда доходят лишь совсем странные системы.
[ -n "${ARCH:-}" ] || [ "$PM" != apk ] || ARCH="$(apk --print-arch 2>/dev/null || true)"
[ -n "$ARCH" ] || die "не удалось определить архитектуру пакетов"

mkdir -p "$TMP"
# Ловушка INT/TERM завершает скрипт (exit запускает ловушку EXIT, та убирает каталог); одна
# общая на EXIT INT TERM убирала каталог по сигналу и продолжала установку без него.
trap 'rm -rf "$TMP"' EXIT
trap 'exit 143' INT TERM

say "splify2: установка"
info "архитектура: $ARCH"

# ---- splify первой версии на том же роутере ------------------------------------
#
# Зачем это здесь. Первая версия проекта (github.com/xyzmean/splify) — отдельная
# программа, и установка второй её не касается: пакеты называются иначе, файлы лежат
# в других местах. То есть человек получает два обхода блокировок одновременно, и
# узнаёт об этом по тому, что перестаёт работать DNS.
#
# Признаки взяты из кода, а не придуманы, — иначе проверка ловила бы не то:
#   * `/etc/init.d/splify`, `/etc/init.d/splify-agent` — службы первой версии; их имена
#     сохранились в мёртвом словаре переводов (`ui/src/lib/i18n.ts:430,463`), где
#     разбираются её же сообщения диагностики;
#   * `splify-apply`, `splify-doctor`, `splify-dnsd`, `splify-failover`,
#     `splify-firewall` — её команды, оттуда же (i18n.ts:287-479);
#   * наборы `splify_vpn_v4`, `splify_direct_v4`, `splify_fakeip_map` в ОБЩЕЙ таблице
#     `inet fw4` — их имена и таблица записаны в `steer/src/dnsd.c:3,636,773,2028`:
#     этот файл сам родом из первой версии;
#   * `30-splify.nft` — её файл правил (i18n.ts:477). Имя точное, каталог — по
#     соглашению OpenWrt (`/usr/share/nftables.d/*/`), поэтому проверяется маской, а
#     не одним путём;
#   * пакет: его имя НИГДЕ не записано, поэтому шаблон описывает не имя, а родство —
#     «установлено что-то со splify в имени, и это не наши luci-app-splify2/splify2».
#     Наши пакеты именно так и отсеиваются, стенд это проверяет.
#
# Чего здесь нет и не будет: удаления и переноса. Это чужая работающая настройка, и
# снести её за человека установщик права не имеет.
V1ROOT="${V1ROOT:-}"   # на роутере пусто; стенд подставляет каталог-песочницу

V1_SIGNS=""
# Закрывающая скоба — на своей строке: стенд достаёт эти функции из файла диапазоном
# sed до строки `^}`, и однострочная запись склеила бы две функции в одну.
v1_add() {
    V1_SIGNS="$V1_SIGNS  - $1
"
}

v1_scan() {
    for p in $(pm_installed | awk '{print $1}' | sed 's/-[0-9][^ ]*$//' |
               grep splify | grep -v splify2 || true); do
        v1_add "пакет $p"
    done
    for f in /etc/init.d/splify /etc/init.d/splify-agent; do
        if [ -e "$V1ROOT$f" ]; then v1_add "служба $f"; fi
    done
    for c in splify-apply splify-doctor splify-dnsd splify-failover splify-firewall; do
        if command -v "$c" >/dev/null 2>&1; then v1_add "команда $c"; fi
    done
    if command -v nft >/dev/null 2>&1; then
        for n in splify_vpn_v4 splify_direct_v4 splify_fakeip_map; do
            if nft list set inet fw4 "$n" >/dev/null 2>&1; then
                v1_add "набор nft inet fw4 $n"
            fi
        done
    fi
    for f in "$V1ROOT"/usr/share/nftables.d/*/30-splify.nft; do
        if [ -e "$f" ]; then v1_add "правила nft $f"; fi
    done
    return 0
}

v1_scan
if [ -n "$V1_SIGNS" ]; then
    say ""
    say "Внимание: на роутере уже стоит splify первой версии"
    printf '%s' "$V1_SIGNS"
    cat <<'TXT'
  Две версии одновременно делят между собой nft и DNS. Первая держит свои наборы в
  общей таблице inet fw4, метит пакеты марками 0x40000/0x80000 и правит таблицы
  маршрутизации 200 и 202; splify2 работает в своей таблице inet steer, с марками от
  0x100000 и таблицами от 300 — здесь они не пересекаются. А вот DNS перехватывают
  оба, и тут выигрывает тот, кто успел: маршрутизация по доменам начинает работать
  через раз, и по логам это выглядит как ошибка второй версии.

  Установщик ничего из первой версии не удаляет и не переносит — это ваша настройка.
  Что можно сделать самому, до или после установки:
    - выключить первую версию, оставив файлы на месте:
        /etc/init.d/splify stop && /etc/init.d/splify disable
      (то же для splify-agent, если он в списке выше)
    - проверить, что её правила ушли из ядра Linux:
        nft list table inet fw4 | grep splify
    - если возвращаться к ней не собираетесь — снять её пакет тем же менеджером,
      которым он ставился; настройки в /etc пакетный менеджер оставит.
TXT
    if [ -t 0 ]; then
        printf '  Продолжить установку splify2? [д/Н]: '
        # Своя переменная, не общая `ans`: ниже её читает вопрос про вариант движка, и
        # ответ, оставшийся от этого вопроса, отвечал бы там за человека.
        read -r v1ans || v1ans=""
        case "${v1ans:-}" in
            [дДyY]*) ;;
            *)
                say ""
                info "Прервано по вашему выбору. Ничего не установлено и не изменено."
                exit 0
                ;;
        esac
    else
        info "Запуск без терминала — спросить некого, установка продолжается."
    fi
fi

# ---- какое ядро стоит сейчас --------------------------------------------------
# Имена установленных пакетов — точные, без версий: «steer» не должно совпадать со «steer-core».
pm_names() {
    if [ "$PM" = apk ]; then
        pm_installed | sed -n 's/^\([^ ]*\)-[0-9][^ -]*-r[0-9]* .*/\1/p'
    else
        pm_installed | awk '{print $1}'
    fi
}

pm_has() {  # ИМЯ
    pm_names | grep -qx "$1"
}

# Модули ядра 2.0 в порядке показа (тот же перечень, что у бэкенда, m-engine.sh STEER_MODULES) и
# умолчание к первой установке: VLESS, hysteria2 и протоколы прокси — туннели по подписке и
# ссылкам. Пакеты 2.0.0 этих трёх вместе — 120–240 КБ (aarch64 — mipsel) при steer-core около
# 1,1 МБ, а без них подписка не заработает; xsteer, обфускатор и мост Telegram ставятся из
# интерфейса, когда понадобятся.
STEER_MODULES="vless hysteria2 proxy xsteer obfs tgws"
STEER_DEFAULT_MODULES="vless hysteria2 proxy"

# Какие модули поставить: выбор человека, уже стоящие (модуль зависит от steer-core точной
# версии — транзакция без него не пройдёт) и, при переходе со steer-extended 1.x, вшитые в него
# vless, xsteer, obfs, tgws — переход не отнимает того, что работало.
steer_mods() {  # ВЫБОР
    _sm_have=" $1 "
    for _sm in $STEER_MODULES; do
        if pm_has "steer-$_sm"; then _sm_have="$_sm_have$_sm "; fi
    done
    if pm_has steer-extended && ! pm_has steer-core; then
        _sm_have="$_sm_have vless xsteer obfs tgws "
    fi
    _sm_out=""
    for _sm in $STEER_MODULES; do
        case "$_sm_have" in *" $_sm "*) _sm_out="$_sm_out $_sm" ;; esac
    done
    printf '%s\n' "${_sm_out# }"
}

# Ядро ведёт steer-box-connector (sing-box для podkop и forkop на ядре steer): его пакет зависит
# от steer-core точной версии, и служба steer рядом с ним делила бы таблицу nft и метки. Тогда
# ядро не ставится и не включается — это пакеты коннектора, а не наши. Признак — тот же, что у
# скриптов пакетов ядра: чья служба /etc/init.d/sing-box.
BOX_INITD="${BOX_INITD:-/etc/init.d/sing-box}"
box_busy() {
    grep -q steer-box-connector "$BOX_INITD" 2>/dev/null
}

HAVE_CORE=no
if pm_has steer-core; then HAVE_CORE=yes; fi
# Прежние пакеты ядра: 1.x (steer, steer-extended) и промежуточной раскладки (libsteer,
# libsteer-wolfssl). steer-core заменяет их — снимаются они в той же транзакции.
STEER_OLD=""
for _n in steer steer-extended libsteer libsteer-wolfssl; do
    if pm_has "$_n"; then STEER_OLD="$STEER_OLD $_n"; fi
done

# ---- модули ядра ----------------------------------------------------------------
# Спрашиваем ТОЛЬКО если ядро 2.0 ставится и есть кому ответить. Без терминала (из скрипта, по
# ssh с перенаправленным вводом) — умолчание.
WANT_MODULES="$STEER_DEFAULT_MODULES"
if box_busy; then
    info "ядро ведёт steer-box-connector — пакеты ядра не трогаю"
elif [ "$HAVE_CORE" = yes ]; then
    info "ядро уже стоит (steer-core); обновляется оно из интерфейса"
elif [ -t 0 ]; then
    say ""
    say "Какие модули ядра поставить?"
    cat <<'TXT'
  vless      VLESS
  hysteria2  Hysteria2
  proxy      Trojan, Shadowsocks, SOCKS, HTTP, VMess
  xsteer     XSTEER
  obfs       WireGuard поверх TCP
  tgws       мост Telegram
  Остальные можно поставить и снять потом: Настройки → О ПО → Модули ядра.
TXT
    printf '  Через пробел [%s]: ' "$STEER_DEFAULT_MODULES"
    read -r ans || ans=""
    if [ -n "${ans:-}" ]; then
        WANT_MODULES=""
        for _m in $ans; do
            case " $STEER_MODULES " in
                *" $_m "*) WANT_MODULES="$WANT_MODULES $_m" ;;
                *) info "такого модуля нет: $_m — пропускаю" ;;
            esac
        done
    fi
fi

# ---- перечень выпусков splify2/releases ---------------------------------------
# Первый источник версий и адресов файлов — version.json репозитория splify2/releases: его
# пишет выпуск каждого проекта, и в нём для каждой версии названы файлы, их sha256 и адреса —
# сначала выпуск в splify2/releases, потом исходный выпуск проекта. Один файл на все продукты,
# без счётчика запросов api.github.com, с трёх адресов: raw.githubusercontent.com, jsDelivr и
# сайт splify2.github.io. Адреса у них разные (на 2026-10-02: raw — 185.199.108-111.133, сайт —
# 185.199.108-111.153, jsDelivr — 104.17.207-208.5 у Cloudflare), так что закрытый
# githubusercontent.com закрывает не все три. Не ответил ни один или файл не тот — прежний путь,
# ничего не теряя.
#
# JSON разбирается awk — тем, что уже нужно установщику: jsonfilter есть на роутере, но не на
# любой системе, где этот скрипт проверяют. Разбор переводит документ в строки «путь<TAB>значение»
# (`products/steer/versions/0/assets/3/urls/1<TAB>https://…`) и не зависит от отступов: строка
# JSON не может содержать перевод строки, поэтому разбор идёт построчно с общим состоянием.
rel_flat() {  # ФАЙЛ -> строки «путь<TAB>значение»
    awk '
    function path(   p, x) { p = k[1]; for (x = 2; x <= d; x++) p = p "/" k[x]; return p }
    function done_item() { if (t[d] == "a") k[d]++; else wk[d] = 1 }
    function val(v) { print path() "\t" v; done_item() }
    {
        line = $0; n = length(line); i = 1
        while (i <= n) {
            c = substr(line, i, 1)
            if (c == "{") { d++; t[d] = "o"; wk[d] = 1; k[d] = ""; i++ }
            else if (c == "[") { d++; t[d] = "a"; k[d] = 0; i++ }
            else if (c == "}" || c == "]") { d--; if (d > 0) done_item(); i++ }
            else if (c == "\"") {
                s = ""; i++
                while (i <= n) {
                    c = substr(line, i, 1)
                    if (c == "\\") {
                        e = substr(line, i + 1, 1)
                        s = s (e == "n" || e == "t" || e == "r" ? " " : e == "u" ? "\\u" : e)
                        i += 2; continue
                    }
                    if (c == "\"") { i++; break }
                    s = s c; i++
                }
                if (t[d] == "o" && wk[d]) { k[d] = s; wk[d] = 0 } else val(s)
            }
            else if (c ~ /[-0-9tfn]/) {
                s = substr(line, i); sub(/[]} \t\r,].*$/, "", s)
                i += length(s); val(s)
            }
            else i++
        }
    }' "$1"
}

# version.json — один раз на прогон: и обе версии, и оба пакета берутся из одного файла. Итог
# лежит в $TMP, а не в переменной: latest() зовётся в подоболочке `$(...)`.
rel_get() {
    [ -s "$TMP/version.flat" ] && return 0
    [ -e "$TMP/version.none" ] && return 1
    for _ru in $REL_JSON_URLS; do
        rm -f "$TMP/version.json" "$TMP/version.flat"
        # 20 секунд на адрес: там, где адрес закрыт молча, ожидание без срока держало бы
        # установку до запасного пути.
        wget -T 20 -qO "$TMP/version.json" "$_ru" 2>/dev/null || continue
        rel_flat "$TMP/version.json" > "$TMP/version.flat" 2>/dev/null || continue
        # Схема — та, под которую написан разбор; иное (страница-заглушка, другая схема) за
        # перечень не принимается.
        if grep -q "^schema${TAB}1\$" "$TMP/version.flat"; then
            return 0
        fi
    done
    rm -f "$TMP/version.json" "$TMP/version.flat"
    : > "$TMP/version.none"
    info "перечень выпусков splify2/releases не ответил — версии спрашиваю у GitHub" >&2
    return 1
}

rel_val() {  # ПУТЬ -> значение
    awk -F "$TAB" -v p="$1" '$1 == p { print $2; exit }' "$TMP/version.flat"
}

# Последняя стабильная версия продукта. Только цифры и точки — тот же барьер, что у VERSION
# ниже: `null` и мусор версией не считаются, и тогда идёт прежний путь.
rel_stable() {  # ПРОДУКТ
    rel_get || return 0
    _rs="$(rel_val "products/$1/stable")"
    case "$_rs" in ''|*[!0-9.]*) _rs="" ;; esac
    printf '%s\n' "$_rs"
}

# Файл выпуска: печатает «sum <sha256>» и «url <адрес>» по порядку адресов. Версия и файл ищутся
# по значению, а не по положению: имена пакетов 1.5.x (steer, steer-extended) и 2.0 (steer-core и
# модули) лежат в version.json как есть, и имя файла собирается так же, как для выпусков.
rel_asset() {  # ПРОДУКТ ВЕРСИЯ ИМЯ_ФАЙЛА
    rel_get || return 1
    awk -F "$TAB" -v pr="products/$1/versions/" -v ver="$2" -v nm="$3" '
        index($1, pr) != 1 { next }
        { n = split(substr($1, length(pr) + 1), a, "/") }
        NR == FNR {
            if (n == 2 && a[2] == "version" && $2 == ver) vk = a[1]
            if (n == 4 && a[2] == "assets" && a[4] == "name" && $2 == nm) aj[a[1]] = a[3]
            next
        }
        vk == "" || !(vk in aj) || a[1] != vk || a[2] != "assets" || a[3] != aj[vk] { next }
        n == 4 && a[4] == "sha256" { print "sum " $2 }
        n == 5 && a[4] == "urls" { print "url " $2 }
    ' "$TMP/version.flat" "$TMP/version.flat"
}

# Сверка с sha256 из version.json. Нет суммы или нет sha256sum на роутере — сверять нечем, и
# файл принимается, как принимался до version.json.
sum_ok() {  # ФАЙЛ SHA256
    [ -n "$2" ] || return 0
    command -v sha256sum >/dev/null 2>&1 || return 0
    _so="$(sha256sum "$1" 2>/dev/null)"
    [ "${_so%% *}" = "$2" ]
}

# ---- последний релиз ----------------------------------------------------------
# Версия берётся из релизов, а не зашита: иначе скрипт из main ставил бы прошлое. Первым —
# перечень выпусков splify2/releases (rel_stable выше); всё ниже — запасной путь.
#
# Путей два, и второй не «на всякий случай». У аудитории splify2 api.github.com
# недоступен чаще, чем сам github.com: его блокируют отдельно, а за CGNAT
# неавторизованный лимит GitHub API (60 запросов в час на адрес) выбирают соседи по
# адресу — тогда API отвечает 403, tag_name в ответе нет, и установка падала на «не
# удалось узнать версию движка (нет релизов?)», хотя релиз и пакет под эту архитектуру
# существовали. Так это и пришло: splify2#5, два человека, mipsel_24kc, и оба поставили
# те же пакеты руками.
#
# Второй путь идёт по raw.githubusercontent.com — тому самому хосту, с которого только
# что скачался этот скрипт, то есть заведомо доступному. Файл VERSION берётся из ветки
# dist, а не из main: в dist его пишет только релизный workflow — рядом с пакетами и тем же
# числом, что в теге, — поэтому он по построению равен последнему выпуску. VERSION в main
# двигают руками между выпусками (у steer он ушёл на три версии вперёд последнего релиза),
# и взятая оттуда версия вела к скачиванию файла из релиза, которого нет: «не скачалось»
# вместо установки — ровно там, где api.github.com и так не отвечает.
latest() {  # РЕПОЗИТОРИЙ
    # Продукт в version.json называется как репозиторий без владельца: steer, splify2.
    ver="$(rel_stable "${1#*/}")"
    if [ -n "$ver" ]; then
        echo "$ver"
        return 0
    fi
    ver="$(wget -qO- "$API/$1/releases/latest" 2>/dev/null |
        sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -1)"
    if [ -z "$ver" ]; then
        # Только цифры и точки: в VERSION не должно быть ничего другого, а если есть —
        # лучше остаться без версии и сказать об этом, чем подставить мусор в имя файла.
        ver="$(wget -qO- "$RAW/$1/$DIST_BRANCH/VERSION" 2>/dev/null |
            sed -n 's/^[[:blank:]]*\([0-9][0-9.]*\).*/\1/p' | head -1)"
        if [ -n "$ver" ]; then
            info "версия $1 взята из VERSION ветки $DIST_BRANCH: api.github.com не ответил" >&2
        fi
    fi
    if [ -z "$ver" ]; then
        vf="$TMP/VERSION.$(echo "$1" | tr '/' '_').txt"
        if gh_file "$1" "$DIST_BRANCH" VERSION "$vf"; then
            ver="$(sed -n 's/^[[:blank:]]*\([0-9][0-9.]*\).*/\1/p' "$vf" | head -1)"
            if [ -n "$ver" ]; then
                info "версия $1 взята из VERSION ветки $DIST_BRANCH обходом (зеркало или contents API): релизы и raw не ответили" >&2
            fi
        fi
    fi
    echo "$ver"
}

# ---- обходной путь по хостам самого GitHub ------------------------------------
# Один файл через api.github.com. Отвечает сам, с адреса 140.82.121.5, и никуда не
# перенаправляет — проверено. Дешевле архива: для движка это 300 КБ вместо пяти мегабайт
# (в релизе steer 24 пакета на шесть архитектур), а /tmp на роутере — это оперативная
# память. Ограничения известны и потому путь не единственный: без ключа GitHub считает
# 60 запросов в час на адрес, а файл больше мегабайта этот метод не отдаёт.
#
# `--header` понимает uclient-fetch, которым wget на OpenWrt и является. Если в сборке
# другой wget и флага он не знает, заход просто не удастся — дальше идёт архив.
gl_file() {  # РЕПОЗИТОРИЙ ВЕТКА ПУТЬ ФАЙЛ
    # Зеркала остались у xyzmean на GitLab, а на GitHub проекты — в организации splify2.
    case "$1" in splify2/*) _glr="xyzmean/${1#splify2/}" ;; *) _glr="$1" ;; esac
    wget -qO "$4" "$MIRROR/$_glr/-/raw/$2/$3" 2>/dev/null || { rm -f "$4"; return 1; }
    [ -s "$4" ] || { rm -f "$4"; return 1; }
}

gh_api_file() {  # РЕПОЗИТОРИЙ ВЕТКА ПУТЬ ФАЙЛ
    wget -qO "$4" --header='Accept: application/vnd.github.raw' \
        "$API/$1/contents/$3?ref=$2" 2>/dev/null || { rm -f "$4"; return 1; }
    [ -s "$4" ] || { rm -f "$4"; return 1; }
}

# Ветка репозитория архивом. Тарбол кэшируется на прогон: за установку из одного
# репозитория берутся и версия, и пакет, а качать по мегабайту дважды незачем.
gh_tarball() {  # РЕПОЗИТОРИЙ ВЕТКА -> печатает путь к тарболу
    _t="$TMP/$(echo "$1-$2" | tr '/' '_').tgz"
    if [ ! -s "$_t" ]; then
        wget -qO "$_t" "$CODELOAD/$1/tar.gz/refs/heads/$2" 2>/dev/null || { rm -f "$_t"; return 1; }
        [ -s "$_t" ] || { rm -f "$_t"; return 1; }
    fi
    printf '%s' "$_t"
}

# Один файл из ветки. Верхний каталог в архиве GitHub называется «репозиторий-ветка»,
# без владельца — отсюда `${1#*/}`.
gh_file() {  # РЕПОЗИТОРИЙ ВЕТКА ПУТЬ ФАЙЛ
    gl_file "$@" && return 0
    gh_api_file "$@" && return 0
    _tb="$(gh_tarball "$1" "$2")" || return 1
    tar -xzOf "$_tb" "${1#*/}-$2/$3" > "$4" 2>/dev/null || { rm -f "$4"; return 1; }
    [ -s "$4" ] || { rm -f "$4"; return 1; }
}

# Скачать. Если файл есть и в ветке `dist` — при отказе прямого адреса берём оттуда:
# прямой адрес релиза перенаправляет на `release-assets.githubusercontent.com`, то есть
# ровно туда, куда закрыт путь.
#
# Пятый аргумент `detours` — только обходы: прямой адрес уже спрашивали адресом из version.json,
# и второй заход туда стоил бы ещё одного ожидания там, где он закрыт.
fetch() {  # URL ФАЙЛ [РЕПОЗИТОРИЙ ИМЯ_В_DIST [detours]]
    if [ "${5:-}" != detours ] && wget -qO "$2" "$1" 2>/dev/null && [ -s "$2" ]; then
        return 0
    fi
    rm -f "$2"
    if [ $# -ge 4 ] && gh_file "$3" "$DIST_BRANCH" "$4" "$2"; then
        info "релизный файл не отдался — взят из ветки $DIST_BRANCH (зеркало gitlab.com или хосты GitHub)"
        return 0
    fi
    die "не скачалось: $1"
}

dl_url() {  # РЕПОЗИТОРИЙ ВЕРСИЯ ИМЯ
    echo "https://github.com/$1/releases/download/v$2/$3"
}

# Пакет выпуска. Сначала адреса из version.json по порядку со сверкой sha256 (не сошлось —
# следующий адрес), затем прежний путь по имени файла: прямая ссылка выпуска и ветка dist.
# Ветка dist держит только последнюю версию, и её адресов в version.json нет — поэтому обход
# через неё остаётся здесь. Сумма сверяется и у файла, взятого прежним путём: имя то же, и
# файл обязан быть тем же.
fetch_pkg() {  # ПРОДУКТ ВЕРСИЯ ИМЯ ФАЙЛ РЕПОЗИТОРИЙ
    _fp_sum=""; _fp_urls=""
    _fp_ra="$(rel_asset "$1" "$2" "$3" 2>/dev/null || true)"
    while read -r _fp_k _fp_u; do
        case "$_fp_k" in
            sum) _fp_sum="$_fp_u" ;;
            # Адрес — только https и только из безопасных знаков: дальше он перебирается
            # словами, и `*` или `?` в нём раскрылись бы как шаблон имён файлов.
            url) case "$_fp_u" in
                     https://*[!A-Za-z0-9._~:/%+@=-]*) ;;
                     https://?*) _fp_urls="$_fp_urls $_fp_u" ;;
                 esac ;;
        esac
    done <<EOF
$_fp_ra
EOF
    case "$_fp_sum" in *[!0-9a-f]*) _fp_sum="" ;; esac
    [ "${#_fp_sum}" = 64 ] || _fp_sum=""
    _fp_old="$(dl_url "$5" "$2" "$3")"
    _fp_seen=""
    for _fp_u in $_fp_urls; do
        [ "$_fp_u" = "$_fp_old" ] && _fp_seen=detours
        if wget -qO "$4" "$_fp_u" 2>/dev/null && [ -s "$4" ]; then
            sum_ok "$4" "$_fp_sum" && return 0
            info "контрольная сумма не сошлась: $_fp_u — беру со следующего адреса"
        fi
        rm -f "$4"
    done
    fetch "$_fp_old" "$4" "$5" "$3" $_fp_seen || return 1
    sum_ok "$4" "$_fp_sum" && return 0
    rm -f "$4"
    die "контрольная сумма $3 не сошлась ни на одном адресе — файл не тот, что в перечне выпусков"
}

# ---- ядро ---------------------------------------------------------------------
# Последняя стабильная версия; если она старше 2.0 (этот интерфейс пишет спеку v2, а её читает
# только ядро 2.0) — предварительная из перечня выпусков, если она 2.0 или новее.
steer_version() {
    _sv="$(latest "$REPO_STEER")"
    case "${_sv%%.*}" in ''|0|1)
        _sp="$(rel_get && rel_val products/steer/prerelease || true)"
        case "$_sp" in ''|*[!0-9.]*) ;; *) case "${_sp%%.*}" in 0|1) ;; *) _sv="$_sp" ;; esac ;; esac
        ;;
    esac
    printf '%s\n' "$_sv"
}

# Снять прежние пакеты ядра у opkg (у него нет `!имя` в транзакции): только наши имена 1.x и
# промежуточной раскладки — чужого установщик не снимает.
pm_drop_old() {  # ИМЕНА
    for _d in "$@"; do
        case "$_d" in steer|steer-extended|libsteer|libsteer-wolfssl) opkg remove --force-depends "$_d" >/dev/null 2>&1 || true ;; esac
    done
}

# Убрать из /etc/apk/world запреты `!имя` и имя steer после перехода: пакетов они уже не
# касаются (прежние сняты в транзакции, steer-core называет себя steer сам).
pm_forget_old() {  # ИМЕНА
    for _d in "$@"; do
        case "$_d" in steer|steer-extended|libsteer|libsteer-wolfssl) apk del "$_d" >/dev/null 2>&1 || true ;; esac
    done
}

if ! box_busy && [ "$HAVE_CORE" = no ]; then
    SV="$(steer_version)"
    [ -n "$SV" ] || die "не удалось узнать версию ядра: не ответили ни перечень выпусков splify2/releases, ни api.github.com, ни raw.githubusercontent.com, ни зеркало на gitlab.com. Пакеты можно поставить руками с https://github.com/$REPO_STEER/releases"
    case "${SV%%.*}" in 0|1) die "последний выпуск ядра — $SV, а этому интерфейсу нужно ядро 2.0 или новее. Пакеты steer-core и модули можно поставить руками с https://github.com/$REPO_STEER/releases" ;; esac
    MODS="$(steer_mods "$WANT_MODULES")"
    say ""
    say "Ядро steer $SV${MODS:+ · модули: $MODS}"
    FILES=""
    for _p in steer-core $(for _m in $MODS; do printf 'steer-%s ' "$_m"; done); do
        _f="${_p}-${SV}-1_${ARCH}.$(pm_ext)"
        info "$_f"
        fetch_pkg steer "$SV" "$_f" "$TMP/$_f" "$REPO_STEER"
        FILES="$FILES $TMP/$_f"
    done
    # Одной транзакцией: модуль зависит от steer-core точной версии. Прежнее ядро у apk снимается
    # в ней же: `!имя` (у steer — снятием закрепления имени за файлом 1.x в world, после чего
    # steer-core замещает его по replaces). /etc/steer — спека, списки, подписки — пакетам не
    # принадлежит и остаётся на месте.
    EXTRA=""
    if [ "$PM" = apk ]; then
        for _n in $STEER_OLD; do
            case "$_n" in
                steer) apk add steer >/dev/null 2>&1 || true ;;
                *) EXTRA="$EXTRA !$_n" ;;
            esac
        done
    fi
    # shellcheck disable=SC2086
    if ! pm_add $FILES $EXTRA; then
        [ "$PM" = opkg ] && [ -n "$STEER_OLD" ] || die "ядро не установилось"
        info "прежнее ядро мешает — снимаю его и ставлю заново"
        # shellcheck disable=SC2086
        pm_drop_old $STEER_OLD
        # shellcheck disable=SC2086
        pm_add $FILES || die "ядро не установилось, а прежнее снято: поставьте пакеты руками с https://github.com/$REPO_STEER/releases"
    fi
    # shellcheck disable=SC2086
    [ "$PM" = apk ] && pm_forget_old $STEER_OLD
    info "установлено"
fi

# ---- интерфейс ----------------------------------------------------------------
UV="$(latest "$REPO_UI")"
[ -n "$UV" ] || die "не удалось узнать версию интерфейса: не ответили ни перечень выпусков splify2/releases, ни api.github.com, ни raw.githubusercontent.com, ни зеркало на gitlab.com. Пакет можно поставить руками с https://github.com/$REPO_UI/releases"
UI_PKG="luci-app-splify2-${UV}-1_$(pm_suffix)"
say ""
say "Интерфейс splify2 $UV"
info "$UI_PKG"
fetch_pkg splify2 "$UV" "$UI_PKG" "$TMP/$UI_PKG" "$REPO_UI"
pm_add "$TMP/$UI_PKG" || die "интерфейс не установился"
info "установлен"

# ---- запуск -------------------------------------------------------------------
# Срок вызова rpcd — тот же, что ждёт интерфейс (120 с); стандартные 30 с обрывали долгие
# вызовы (установка, подписка, каталог стратегий) на середине. Подробно — в
# files/etc/uci-defaults/99-splify2, который делает то же самое при установке пакетом; здесь
# повтор на случай, если uci-defaults на этой системе отложен до перезагрузки.
# `|| true` — под set -e: отсутствующий ключ даёт uci код 1, и без этого установщик молча
# завершался ПОСЛЕ установки пакетов — без рестарта rpcd, пустой спеки и слова «Готово».
_rt="$(uci -q get rpcd.@rpcd[0].timeout 2>/dev/null || true)"
case "${_rt:-30}" in ''|*[!0-9]*) _rt=30 ;; esac
if [ "$_rt" -lt 120 ]; then
    uci -q set rpcd.@rpcd[0].timeout=120 && uci -q commit rpcd
fi
/etc/init.d/rpcd restart >/dev/null 2>&1 || true   # чтобы ubus увидел новый бэкенд
# Пустая спека — по тому же доводу, что и срок rpcd выше: то же самое делает
# files/etc/uci-defaults/99-splify2, а здесь повтор на случай, если uci-defaults отложен.
#
# Без файла движок не поднимается вовсе («no /etc/steer/spec.json — nothing to apply»), и
# свежепоставленный роутер выглядит сломанным: пульт висит в «Загрузке», а исправный движок
# объявляется не отвечающим. Выход `direct` в спеке есть сразу — «пустить напрямую» не
# настройка, а то, что роутер делает без нас, и правилу-исключению нужен адрес назначения.
# Форма — спека v2, как в uci-defaults: ядро 2.0 читает её, а прежнюю (`schema`) интерфейс при
# первом открытии переписал бы сам. Две спеки рядом ядро отвергает — при spec.yaml не пишем.
if [ ! -s /etc/steer/spec.json ] && [ ! -s /etc/steer/spec.yaml ]; then
    mkdir -p /etc/steer 2>/dev/null
    printf '{"version":2,"outputs":{"direct":{"kind":"direct"}}}\n' \
        > /etc/steer/spec.json 2>/dev/null || true
fi
# При коннекторе служба steer не включается: ядро ведёт он (box_busy).
if [ -x /etc/init.d/steer ] && ! box_busy; then
    /etc/init.d/steer enable >/dev/null 2>&1 || true
fi

say ""
say "Готово."
# Напоминание повторяется здесь намеренно: при запуске без терминала предупреждение
# выше уезжает вверх за экран, и «Готово.» читается как «всё чисто».
if [ -n "$V1_SIGNS" ]; then
    info "Первая версия splify осталась на роутере — пока она включена, DNS делят два хозяина (см. выше)."
fi
info "Откройте LuCI → Сервисы → splify2"
info "Дальше: вставить ссылку подписки и отметить сервисы — больше ничего не нужно."
