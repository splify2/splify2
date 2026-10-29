#!/bin/sh
# Все стенды splify2 одной командой.
#
# Зачем отдельный вход. Урок запуска 26: пометка «стенд создан» ничего не стоит, пока
# стенд не подключён к тому, что запускают. Стенд, который надо вспомнить и позвать
# руками, не запускается никогда — а значит и не сторожит ничего.
#
# Здесь нет Makefile, в отличие от steer: у splify2 нет сборки на C, и единственная
# зависимость стендов — python3 (и node для каркаса LuCI JS).
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
# Проверка узлов и выходов на роутере (плагин node-check): страна выхода с кэшем, перебор узлов подписки, лучший узел.
run nodecheckmatch sh "$ROOT/tests/nodecheckmatch.sh"
# Проверки групп выходов (плагин group-check): приговор по членам, подсказка, история, события, расписание.
run groupcheckmatch sh "$ROOT/tests/groupcheckmatch.sh"
# Версии и установка ядра и splify2 (плагин updater): порядок шагов, проверки до сети, итог проверки выпусков, задача.
run updatermatch sh "$ROOT/tests/updatermatch.sh"
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
# Тексты бэкенда на языке каркаса: code и args, словари lang-ru и lang-en против кода, s2_fail_code и s2_t плагинов.
run i18nmatch sh "$ROOT/tests/i18nmatch.sh"

# Интерфейс (Andromeda) здесь больше не живёт: он — плагин в репозитории andromeda, и его тесты (vitest, lint, tsc, сверка
# вызовов с таблицей методов splify2-api, словари языков) идут там. Со стороны splify2 проверяется всё, что плагин-интерфейс
# получает от каркаса: ссылка на вид luci/, prefs_get, метод paths, семя (tests/pluginmatch.sh, tests/rpcdmatch.sh).

printf '\n%s\n' "$([ "$fails" -eq 0 ] && echo 'ВСЕ СТЕНДЫ ЗЕЛЁНЫЕ' || echo "СТЕНДОВ С ПРОВАЛОМ: $fails")"
[ "$fails" -eq 0 ]
