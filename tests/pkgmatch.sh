#!/bin/sh
# Упаковка и установщик: сверка имён пакетов между тремя местами, где они пишутся.
#
# Зачем. Имя файла пакета собирается ТРИЖДЫ и каждый раз руками: в build.sh (что кладём
# в out/), в .github/workflows/release.yml (что выкладываем и что требует барьер) и в
# install.sh (что скачиваем с релиза). Расхождение любых двух из них не ломает ни сборку,
# ни релиз — оно ломает установку у человека, сообщением «не скачалось», и узнаётся не от
# стенда, а от людей.
#
# Второе, что здесь стережётся, — наличие ОБОИХ форматов. OpenWrt перешёл на apk в 24.10,
# но 23.05 и 22.03 стоят на слабых роутерах и будут стоять; пакет только в новом формате
# отрезает их молча, потому что сборка от этого не падает.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 2

pass=0 fail=0
check() {
    if [ "$2" = "$3" ]; then
        pass=$((pass + 1))
    else
        fail=$((fail + 1))
        printf 'FAIL %s\n  ожидалось: %s\n  получено:  %s\n' "$1" "$2" "$3"
    fi
}

WF=.github/workflows/release.yml

# ---- форма VERSION -------------------------------------------------------------
# Этой строкой собираются имя файла пакета, версия для apk/opkg, тег релиза — и она же
# подставляется sed-ом внутрь JS (`?v=26.9`). Пробел ломает всё перечисленное, причём
# по-разному: пакет соберётся с искалеченным именем, а бандл получит битую ссылку на кусок, то
# есть страница откроется и не заработает.
#
# Кодовое имя выпуска («26.9 Andromeda») живёт в заголовке релиза на GitHub, откуда его читает
# бэкенд (gh_load) и показывает человеку.
check "в build.sh есть барьер на форму VERSION" "1" \
    "$(grep -c "''|\*\[!0-9.\]\*)" build.sh)"
check "VERSION в дереве проходит свой же барьер" "yes" \
    "$(V="$(cat VERSION)"; case "$V" in ''|*[!0-9.]*) echo no ;; *) echo yes ;; esac)"
# Версия из двух частей законна: «26.9» — такой же выпуск, как «1.2.0».
check "версия из двух частей барьером не отвергается" "yes" \
    "$(V=26.9; case "$V" in ''|*[!0-9.]*) echo no ;; *) echo yes ;; esac)"
check "кодовое имя в VERSION барьер отвергает" "no" \
    "$(V='26.9 Andromeda'; case "$V" in ''|*[!0-9.]*) echo no ;; *) echo yes ;; esac)"

# ---- барьер релизного workflow согласен с барьером сборки ------------------------
# Форму версии проверяют ДВА барьера: build.sh (case выше) и первый шаг release.yml
# (grep -E по введённой версии). Разойтись они могут молча, и разошлись: сборка принимала
# «26.9», а workflow требовал X.Y.Z — то есть собственный выпуск отвергался ещё до сборки,
# и узнавалось это нажатием кнопки «Релиз». Здесь регулярное выражение берётся из самого
# workflow, а не переписывается: иначе стенд сверял бы своё представление о барьере с собой.
WF_RE="$(sed -n "s/.*grep -qE '\([^']*\)'.*/\1/p" "$WF" | head -1)"
check "у workflow есть барьер на форму версии" "yes" "$([ -n "$WF_RE" ] && echo yes || echo no)"
wf_ok() { printf '%s\n' "$1" | grep -qE "$WF_RE" && echo yes || echo no; }
check "VERSION в дереве проходит барьер workflow" "yes" "$(wf_ok "$(cat VERSION)")"
check "версия из двух частей барьером workflow не отвергается" "yes" "$(wf_ok 26.9)"
check "версия из трёх частей проходит барьер workflow" "yes" "$(wf_ok 1.2.5)"
check "кодовое имя барьер workflow отвергает" "no" "$(wf_ok '26.9 Andromeda')"
check "версию с буквой v барьер workflow отвергает" "no" "$(wf_ok v26.9)"
check "одно число без точки барьер workflow отвергает" "no" "$(wf_ok 26)"
check "точку без числа за ней барьер workflow отвергает" "no" "$(wf_ok 26.)"

# ---- кодовое имя выпуска доезжает до заголовка релиза ------------------------------
# Бэкенд читает название выпуска из ЗАГОЛОВКА релиза на GitHub (gh_load_api) и отдаёт его
# интерфейсу рядом с версией. Workflow же подписывал каждый релиз «splify2 X.Y.Z», и
# «26.9 Andromeda» могло появиться только правкой заголовка руками после выкладки. Теперь
# имя — необязательный вход кнопки, и заголовок собирается из него тем же шагом, что
# проверяет версию.
check "у workflow есть вход codename" "1" "$(grep -c '^      codename:$' "$WF")"
check "вход codename необязателен" "1" \
    "$(sed -n '/^      codename:$/,/^      [a-z]*:$/p' "$WF" | grep -c 'required: false')"
check "заголовок релиза собирается из версии и кодового имени" "1" \
    "$(grep -c 'RELEASE_NAME=\$VERSION \$C' "$WF")"
check "без кодового имени заголовок прежний" "1" \
    "$(grep -c 'RELEASE_NAME=splify2 \$VERSION' "$WF")"
check "публикация берёт заголовок из собранного" "1" \
    "$(grep -c '^          name: \${{ env.RELEASE_NAME }}$' "$WF")"
check "вертикальная черта в имени остановлена до публикации" "1" \
    "$(sed -n '/Собрать заголовок релиза/,/Установить зависимости/p' "$WF" | grep -c '\*"|"\*)')"

# ---- сборка делает оба формата ------------------------------------------------
# Общее скачивание едет в пакете, и обе половины начинаются с его подключения: пакет без
# этого файла не запускает ни ubus-объект, ни ночное обновление, а выглядит это как
# «раздел splify2 пропал из LuCI». Поэтому проверяется и укладка файла, и барьер на неё.
check "общие куски укладываются в пакет каталогом" "1" \
    "$(grep -c 'cp files/usr/lib/splify2/\*\.sh' build.sh)"
