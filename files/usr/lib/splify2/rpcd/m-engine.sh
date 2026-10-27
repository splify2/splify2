#!/bin/sh
# Часть объекта rpcd splify2 — подключается диспетчером /usr/libexec/rpcd/splify2 по имени
# метода. ЗАЧЕМ ФАЙЛОВ НЕСКОЛЬКО. busybox ash разбирает файл целиком, и объект в 4500 строк
# стоил 110 мс разбора на КАЖДЫЙ вызов — при том, что сам ответ считается за 30-90 мс.
# Диспетчер разбирает только себя, общие помощники (common.sh) и группу вызванного метода.
# Переменные и швы для стендов объявлены в диспетчере и здесь доступны как есть.

# Этой группе нужно скачивание (fetch.sh): подключается здесь, а не каждым вызовом объекта.
need_fetch

# Протоколы ядра — плагины, их ведёт менеджер ядра (`steer plugin …`); состояние и вызовы — в plugin.sh.
. "${PLUGIN_SH:-/usr/lib/splify2/plugin.sh}"

# Пакеты, выпуски, версии (общее с хостом): pkg-lib.sh.
. "${PKG_LIB_SH:-${RPCD_LIB:-/usr/lib/splify2/rpcd}/pkg-lib.sh}"

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
        # Версия САМОГО интерфейса (пакет splify2, прежде luci-app-splify2) — здесь, а не только в
        # splify2_versions: тот перед ответом идёт в сеть за перечнем выпусков, и там, где сети
        # нет, «Сейчас» в карточке интерфейса и подпись рельса ждали её десятки секунд (снято с
        # QEMU-стенда без DNS: 26 с на вызов). Установленный пакет — местное знание.
        ui_ver="$(pkg_version splify2)"
        [ -n "$ui_ver" ] || ui_ver="$(pkg_version luci-app-splify2)"
        if [ ! -x "$STEER" ]; then
            json_init
            json_add_boolean present 0
            json_add_string ui_version "$ui_ver"
            json_add_object update
            json_add_string url "$UPDATE_URL"
            json_add_string command "$UPDATE_CMD"
            json_close_object
            [ -n "$busy" ] && json_add_string busy "$busy"
            json_add_boolean vless 0
            json_add_boolean enabled "$svc_enabled"
            json_add_boolean running "$svc_running"
            json_dump
            exit 0
        fi
        # ПРОТОКОЛЫ ЯДРА 2.1 — плагины (STEER_MODULES): доступен включённый плагин. Состояние берётся
        # из state.json менеджера плагинов — так его видит и само ядро.
        mods="$(mods_present)"
        # VLESS — по плагину vless.
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
        json_add_object update
        json_add_string url "$UPDATE_URL"
        json_add_string command "$UPDATE_CMD"
        json_close_object
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
        # (splify2) — это сам этот скрипт и страница; к тому же снятие занимает
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
            fail_code purge.no_command "The removal command is missing: {path}" path "$PURGE_BIN"
        fi
        if [ "$pg_plan" = true ]; then
            pg_out="$(PURGE_MARK=1 "$PURGE_BIN" $pg_flag 2>&1)"
            json_add_boolean ok 1
            json_add_boolean plan 1
            json_add_boolean keep_config "$([ -n "$pg_flag" ] && echo 1 || echo 0)"
            json_add_array items
            pg_items="$(printf '%s\n' "$pg_out" | sed -n 's/^splify2-purge: @plan //p')"
            while IFS= read -r pg_l; do
                [ -n "$pg_l" ] && json_add_string "" "$pg_l"
            done <<EOF
