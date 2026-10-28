#!/bin/sh
# Собирает один noarch-пакет splify2: каркас на LuCI JS, бэкенд rpcd и семя плагинов «из коробки» (в том числе Andromeda — её
# собирает репозиторий andromeda, см. ANDROMEDA_S2P ниже).
#
# Архитектуры тут нет и быть не должно — весь бинарный код живёт в steer. Поэтому
# пакет один на все роутеры, а зависимость от движка объявлена явно.
set -eu

VERSION="$(cat VERSION 2>/dev/null || echo 0.1.0)"

# В VERSION только цифры и точки, и это не педантизм. Этой строкой собираются имя файла
# пакета (`splify2-26.9-1_noarch.apk`), версия для apk/opkg и тег релиза, а ниже она
# подставляется sed-ом внутрь JS (`?v=26.9`). Пробел или буква ломают всё перечисленное, причём
# по-разному: пакет соберётся с искалеченным именем, а бандл получит битую ссылку на кусок —
# то есть страница откроется и не заработает.
#
# Кодовое имя выпуска («26.9 Andromeda») живёт в ЗАГОЛОВКЕ релиза на GitHub, откуда его и
# читает бэкенд (gh_load в files/usr/libexec/rpcd/splify2). Здесь ему места нет.
#
# Число составляющих НЕ проверяется: «26.9» — такая же законная версия, как «1.2.0».
case "$VERSION" in
    ''|*[!0-9.]*)
        echo "в VERSION только цифры и точки, а там: «$VERSION»"
        echo "кодовое имя выпуска задаётся заголовком релиза на GitHub, а не файлом VERSION"
        exit 1 ;;
esac
OUT=out
PKG=build/pkg

# Куда уезжает вывод самых длинных шагов — сборки плагинов семени и упаковки (I-044, R-034).
#
# ЗАЧЕМ ФАЙЛ, А НЕ ПРЯМОЙ ВЫВОД. На успехе печатать полтора экрана tsc и vite незачем: сборка
# зовётся из релизного workflow, и шум там прячет то немногое, что стоит читать. А на провале
# нужна ровно эта диагностика: без неё человек получал одну строку «сборка
# провалилась» и запускал сборку во второй раз руками, чтобы узнать причину. Файл даёт оба
# поведения разом.
BUILD_LOG=build/build.log
mkdir -p build

echo "splify2 $VERSION"

# Каждый метод rpcd обязан быть в ACL LuCI, иначе он работает из ssh и НЕ работает из
# браузера. Проверяется здесь, потому что этот сбой не виден ни в одном другом месте:
# `ubus call splify2 diag` с роутера отвечает, а тот же вызов со страницы получает отказ
# доступа — и если у вызова есть запасной путь (а у нас у половины есть), страница молча
# показывает «нет данных». Так уже уехали в релиз dev_stats, ui_get/ui_set, diag,
# engine_state и установка движка: семь методов, проверенных не на том слое.
#
# Цифра в имени в наборе символов не случайна: без неё `splify2_versions` резался до
# `splify`, барьер искал в ACL несуществующее имя и валился на верных данных. Заметить
# это удалось только когда проверка стала запускаться без docker.
acl=luci/root/usr/share/rpcd/acl.d/splify2.json
methods="$(sed -n '/^list)/,/^    ;;/p' files/usr/libexec/rpcd/splify2 |
           grep -o 'json_add_object [a-z0-9_]*' | awk '{print $2}' | tr '\n' ' ')"
missing=''
for m in $methods; do
    grep -q "\"$m\"" "$acl" || missing="$missing $m"
done
[ -z "$missing" ] || {
    echo "методы rpcd не объявлены в ACL ($acl):$missing"
    echo "из браузера они получат отказ доступа, из ssh будут работать"
    exit 1
}

# Третье ребро контракта — вызовы интерфейса — переехало вместе с интерфейсом: Andromeda (репозиторий andromeda) сверяет свои
# вызовы с таблицей методов splify2-api (`methods.tsv` в SDK), а не с исходником этого пакета.

# Docker нужен только для упаковки, поэтому проверяется здесь, а не в шапке. Пока он
# стоял первым, ни один барьер выше не запускался на машине без docker — то есть ровно
# там, где правят rpcd и ACL, проверить их было нечем.
command -v docker >/dev/null 2>&1 || { echo "нужен docker (сборка пакета в alpine)"; exit 1; }

rm -rf "$PKG"
mkdir -p "$PKG/etc/init.d" "$PKG/usr/libexec/rpcd" "$PKG/usr/sbin" "$PKG/etc/splify2" \
         "$PKG/lib/netifd/proto" "$PKG/www/luci-static/resources/protocol"