# Барьер сверяет пакет с тем, что скрипты ПОДКЛЮЧАЮТ, а не со списком имён в самом барьере:
# пока имя было одно, про второй такой файл он промолчал бы, а второй появился (fast.sh).
check "на отсутствие подключаемого файла стоит барьер" "1" \
    "$(grep -c "grep -ho '/usr/lib/splify2/" build.sh)"
# Скачивание одно: каркас подключает fetch.sh лениво (need_fetch в env.sh), а плагины качают службой хоста
# `splify2-host fetch`, которая зовёт ту же функцию. Своего скачивания у плагина нет.
check "скачивание одно: каркас и служба хоста для плагинов" "yes;yes" \
    "$(grep -q 'FETCH_SH:-.*/fetch.sh' files/usr/lib/splify2/env.sh && echo yes || echo no);$(grep -q '^[[:space:]]*need_fetch$' files/usr/sbin/splify2-host && grep -q 'download "\$_f_url"' files/usr/sbin/splify2-host && echo yes || echo no)"
# Быстрый путь опроса подключается ТОЛЬКО из объекта rpcd, и подключений там несколько: круг
# опроса, чтение спеки и старые методы, отдающие те же числа. Если файл переименуют, а барьер
# укладки промолчит — объект перестанет отвечать на самый частый вызов.
check "объект подключает быстрый путь" "yes" \
    "$(grep -q 'FAST_SH:-/usr/lib/splify2/fast.sh' files/usr/libexec/rpcd/splify2 && echo yes || echo no)"
check "файл быстрого пути на месте" "yes" \
    "$([ -s files/usr/lib/splify2/fast.sh ] && echo yes || echo no)"

# Оформление интерфейса (акцент, цвет предупреждения) — дело плагина Andromeda: его стенды в репозитории andromeda.

# ---- I-044/R-034: провал сборки обязан называть причину ------------------------
# Два самых длинных шага build.sh уезжали в /dev/null целиком, и человек получал одну
# строку «сборка интерфейса провалилась». Диагностика tsc и vite при этом существовала —
# её просто стирали, — и узнать причину можно было только запустив сборку во второй раз
# руками. Тот же файл двумя барьерами выше делает наоборот и печатает именно то, что не
# так (методы вне ACL, заголовки с размером утилитой), то есть верная форма ему известна.
check "вывод сборки интерфейса не выбрасывается" "0" \
    "$(grep -c 'npm run build >/dev/null 2>&1' build.sh)"
check "вывод упаковки apk не выбрасывается" "0" \
    "$(grep -c 'o \$OUT/splify2-\$VERSION-1_noarch.apk" >/dev/null 2>&1' build.sh)"
# Отдельная проверка на то, что вывод не просто перестал глушиться, а СОХРАНЯЕТСЯ и
# печатается в отказе: без неё шаг, печатающий полтора экрана на успехе, читался бы как
# исправление.
check "провал сборки печатает сохранённый вывод" "2" \
    "$(grep -c 'cat "\$BUILD_LOG"' build.sh)"
# `;` вместо `&&` после установки apk-tools: провал установки игнорировался и проявлялся
# командой позже как отсутствующий `apk mkpkg` — под сообщением «упаковка провалилась».
check "установка apk-tools присоединена по И, а не точкой с запятой" "0" \
    "$(grep -c 'apk add --no-cache apk-tools >/dev/null 2>&1;' build.sh)"

check "build.sh собирает apk под именем splify2" "1" "$(grep -c 'info name:splify2 ' build.sh)"
check "build.sh собирает ipk под именем splify2" "1" "$(grep -c '^Package: splify2$' build.sh)"
# Переименование luci-app-splify2 -> splify2: прежнее имя обязано быть provides и replaces, иначе
# обновление поставит второй пакет рядом с прежним (меню и ACL двух пакетов столкнутся).
check "apk: provides и replaces прежнего имени" "1" \
    "$(grep -c 'info provides:luci-app-splify2 --info replaces:luci-app-splify2' build.sh)"
check "ipk: Provides, Replaces и Conflicts прежнего имени" "3" \
    "$(grep -c '^\(Provides\|Replaces\|Conflicts\): luci-app-splify2$' build.sh)"
check "build.sh берёт родной ipkg-build из OpenWrt" "1" \
    "$(grep -c 'scripts/ipkg-build' build.sh)"

# CONTROL обязан создаваться ПОСЛЕ apk mkpkg и убираться после: иначе служебные файлы
# формата opkg уезжают в полезную нагрузку apk-пакета.
apk_line=$(grep -n 'apk mkpkg' build.sh | head -1 | cut -d: -f1)
ctl_line=$(grep -n 'mkdir -p "\$PKG/CONTROL"' build.sh | head -1 | cut -d: -f1)
check "CONTROL создаётся после сборки apk" "1" \
    "$([ -n "$apk_line" ] && [ -n "$ctl_line" ] && [ "$ctl_line" -gt "$apk_line" ] && echo 1 || echo 0)"
check "CONTROL убирается после сборки ipk" "1" "$(grep -c 'rm -rf "\$PKG/CONTROL"' build.sh)"

# ---- имена совпадают во всех трёх местах ---------------------------------------
# apk называет пакет без бинарного кода noarch, opkg — all. Перепутать их значит скачать
# несуществующий файл, и проверить это можно только сверкой имён между файлами.
for suffix in noarch.apk all.ipk; do
    check "build.sh кладёт splify2-...-1_$suffix" "1" \
        "$(grep -c "splify2-\$VERSION-1_$suffix\|splify2-\${VERSION}-1_$suffix" build.sh)"
    check "барьер релиза требует $suffix" "1" "$(grep -c "test -f \"out/splify2-\${VERSION}-1_$suffix\"" "$WF")"
    check "релиз выкладывает $suffix" "1" "$(grep -c "^ *out/splify2-\${{ env.VERSION }}-1_$suffix\$" "$WF")"
    # Переход: обновление 26.10.x ищет файл по прежнему имени — релиз выкладывает копию пакета под ним.
    check "релиз выкладывает копию luci-app-splify2-...-1_$suffix" "1" \
        "$(grep -c "^ *out/compat/luci-app-splify2-\${{ env.VERSION }}-1_$suffix\$" "$WF")"