$pg_items
EOF
            json_close_array
            json_add_array notes
            pg_notes="$(printf '%s\n' "$pg_out" | grep '^splify2-purge: ' | grep -v -e '^splify2-purge: @plan ' -e '^splify2-purge: @hint ' | sed 's/^splify2-purge: //')"
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
            # откажет из-за зависимостей. splify2 и steer — последними.
            pg_first=""; pg_last=""
            for pg_n in $pg_pkgs; do
                case "$pg_n" in splify2|luci-app-splify2|steer) pg_last="$pg_last $pg_n" ;; *) pg_first="$pg_first $pg_n" ;; esac
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
            s2_fail_fields core.busy "The core is busy: {by}" by "$BOX_BY"
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

    steer_modules)
        # ПРЕЖНЯЯ карточка модулей («Интерфейс»), теперь над менеджером плагинов: протоколы ядра 2.1 —
        # плагины, и шесть прежних имён показываются состоянием плагина. Форма ответа прежняя; новое —
        # state и why (состояние плагина и причина). Вкладка «Плагины» берёт всё из plugins_list; этот
        # метод — для старой карточки, пока интерфейс её не снял.
        PKGS="$(pkg_list)"
        spec_mods
        busy=""; box_busy && busy="$BOX_BY"
        _sm_rows=""
        for m in $STEER_MODULES; do
            _sm_inst=0; plugin_installed "$m" && _sm_inst=1
            _sm_rows="$_sm_rows$m|$_sm_inst|$(plugin_version_of "$m")|$(plugin_state_of "$m")|$(plugin_why_of "$m")
"
        done
        json_init
        json_add_string core "$(pkg_in steer-core)"
        [ -n "$busy" ] && json_add_string busy "$busy"
        json_add_array modules
        while IFS='|' read -r m _sm_inst _sm_ver _sm_st _sm_why; do
            [ -n "$m" ] || continue
            json_add_object ""
            json_add_string name "$m"
            json_add_boolean installed "$_sm_inst"
            [ -n "$_sm_ver" ] && [ "$_sm_inst" = 1 ] && json_add_string version "$_sm_ver"
            [ -n "$_sm_st" ] && json_add_string state "$_sm_st"
            [ -n "$_sm_why" ] && json_add_string why "$_sm_why"
            case " $SPEC_MODS " in
                *" $m "*) json_add_boolean needed 1; json_add_string outputs "$(spec_mod_outs "$m")" ;;
                *) json_add_boolean needed 0 ;;
            esac
            json_close_object
        done <<EOF
