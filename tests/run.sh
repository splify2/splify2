#!/bin/sh
# Все стенды splify2 одной командой.
#
# Зачем отдельный вход. Урок запуска 26: пометка «стенд создан» ничего не стоит, пока
# стенд не подключён к тому, что запускают. Стенд, который надо вспомнить и позвать
# руками, не запускается никогда — а значит и не сторожит ничего.
#
# Здесь нет Makefile, в отличие от steer: у splify2 нет сборки на C, и единственная
# зависимость стендов — python3 плюс node для интерфейса.
#
# Запуск: sh tests/run.sh
set -u

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
fails=0

run() {  # ИМЯ КОМАНДА...
    name="$1"; shift
    printf '\n===== %s =====\n' "$name"
    if "$@"; then
        printf '%s: зелено\n' "$name"
    else
        printf '%s: ПРОВАЛ\n' "$name"
        fails=$((fails + 1))
    fi
}

run listsmatch sh "$ROOT/tests/listsmatch.sh"
run rpcdmatch  sh "$ROOT/tests/rpcdmatch.sh"
# Тот же объект rpcd, но против настоящего движка: спека v2, которую пишет интерфейс, обязана
# пройти его разбор, а негодная — вернуться его словами.
run enginematch sh "$ROOT/tests/enginematch.sh"
# Набор каталога, который списком не выразим (исключения AdGuard), — файлом `.srs` в правиле:
# скачивание, сохранение спеки настоящим движком, доскачивание, ночное обновление, удаление.
run srsmatch sh "$ROOT/tests/srsmatch.sh"
run pkgmatch   sh "$ROOT/tests/pkgmatch.sh"
# Плагины: методы вкладки «Плагины» над менеджером ядра (заглушка), диспетчер методов плагинов, ACL из
# манифеста, ссылки объектов splify2.p.<id>, шлюз /v1/plugin/*.
run pluginmatch sh "$ROOT/tests/pluginmatch.sh"
# Точки расширения каркаса (splify2-api): хуки, задачи, события, псевдонимы и переопределения плагинов, безопасный
# режим, архив настроек с разделами плагинов, сборка .s2p плагинов каркаса.
run exttest sh "$ROOT/tests/exttest.sh"
# Граница API официальных плагинов: ни путей, ни файлов, ни швов, ни функций каркаса — только службы хоста; слои: grep и
# `s2p lint --official`, оба доказаны обратным опытом.
run pluginhygiene sh "$ROOT/tests/pluginhygiene.sh"
# Службы хоста для программ плагинов (splify2-host): скачивание, спека, настройки плагина, архив настроек каркаса, применение.
run hostmatch sh "$ROOT/tests/hostmatch.sh"
# ReCheck: таблица nftables для IPv4 и IPv6, служба и rpcd без движка.
run recheckmatch sh "$ROOT/tests/recheckmatch.sh"
# Спека в spec.yaml (spec.sh): JSON-вид, запись переводом ядра, перевод при обновлении ядра.
run specfilematch sh "$ROOT/tests/specfilematch.sh"
# Автоприменение на роутере (плагин autoapply): хук после записи спеки, пауза, склейка правок, sweep, события.
run autoapplymatch sh "$ROOT/tests/autoapplymatch.sh"
# Плагин subscriptions: расписание автообновления (задача зовёт методы каркаса только по тем подпискам, у которых срок
# вышел), остаток трафика, название, поля sub_list через хук, архив. Стенд про то, кого позвали и кого не тронули.
run subsmatch  sh "$ROOT/tests/subsmatch.sh"
# Команда полного удаления: убирает ТОЛЬКО записанное за нами и по умолчанию ничего не
# делает вовсе. Стенд про порядок (проброс уходит раньше зоны — иначе fw4 не перезагрузится)
# и про чужое, которое остаться обязано.
run purgematch sh "$ROOT/tests/purgematch.sh"
# Скачивание с обходом закрытого githubusercontent: лестница путей и её порядок (splify2#15).
run fetchmatch sh "$ROOT/tests/fetchmatch.sh"
# Определение версии в установщике: оба пути и оба отказа (R-048).
run installmatch sh "$ROOT/tests/installmatch.sh"
# Разбор конфигурации на странице протокола xsteer. Пропускается вслух, если нет quickjs.
run protomatch python3 "$ROOT/tests/protomatch.py"
# Обработчик протокола netifd: 193 строки, которые netifd исполняет от root на каждой
# настройке интерфейса. Заглушки в PATH и швы в самом обработчике, ядро не нужно.
run protohandler sh "$ROOT/tests/protohandler.sh"