done

# ---- официальные репозитории плагинов по умолчанию -------------------------------
# splify2-core-plugins и splify2-extended-plugins подключает пакет: без файла repos.d каталог «Плагины» их не видит,
# а семя не обновляется из сети. Оба официальные (подписаны ключами splify2 из steer-core).
for r in splify2-core-plugins splify2-extended-plugins; do
    check "пакет кладёт repos.d/$r.json" "1" "$(grep -c 'for r in splify2-core-plugins splify2-extended-plugins; do' build.sh)"
    check "repos.d/$r.json: id, official, адрес Pages" "$r;True;https://splify2.github.io/$r/" \
        "$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("%s;%s;%s" % (d["id"], d["official"], d["url"]))' \
            "files/etc/steer/plugins/repos.d/$r.json")"
done

# ---- установщик умеет оба менеджера --------------------------------------------
# Раньше здесь стоял прямой отказ «нужен apk», то есть установка одной строкой на 23.05
# не работала вовсе. Проверяется не текст, а наличие обеих веток и отсутствие отказа.
# Считается ОТКАЗ, а не упоминание: слово «apk» есть и в комментарии, объясняющем, почему
# прежний отказ убран.
check "установщик больше не отказывает системам без apk" "0" \
    "$(grep -c 'die "нужен apk' install.sh)"
check "установщик знает opkg" "1" "$(grep -c 'command -v opkg' install.sh)"
# Два вызова, а не один: второй — повтор после `opkg update`. На свежей прошивке списков
# пакетов нет, и зависимость локального файла (ip-full у движка) не находится — установка
# падала на «cannot find dependency», хотя пакет скачан и лежит рядом.
check "установщик ставит через opkg install" "2" "$(grep -c 'opkg install' install.sh)"
check "и обновляет списки, если зависимость не нашлась" "1" \
    "$(grep -c '^ *opkg update' install.sh)"

# Суффиксы в установщике обязаны совпадать с тем, что кладёт сборка. Сверяются сами
# строки: именно расхождение здесь и даёт «не скачалось».
check "установщик знает суффикс noarch.apk" "1" "$(grep -c 'noarch.apk' install.sh)"
check "установщик знает суффикс all.ipk" "1" "$(grep -c 'all.ipk' install.sh)"

# Вызовов менеджера напрямую в теле скрипта быть не должно — только через обёртки:
# прямой вызов это место, где про второй менеджер забыли. Исключение — определение
# менеджера и сами обёртки, они выше по файлу.
direct=$(sed -n '/^# ---- какой движок стоит сейчас/,$p' install.sh |
         grep -c 'apk add\|apk list\|opkg install\|opkg list')
check "ниже обёрток менеджер напрямую не зовут" "0" "$direct"

# ---- типы полей на границе ubus -------------------------------------------------
# Метод объявлен с `json_add_boolean append`, то есть политика ubus для поля — BOOL.
# Число (1/0) приезжает как INT32, и blobmsg_parse молча ОТБРАСЫВАЕТ атрибут, тип
# которого не совпал: до скрипта append не доходил, и каждая порция загружаемого файла
# замещала предыдущую вместо дописывания. Стенд rpcdmatch при этом был зелёным, потому
# что слал настоящее булево — тип, которого из браузера не бывает.
# Порции принимают три метода — list_put (файл списка), list_srs_put (набор .srs) и backup_put
# (архив настроек), — поэтому объявлений три. Сторожится не число ради числа, а тип: объявление append числом
# или строкой возвращает ту самую ловушку, ради которой проверка и заведена.
check "бэкенд не объявляет append числом или строкой" "0" \
    "$(grep -c 'json_add_int append\|json_add_string append' files/usr/libexec/rpcd/splify2)"
check "бэкенд объявляет append булевым" "3" \
    "$(grep -c 'json_add_boolean append' files/usr/libexec/rpcd/splify2)"

# ---- документация не разошлась с кодом ----------------------------------------
# docs/rpcd-api.md объявлен контрактом между интерфейсом и бэкендом, и разойтись с кодом он
# может только молча: документ не исполняется. Так в нём и жило «All 25 declared methods»,
# когда методов стало 30, — причём неописанными оказались ровно те, что меняют состояние
# роутера сильнее прочих (снимают автозапуск, заменяют сам пакет интерфейса).
#
# Сверяется состав в ОБЕ стороны: метод, которого нет в документе, и метод, описанный, но
# не существующий, — одинаково плохие расхождения.
API=docs/rpcd-api.md
RPCD=files/usr/libexec/rpcd/splify2
methods="$(sed -n '/^list)/,/^    ;;/p' "$RPCD" | grep -o 'json_add_object [a-z0-9_]*' | sed 's/json_add_object //')"

missing=""
for m in $methods; do
    grep -q "| \`$m\` |" "$API" || missing="$missing$m "
done
check "каждый метод rpcd описан в контракте" "" "$missing"

extra=""
for m in $(sed -n '/^| Метод | ACL/,/^$/p' "$API" | grep -o '^| `[a-z0-9_]*`' | tr -d '|` '); do
    printf '%s\n' "$methods" | grep -qx "$m" || extra="$extra$m "
done
check "в контракте нет методов, которых нет в коде" "" "$extra"

# Число в тексте документа тоже сверяется: именно оно и разошлось.
n_code="$(printf '%s\n' "$methods" | grep -c .)"
# Число пришито к тексту, а согласование — нет: «Все 40 объявленных методов» и «Все 41
# объявленный метод» одинаково верны по-русски, и требовать одну форму значило бы заставить
# документ ошибаться грамматически ради стенда.
check "число методов в тексте контракта верно" "1" \
    "$(grep -c "Все $n_code объявленн" "$API")"

