#!/bin/sh
# Часть объекта rpcd splify2 — подключается диспетчером /usr/libexec/rpcd/splify2 по имени
# метода (зачем файлов несколько — шапка m-xsteer.sh).
#
# СВОЙ ТУННЕЛЬ WireGuard ИЛИ AmneziaWG — ФАЙЛОМ ИЛИ ТЕКСТОМ, БЕЗ НАСТРОЕК СЕТИ РОУТЕРА.
#
# Прежде туннель надо было завести в сети роутера (интерфейс, пир, зона), и только потом назвать
# его устройство в выходе `kind: interface`. Ядро умеет больше: выход `kind: awg` заводит
# устройство само — из файла формата wg-quick/awg-quick, того самого, который человеку выдал
# сервер (steer, src/kinds/awg.c). Здесь — приём такого файла: проверка, закрытая запись туда,
# где его ищет ядро, перечень и удаление. Зону фаервола устройству ставит apply (fw_zone_sync
# знает вид awg), ключ `ipv6` — самолечение спеки.
#
# ВЫХОД В СПЕКУ ДОБАВЛЯЕТ ИНТЕРФЕЙС, А НЕ ЭТОТ МЕТОД. У спеки есть ревизия и черновик панели:
# правки человека лежат в браузере до «Сохранить», и запись спеки за спиной черновика кончилась
# бы отказом «спеку изменили» на следующем сохранении либо потерей правок. Метод кладёт файл и
# отвечает готовым выходом (`output`) — интерфейс добавляет его в черновик тем же путём, каким
# добавляет любой выход, и применяет вместе с правилом, которое в него ведёт.
#
# ПЛАГИН awg (допуск вида и модуль ядра Linux) ставит тоже интерфейс — заданием с ходом
# (plugin_install): установка модуля ядра из фида идёт десятки секунд, а этот метод отвечает
# сразу. Ответ говорит, стоит ли плагин (`plugin_ready`).
#
# СЕКРЕТЫ. В файле приватный ключ. Он не возвращается ни одним методом, не попадает в отказы
# (проверка называет номер строки и имя параметра, но не значение — так же делает ядро) и в
# журнал; каталог 0700, файлы 0600.

. "${PLUGIN_SH:-${SPLIFY2_LIBDIR:-/usr/lib/splify2}/plugin.sh}"

# Плагин awg стоит и включён — по state.json менеджера (как mods_present у протоколов).
awg_plugin_ready() {
    [ "$(plugin_state_of awg)" = enabled ]
}

# Выходы сохранённой спеки вида awg и их файлы: строки «ВЫХОД ПУТЬ». Имена — у ядра (`outputs
# --kind`), а не разбором JSON здесь: jshn отдаёт ключи с заменой знаков («my-tun» → «my_tun»), и
# выход с дефисом в имени не нашёлся бы. Путь — ключ `conf`, а без него умолчание ядра.
awg_outs() {
    spec_have || return 0
    _ao_j="$(spec_json)"
    for _ao_o in $("$STEER" outputs --kind awg --spec "$SPEC" 2>/dev/null); do
        _ao_c="$(jsonfilter -i "$_ao_j" -e "@.outputs['$_ao_o'].conf" 2>/dev/null)"
        printf '%s %s\n' "$_ao_o" "${_ao_c:-$AWG_DIR/$_ao_o.conf}"
    done
}

# Выходы из перечня awg_outs ($1), читающие файл $2, — через запятую.
awg_users() {  # ПЕРЕЧЕНЬ ПУТЬ
    _au=""
    while read -r _au_o _au_p; do
        [ "$_au_p" = "$2" ] && _au="${_au:+$_au, }$_au_o"
    done <<EOF
$1
EOF
    printf '%s' "$_au"
}