# Каркас на классическом LuCI JS (view/splify2/core): автоформа «схема ключей ядра -> поля» с покрытием каждого
# ключа фикстуры, словарь T(), список строк strings.json, методы rpcd каркаса. Настоящие модули, LuCI-заглушки.
run automatch sh "$ROOT/tests/automatch.sh"
# Языковые плагины lang-ru и lang-en: словари каркаса и Andromeda, i18n_get, сборка с lint --official.
run langmatch sh "$ROOT/tests/langmatch.sh"

# Интерфейс. Пропускается вслух, а не молча: молчаливый пропуск читается как «прошло», и
# ровно так стенд однажды и превратился в фикцию.
#
# Требуется node ≥ 20.19: vitest 4 и vite 8 на node 18 не работают. Как ставился локально —
# записано в STATE.md, раздел «Окружение».
if [ -d "$ROOT/ui/node_modules/vitest" ]; then
    node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
    if [ "$node_major" -lt 20 ] 2>/dev/null; then
        for _n in /opt/node22/bin /opt/node24/bin /root/.local/opt/node-v22.14.0-linux-x64/bin; do
            if [ -x "$_n/node" ]; then
                PATH="$_n:$PATH"
                node_major="$("$_n/node" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
                break
            fi
        done
    fi
    if [ "$node_major" -ge 20 ] 2>/dev/null; then
        # ТЕ ЖЕ ТРИ ПРОВЕРКИ, ЧТО В ACTIONS, И ДО СТЕНДА. Прежде здесь был только `npm test`, а
        # lint, tsc и check:cn гонялись лишь в workflow — то есть локальный прогон был зелёным
        # при красном CI, и узнавалось это через сутки, чужим коммитом. Так и вышло: условно
        # вызванный хук в RulesTab прошёл vitest (Preact к смене числа хуков терпим) и упал на
        # oxlint в Actions.
        run ui-lint sh -c "cd '$ROOT/ui' && npm run lint --silent && npx tsc -b && npm run check:cn --silent"
        run ui-harness sh -c "cd '$ROOT/ui' && npm test --silent"
    elif docker image inspect node:22-alpine >/dev/null 2>&1; then
        # Node в системе старый, а образ есть — гоняем стенд в нём, а не пропускаем.
        # Пропуск здесь дороже, чем кажется: половина проверок интерфейса — про поведение,
        # которое нечем проверить больше нигде, и «ПРОПУЩЕН» на каждом прогоне читается как
        # «этого стенда нет». Каталог монтируется КОРНЕМ дерева, а не ui/: стенд загрузчика
        # читает luci/htdocs/... по относительному пути и в узком монтировании не находит его.
        run ui-lint docker run --rm -v "$ROOT":/w -w /w/ui node:22-alpine \
            sh -c 'npm run lint --silent && npx tsc -b && npm run check:cn --silent'
        run ui-harness docker run --rm -v "$ROOT":/w -w /w/ui node:22-alpine npm test --silent
    else
        printf '\n===== ui-harness =====\nПРОПУЩЕН: нужен node >= 20 (найден %s) либо образ node:22-alpine для docker\n' \
            "$(node --version 2>/dev/null || echo 'нет node')"
        fails=$((fails + 1))
    fi
else
    printf '\n===== ui-harness =====\nПРОПУЩЕН: не установлен (cd ui && npm install)\n'
    fails=$((fails + 1))
fi

printf '\n%s\n' "$([ "$fails" -eq 0 ] && echo 'ВСЕ СТЕНДЫ ЗЕЛЁНЫЕ' || echo "СТЕНДОВ С ПРОВАЛОМ: $fails")"
[ "$fails" -eq 0 ]