# ---- ребро «интерфейс → метод rpcd» ----------------------------------------------
# Переехало вместе с интерфейсом: Andromeda (репозиторий andromeda, tests/api-calls.sh) сверяет вызовы со списком публичных
# методов splify2-api (`methods.tsv`), и этот список сверяет с диспетчером tests/exttest.sh.

# Документация на русском — проект для русскоязычных пользователей. Проверяется наличие
# кириллицы, а не отсутствие латиницы: имена методов, полей и команд остаются как есть.
for d in README.md docs/rpcd-api.md; do
    check "$d написан по-русски" "yes" \
        "$(grep -qP '[А-Яа-я]' "$d" && echo yes || echo no)"
done

# ---- протокол xsteer: обработчик netifd и страница LuCI -------------------------
# Оба файла ОБЯЗАНЫ ехать в пакете вместе, и проверяется это здесь потому, что каждая из
# половин ломается по-своему и молча. Без обработчика /lib/netifd/proto/xsteer.sh интерфейс с
# `proto xsteer` не поднимается вовсе, а LuCI показывает его «неизвестным». Без страницы
# protocol/xsteer.js туннель работает, но в браузере на нём написано «Не поддерживаемый тип
# протокола» и предлагается поставить пакет — который уже стоит. Второе уже случалось на живом
# роутере: обработчик был, страницы не было, и выглядело это как поломка пакета.
check "build.sh кладёт обработчик netifd" "1" \
    "$(grep -c 'cp files/lib/netifd/proto/xsteer.sh' build.sh)"
check "обработчик кладётся исполняемым" "1" \
    "$(grep -c 'chmod 0755 "\$PKG/lib/netifd/proto/xsteer.sh"' build.sh)"
check "build.sh кладёт страницу протокола" "1" \
    "$(grep -c 'cp luci/htdocs/luci-static/resources/protocol/xsteer.js' build.sh)"
check "обработчик есть в дереве" "yes" \
    "$([ -f files/lib/netifd/proto/xsteer.sh ] && echo yes || echo no)"
check "страница протокола есть в дереве" "yes" \
    "$([ -f luci/htdocs/luci-static/resources/protocol/xsteer.js ] && echo yes || echo no)"
# Кнопка «установить расширения протокола» обязана называть ЭТОТ пакет: клиент xsteer живёт в
# движке, а протокол для netifd и LuCI — здесь, отдельного пакета для протокола нет и не будет.
# Проверяется не отсутствие имени в тексте (в пояснении оно уместно), а то, что в КОДЕ
# возвращается имя существующего пакета: имя несуществующего оставило бы кнопку, которая ничего
# не ставит.
check "страница называет пакетом сам splify2" "1" \
    "$(grep -c "return 'splify2'" luci/htdocs/luci-static/resources/protocol/xsteer.js)"
check "в коде не возвращается несуществующий пакет" "0" \
    "$(grep -c "'luci-proto-xsteer'" luci/htdocs/luci-static/resources/protocol/xsteer.js)"
# Обработчик вызывает движок по абсолютному пути. Путь обязан быть тем, куда движок ставится
# пакетом steer: /usr/sbin/steer. Проверка стоит потому, что при отладке этот путь заменяют на
# свой бинарник, и уехать в релиз с чужим путём — значит получить «нет такой команды» у всех.
#
# Путь стал швом (STEER_BIN) ради стенда обработчика, и проверка переехала с подсчёта
# литералов на две части того же утверждения: умолчание шва ровно одно и ровно то, и все
# вызовы идут через шов, а не мимо него. Отладочный путь так виден так же хорошо: он
# оказался бы либо в умолчании, либо лишним литералом.
check "умолчание шва движка — /usr/sbin/steer" "1" \
    "$(grep -c 'STEER_BIN="${STEER_BIN:-/usr/sbin/steer}"' files/lib/netifd/proto/xsteer.sh)"
check "движок вызывается только через шов" "2" \
    "$(grep -c '"\$STEER_BIN"' files/lib/netifd/proto/xsteer.sh)"
check "мимо шва движок не вызывается" "1" \
    "$(grep -c '/usr/sbin/steer' files/lib/netifd/proto/xsteer.sh)"
check "в обработчике нет отладочных путей" "0" \
    "$(grep -c '/usr/local/sbin' files/lib/netifd/proto/xsteer.sh)"

# ---- netifd держит набор опций от прежней версии --------------------------------
# Набор опций обработчика протокола netifd читает ОДИН РАЗ при своём запуске и молча
# отбрасывает из настройки интерфейса всё, чего в наборе нет. Значит опция, приехавшая с
# новым пакетом, до перезапуска netifd не существует: галочка стоит, `uci` её помнит, а
# движок работает по-старому — ровно так не включался «режим потока». Перезапускать сеть
# из post-install нельзя (этим туннелем идёт и сама установка), поэтому расхождение
# ОБНАРУЖИВАЕТСЯ и НАЗЫВАЕТСЯ, а решение остаётся человеку.
check "post-install считает отпечаток набора опций" "1" \
    "$(grep -c 'proto_config_add_\[a-z\]\*' build.sh)"
check "отпечаток берёт строку целиком, а не имя опции" "1" \
    "$(grep -c "grep -o 'proto_config_add_\[a-z\]\*\.\*'" build.sh)"
check "отпечаток запоминается на диске" "1" \
    "$(grep -c 'netifd-proto-set' build.sh)"
check "post-install называет команду перезапуска сети" "1" \
    "$(grep -c '/etc/init.d/network restart' build.sh)"
# Сеть из post-install не перезапускается, и это надо стеречь: строка `/etc/init.d/network
# restart` в скрипте (а не в тексте echo) обрывала бы установку на середине, потому что
# пакет едет через тот же туннель.
check "post-install сеть не перезапускает" "0" \
    "$(sed -n '/^cat > build\/scripts\/post-install/,/^EOF$/p' build.sh | grep -c '^ *"\?/etc/init.d/network"\? restart')"