# Файл туннеля ИМЯ назван в спеке ФАЙЛ (JSON) — без ядра, по тексту: выход с этим именем вида awg
# без своего `conf` либо путь файла в любом ключе. Для применённой спеки (её снимок ядру не
# покажешь как текущую) и как вторая проверка сохранённой, когда ядро не ответило. Ошибается
# только в сторону «занят»: файл с ключом лучше не удалить, чем удалить из-под выхода.
awg_named_in() {  # ФАЙЛ_СПЕКИ ИМЯ
    [ -s "$1" ] || return 1
    grep -qF "\"$AWG_DIR/$2.conf\"" "$1" 2>/dev/null && return 0
    [ "$(jsonfilter -i "$1" -e "@.outputs['$2'].kind" 2>/dev/null)" = awg ] || return 1
    [ -z "$(jsonfilter -i "$1" -e "@.outputs['$2'].conf" 2>/dev/null)" ]
}

# Поля файла в текущий объект ответа: endpoint, addresses, amnezia, ipv6. Ключ `ipv6` — тем же
# правилом, что у самолечения спеки (v6_mode_of_dev): есть адрес IPv6 в Address — nat, нет — off.
awg_info_json() {  # ФАЙЛ
    _ai="$(awg_conf_info "$1")"
    json_add_string endpoint "$(printf '%s\n' "$_ai" | sed -n 's/^endpoint //p' | head -n 1)"
    json_add_array addresses
    for _ai_a in $(printf '%s\n' "$_ai" | sed -n 's/^addr //p'); do json_add_string "" "$_ai_a"; done
    json_close_array
    case "$_ai" in *"amnezia 1"*) json_add_boolean amnezia 1 ;; *) json_add_boolean amnezia 0 ;; esac
    AWG_V6="$(v6_mode_of_dev "" "" "$1")"
    json_add_string ipv6 "${AWG_V6:-off}"
}

