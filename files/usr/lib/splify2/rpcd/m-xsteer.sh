#!/bin/sh
# Часть объекта rpcd splify2 — подключается диспетчером /usr/libexec/rpcd/splify2 по имени
# метода. ЗАЧЕМ ФАЙЛОВ НЕСКОЛЬКО. busybox ash разбирает файл целиком, и объект в 4500 строк
# стоил 110 мс разбора на КАЖДЫЙ вызов — при том, что сам ответ считается за 30-90 мс.
# Диспетчер разбирает только себя, общие помощники (common.sh) и группу вызванного метода.
# Переменные и швы для стендов объявлены в диспетчере и здесь доступны как есть.


case "$2" in

    xsteer_link)
        # Ссылка xs:// в обе стороны, и направление выбирает ВХОД, а не отдельный метод.
        #
        #   {"iface":"home"}     → ссылка на этот туннель: тот же доступ перенести на телефон.
        #   {"link":"xs://…"}    → текст конфигурации из ссылки: им заполняет поля страница сети.
        #
        # Так же устроена и подкоманда движка (`steer xsteer-link`), и по той же причине: человек
        # здесь всегда хочет «дай мне другой вид того же самого», и спрашивать его, какой именно,
        # значило бы заставлять называть то, что уже видно из запроса.
        #
        # ПЕЧАТАЕТ И РАЗБИРАЕТ ДВИЖОК, а не этот скрипт. Формат описан один раз (steer,
        # src/ext/xslink.c) и сверяется побайтово с половиной на Go; своя сборка или разбор строки
        # здесь были бы третьей реализацией одного формата — и первой, у которой нет стенда. Ровно
        # поэтому страница сети, умеющая разбирать файл в стиле wg своим кодом, ссылку разбирать
        # сама НЕ должна: она приводит её сюда и получает файл.
        read -r input
        json_load "$input" 2>/dev/null || fail_code req.unparsable "Unparsable request"
        json_get_var iface iface
        json_get_var link link
        if [ -n "$link" ]; then
            case "$link" in
                xs://*) ;;
                *) fail_code xs.not_link "This is not an xs:// link: it must start with xs://" ;;
            esac
            # Ссылка уходит движку СТАНДАРТНЫМ ВВОДОМ, а не аргументом: аргументы видны в списке
            # процессов всякому, кто есть на роутере, а в ссылке лежит приватный ключ.
            conf="$(printf '%s\n' "$link" | "$STEER" xsteer-link - 2>&1)"
            case "$conf" in
                '[Interface]'*) json_init; json_add_boolean ok 1
                                json_add_string conf "$conf"; json_dump ;;
                *) fail_code xs.link_rejected "The link was not accepted: {reason}" reason "$conf" ;;
            esac
            exit 0
        fi
        [ -n "$iface" ] || fail_code xs.need_iface_or_link "An interface name or a link is required"
        backup_safe_word "$iface" || fail_code xs.bad_iface "Invalid interface name"
        [ "$(uci -q get "network.$iface.proto")" = xsteer ] || \
            fail_code xs.not_xsteer "The interface {iface} is not xsteer" iface "$iface"
        # ИСТОЧНИК — ГОТОВЫЙ ФАЙЛ, собранный обработчиком протокола из uci. Собирать конфигурацию
        # здесь во второй раз нельзя: два места, превращающие uci в настройку, однажды разойдутся,
        # и разойдутся молча. Отсюда следствие, которое названо человеку прямо: у выключенного
        # интерфейса файла нет, и ссылку отдать неоткуда.
        conf="$XS_RUN/$iface.conf"
        [ -f "$conf" ] || fail_code xs.iface_off "The interface {iface} is off, so there is nothing to print a link from: it is built from the same setting that brings the tunnel up. Turn the interface on." iface "$iface"
        link="$("$STEER" xsteer-link "$conf" --name "$iface" 2>&1)"
        case "$link" in
            xs://*) json_init; json_add_boolean ok 1; json_add_string link "$link"; json_dump ;;
            *) fail_code xs.core_no_link "The core did not print a link: {reason}" reason "$link" ;;
        esac
        ;;

    xsteer_link_put)
        # Принять ссылку: положить её содержимое в настройку СУЩЕСТВУЮЩЕГО интерфейса xsteer.
        #
        # ПОЧЕМУ НЕ СОЗДАЁТ ИНТЕРФЕЙС. У интерфейса есть то, чего в ссылке нет и быть не может:
        # зона фаервола, имя устройства, участие в спеке движка. Созданный здесь туннель без зоны
        # выглядел бы настроенным и не вёз бы трафик — то есть мы бы своими руками сделали ровно то
        # состояние, отличать которое учит весь остальной этот файл. Создание остаётся за страницей
        # сети, а этот метод заполняет уже созданное.
        #
        # РАЗБИРАЕТ ССЫЛКУ ДВИЖОК, и он же её проверяет. Ссылка приходит от человека, то есть это
        # недоверенный ввод; разбирать её здесь на sed значило бы держать третью реализацию формата
        # и надеяться, что она отвергает то же самое. Движок отвечает текстом конфигурации, и уже
        # из него берутся значения — по строкам, а не по позициям.
        read -r input
        json_load "$input" 2>/dev/null || fail_code req.unparsable "Unparsable request"
        json_get_var iface iface
        json_get_var link link
        [ -n "$iface" ] || fail_code xs.need_iface "An interface name is required"
        backup_safe_word "$iface" || fail_code xs.bad_iface "Invalid interface name"
        [ -n "$link" ] || fail_code xs.need_link "An xs:// link is required"
        case "$link" in xs://*) ;; *) fail_code xs.not_link "This is not an xs:// link: it must start with xs://" ;; esac
        [ "$(uci -q get "network.$iface.proto")" = xsteer ] || \
            fail_code xs.not_xsteer_create "The interface {iface} is not xsteer. Create it in the network settings and choose the xsteer protocol." iface "$iface"
        # Ссылка уходит движку СТАНДАРТНЫМ ВВОДОМ, а не аргументом: аргументы видны в списке
        # процессов всякому, кто есть на роутере, а в ссылке лежит приватный ключ.
        conf="$(printf '%s\n' "$link" | "$STEER" xsteer-link - 2>&1)"
        case "$conf" in
            '[Interface]'*) ;;
            *) fail_code xs.link_rejected "The link was not accepted: {reason}" reason "$conf" ;;
        esac
        priv=$(printf '%s\n' "$conf" | sed -n 's/^PrivateKey = //p')
        addr=$(printf '%s\n' "$conf" | sed -n 's/^Address = //p')
        sni=$(printf '%s\n' "$conf" | sed -n 's/^SNI = //p')
        mtu=$(printf '%s\n' "$conf" | sed -n 's/^MTU = //p')
        pub=$(printf '%s\n' "$conf" | sed -n 's/^PublicKey = //p')
        allowed=$(printf '%s\n' "$conf" | sed -n 's/^AllowedIPs = //p')
        ep=$(printf '%s\n' "$conf" | sed -n 's/^Endpoint = //p')
        ka=$(printf '%s\n' "$conf" | sed -n 's/^PersistentKeepalive = //p')
        [ -n "$priv" ] && [ -n "$addr" ] && [ -n "$pub" ] && [ -n "$ep" ] || \
            fail_code xs.core_incomplete "The core returned a configuration without required fields. This is a core error, not a link error."
        uci -q set "network.$iface.private_key=$priv"
        uci -q delete "network.$iface.addresses"
        uci -q add_list "network.$iface.addresses=$addr"
        if [ -n "$sni" ]; then uci -q set "network.$iface.sni=$sni"
        else uci -q delete "network.$iface.sni"; fi
        if [ -n "$mtu" ]; then uci -q set "network.$iface.mtu=$mtu"
        else uci -q delete "network.$iface.mtu"; fi
        # Пиры интерфейса ЗАМЕЩАЮТСЯ целиком: ссылка описывает доступ, а не добавку к нему, и
        # оставленный рядом прежний пир означал бы туннель к двум хабам сразу — состояние, которого
        # в звезде не бывает.
        # Секция пира ищется ПО ТИПУ, а не по имени: страница сети создаёт её безымянной
        # (uci.add), и такая секция называется по-разному в разных выпусках uci — cfg0d1234 у
        # одного, @xsteer_home[0] у другого. Тип же записан ровно один.
        for _p in $(uci -q show network 2>/dev/null | sed -n \
                    "s/^network\.\([^.]*\)=xsteer_$iface\$/\1/p"); do
            uci -q delete "network.$_p"
        done
        _sec=$(uci -q add network "xsteer_$iface")
        [ -n "$_sec" ] || fail_code xs.peer_section "Cannot create the peer section: no space left"
        uci -q set "network.$_sec.public_key=$pub"
        uci -q set "network.$_sec.endpoint_host=${ep%:*}"
        uci -q set "network.$_sec.endpoint_port=${ep##*:}"
        [ -n "$allowed" ] && {
            uci -q delete "network.$_sec.allowed_ips"
            _old_ifs="$IFS"; IFS=','
            for _a in $allowed; do
                _a=$(echo "$_a" | tr -d ' ')
                [ -n "$_a" ] && uci -q add_list "network.$_sec.allowed_ips=$_a"
            done
            IFS="$_old_ifs"
        }
        [ -n "$ka" ] && uci -q set "network.$_sec.persistent_keepalive=$ka"
        uci -q commit network || fail_code xs.network_not_saved "Cannot save the network settings"
        # Интерфейс поднимается заново СРАЗУ: человек вставил ссылку, чтобы туннель заработал, а не
        # чтобы получить запись в файле. ifup не ждёт результата, поэтому дальше интерфейс
        # рассказывает о себе сам — через xsteer_state.
        ifup "$iface" >/dev/null 2>&1 || true
        json_init
        json_add_boolean ok 1
        json_add_string iface "$iface"
        json_add_string hub "$ep"
        json_dump
        ;;

    *) fail_code req.unknown_method "Unknown method" ;;
esac