# ---- расписание: счётчика установок больше нет ---------------------------------
#
# Строки крона прежних отправок (splify2-ping, а до 26.10 — splify2-telemetry) при обновлении
# снимаются, новых не ставится. Проверяется блок post-install, который действительно исполнится:
# он берётся из build.sh (сгенерированный build/scripts/post-install — артефакт, он может быть от
# прежней сборки).
T="$(mktemp -d /tmp/pkgmatch.XXXXXX)"
PI="$T/post-install.block"
sed -n '/^cat > build\/scripts\/post-install/,/^EOF$/p' build.sh > "$PI"
check "post-install отклик для счётчика не ставит" "0" \
    "$(grep -c "printf '%s \\* \\* \\* \\* /usr/sbin/splify2-ping" "$PI")"
check "и убирает строку прежнего отклика" "1" \
    "$(grep -c "sed -i '/splify2-ping/d' /etc/crontabs/root" "$PI")"
check "обновление списков — не строка post-install, а задача плагина lists-catalog" "0;1" \
    "$(grep -c "printf '%s 5 \\* \\* \\* /usr/sbin/splify2-update-lists" "$PI");$(grep -c '"cron": "M 5 \* \* \*"' plugins/lists-catalog/plugin.json)"
check "post-install снимает прежнюю строку обновления списков" "1" \
    "$(grep -c "sed -i '/splify2-update-lists/d' /etc/crontabs/root" "$PI")"
check "пакет не везёт команду отклика" "0" \
    "$(grep -c 'cp files/usr/sbin/splify2-ping' build.sh)"
check "и в дереве её нет" "no" "$([ -e files/usr/sbin/splify2-ping ] && echo yes || echo no)"
check "как и общего скрипта отклика" "no" "$([ -e files/usr/lib/splify2/ping.sh ] && echo yes || echo no)"
rm -rf "$T"

# ---- сказанное установщиком доходит до браузера ---------------------------------
# post-install печатает в stdout менеджера пакетов, а тот попадает в $PKG_OUT. Пока
# $PKG_OUT отдавался только в отказе, единственная просьба post-install («перезапустите
# сеть») существовала лишь в терминале того, кто ставит пакет руками.
# Метод splify2_install живёт в плагине updater (plugins/updater/bin/updater); вывод менеджера пакетов ему отдаёт служба хоста.
RPCD=plugins/updater/bin/updater
check "self_update отдаёт вывод установщика и на успехе" "1" \
    "$(grep -c 'json_add_string output "\$INSTALL_OUT"' "$RPCD")"
# Объявление этого поля в интерфейсе и его показ в карточке обновления проверяет репозиторий andromeda.

# ---- workflow вообще пригоден к запуску ---------------------------------------
# Разбор вынесен в tests/wfcheck.py — там объяснено, почему глазами это не ловится.
# Коротко: GitHub раскрывает выражения и внутри комментариев оболочки в блоке `run:`,
# поэтому пример выражения, написанный ради пояснения, роняет релиз ещё до первой
# команды. В соседнем движке ровно так и случилось.
if command -v python3 >/dev/null 2>&1; then
    check "release.yml пригоден к запуску" "" "$(python3 tests/wfcheck.py "$WF" 2>&1)"
    check "tests.yml пригоден к запуску" "" "$(python3 tests/wfcheck.py .github/workflows/tests.yml 2>&1)"
fi
# Стенды на push и в релизе — одни и те же шаги; расхождение означало бы «зелено здесь, красно там».
check "движок для стендов собирается и в релизе, и на push" "2" \
    "$(grep -c 'make -C "\$GITHUB_WORKSPACE/../steer" all' "$WF" .github/workflows/tests.yml | awk -F: '{s+=$2} END {print s}')"

# ---- настройка uci кладётся пакетом, а не создаётся на первом обращении --------
# `uci set splify2.main.x` в несуществующий файл молча ничего не делает — на этом уже
# терялась ссылка подписки, и rpcd с тех пор создаёт файл сам (uci_file). Это правильная
# оборона, но не то место: настройка пакета объявляется системе через /etc/uci-defaults,
# и тогда `uci show splify2` отвечает с первой секунды, а не после первого сохранения.
# Файл обязан приехать в пакет и обязан быть запущен установкой — иначе он существует
# только в дереве.
UD=files/etc/uci-defaults/99-splify2
check "uci-defaults есть в репозитории" "yes" "$([ -f "$UD" ] && echo yes || echo no)"
check "build.sh кладёт uci-defaults" "1" "$(grep -c "cp $UD" build.sh)"
# Считаются РАЗНЫЕ вещи, а не вхождения строки: скрипт обязан быть и запущен, и убран после
# успеха — иначе он остаётся в системе и запускается на каждом обновлении пакета.
#
# Читается build.sh, а не build/scripts/post-install: второй — сгенерированный артефакт, его
# каталог в .gitignore, и в свежем клоне его нет вовсе. Стенд, проверяющий артефакт сборки,
# зелен только там, где сборку уже запускали.
check "установка прогоняет uci-defaults" "1" \
    "$(grep -c '\. /etc/uci-defaults/99-splify2' build.sh)"
check "установка убирает uci-defaults после успеха" "1" \
    "$(grep -c 'rm -f /etc/uci-defaults/99-splify2' build.sh)"
check "uci-defaults заводит секцию main" "1" \
    "$(grep -c "splify2.main=splify2" "$UD" 2>/dev/null)"
# Перезапуск rpcd из uci-defaults — В ФОНЕ И С ЗАДЕРЖКОЙ. Скрипт исполняет postinst, а
# postinst при обновлении из интерфейса запускает сам rpcd (splify2_install → pkg_install →
# apk/opkg → postinst): перезапуск здесь же обрывал ответ метода, и человек видел «сбой» у
# удавшейся установки. На роутере проверено: `reload` у rpcd — это procd_send_signal (мягкий),
# и единственный жёсткий перезапуск на пути обновления был именно этот.
check "перезапуск rpcd в uci-defaults отложен и уведён в фон" "1" \
    "$(grep -c '( sleep 2; /etc/init.d/rpcd restart ) >/dev/null 2>&1 &$' "$UD")"