$_sm_rows
EOF
        json_close_array
        json_dump
        ;;

    steer_module_add|steer_module_del)
        # ПРЕЖНИЕ методы карточки модулей: поставить или снять плагин-протокол менеджером ядра.
        # Синхронно, как раньше; настоящий путь установки — plugin_install (задание с ходом).
        #
        # Снять плагин, который нужен спеке, нельзя: ядро отвергло бы её при следующем применении, а
        # выход его вида перестал бы работать уже сейчас. Отказ называет выходы. Менеджер проверяет это и
        # сам (remove без --force), здесь отказ раньше и теми же словами, что у карточки.
        read -r input
        m="$(jsonfilter -s "$input" -e '@.module' 2>/dev/null)"
        case " $STEER_MODULES " in *" $m "*) ;; *) fail_code module.unknown "Unknown module: {name}" name "$m" ;; esac
        [ -n "$m" ] || fail_code module.unknown "Unknown module: {name}" name "$m"
        box_busy && fail_code core.busy "The core is busy: {by}" by "$BOX_BY"
        if [ "$2" = steer_module_del ]; then
            spec_mods
            case " $SPEC_MODS " in
                *" $m "*) fail_code module.in_use "The module is used by outputs: {outputs}" outputs "$(spec_mod_outs "$m")" ;;
            esac
            if plugin_manager remove "$m"; then
                plugin_sync; plugin_sync_reload
                json_init; json_add_boolean ok 1; json_dump
            else
                plugin_manager_core
                fail "$(plugin_manager_error)" "$PLUGIN_ECODE" "$PLUGIN_EARGS"
            fi
            exit 0
        fi
        [ -n "$(pkg_version steer-core)" ] || fail_code core.not_installed "The steer core is not installed"
        if plugin_manager install "$m"; then
            plugin_sync; plugin_sync_reload
            json_init
            json_add_boolean ok 1
            json_add_string installed "$m $(plugin_version_of "$m")"
            json_dump
        else
            plugin_manager_core
            fail "$(plugin_manager_error)" "$PLUGIN_ECODE" "$PLUGIN_EARGS"
        fi
        ;;

    prefs_get)
        # Settings of the frame: which interface opens as the main page (`interface`: andromeda, basic or
        # the id of an interface plugin), the language of the frame (LuCI language, "auto" - the browser's).
        # Without a saved choice the interface is Andromeda while its bundle is in the package, else basic.
        _pg_if="$(uci -q get splify2.main.interface 2>/dev/null)"
        _pg_has=0; [ -s "${ANDROMEDA_MARK:-/www/luci-static/resources/splify2/build-id.txt}" ] && _pg_has=1
        _pg_set=1
        if [ -z "$_pg_if" ]; then
            _pg_set=0
            if [ "$_pg_has" = 1 ]; then _pg_if=andromeda; else _pg_if=basic; fi
        fi
        _pg_lang="$(uci -q get luci.main.lang 2>/dev/null)"
        json_init
        json_add_boolean ok 1
        json_add_string interface "$_pg_if"
        json_add_boolean interface_set "$_pg_set"
        json_add_boolean andromeda "$_pg_has"
        json_add_string lang "${_pg_lang:-auto}"
        json_dump
        ;;

    prefs_set)
        read -r input
        json_load "$input" 2>/dev/null || fail_code req.unparsable "Unparsable request"
        json_get_var _ps_if interface
        case "$_ps_if" in
            ''|*[!a-z0-9-]*) fail_code prefs.bad_interface "The interface must be a lowercase id: basic, andromeda or an interface plugin" ;;
        esac
        uci_file || fail_code disk.cannot_create "Cannot create {file}: no space left" file "$UCI_SPLIFY2"
        uci -q set splify2.main.interface="$_ps_if" || fail_code prefs.not_saved "Cannot save the setting"
        uci_commit
        json_init; json_add_boolean ok 1; json_add_string interface "$_ps_if"; json_dump
        ;;

    i18n_get)
        # Dictionaries of the frame for a language: every enabled plugin may carry i18n/core/<lang>.json
        # (flat "English text" -> translation, {name} substitutions, plural forms as an object). They are
        # returned as an array in plugin order; a later one overrides an earlier one in the browser.
        read -r input
        json_load "$input" 2>/dev/null || fail_code req.unparsable "Unparsable request"
        json_get_var _il lang
        case "$_il" in
            [a-z][a-z]|[a-z][a-z][a-z]|[a-z][a-z]-[A-Za-z0-9]*|[a-z][a-z][a-z]-[A-Za-z0-9]*) ;;
            *) fail_code i18n.bad_lang "Expected a language code such as en or pt-BR" ;;
        esac
        case "$_il" in *[!A-Za-z0-9-]*) fail_code i18n.bad_lang "Expected a language code such as en or pt-BR" ;; esac
        _il_out=""
        for _il_d in "${PLUGIN_ROOT:-/usr/lib/steer/plugins}"/*/i18n/core/"$_il".json; do
            [ -r "$_il_d" ] || continue
            _il_id="${_il_d%/i18n/core/*}"; _il_id="${_il_id##*/}"
            [ "$(plugin_state_of "$_il_id")" = enabled ] || continue
            _il_t="$(cat "$_il_d")"
            [ -n "$(jsonfilter -s "$_il_t" -e '@' 2>/dev/null)" ] || continue
            _il_out="${_il_out:+$_il_out,}{\"plugin\":\"$_il_id\",\"dict\":$_il_t}"
        done
        printf '{"ok":true,"lang":"%s","dicts":[%s]}\n' "$_il" "$_il_out"
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
        uci_file || fail_code disk.cannot_create "Cannot create {file}: no space left" file "$UCI_SPLIFY2"
        uci -q get splify2.main >/dev/null 2>&1 || uci -q set splify2.main=splify2
        if [ "$2" = ui_set ]; then
            read -r input
            json_load "$input" 2>/dev/null || fail_code req.unparsable "Unparsable request"
            json_get_var state state
            # Память мастера — несколько отметок и имён, а не хранилище: без предела туда можно
            # положить сколько угодно в настройку роутера (I-329). Отказ называет число.
            _sz="$(printf '%s' "$state" | wc -c)"
            [ "$_sz" -le "$UI_STATE_MAX" ] ||
                fail_code ui.state_too_big "The interface memory is larger than {max} KB: {size} bytes" max "$((UI_STATE_MAX / 1024))" size "$_sz"
            uci -q set splify2.main.wizard="$state" || fail_code ui.state_not_saved "Cannot save the interface memory"
            uci_commit
            json_init; json_add_boolean ok 1; json_dump
        else
            json_init
            json_add_string state "$(uci -q get splify2.main.wizard)"
            json_dump
        fi
        ;;

    *) fail_code req.unknown_method "Unknown method" ;;
esac