cp -r luci/htdocs/luci-static/resources/view "$PKG/www/luci-static/resources/"
cp -r luci/root/usr/share "$PKG/usr/"
cp files/usr/libexec/rpcd/splify2 "$PKG/usr/libexec/rpcd/splify2"
# Обновление списков переехало в плагин lists-catalog (plugins/lists-catalog, задача update-lists): строка crontab
# теперь пишется plugin_sync из манифеста плагина, а не postinst пакета.
# Автообновление подписок переехало в плагин subscriptions (plugins/subscriptions, задача update-subs).
# Команда полного удаления следов. В postrm её быть НЕ МОЖЕТ: у opkg обновление пакета это
# удаление плюс установка, поэтому чистка в postrm сносила бы настройки человека при каждом
# обновлении. Поэтому — отдельная команда, которую зовут осознанно (см. шапку скрипта).
cp files/usr/sbin/splify2-purge "$PKG/usr/sbin/splify2-purge"
# Плагины: ссылки и ACL объектов splify2.p.<id> приводит в согласие с менеджером ядра эта команда
# (postinst и первое открытие вкладки «Плагины»); сам обработчик — один общий файл без расширения,
# на него указывают ссылки rpcd (plugin-rpcd), поэтому он лежит рядом с библиотеками, а не в libexec.
cp files/usr/sbin/splify2-plugin-sync "$PKG/usr/sbin/splify2-plugin-sync"
# Семя плагинов «из коробки» (ниже кладётся в /usr/share/splify2/seed) и команда, которая ставит их через менеджер ядра.
cp files/usr/sbin/splify2-seed "$PKG/usr/sbin/splify2-seed"
# ReCheck — обход DPI на прямом трафике: служба запускает движок из отдельного пакета recheck,
# если тот стоит и обход включён (/etc/splify2/recheck.conf); иначе ничего не делает.
cp files/etc/init.d/splify2-recheck "$PKG/etc/init.d/splify2-recheck"
chmod 0755 "$PKG/etc/init.d/splify2-recheck"
mkdir -p "$PKG/usr/share/splify2"
# Схема ключей спеки, которой пользуется каркас на LuCI JS, пока ядро не умеет `steer spec-schema`
# (метод spec_schema: ответ ядра — главный, этот файл — запасной, с пометкой source: bundled).
cp files/usr/share/splify2/spec-schema.json "$PKG/usr/share/splify2/spec-schema.json"
# Версии осей совместимости панели для менеджера плагинов ядра (compat.host-api, compat.splify2-api): он сверяет
# с ними манифест плагина. Источник — те же числа, что отдаёт plugins_list (plugin.sh).
mkdir -p "$PKG/usr/share/splify2/compat"
sed -n 's/^PLUGIN_HOST_API="${PLUGIN_HOST_API:-\(.*\)}"$/\1/p' files/usr/lib/splify2/plugin.sh > "$PKG/usr/share/splify2/compat/host-api"
sed -n 's/^PLUGIN_SPLIFY2_API="${PLUGIN_SPLIFY2_API:-\(.*\)}"$/\1/p' files/usr/lib/splify2/plugin.sh > "$PKG/usr/share/splify2/compat/splify2-api"
for _a in host-api splify2-api; do test -s "$PKG/usr/share/splify2/compat/$_a" || { echo "нет версии оси $_a в plugin.sh"; exit 1; }; done
# Общие куски обеих половин: скачивание (fetch.sh) и быстрый путь опроса (fast.sh). Каждый
# подключается строкой `. /usr/lib/splify2/…`, и забыть любой — значит выкатить пакет, где
# соответствующая половина не запускается вовсе. Копируется КАТАЛОГ ЦЕЛИКОМ, а не файлы по
# именам: список тут уже вырос с одного до двух, и следующий забыли бы ровно так же. Барьер
# ниже сверяет пакет с тем, что скрипты на самом деле подключают.
mkdir -p "$PKG/usr/lib/splify2"
cp files/usr/lib/splify2/*.sh "$PKG/usr/lib/splify2/"
# Объект rpcd разнесён по файлам: диспетчер в libexec, общие помощники и группы методов —
# здесь. Разбор одного файла в 4500 строк стоил 110 мс на каждый вызов; теперь разбирается
# диспетчер, common.sh и одна группа. Забыть каталог — значит объект, отвечающий отказом на
# всё, кроме круга опроса; барьер ниже сверяет группы диспетчера с файлами.
mkdir -p "$PKG/usr/lib/splify2/rpcd"
cp files/usr/lib/splify2/rpcd/*.sh "$PKG/usr/lib/splify2/rpcd/"
# Настройка uci объявляется системе пакетом: почему именно так — в шапке самого файла.
mkdir -p "$PKG/etc/uci-defaults"
cp files/etc/uci-defaults/99-splify2 "$PKG/etc/uci-defaults/99-splify2"
chmod 0755 "$PKG/etc/uci-defaults/99-splify2"
# А ЧТО ИМЕННО СОХРАНЯТЬ — объявляется отдельным файлом, и без него предыдущий шаг только
# создаёт настройку, но не спасает её.
#
# sysupgrade и «Создать архив» в LuCI собирают список файлов из ТРЁХ мест: conffiles
# установленных пакетов, /etc/sysupgrade.conf и /lib/upgrade/keep.d/*. Общего правила
# «сохраняем /etc/config» не существует — соседние файлы там лежат потому, что ИХ пакеты
# объявили их своими conffiles (см. Package/https-dns-proxy/conffiles). Пустая настройка
# conffile-ом быть не может (шапка 99-splify2 объясняет, почему), поэтому остаётся keep.d —
# у него нет ни одного из недостатков conffiles и он берёт каталоги рекурсивно.
#
# Второй путь в файле — расписка фаервола. Она не настройка и человеком не правится, но
# невосстановима: потеряв её, fw_zone_sync больше никогда не уберёт свою зону, потому что
# перестанет отличать её от чужой. Именно то накопление мусора, ради устранения которого
# расписка и заведена.
mkdir -p "$PKG/lib/upgrade/keep.d"
cp files/lib/upgrade/keep.d/splify2 "$PKG/lib/upgrade/keep.d/splify2"
chmod 0644 "$PKG/lib/upgrade/keep.d/splify2"
chmod 0755 "$PKG/usr/libexec/rpcd/splify2" \
           "$PKG/usr/sbin/splify2-purge"
chmod 0644 "$PKG"/usr/lib/splify2/*.sh "$PKG"/usr/lib/splify2/rpcd/*.sh
cp files/usr/lib/splify2/plugin-rpcd "$PKG/usr/lib/splify2/plugin-rpcd"
chmod 0755 "$PKG/usr/lib/splify2/plugin-rpcd" "$PKG/usr/sbin/splify2-plugin-sync" "$PKG/usr/sbin/splify2-seed"
# splify2-api (хуки, задачи, события, псевдонимы): таблица методов, запуск задач и раздача событий ядра.
cp files/usr/lib/splify2/methods.tsv "$PKG/usr/lib/splify2/methods.tsv"
chmod 0644 "$PKG/usr/lib/splify2/methods.tsv"
cp files/usr/sbin/splify2-task "$PKG/usr/sbin/splify2-task"
# Службы хоста для программ плагинов (splify2-api, «Службы хоста»): скачивание, спека, архив настроек каркаса,
# настройки плагина, применение. Единственный путь плагина к файлам каркаса.
cp files/usr/sbin/splify2-host "$PKG/usr/sbin/splify2-host"
chmod 0755 "$PKG/usr/sbin/splify2-host"
cp files/usr/sbin/splify2-events "$PKG/usr/sbin/splify2-events"
cp files/etc/init.d/splify2-events "$PKG/etc/init.d/splify2-events"
chmod 0755 "$PKG/usr/sbin/splify2-task" "$PKG/usr/sbin/splify2-events" "$PKG/etc/init.d/splify2-events"

# Официальные репозитории плагинов splify2 (plugin-sdk/docs/index.md, «Репозитории по умолчанию»): splify2-core-plugins
# (плагины «из коробки», из него обновляется семя) и splify2-extended-plugins (recheck, tgws, warpbox-ui — по желанию).
# Оба наши и подписаны ключами splify2 из steer-core (index, plugins), поэтому official; пометку «не официальный» (В6)
# получают только репозитории, которые человек подключил сам. Репозиторий протоколов (splify2) кладёт steer-core.
mkdir -p "$PKG/etc/steer/plugins/repos.d"
for r in splify2-core-plugins splify2-extended-plugins; do
    cp "files/etc/steer/plugins/repos.d/$r.json" "$PKG/etc/steer/plugins/repos.d/$r.json"
    chmod 0644 "$PKG/etc/steer/plugins/repos.d/$r.json"
done

# Протокол xsteer: обработчик netifd и страница LuCI.
#
# ПОЧЕМУ ЗДЕСЬ, А НЕ В steer. Клиент xsteer — часть ядра steer: с 2.0 это модуль steer-xsteer
# (его ставит и мета-пакет steer-extended), а запускается он по-прежнему как `steer xsteer` —
# команду модуля клиент steer передаёт его бинарнику. А эти два файла — часть ИНТЕРФЕЙСА: они описывают netifd и
# LuCI, как показать туннель обычным интерфейсом и что у него за поля. Отдельный третий пакет
# (luci-proto-xsteer) означал бы третью версию, третий барьер релиза и третий способ поставить
# половину — например обработчик без страницы, и тогда LuCI говорит «не поддерживаемый тип
# протокола» на работающем туннеле.
#
# ОБА ФАЙЛА ОБЯЗАНЫ ЕХАТЬ ВМЕСТЕ, и это ровно то, на чём стенд стоит ниже: без обработчика
# интерфейс не поднимется вовсе, без страницы его нельзя настроить из браузера. Один из двух
# забыть особенно легко потому, что лежат они в разных деревьях (files/ и luci/).
cp files/lib/netifd/proto/xsteer.sh "$PKG/lib/netifd/proto/xsteer.sh"
chmod 0755 "$PKG/lib/netifd/proto/xsteer.sh"
cp luci/htdocs/luci-static/resources/protocol/xsteer.js \
   "$PKG/www/luci-static/resources/protocol/xsteer.js"

# СЕМЯ ПЛАГИНОВ. Пакет несёт .s2p плагинов «из коробки» (решение владельца: после обновления 26.10.x человек ничего не
# теряет, а Andromeda — теперь плагин, не часть пакета): плагины из plugins/ этого дерева и Andromeda из её репозитория.
# Собираются инструментом SDK (`s2p lint --official`, `s2p build`) и ставятся командой splify2-seed в postinst.
#
#   S2P_KEY=ключ.sec          — подписать семя ключом официального репозитория (выпуск). Без ключа семя собирается
#                               неподписанным, в него кладётся файл `unsigned`, и ставится оно с `--unsigned` — для разработки.
#   ANDROMEDA_S2P=файл.s2p    — архив Andromeda (по умолчанию ../andromeda/out/andromeda-*-all.s2p, сборка репозитория
#                               andromeda: `sh build.sh`). Без него пакет без панели Andromeda не собирается: человек
#                               получил бы обновление, после которого привычной панели нет. Осознанно «только каркас» —
#                               SPLIFY2_SEED_WITHOUT_ANDROMEDA=1.
SEED_PKG="$PKG/usr/share/splify2/seed"
SEED_BUILD=build/seed
rm -rf "$SEED_BUILD"; mkdir -p "$SEED_PKG" "$SEED_BUILD"
S2P_OUT_DIR="$PWD/$SEED_BUILD" sh plugins/build.sh > "$BUILD_LOG" 2>&1 \
    || { echo "сборка плагинов семени провалилась:"; cat "$BUILD_LOG"; exit 1; }
if [ -n "${ANDROMEDA_S2P:-}" ]; then
    cp "$ANDROMEDA_S2P" "$SEED_BUILD/" || { echo "нет файла ANDROMEDA_S2P=$ANDROMEDA_S2P"; exit 1; }
else
    _an="$(ls -1 ../andromeda/out/andromeda-*-all.s2p 2>/dev/null | sort -V | tail -n 1)"
    if [ -n "$_an" ]; then cp "$_an" "$SEED_BUILD/"
    elif [ "${SPLIFY2_SEED_WITHOUT_ANDROMEDA:-}" != 1 ]; then
        echo "нет архива Andromeda: соберите ../andromeda (sh build.sh) или задайте ANDROMEDA_S2P=файл.s2p"
        echo "(только каркас, без панели: SPLIFY2_SEED_WITHOUT_ANDROMEDA=1)"
        exit 1
    fi
fi
cp "$SEED_BUILD"/*.s2p "$SEED_PKG/"
[ -n "${S2P_KEY:-}" ] || : > "$SEED_PKG/unsigned"
test -n "$(ls "$SEED_PKG"/*.s2p 2>/dev/null)" || { echo "в семени нет ни одного плагина"; exit 1; }
chmod 0644 "$SEED_PKG"/*

# ВНЕ каталога пакета: всё, что лежит внутри, попадает в пакет как файл, и такой
# .post-install приезжает на роутер как /.post-install — где сталкивается с чужим,
# потому что имя одно у всех. Скрипт передаётся ключом --script, содержимым он быть
# не должен.
mkdir -p build/scripts
cat > build/scripts/post-install <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] && exit 0
# Расписание обновления списков. Раз в сутки со случайной минутой: если все роутеры
# постучатся в одну секунду, это выглядит как всплеск на источнике, и первым страдает
# тот, кто раздаёт списки бесплатно.
# Настройка uci: скрипт uci-defaults штатно запускает загрузка системы (образ) или
# postinst пакетного менеджера (установка). Свой postinst здесь написан руками, поэтому
# запуск делаем сами и файл убираем после успеха — ровно как это делает default_postinst
# в сборочной системе OpenWrt. Без этой строки файл существовал бы только в пакете.
if [ -x /etc/uci-defaults/99-splify2 ]; then
    ( . /etc/uci-defaults/99-splify2 ) >/dev/null 2>&1 && rm -f /etc/uci-defaults/99-splify2
fi
# Обновление списков больше не строка этого пакета: его делает плагин lists-catalog (задача update-lists), а строку
# crontab пишет plugin_sync. Прежняя строка снимается — команды /usr/sbin/splify2-update-lists в пакете нет.
if grep -q splify2-update-lists /etc/crontabs/root 2>/dev/null; then
    sed -i '/splify2-update-lists/d' /etc/crontabs/root
    /etc/init.d/cron restart 2>/dev/null
fi
# Ссылки объектов плагинов, ACL и блок задач crontab приводятся в согласие с тем, что стоит у менеджера плагинов.
# Автообновление подписок больше не строка этого пакета: его делает плагин subscriptions (задача update-subs), а строку
# crontab пишет plugin_sync. Прежняя строка снимается — команды /usr/sbin/splify2-update-subs в пакете нет.
if grep -q splify2-update-subs /etc/crontabs/root 2>/dev/null; then
    sed -i '/splify2-update-subs/d' /etc/crontabs/root
    /etc/init.d/cron restart 2>/dev/null
fi
# Счётчика установок больше нет: строка крона прежнего отклика (splify2-ping) снимается
# при обновлении.
if grep -q 'splify2-ping' /etc/crontabs/root 2>/dev/null; then
    sed -i '/splify2-ping/d' /etc/crontabs/root
    /etc/init.d/cron restart 2>/dev/null
fi
# https-dns-proxy и zapret этот пакет не настраивает и от них не зависит: шифрованный DNS
# теперь у движка (`dns.upstreams` в спеке), а обход DPI из splify2 убран. Уже стоящие у
# человека пакеты и их настройки не трогаются.
# ReCheck: после обновления службу надо поднять заново. opkg обновляет удалением и установкой, и
# перед удалением служба снята (pre-remove ниже) вместе с таблицей nftables; без этого включённый
# человеком обход молчал бы до перезагрузки. Только если он включён: иначе незачем.
if [ -x /etc/init.d/splify2-recheck ] && grep -qx enabled=1 /etc/splify2/recheck.conf 2>/dev/null; then
    /etc/init.d/splify2-recheck enable 2>/dev/null
    /etc/init.d/splify2-recheck restart >/dev/null 2>&1
fi
# Кеш LuCI обязателен к сбросу: иначе меню и view остаются прежними до перезагрузки.
rm -f /tmp/luci-indexcache.* 2>/dev/null
rm -rf /tmp/luci-modulecache/ 2>/dev/null
# Плагины: ссылки и ACL их объектов ubus (после обновления прошивки плагины на месте, ссылок нет).
# До перечитки rpcd ниже — одной на всё.
# Плагины «из коробки» (Andromeda, языки, логика) — из семени пакета, без сети: одно обновление, и привычная панель на месте.
# Что не встало (ядра ещё нет), повторится по cron; снятое человеком не возвращается (/etc/splify2/seeded).
[ -x /usr/sbin/splify2-seed ] && /usr/sbin/splify2-seed --no-reload 2>&1 | sed 's/^/splify2: плагин: /'
[ -x /usr/sbin/splify2-plugin-sync ] && /usr/sbin/splify2-plugin-sync --no-reload >/dev/null 2>&1
/etc/init.d/rpcd reload 2>/dev/null
# Перечитка (SIGHUP) снимает объекты обработчиков и регистрирует их заново вызовом `list`; если
# в этот момент обработчик не ответил, объекта splify2 нет до следующего перезапуска rpcd, и
# интерфейс видит «Object not found» на каждом вызове (поймано на роутере 2026-10-03). Поэтому
# объект проверяется, и при его отсутствии rpcd перезапускается целиком.
for _i in 1 2 3 4 5 6; do
    ubus list splify2 >/dev/null 2>&1 && break
    sleep 1
done
ubus list splify2 >/dev/null 2>&1 || /etc/init.d/rpcd restart 2>/dev/null

# Набор опций обработчика протокола netifd читает ОДИН РАЗ, при своём запуске, и всё, чего в
# наборе нет, молча отбрасывает из настройки интерфейса. Значит опция, приехавшая с новым
# пакетом, до перезапуска netifd не существует вовсе: галочка в интерфейсе стоит, `uci` её
# помнит, а движок работает по-старому. Ровно так не включался «режим потока» — netifd держал
# набор от версии, где опции ещё не было, и туннель шёл поддельным TCP в порт, где у хаба
# настоящий слушающий сокет. Ни одной строчки об этом не сказал никто.
#
# Перезапускать сеть ОТСЮДА НЕЛЬЗЯ, и это не осторожность: netifd управляет туннелем, через
# который пакет в том числе и ставят, — обновление обрывало бы само себя на середине. Тот же
# довод, по которому rpcd не перезапускает выходы без нужды. Поэтому расхождение
# обнаруживается и НАЗЫВАЕТСЯ, а решение остаётся человеку.
proto_set() {
    # Строка ЦЕЛИКОМ, а не только имя опции: у proto_config_add_array аргумент несёт тип
    # ('addresses:list(cidr4)'), и его смена — такое же изменение набора, как новая опция.
    grep -o 'proto_config_add_[a-z]*.*' "$1" 2>/dev/null | sort | md5sum | cut -d' ' -f1
}
mark=/etc/splify2/netifd-proto-set
now="$(proto_set /lib/netifd/proto/xsteer.sh)"
was="$(cat "$mark" 2>/dev/null)"
if [ -n "$now" ] && [ "$now" != "$was" ]; then
    mkdir -p /etc/splify2
    printf '%s\n' "$now" > "$mark"
    [ -n "$was" ] && echo "splify2: набор опций протокола xsteer изменился." \
                  || echo "splify2: обработчик протокола xsteer установлен."
    echo "         netifd держит прежний набор и молча отбрасывает новые опции — до"
    echo "         перезапуска они не действуют, хотя в интерфейсе видны:"
    echo "             /etc/init.d/network restart"
    echo "         Сеть отсюда не перезапускается нарочно: этим туннелем идёт и сама установка."
fi
exit 0
EOF
chmod +x build/scripts/post-install

# Перед снятием пакета служба ReCheck останавливается, а таблица nftables уходит вместе с
# остановкой. Без этого после `apk del`/`opkg remove` init-скрипта уже нет, а таблица
# splify2_recheck остаётся и гоняет пакеты в очередь, которую никто не слушает (`bypass`
# их пропускает, но лишний проход по цепочкам и счётчики живут до перезагрузки). Автозапуск
# снимается тоже; при обновлении opkg его вернёт post-install, если обход включён.
cat > build/scripts/pre-remove <<'EOF'
#!/bin/sh
[ -n "${IPKG_INSTROOT}" ] && exit 0
if [ -x /etc/init.d/splify2-recheck ]; then
    /etc/init.d/splify2-recheck stop >/dev/null 2>&1
    /etc/init.d/splify2-recheck disable >/dev/null 2>&1
fi
nft delete table inet splify2_recheck >/dev/null 2>&1
# Объекты плагинов указывали на обработчик этого пакета: без него rpcd на каждой перечитке спотыкался
# бы о ссылки. Обновление (opkg — удаление и установка) вернёт их через post-install.
for _l in /usr/libexec/rpcd/splify2.p.*; do [ -L "$_l" ] && rm -f "$_l"; done
rm -f /usr/share/rpcd/acl.d/splify2-p-*.json
# CGI плагинов (splify2.cgi) выставлял этот пакет; вернёт post-install вместе с объектами.
for _c in /www/cgi-bin/*; do case "$(readlink "$_c" 2>/dev/null)" in /usr/lib/steer/plugins/*/cgi/*) rm -f "$_c" ;; esac; done
exit 0
EOF
chmod +x build/scripts/pre-remove

# ЧТО ОБЪЯВЛЕНО ЗАВИСИМОСТЬЮ, А ЧТО НЕТ, И ПОЧЕМУ ЭТО РАЗНЫЕ ОТВЕТЫ.
#
# https-dns-proxy — НЕ объявлен (прежние выпуски объявляли). Шифрованный DNS теперь делает
# встроенный резолвер движка: апстримы DoH, DoT, DoQ и обычный DNS описываются в спеке
# (`dns.upstreams`), и отдельный пакет для этого не нужен. Если он у человека стоит, это его
# пакет, и мы его не трогаем.
#
# curl — объявлен. Страну, внешний адрес и отклик выхода мерит outbound_geo запросом curl через
# устройство выхода (`--interface`; uclient-fetch к устройству не привязывается). До 26.10 curl
# приезжал зависимостью https-dns-proxy, и снятие той зависимости его забрало: на OpenWrt 25.12
# apk при обновлении пакета вычищает и https-dns-proxy, и curl с libcurl как осиротевшие (снято
# с QEMU-стенда: 26.9.2 → 26.10.0), а на свежей установке curl не появлялся вовсе — обзор писал
# «Не установлен curl», выходы стояли без страны и отклика (splify2#32).
#
# ip-full — объявлен. Скачивание через туннель (fetch.sh) отбирает трафик правилом
# `ip rule ... uidrange`, а busybox-овский `ip` про uidrange не знает вовсе: без пакета
# переключатель «скачивать через туннель» встал бы молча (правило не добавилось, ответ «ok»).
# Пакет тянет и движок, но полагаться на чужую зависимость для СВОЕЙ команды — способ однажды
# остаться без неё.
#
# zapret — не объявлен и из splify2 убран: обход DPI вернётся позже.
#
# Движок в depends НЕ объявлен, хотя без него интерфейс
# бесполезен: steer лежит в GitHub Releases, а не в репозитории apk, и жёсткая зависимость
# делает пакет неустанавливаемым — «ERROR: steer (no such package)» у любого, кто ставит
# интерфейс первым. А первым его ставят как раз новички.
#
# Вместо зависимости движок ставится двумя путями, и оба, в отличие от apk, объясняют выбор
# варианта: install.sh при установке одной строкой и карточка в самом интерфейсе, если
# движка нет. Отсутствие движка интерфейс переживает и говорит об этом прямо — это
# предусмотренное состояние, а не поломка.
# Барьер: всё, что половины подключают строкой `. /usr/lib/splify2/…`, обязано лежать в
# пакете. Пакет без такого файла не запускает подключающую половину вовсе — ни ubus-объект,
# ни ночное обновление, — а выглядит это как «раздел splify2 пропал из LuCI», то есть виной
# кажется интерфейс.
#
# Проверяются ИМЕНА ИЗ САМИХ СКРИПТОВ, а не список здесь: пока барьер знал одно имя
# (fetch.sh), про второй такой файл он промолчал бы, а второй появился (fast.sh, быстрый путь
# опроса). Теперь добавить подключение и забыть укладку нельзя.
for _need in $(grep -ho '/usr/lib/splify2/[a-z0-9_-]*\.sh' \
                    files/usr/libexec/rpcd/splify2 files/usr/sbin/splify2-host \
                    files/etc/init.d/splify2-recheck files/usr/lib/splify2/rpcd/*.sh \
                    files/usr/lib/splify2/*.sh files/usr/sbin/splify2-task files/usr/sbin/splify2-events \
                    plugins/*/lib/*.sh plugins/*/bin/* |
               sort -u); do
    test -s "$PKG$_need" || {
        echo "в пакете нет ${_need#/} — подключающая его половина не запустится"; exit 1; }
done
# Каждая группа, которую называет диспетчер (`_grp=имя`), обязана лежать файлом рядом с
# common.sh — иначе метод отвечает «файл не найден» вместо ответа.
for _g in $(sed -n 's/.*) _grp=\([a-z]*\) ;;$/\1/p' files/usr/libexec/rpcd/splify2 | sort -u); do
    test -s "$PKG/usr/lib/splify2/rpcd/m-$_g.sh" || {
        echo "в пакете нет usr/lib/splify2/rpcd/m-$_g.sh — методы группы $_g не ответят"; exit 1; }
done
# Общий обработчик объектов плагинов: на него указывают ссылки rpcd, исполняемый, без расширения (его
# не видит барьер выше по `.sh`).
test -x "$PKG/usr/lib/splify2/plugin-rpcd" || {
    echo "в пакете нет исполняемого usr/lib/splify2/plugin-rpcd — методы плагинов не ответят"; exit 1; }
test -s "$PKG/usr/lib/splify2/rpcd/common.sh" || {
    echo "в пакете нет usr/lib/splify2/rpcd/common.sh — ни один метод объекта не ответит"; exit 1; }
# Без этой команды следы пакета убрать нечем: зона фаервола, правила прежних версий, ключ
# чужого пакета zapret и запись в crontab остаются на роутере после снятия пакетов навсегда —
# автоматически чистить их в postrm нельзя (обновление opkg это удаление плюс установка).
test -x "$PKG/usr/sbin/splify2-purge" || {
    echo "в пакете нет usr/sbin/splify2-purge — следы пакета убрать будет нечем"; exit 1; }
# Описание второго издателя списков лежит в плагине lists-catalog (plugins/lists-catalog/lib/allow-domains.sh) и едет
# в его архиве, а не в пакете каркаса. Зашитый в него тег релиза проверяется здесь: без него версия списков у человека
# определялась бы тем, когда он нажал кнопку, — плавающей ссылкой.
grep -qE '^AD_TAG_DEFAULT=\$\{AD_TAG_DEFAULT:-[0-9]' plugins/lists-catalog/lib/allow-domains.sh || {
    echo "в plugins/lists-catalog/lib/allow-domains.sh не зашит тег релиза — версия списков окажется плавающей"
    exit 1; }
# Каркас на классическом LuCI JS: виды лежат в пакете, без сборки (view/splify2/index.js и view/splify2/core).
for _need in view/splify2/index.js view/splify2/core/main.js view/splify2/core/autoform.js \
             view/splify2/core/i18n.js view/splify2/core/strings.json; do
    test -s "$PKG/www/luci-static/resources/$_need" || {
        echo "в пакете нет $_need — каркас splify2 не откроется"
        exit 1; }
done
test -s "$PKG/usr/share/splify2/spec-schema.json" || {
    echo "в пакете нет usr/share/splify2/spec-schema.json — у каркаса не будет схемы ключей на ядре без spec-schema"
    exit 1; }
test -x "$PKG/usr/sbin/splify2-seed" || {
    echo "в пакете нет usr/sbin/splify2-seed — плагины «из коробки» поставить будет нечем"; exit 1; }
mkdir -p "$OUT"
# `&&` после установки apk-tools, а не `;`. С точкой с запятой провал установки игнорировался
# и проявлялся командой позже — как отсутствующий `apk mkpkg`, о чём говорилось «упаковка
# провалилась». Причина (нет сети в контейнере, зеркало alpine не отвечает) при этом не
# называлась вовсе, а она совсем не та, о которой думает читающий это сообщение.
docker run --rm -v "$PWD":/w -w /w alpine:latest sh -c \
    "apk add --no-cache apk-tools >/dev/null 2>&1 && apk mkpkg \
       --info name:splify2 --info version:$VERSION-r1 \
       --info provides:luci-app-splify2 --info replaces:luci-app-splify2 \
       --info description:'splify2: правила, выходы и списки поверх ядра steer' \
       --info arch:noarch --info depends:'luci-base ip-full curl ucode ucode-mod-fs ucode-mod-ubus' \
       --script post-install:build/scripts/post-install \
       --script post-upgrade:build/scripts/post-install \
       --script pre-deinstall:build/scripts/pre-remove \
       -F $PKG -o $OUT/splify2-$VERSION-1_noarch.apk" > "$BUILD_LOG" 2>&1 \
    || { echo "упаковка apk провалилась:"; cat "$BUILD_LOG"; exit 1; }

# ---- тот же пакет в формате opkg ---------------------------------------------
#
# OpenWrt перешёл на apk в 24.10, но 23.05 и 22.03 стоят на роутерах и будут стоять: на
# 4/32 их никто не обновит. Интерфейс к движку нужен там ровно так же, а apk на таком
# роутере нет вовсе — то есть пакет только в новом формате отрезает половину устройств,
# ничего об этом не сказав.
#
# Дерево файлов ОДНО ($PKG) на оба формата: разные деревья означали бы пакет, который в
# одном формате работает, а в другом нет, и заметить это можно было бы только на роутере.
# Отличаются только метаданные.
#
# ipkg-build — родной скрипт OpenWrt, тот же, что собирает пакеты в их SDK. Качается один
# раз в build/ (см. .gitignore): своя реализация формата дала бы .ipk, который opkg
# принимает не везде.
IPKG=build/ipkg-build
if [ ! -x "$IPKG" ]; then
    echo "качаю ipkg-build из OpenWrt"
    # curl или wget: на машине сборщика бывает любой из двух, а требовать конкретный
    # значит уронить сборку там, где всё для неё есть.
    URL=https://raw.githubusercontent.com/openwrt/openwrt/master/scripts/ipkg-build
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "$URL" -o "$IPKG" || { echo "не удалось скачать ipkg-build"; exit 1; }
    elif command -v wget >/dev/null 2>&1; then
        wget -qO "$IPKG" "$URL" || { echo "не удалось скачать ipkg-build"; exit 1; }
    else
        echo "нужен curl или wget, чтобы взять ipkg-build"; exit 1
    fi
    chmod +x "$IPKG"
fi

# CONTROL кладётся ВНУТРЬ дерева пакета, поэтому строго ПОСЛЕ apk mkpkg по тому же
# дереву: иначе служебные файлы уехали бы в полезную нагрузку apk.
mkdir -p "$PKG/CONTROL"
cat > "$PKG/CONTROL/control" <<EOF
Package: splify2
Version: $VERSION-1
Depends: luci-base, ip-full, curl, ucode, ucode-mod-fs, ucode-mod-ubus
Provides: luci-app-splify2
Replaces: luci-app-splify2
Conflicts: luci-app-splify2
Architecture: all
Maintainer: xyzmean
Section: luci
Description: splify2: правила, выходы и списки поверх ядра steer
EOF
cp build/scripts/post-install "$PKG/CONTROL/postinst"
chmod 0755 "$PKG/CONTROL/postinst"
cp build/scripts/pre-remove "$PKG/CONTROL/prerm"
chmod 0755 "$PKG/CONTROL/prerm"
if "$PWD/$IPKG" "$PKG" "$PWD/$OUT" >/dev/null 2>&1; then
    # ipkg-build называет файл через подчёркивания; приводим к тому же виду, что у apk,
    # чтобы в релизе оба формата одного пакета лежали рядом и читались одинаково.
    mv "$OUT/splify2_${VERSION}-1_all.ipk" \
       "$OUT/splify2-${VERSION}-1_all.ipk" 2>/dev/null || true
else
    echo "упаковка ipk провалилась"; exit 1
fi
rm -rf "$PKG/CONTROL"

ls -la "$OUT"