check "немедленного перезапуска rpcd в uci-defaults нет" "0" \
    "$(grep -c '^[[:space:]]*\[ -x /etc/init.d/rpcd \] && /etc/init.d/rpcd restart' "$UD")"
# ---- что именно переживает обновление прошивки --------------------------------
# Настройку МАЛО ЗАВЕСТИ. sysupgrade и «Создать архив» собирают список из conffiles
# установленных пакетов, /etc/sysupgrade.conf и /lib/upgrade/keep.d/* — общего правила
# «сохраняем /etc/config» нет, соседние файлы там лежат потому, что их объявили ИХ пакеты.
# До запуска 65 splify2 не объявлял ничего, и обновление «с сохранением настроек» теряло всю
# настройку молча: ссылку подписки, её название, фикс Zapret Manager, адрес манифеста,
# скачивание через туннель — одиннадцать ключей.
KEEP=files/lib/upgrade/keep.d/splify2
check "keep.d есть в репозитории" "yes" "$([ -f "$KEEP" ] && echo yes || echo no)"
check "build.sh кладёт keep.d в дерево пакета" "1" "$(grep -c "cp $KEEP" build.sh)"
for f in /etc/config/splify2 /etc/splify2/fw-owned; do
    check "keep.d объявляет $f" "1" "$(grep -cx "$f" "$KEEP" 2>/dev/null)"
done
# Ни комментариев, ни пустых строк, ни относительных путей: файл читает sysupgrade, и строка,
# не являющаяся путём, в лучшем случае бесполезна. Тот же барьер, что у keep.d движка.
check "в keep.d только абсолютные пути" "0" "$(grep -cv '^/' "$KEEP" 2>/dev/null)"
# Кеш в keep.d не попадает: манифест и каталог стратегий обхода перекачиваются сами, а
# результаты часовой проверки стратегий — производное от них.
check "keep.d не тащит кеш манифеста" "0" "$(grep -c 'manifest.json' "$KEEP" 2>/dev/null)"
check "keep.d не тащит каталог стратегий" "0" "$(grep -c 'strategies.txt' "$KEEP" 2>/dev/null)"
# Шапка uci-defaults объясняет, ПОЧЕМУ настройка не conffile, и до запуска 65 утверждала, что
# файл «попадает в архив настроек наравне с остальным /etc/config». Это было неверно —
# соседство ничего не сохраняет, — и правка это опровержение записала.
#
# Проверка стоит на ОПРОВЕРЖЕНИИ, а не на отсутствии прежней фразы: сама фраза в файле
# осталась, потому что новая редакция её цитирует, объясняя, чем она неверна. Запрет на
# подстроку поймал бы эту цитату и заставил бы убрать объяснение — то есть стенд требовал бы
# забыть, в чём была ошибка.
check "uci-defaults называет keep.d" "yes" \
    "$(grep -q 'keep.d' "$UD" 2>/dev/null && echo yes || echo no)"
check "и говорит, что соседство в /etc/config ничего не сохраняет" "yes" \
    "$(grep -q 'Общего правила' "$UD" 2>/dev/null && echo yes || echo no)"

# Заведение спеки и служба ядра (блок «пустая спека и служба ядра» в uci-defaults). Ядро ставят
# раньше интерфейса, и его демон встаёт без спеки: `start` для РАБОТАЮЩЕЙ службы — пустой вызов
# (procd видит тот же экземпляр), и без перечитывания `steer status` отвечал бы «cannot open», а
# пульт — «ядро не ответило», пока человек не нажал «Применить». Работающей службе велено
# перечитать спеку (reload, а не restart — тот гасит таблицы и помощников), остановленной — start.
#
# Гоняется сам блок: корень — SPLIFY2_TEST_ROOT (шов `_r`, как у чистки следов отчёта), init-скрипт
# — заглушка, которая помнит вызовы и отвечает на `running` по файлу. Перед запуском блок
# проверяется на пути мимо корня: такой прогон тронул бы настоящий /etc/steer машины, где идёт стенд.
TSP="$(mktemp -d)"
sed -n '/^# >>> пустая спека и служба ядра/,/^# <<< пустая спека и служба ядра/p' "$UD" > "$TSP/blk.sh"
check "блок заведения спеки найден в uci-defaults" "yes" "$([ -s "$TSP/blk.sh" ] && echo yes || echo no)"
check "блок не ходит в /etc мимо корня стенда" "0" \
    "$(grep -v '^[[:space:]]*#' "$TSP/blk.sh" | grep '/etc/' | grep -vc '\$_r/etc/')"
# spec_blk РЕЖИМ... — свежий корень и прогон блока. Режимы: работает — служба работает, без-службы —
# init-скрипта нет, спека — spec.json уже лежит, yaml — рядом spec.yaml, коннектор — sing-box
# коннектора. Вызовы init-скрипта (по строке на вызов) — в $TSP/calls.
spec_blk() {
    rm -rf "$TSP/root" "$TSP/calls" "$TSP/up"
    mkdir -p "$TSP/root/etc/init.d" "$TSP/root/etc/steer"
    cat > "$TSP/root/etc/init.d/steer" <<'STUB'
#!/bin/sh
echo "$1" >> "$TSP_CALLS"
case "$1" in running) [ -f "$TSP_UP" ] ;; esac
STUB
    chmod +x "$TSP/root/etc/init.d/steer"
    for _m in "$@"; do
        case "$_m" in
            работает)   : > "$TSP/up" ;;
            без-службы) rm -f "$TSP/root/etc/init.d/steer" ;;
            спека)      printf '{"version":2}\n' > "$TSP/root/etc/steer/spec.json" ;;
            yaml)       printf 'version: 2\n' > "$TSP/root/etc/steer/spec.yaml" ;;
            коннектор)  printf '# sing-box от steer-box-connector\n' > "$TSP/root/etc/init.d/sing-box" ;;
        esac
    done
    ( _r="$TSP/root"; TSP_CALLS="$TSP/calls"; TSP_UP="$TSP/up"; export TSP_CALLS TSP_UP; . "$TSP/blk.sh" )
}
spec_calls() { cat "$TSP/calls" 2>/dev/null | tr '\n' ' ' | sed 's/ $//'; }
spec_has() { [ -s "$TSP/root/etc/steer/spec.json" ] && echo yes || echo no; }