case "$2" in

    awg_list)
        # Файлы туннелей и кто ими пользуется. Файл без выхода — не ошибка: человек убрал выход и
        # может вернуть его либо удалить файл (awg_del); интерфейс показывает такие отдельно.
        _al_outs="$(awg_outs)"
        _al_ready=0; awg_plugin_ready && _al_ready=1
        json_init
        json_add_boolean ok 1
        json_add_boolean plugin_ready "$_al_ready"
        json_add_string dir "$AWG_DIR"
        json_add_array tunnels
        for _al_f in "$AWG_DIR"/*.conf; do
            [ -f "$_al_f" ] || continue
            _al_n="${_al_f##*/}"; _al_n="${_al_n%.conf}"
            awg_name_ok "$_al_n" || continue
            json_add_object ""
            json_add_string name "$_al_n"
            json_add_string conf "$_al_f"
            awg_info_json "$_al_f"
            json_add_array outputs
            # Перечень считается ДО смены IFS: внутри подстановки read делил бы строки «ВЫХОД ПУТЬ» по запятой.
            _al_u="$(awg_users "$_al_outs" "$_al_f")"
            _al_old="$IFS"; IFS=','
            for _al_o in $_al_u; do
                json_add_string "" "${_al_o# }"
            done
            IFS="$_al_old"
            json_close_array
            json_close_object
        done
        json_close_array
        json_dump
        ;;

    awg_put)
        # Принять файл туннеля: {name, text, replace}. Имя — будущее имя выхода (файл называется по
        # нему).
        #
        # ФАЙЛ С ТЕМ ЖЕ ИМЕНЕМ ЗАМЕЩАЕТСЯ ТОЛЬКО ПО ПРОСЬБЕ (`replace: true`): так меняют настройку
        # туннеля, который уже в работе, — ядро кладёт новую поверх живого устройства при следующем
        # применении. Без просьбы — отказ awg.exists: второй туннель, добавленный под тем же именем
        # (имя подставляется из имени файла, а файлы у серверов зовутся одинаково — wg0.conf),
        # молча заменил бы ключи первого, и рабочий туннель ушёл бы на чужой сервер.
        read -r input
        json_load "$input" 2>/dev/null || fail_code req.unparsable "Unparsable request"
        json_get_var name name
        json_get_var text text
        json_get_var replace replace
        awg_name_ok "$name" || fail_code awg.bad_name "The tunnel name: letters, digits, _ - and a dot, up to 31 characters, not starting with a dot"
        [ -n "$text" ] || fail_code awg.need_text "The text of a WireGuard or AmneziaWG file is required"
        # Имя занято выходом ДРУГОГО вида (или словом ядра): выход awg с этим именем не добавить,
        # а файл остался бы без хозяина. Выход вида awg с этим именем — замена его файла, но только
        # когда выход читает файл по умолчанию: со своим `conf` он читает другой файл, и принятый
        # здесь лёг бы мимо — ответ «туннель заменён» был бы неправдой.
        case "$name" in direct|block) fail_code awg.name_taken "The name {name} is taken by another output. Choose another name." name "$name" ;; esac
        if spec_have; then
            _ap_k="$(jsonfilter -i "$(spec_json)" -e "@.outputs['$name'].kind" 2>/dev/null)"
            [ -z "$_ap_k" ] || [ "$_ap_k" = awg ] ||
                fail_code awg.name_taken "The name {name} is taken by another output. Choose another name." name "$name"
            _ap_c="$(jsonfilter -i "$(spec_json)" -e "@.outputs['$name'].conf" 2>/dev/null)"
            [ -z "$_ap_c" ] || [ "$_ap_c" = "$AWG_DIR/$name.conf" ] ||
                fail_code awg.name_taken "The name {name} is taken by another output. Choose another name." name "$name"
        fi
        case "$replace" in 1|true) ;; *)
            [ ! -e "$AWG_DIR/$name.conf" ] ||
                fail_code awg.exists "The tunnel {name} already exists. Choose another name." name "$name" ;;
        esac
        mkdir -p "$AWG_DIR" 2>/dev/null || fail_code awg.not_saved "The tunnel was not saved: no space left"
        # Права каталога — ЯВНО, а не от umask: внутри приватные ключи.
        chmod 0700 "$AWG_DIR" 2>/dev/null
        # Черновик — в том же каталоге (переименование на месте атомарно) и с точки: перечень
        # (awg_list) и архив такие имена не берут. \r убирается: файл из Windows иначе нёс бы его в
        # каждом значении, и ядро отвергло бы ключ «не base64».
        _ap_tmp="$AWG_DIR/.$name.new.$$"
        _ap_chk="$AWG_DIR/.$name.check.$$"
        ( umask 077; printf '%s\n' "$text" | tr -d '\r' > "$_ap_tmp" ) 2>/dev/null ||
            { rm -f "$_ap_tmp"; fail_code awg.not_saved "The tunnel was not saved: no space left"; }
        _ap_why="$(awg_conf_check "$_ap_tmp" "$name")" || { rm -f "$_ap_tmp"; fail "$_ap_why"; }
        # СУДЬЯ ЗНАЧЕНИЙ — ЯДРО. Отдельной команды проверки файла у него нет, зато `apply
        # --dry-run` читает файлы выходов awg и говорит о негодном предупреждением (awg_check_all).
        # Ему даётся спека из одного этого выхода, а не спека человека: вопрос — «годен ли файл», и
        # ответ не должен зависеть от того, что ещё лежит в настройках.
        #   - отказ с кодом spec.key_rejected — вида awg у ядра нет: не стоит плагин. Файл принят
        #     по форме (`checked: false`), ядро проверит его при применении, когда плагин встанет;
        #   - другой отказ с кодом — слова ядра человеку;
        #   - ядро не ответило вовсе (его нет) — тоже `checked: false`.
        _ap_checked=0
        _ap_ready=0; awg_plugin_ready && _ap_ready=1
        ( umask 077; printf '{"version":2,"outputs":{"direct":{"kind":"direct"},"%s":{"kind":"awg","conf":"%s"}}}\n' \
            "$name" "$_ap_tmp" > "$_ap_chk" ) 2>/dev/null
        _ap_out="$(STEER_ERR_JSON=1 "$STEER" apply --dry-run --spec "$_ap_chk" 2>&1 >/dev/null)"
        _ap_rc=$?
        rm -f "$_ap_chk"
        if [ "$_ap_rc" = 0 ]; then
            _ap_checked=1
            _ap_bad="$(printf '%s\n' "$_ap_out" | grep -F "awg: выход $name: " | head -n 1)"
            if [ -n "$_ap_bad" ]; then
                rm -f "$_ap_tmp"
                # Отказ чтения файла ядро начинает путём («ПУТЬ: причина»), а путь здесь — черновик
                # с номером процесса: человеку он ни о чём не говорит и после отказа не существует.
                _ap_r="${_ap_bad#*awg: выход "$name": }"
                case "$_ap_r" in "$_ap_tmp: "*) _ap_r="${_ap_r#"$_ap_tmp: "}" ;; esac
                fail_code awg.rejected "The tunnel file was not accepted: {reason}" reason "$_ap_r"
            fi
        elif s2_core_split "$_ap_out"; then
            case "$S2_CORE_CODE" in
                spec.key_rejected) _ap_ready=0 ;;
                *) rm -f "$_ap_tmp"; fail "$S2_CORE_TEXT" "$S2_CORE_CODE" "$S2_CORE_ARGS" ;;
            esac
        fi
        chmod 0600 "$_ap_tmp" 2>/dev/null
        mv -f "$_ap_tmp" "$AWG_DIR/$name.conf" ||
            { rm -f "$_ap_tmp"; fail_code awg.not_saved "The tunnel was not saved: no space left"; }
        json_init
        json_add_boolean ok 1
        json_add_string name "$name"
        json_add_string conf "$AWG_DIR/$name.conf"
        awg_info_json "$AWG_DIR/$name.conf"
        json_add_boolean checked "$_ap_checked"
        json_add_string plugin awg
        json_add_boolean plugin_ready "$_ap_ready"
        # Готовый выход для черновика спеки. `conf` не пишется: файл лежит там, где ядро ищет его
        # по имени выхода, и спека остаётся без путей. `on_fail: drop` — как у своего туннеля,
        # включённого переключателем: упавший туннель не выпускает трафик в открытую сеть.
        json_add_object output
        json_add_string kind awg
        json_add_string on_fail drop
        json_add_string ipv6 "${AWG_V6:-off}"
        json_close_object
        json_dump
        ;;

    awg_del)
        # Убрать файл туннеля — только когда его не читает ни один выход: ни сохранённой спеки
        # (выход остался бы без файла, и ядро отвергло бы применение), ни применённой (туннель ещё
        # работает, и следующая перенастройка устройства файла не нашла бы).
        read -r input
        json_load "$input" 2>/dev/null || fail_code req.unparsable "Unparsable request"
        json_get_var name name
        awg_name_ok "$name" || fail_code awg.bad_name "The tunnel name: letters, digits, _ - and a dot, up to 31 characters, not starting with a dot"
        _ad_f="$AWG_DIR/$name.conf"
        [ -f "$_ad_f" ] || fail_code awg.no_such "There is no tunnel {name}" name "$name"
        _ad_u="$(awg_users "$(awg_outs)" "$_ad_f")"
        if [ -z "$_ad_u" ] && spec_have && awg_named_in "$(spec_json)" "$name"; then _ad_u="$name"; fi
        [ -z "$_ad_u" ] ||
            fail_code awg.in_use "The tunnel {name} is used by outputs: {outputs}. Remove them first." name "$name" outputs "$_ad_u"
        awg_named_in "$APPLIED" "$name" &&
            fail_code awg.in_use_applied "The tunnel {name} is still in use by the applied settings. Apply the changes first." name "$name"
        rm -f "$_ad_f" || fail_code awg.not_removed "The tunnel {name} was not removed" name "$name"
        json_init
        json_add_boolean ok 1
        json_add_string name "$name"
        json_dump
        ;;

    *) fail_code req.unknown_method "Unknown method" ;;
esac
