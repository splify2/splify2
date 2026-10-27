#!/bin/sh
# Часть объекта rpcd splify2 — подключается диспетчером /usr/libexec/rpcd/splify2 по имени метода (см. шапку common.sh).
# Подписки: ручные методы каркаса. Автообновление по расписанию, остаток трафика по запросу и своё название — плагин
# subscriptions (sub_auto, sub_quota, sub_rename); данные подписок остаются здесь, а плагин добавляет к ответам
# sub_list и sub_info свои поля хуком sub_fields.

# Этой группе нужно скачивание (fetch.sh): подключается здесь, а не каждым вызовом объекта.
need_fetch
. "${SUB_LIB_SH:-${RPCD_LIB:-/usr/lib/splify2/rpcd}/sub-lib.sh}"

case "$2" in

    sub_set)
        # Две формы одного и того же: ссылка на подписку и сами ссылки vless://.
        #
        # Движок различия не знает вовсе — он читает файл, где по строке на узел, и сам
        # разбирает base64, если это base64 (см. sub.c). Подписка это ровно такой файл,
        # который кто-то другой держит на сервере. Значит «вставить одну vless://» — не
        # новая возможность движка, а отсутствовавшая строчка ЗДЕСЬ: прежний код отвечал
        # «ссылка должна начинаться с http://», то есть человек с одним сервером от
        # знакомого не мог сделать вообще ничего.
        #
        # Ссылок может быть несколько — по одной на строку или через пробел. Пишем как
        # есть: разбирать их здесь значило бы держать вторую реализацию разбора vless://
        # в shell, а у движка она уже есть и она же будет применена.
        read -r input
        json_load "$input" 2>/dev/null || fail_code req.unparsable "Unparsable request"
        json_get_var url url
        json_get_var sub_name name
        json_get_var sub_title title
        json_get_var links links
        [ -n "$url" ] || [ -n "$links" ] || fail_code sub.no_link "No link given"
        sub_use "$sub_name"
        mkdir -p "$(dirname "$SUB")"
        # Ссылки узлов отдельным полем (прокси http(s):// и любые другие): только ссылки, без
        # скачивания. Вместе с ними в `url` могут стоять ссылки узлов, но не адрес подписки —
        # подписка и ссылки руками — два разных источника, и одно из двух потерялось бы молча.
        if [ -n "$links" ]; then
            case "$url" in https://*|http://*) fail_code sub.url_and_links "A subscription address and node links belong to different subscriptions" ;; esac
            sub_links_write "$url $links" "($SUB_LINK_RE)://.+|$SUB_HTTP_PROXY_RE" \
                || fail_code sub.no_links_proxy "No node links in the text: proxy http(s)://address:port, vless://, trojan://, ss://, socks://, vmess://, hysteria2://"
            kind=links
            url=''
        else
            case "$url" in
                https://*|http://*)
                    # Одним вызовом движка: скачать, разобрать заголовки, посчитать пригодные
                    # узлы и, если их нет ни одного, перезапросить у панели другой формат. Здесь
                    # остаётся взять из ответа то, что нужно учёту.
                    sub_fetch "$url" || fail_code sub.download_failed "The subscription was not downloaded{why}" why "${SUB_ANSWER:+: $(sub_answer error)}"
                    dev_warn="$(sub_answer warn)"
                    # Ссылка из ответа, а не та, что просили: движок мог перезапросить подписку с
                    # суффиксом /json, и обновлять в следующий раз надо по ТОЙ ссылке. Прежде это
                    # решение дублировалось здесь строкой `url="${url%/}/json"` — то есть
                    # оболочка повторяла правило, которое применил не она.
                    _u="$(sub_answer url)"
                    [ -n "$_u" ] && url="$_u"
                    kind=url
                    ;;
                vless://*|hysteria2://*|hy2://*|trojan://*|ss://*|socks://*|socks4://*|socks4a://*|socks5://*|vmess://*)
                    # Ссылки узлов: hysteria2:// (и короткая hy2://) — клиента hysteria2 (пакет
                    # steer-hysteria2), trojan/ss/socks/vmess — прокси (пакет steer-proxy). Файл
                    # подписки один, какому протоколу принадлежит узел, различает ядро.
                    sub_links_write "$url" "($SUB_LINK_RE)://.+" \
                        || fail_code sub.no_links "No node links in the text (vless://, hysteria2://, trojan://, ss://, socks://, vmess://)"
                    kind=links
                    ;;
                *) fail_code sub.need_link "A subscription link (http:// or https://) or node links (vless://, hysteria2://, trojan://, ss://, socks://, vmess://) are required" ;;
            esac
        fi
        # Новая подписка — новые узлы, значит помощника выхода надо перечитать. Иначе туннель
        # продолжает работать по узлу, которого в подписке может уже не быть. Перечитывает
        # демон движка (см. engine_reload_clean); туннелей, которым эта подписка ещё не
        # назначена, перезагрузка не касается.
        engine_reload_clean || true
        # Ссылка сохраняется, чтобы её можно было обновить одной кнопкой и показать
        # человеку, откуда взялись узлы. В uci, а не в спеке: спека — вход движка, и
        # URL ему не нужен ни для чего.
        #
        # Файл конфигурации создаётся здесь: пакет его не кладёт, а `uci set` в
        # несуществующий файл молча ничего не делает — ссылка «сохранялась» и пропадала,
        # причём sub_set отвечал ok. Тихая потеря настройки хуже отказа.
        #
        # Для vless:// сохраняется ВИД, а не текст: показывать человеку обратно ссылку с
        # его же ключом незачем, а обновлять её нечем — обновляют подписку, не ссылку.
        uci_file || fail_code disk.cannot_create "Cannot create {file}: no space left" file "$UCI_SPLIFY2"
        # if, а не `&& … || …`: там отказ записи ссылки запускал вторую ветку, и та стирала
        # прежнюю ссылку — подписку становилось нечем обновить (I-329).
        if [ "$kind" = url ]; then sub_put "$SUB_NAME" url "$url"
        else sub_put "$SUB_NAME" url ""
        fi
        sub_put "$SUB_NAME" kind "$kind"
        # Источник стал ссылками: остаток трафика прежней панели больше ни к чему — ссылки не панель. Без этого
        # обзор показывал бы остаток панели, которой у подписки уже нет. Интервал автообновления (плагин
        # subscriptions) для такой подписки не действует: хук sub_fields отдаёт auto 0 при kind не url.
        if [ "$kind" != url ]; then
            rm -f "$SUB_INFO"
        fi
        # Название: что дал человек, иначе то, что назвала панель. Своё имя переписывать
        # ответом панели нельзя — человек его для того и вписал.
        if [ -z "$sub_title" ]; then
            sub_brand "$url" "$(sub_answer title)"
            sub_title="$SUB_BRAND_TITLE"
        fi
        [ -n "$sub_title" ] && sub_put "$SUB_NAME" title "$sub_title"
        uci_commit
        json_init
        json_add_boolean ok 1
        json_add_string kind "$kind"
        json_add_string name "$SUB_NAME"
        json_add_string title "${sub_title:-}"
        json_add_string path "$SUB"
        json_add_int bytes "$(wc -c 2>/dev/null < "$SUB" || echo 0)"
        # Сколько узлов движок счёл ПРИГОДНЫМИ. Считал он их тем же кодом, которым читает
        # подписку при подъёме туннеля, — значит это то самое число, по которому туннель и
        # поднимется. Прежде оболочка добывала его отдельным запуском движка и регулярным
        # выражением по его JSON, поэтому в ответ оно не попадало вовсе.
        [ -n "$(sub_answer usable)" ] && json_add_int usable "$(sub_answer usable)"
        # Сказанное панелью про устройство — в ответе, а не в журнале: человек нажал кнопку
        # и должен узнать там же, что скачалась заглушка, а не гадать позже по туннелю,
        # который «настроен и не работает».
        [ -n "${dev_warn:-}" ] && json_add_string warn "$dev_warn"
        json_add_string hwid "$(hwid)"
        # Остаток трафика — в ответе на ту же кнопку, которая ходила к панели. Иначе обзор
        # показывал бы прежние числа до следующего опроса, а человек только что нажал
        # «Обновить» именно затем, чтобы увидеть свежие.
        sub_userinfo_emit
        json_dump
        ;;

    sub_info)
        # `|| input=''` ЗДЕСЬ БЫЛО ОШИБКОЙ. ubus отдаёт JSON без завершающего перевода
        # строки, и `read` в этом случае возвращает ненулевой код, УЖЕ ЗАПОЛНИВ переменную.
        # Ветка `||` затирала прочитанное: имя подписки не доезжало, метод отвечал по
        # первой, и на экране у второй подписки стояли чужие числа. Остальные методы
        # читают вход простым `read -r input` — по той же причине.
        input=''
        read -r input 2>/dev/null || true
        sub_use "$(jsonfilter -s "${input:-{\}}" -e '@.name' 2>/dev/null)"
        sub_fields_run "$SUB_NAME"
        json_init
        json_add_string url "$(sub_get "$SUB_NAME" url)"
        json_add_string name "$SUB_NAME"
        # Вид источника: url — подписка, которую можно обновить; links — вставленные
        # руками ссылки, обновлять которые нечем. Интерфейсу это нужно, чтобы не
        # предлагать «Обновить» там, где обновление ничего не значит.
        json_add_string kind "$(sub_kind_of "$SUB_NAME")"
        json_add_string path "$SUB"
        # Идентификатор устройства отдаётся ВСЕГДА, а не только после скачивания: человек
        # заводит роутер в панели заранее, и найти там свою коробку он может только по этой
        # строке. Пустая строка значит «не из чего считать» — ни одного физического порта с
        # постоянным MAC; тогда заголовок не уходит вовсе, и об этом говорит sub_set.
        json_add_string hwid "$(hwid)"
        sub_fields_emit "$SUB_NAME"
        if [ -s "$SUB" ]; then
            json_add_boolean present 1
            json_add_int bytes "$(wc -c 2>/dev/null < "$SUB" || echo 0)"
            json_add_int mtime "$(date -r "$SUB" +%s 2>/dev/null || echo 0)"
        else
            json_add_boolean present 0
        fi
        # Остаток трафика — тот, что запомнен с последнего обращения к панели. Сюда он
        # приходит БЕЗ запроса наружу: sub_info спрашивают по кругу вместе с остальным
        # состоянием, и ходить с роутера к панели каждые пять секунд нельзя. Обновляет
        # его отдельный метод sub_quota, который зовут по нажатию и по устареванию.
        #
        # Поля `quota` нет вовсе — значит панель остатка не сообщала: ни разу, либо в
        # последний раз промолчала. Интерфейс к этому готов и говорит об этом прямо.
        sub_userinfo_emit
        sub_fields_clean
        json_dump
        ;;

    sub_list)
        # Все подписки роутера одним ответом. Именно списком, а не по одной: экран «Подписки»
        # показывает их вместе, и десять вызовов ради десяти строк — это десять запусков
        # shell на роутере с 64 МБ.
        #
        # Остаток здесь приходит ЗАПОМНЕННЫЙ, как и в sub_info: наружу за ним ходит
        # отдельный sub_quota (плагин subscriptions), который зовут по нажатию.
        sub_fields_run $(sub_names)
        json_init
        json_add_array subs
        for n in $(sub_names); do
            sub_use "$n"
            json_add_object ""
            json_add_string name "$SUB_NAME"
            _sb_u="$(sub_get "$SUB_NAME" url)"
            sub_brand "$_sb_u" "$(sub_get "$SUB_NAME" title)" own
            json_add_string title "$SUB_BRAND_TITLE"
            # Ссылка на продавца — только когда источник опознан; пустую наружу не отдаём,
            # чтобы интерфейсу не пришлось отличать «нет ссылки» от «ссылка пустая».
            [ -n "$SUB_BRAND_LINK" ] && json_add_string link "$SUB_BRAND_LINK"
            json_add_string url "$_sb_u"
            json_add_string kind "$(sub_kind_of "$SUB_NAME")"
            json_add_string path "$SUB"
            if [ -s "$SUB" ]; then
                json_add_boolean present 1
                json_add_int bytes "$(wc -c 2>/dev/null < "$SUB" || echo 0)"
                json_add_int mtime "$(date -r "$SUB" +%s 2>/dev/null || echo 0)"
            else
                json_add_boolean present 0
            fi
            # Сколько выходов на неё ссылается: по этому числу интерфейс говорит, чем
            # занята подписка, и отказывается удалять занятую.
            json_add_int used "$(sub_used_by "$SUB")"
            json_add_int used_nodes "$(sub_nodes_used "$SUB")"
            # Поля плагинов (интервал автообновления, «пора ли обновлять»): хук sub_fields, один вызов на весь ответ.
            sub_fields_emit "$SUB_NAME"
            sub_userinfo_emit
            json_close_object
        done
        json_close_array
        json_add_string hwid "$(hwid)"
        sub_fields_clean
        json_dump
        ;;

    sub_refresh)
        # Обновить подписку по сохранённой ссылке. Этот метод зовёт расписание; человек
        # нажимает «Обновить», и тогда работает sub_set — у него на входе ссылка.
        #
        # ТУННЕЛЬ ПЕРЕЧИТЫВАЕТСЯ ТОЛЬКО ПРИ ИЗМЕНИВШИХСЯ УЗЛАХ. Подписка опрашивается по
        # часам, а узлы у панели меняются редко: помечай мы правку каждый раз, туннель
        # перезапускался бы по расписанию на ровном месте, и человек видел бы обрыв связи
        # каждые полчаса. Поэтому сравниваем файл до и после.
        input=''
        read -r input 2>/dev/null || true
        sub_use "$(jsonfilter -s "${input:-{\}}" -e '@.name' 2>/dev/null)"
        url="$(sub_get "$SUB_NAME" url)"
        [ "$(sub_kind_of "$SUB_NAME")" = url ] && [ -n "$url" ] ||
            fail_code sub.links_only "The nodes are given as links: there is nothing to update"
        before="$(md5sum < "$SUB" 2>/dev/null | cut -d' ' -f1)"
        sub_fetch "$url" || fail_code sub.download_failed "The subscription was not downloaded{why}" why "${SUB_ANSWER:+: $(sub_answer error)}"
        _u="$(sub_answer url)"
        [ -n "$_u" ] && [ "$_u" != "$url" ] && { sub_put "$SUB_NAME" url "$_u"; uci_commit; }
        after="$(md5sum < "$SUB" 2>/dev/null | cut -d' ' -f1)"
        json_init
        json_add_boolean ok 1
        json_add_string name "$SUB_NAME"
        if [ "$before" != "$after" ]; then
            json_add_boolean changed 1
            # Сразу просим демон перечитать подписки: ждать, пока человек нажмёт «Применить»,
            # нельзя — обновление затем и по часам, чтобы человек в него не вмешивался. Если
            # есть неприменённые правки, перезагрузка не делается (см. engine_reload_clean), а
            # «Применить» перезапустит помощников само: содержимое файла входит в их подпись.
            # Перезапустить узнают те выходы, что читают эту подписку: остальных перезагрузка
            # не трогает.
            _rs=0
            if engine_reload_clean; then
                for _ro in $(sub_outputs_using "$SUB"); do _rs=$((_rs + 1)); done
            fi
            json_add_int restarted "$_rs"
        else
            json_add_boolean changed 0
        fi
        json_add_int bytes "$(wc -c 2>/dev/null < "$SUB" || echo 0)"
        [ -n "$(sub_answer usable)" ] && json_add_int usable "$(sub_answer usable)"
        sub_userinfo_emit
        json_dump
        ;;

    sub_del)
        # Удалить подписку целиком: файл узлов, запомненный остаток и ключи uci.
        #
        # ЗАНЯТУЮ НЕ УДАЛЯЕМ. Выход читает файл узлов при подъёме, и снос файла под живым
        # выходом — это правило, которое ведёт в туннель без единого узла: маршрутизация
        # выглядит настроенной, а трафик не идёт никуда. Поэтому отказ со словами, чем она
        # занята, а не молчаливое удаление.
        read -r input
        json_load "$input" 2>/dev/null || fail_code req.unparsable "Unparsable request"
        json_get_var sub_name name
        [ -n "$sub_name" ] || fail_code sub.no_name "No subscription name given"
        sub_use "$sub_name"
        used="$(sub_used_by "$SUB")"
        [ "${used:-0}" = 0 ] || fail_code sub.in_use "The subscription is used by outputs: {outputs}" outputs "$used"
        rm -f "$SUB" "$SUB_INFO"
        if [ "$SUB_NAME" = main ]; then
            uci -q delete splify2.main.sub_url 2>/dev/null
            uci -q delete splify2.main.sub_kind 2>/dev/null
            uci -q delete splify2.main.sub_title 2>/dev/null
            uci -q delete splify2.main.sub_auto 2>/dev/null   # прежний ключ: до переезда расписания в плагин
        else
            uci -q delete "splify2.sub_$SUB_NAME" 2>/dev/null
        fi
        uci_commit
        json_init
        json_add_boolean ok 1
        json_add_string name "$SUB_NAME"
        json_dump
        ;;

    *) fail_code req.unknown_method "Unknown method" ;;
esac