if [ -s "$TSP/blk.sh" ] && [ "$(grep -v '^[[:space:]]*#' "$TSP/blk.sh" | grep '/etc/' | grep -vc '\$_r/etc/')" = 0 ]; then
    spec_blk работает
    check "ядро работает без спеки: спека заведена" "yes" "$(spec_has)"
    check "  это v2 с постоянным выходом direct" "1" \
        "$(grep -c '^{"version":2,"outputs":{"direct":{"kind":"direct"}}}$' "$TSP/root/etc/steer/spec.json")"
    check "  службе велено перечитать её — reload, а не start и не restart" "running reload" "$(spec_calls)"

    spec_blk
    check "служба остановлена: спека заведена и служба поднята, как прежде" "yes;running start" \
        "$(spec_has);$(spec_calls)"

    spec_blk без-службы
    check "службы нет (интерфейс первым): спека заведена, звать некого" "yes;" "$(spec_has);$(spec_calls)"

    spec_blk работает спека
    check "спека уже есть: файл не тронут" '{"version":2}' "$(cat "$TSP/root/etc/steer/spec.json")"
    check "  и служба не тронута вовсе" "" "$(spec_calls)"

    spec_blk работает yaml
    check "рядом spec.yaml: второй файл не заводится" "no" "$(spec_has)"
    check "  и служба не тронута" "" "$(spec_calls)"

    spec_blk работает коннектор
    check "ядро ведёт коннектор: спека не заводится" "no" "$(spec_has)"
    check "  и служба steer не тронута" "" "$(spec_calls)"
fi
rm -rf "$TSP"

# Список изменений: release.yml берёт раздел «## <версия>» из CHANGELOG.md тем же awk и без
# него стабильный выпуск не выпускает. Раздел для версии в VERSION обязан быть уже в дереве —
# иначе выпуск падает на сервере, а не здесь.
CHV="$(cat VERSION)"
check "в CHANGELOG.md есть раздел версии $CHV" "yes" \
    "$(awk -v v="$CHV" '/^## / { if (on) exit; split($0, h, " "); if (h[2] == v) { on = 1; next } } on { print }' CHANGELOG.md | grep -q '[^[:space:]]' && echo yes || echo no)"
check "release.yml разбирает CHANGELOG.md тем же выражением" "1" \
    "$(grep -c "split(\$0, h, \" \"); if (h\[2\] == v)" .github/workflows/release.yml)"

# ReCheck: перед снятием пакета служба и её таблица nftables убираются (иначе таблица переживает
# init-скрипт), и это есть в обоих форматах; после обновления opkg служба поднимается заново.
check "pre-remove останавливает службу ReCheck и снимает таблицу" "2" \
    "$(sed -n '/^cat > build\/scripts\/pre-remove/,/^EOF$/p' build.sh | grep -c 'splify2-recheck stop\|delete table inet splify2_recheck')"
check "apk получает pre-deinstall" "1" "$(grep -c 'pre-deinstall:build/scripts/pre-remove' build.sh)"
check "ipk получает prerm" "1" "$(grep -c 'build/scripts/pre-remove "\$PKG/CONTROL/prerm"' build.sh)"
check "post-install поднимает включённый ReCheck после обновления" "1" \
    "$(sed -n '/^cat > build\/scripts\/post-install/,/^EOF$/p' build.sh | grep -c 'splify2-recheck restart')"

# ---- счётчика установок больше нет: следы прежних версий уходят при обновлении ------
# Блок uci-defaults снимает ключи отклика (согласие, идентификатор, адрес для стендов) и файл в /var и /tmp; соседи, которые живы (замер внешнего адреса выхода), не
# трогаются. uci подменён файлом ключей, корень — каталог в /tmp.
TUD="$(mktemp -d /tmp/pkgmatch-ud.XXXXXX)"
mkdir -p "$TUD/bin" "$TUD/root/var/lib/splify2" "$TUD/root/var/run" "$TUD/root/tmp"
cat > "$TUD/bin/uci" <<EOF2
#!/bin/sh
db="$TUD/uci.db"
case "\$1" in -q) shift ;; esac
case "\$1" in
    get)    v="\$(sed -n "s|^\$2=||p" "\$db" 2>/dev/null | tail -n1)"; [ -n "\$v" ] || exit 1; printf '%s\n' "\$v" ;;
    delete) sed -i "\\|^\$2=|d" "\$db" 2>/dev/null ;;
    set)    k="\${2%%=*}"; sed -i "\\|^\$k=|d" "\$db" 2>/dev/null; printf '%s\n' "\$2" >> "\$db" ;;
    commit) : ;;
    *) exit 1 ;;
esac
EOF2
chmod +x "$TUD/bin/uci"
for k in telemetry telemetry_id ping_url; do echo "splify2.main.$k=x" >> "$TUD/uci.db"; done
echo "splify2.main.manifest_url=keep" >> "$TUD/uci.db"
for f in tmp/splify2-ping; do
    echo x > "$TUD/root/$f"
done
echo x > "$TUD/root/var/lib/splify2/geo-wg0"
sed -n '/^# Ключи счётчика установок/,/^\[ -n "\$_old" \]/p' files/etc/uci-defaults/99-splify2 > "$TUD/olds.sh"
check "блок чистки прежних ключей найден в uci-defaults" "yes" "$([ -s "$TUD/olds.sh" ] && echo yes || echo no)"
PATH="$TUD/bin:$PATH" SPLIFY2_TEST_ROOT="$TUD/root" sh "$TUD/olds.sh"
check "ключи счётчика сняты" "splify2.main.manifest_url=keep" "$(cat "$TUD/uci.db")"
for f in tmp/splify2-ping; do
    check "прежний файл /$f убран" "no" "$([ -e "$TUD/root/$f" ] && echo yes || echo no)"
done
check "замер внешнего адреса выхода не тронут" "yes" "$([ -e "$TUD/root/var/lib/splify2/geo-wg0" ] && echo yes || echo no)"
rm -rf "$TUD"
# ---- настройки каталога списков переезжают в плагин lists-catalog ----------------------------------
# Поля uci каркаса (адрес каталога, порог сокращения, тег второго издателя) один раз переносятся в conf плагина, и поля
# снимаются: человек, менявший их, не теряет выбор при обновлении. Файл настроек плагина, если он уже есть, не затирается.
TUD="$(mktemp -d /tmp/pkgmatch-mig.XXXXXX)"
mkdir -p "$TUD/bin" "$TUD/root"
cat > "$TUD/bin/uci" <<EOF2
#!/bin/sh
db="$TUD/uci.db"
case "\$1" in -q) shift ;; esac
case "\$1" in
    get)    v="\$(sed -n "s|^\$2=||p" "\$db" 2>/dev/null | tail -n1)"; [ -n "\$v" ] || exit 1; printf '%s\n' "\$v" ;;
    delete) sed -i "\\|^\$2=|d" "\$db" 2>/dev/null ;;
    commit) : ;;
    *) exit 1 ;;
esac
EOF2
chmod +x "$TUD/bin/uci"
printf '%s\n' 'splify2.main.manifest_url=https://example.net/own.json' 'splify2.main.list_shrink_factor=0' \
    'splify2.main.allow_domains_tag=2026-01-01_00-00' 'splify2.main.sub_url=https://panel.example.net/s' > "$TUD/uci.db"
sed -n '/^# >>> перенос настроек каталога списков/,/^# <<< перенос настроек каталога списков/p' files/etc/uci-defaults/99-splify2 > "$TUD/mig.sh"
check "блок переноса настроек каталога найден в uci-defaults" "yes" "$([ -s "$TUD/mig.sh" ] && echo yes || echo no)"
PATH="$TUD/bin:$PATH" SPLIFY2_TEST_ROOT="$TUD/root" sh "$TUD/mig.sh"
MC="$TUD/root/etc/steer/plugins/conf/lists-catalog/settings.json"
check "настройки каталога перенесены в conf плагина" "https://example.net/own.json;0;2026-01-01_00-00" \
    "$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("%s;%s;%s" % (d["manifest_url"], d["list_shrink_factor"], d["allow_domains_tag"]))' "$MC" 2>/dev/null)"
check "поля uci каталога сняты, чужие остались" "splify2.main.sub_url=https://panel.example.net/s" "$(cat "$TUD/uci.db")"
printf '%s\n' 'splify2.main.manifest_url=https://example.net/other.json' >> "$TUD/uci.db"
PATH="$TUD/bin:$PATH" SPLIFY2_TEST_ROOT="$TUD/root" sh "$TUD/mig.sh"
check "готовый файл настроек плагина не затирается" "https://example.net/own.json" \
    "$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["manifest_url"])' "$MC")"
rm -rf "$TUD"
# Метод учёта убран из объекта rpcd и из прав интерфейса; ни одного упоминания в рабочих текстах.
check "rpcd не знает telemetry_state и telemetry_set" "0" \
    "$(grep -c 'telemetry_state\|telemetry_set' files/usr/libexec/rpcd/splify2 luci/root/usr/share/rpcd/acl.d/splify2.json | awk -F: '{s+=$2} END {print s+0}')"
# Файлы, в которые пишут параллельные вызовы одного и того же метода (страница спрашивает версии ядра
# и интерфейса, обзор списков — разом), создаются mktemp, а не по общему имени: общее имя — смесь двух
# ответов, имя с номером процесса в /tmp предсказуемо.
check "кэш local_lists и ответы GitHub пишутся в свои файлы (mktemp)" "0;1;1;1" \
    "$(grep -c '_ll_c\.tmp' plugins/lists-catalog/lib/methods.sh);$(grep -c 'mktemp \"${GH_CACHE:-/tmp/splify2-releases.json}.api.XXXXXX' files/usr/lib/splify2/rpcd/pkg-lib.sh);$(grep -c 'mktemp \"${GH_CACHE:-/tmp/splify2-releases.json}.version.XXXXXX' files/usr/lib/splify2/rpcd/pkg-lib.sh);$(grep -c 'mktemp \"$_ll_c.XXXXXX' plugins/lists-catalog/lib/methods.sh)"
# Методы, отдающие секреты (архив с приватными ключами туннелей, ссылка xs:// с ключом), — только в
# группе write: учётная запись «только чтение» их получить не должна.
check "backup_get и xsteer_link — в write и не в read" "yes" \
    "$(python3 -c 'import json,sys
a = json.load(open(sys.argv[1]))["splify2"]
r = a["read"]["ubus"]["splify2"]; w = a["write"]["ubus"]["splify2"]
print("yes" if all(m in w and m not in r for m in ("backup_get", "xsteer_link")) else "no")' luci/root/usr/share/rpcd/acl.d/splify2.json)"
check "группы telemetry в rpcd нет" "no" "$([ -e files/usr/lib/splify2/rpcd/m-telemetry.sh ] && echo yes || echo no)"
check "README и руководство о счётчике не говорят" "0" \
    "$(cat README.md docs/guide.md | grep -ci 'Счётчик на сайте\|TELEMETRY.md')"

printf '\n%d проверок пройдено' "$pass"
if [ "$fail" -gt 0 ]; then printf ', %d ПРОВАЛЕНО\n' "$fail"; exit 1; fi
printf '\nвсе проверки прошли\n'
