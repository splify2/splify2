#!/bin/sh
# Часть объекта rpcd splify2 — подключается диспетчером /usr/libexec/rpcd/splify2 по имени
# метода. ЗАЧЕМ ФАЙЛОВ НЕСКОЛЬКО. busybox ash разбирает файл целиком, и объект в 4500 строк
# стоил 110 мс разбора на КАЖДЫЙ вызов — при том, что сам ответ считается за 30-90 мс.
# Диспетчер разбирает только себя, общие помощники (common.sh) и группу вызванного метода.
# Переменные и швы для стендов объявлены в диспетчере и здесь доступны как есть.


# Отпечатков выбора узла и обфускатора здесь больше нет: помощников выходов держит демон
# движка, и он сам перезапускает того, у кого изменились параметры выхода или файл подписки.

fw_note() {  # СТРОКА
    mkdir -p "$(dirname "$FW_OWNED")" 2>/dev/null
    grep -qxF "$1" "$FW_OWNED" 2>/dev/null || printf '%s\n' "$1" >> "$FW_OWNED"
}

fw_noted() { grep -qxF "$1" "$FW_OWNED" 2>/dev/null; }

fw_unnote() {  # СТРОКА
    [ -f "$FW_OWNED" ] || return 0
    grep -vxF "$1" "$FW_OWNED" > "$FW_OWNED.tmp" 2>/dev/null
    mv "$FW_OWNED.tmp" "$FW_OWNED" 2>/dev/null || rm -f "$FW_OWNED.tmp"
}

# СЕКЦИИ ФАЕРВОЛА ПО ИДЕНТИФИКАТОРУ, А НЕ ПО НОМЕРУ. Безымянную секцию uci зовёт «@zone[N]»,
# именованную («config zone 'ts'») — её именем, и обращаться к обеим можно одинаково:
# firewall.<ид>.<опция>. Прежде здесь искалось только «@zone[N]» — и зона, заведённая
# именованной секцией (так её пишут руками по руководствам к Tailscale и ZeroTier), для нас не
# существовала: устройство клиентов из неё считалось ничьим, проброс к туннелю не заводился, и
# «выбрал tailscale0, применил, не заработало» оставалось в силе после H-206. Тип секции
# проверяется отдельно: имя «ts» может носить и правило (`config rule` с option name), а
# устройство лежит только в зоне.
fw_sections() {  # ТИП -> идентификаторы секций этого типа, по одному в строке
    uci show firewall 2>/dev/null | sed -n "s/^firewall\.\([^.=]*\)=$1$/\1/p"
}

zone_index() {  # ИМЯ_ЗОНЫ -> идентификатор секции
    fw_sections zone | while IFS= read -r _zi_s; do
        [ "$(uci -q get "firewall.$_zi_s.name" 2>/dev/null)" = "$1" ] && { printf '%s' "$_zi_s"; return 0; }
    done
}

# В какой зоне устройство лежит ПРЯМО, списком `device`. Пусто — ни в какой такой.
#
# Нужно потому, что устройство в ДВУХ зонах fw4 не прощает, а устройство выхода kind=interface
# человек мог назначить в зону сам — страница интерфейса в LuCI это предлагает. Молча добавив
# его во вторую, мы получили бы отказ перезагрузки правил и неработающий фаервол целиком.
#
# ЭТО ТОЛЬКО ПОЛОВИНА ОТВЕТА. LuCI называет в зоне не устройство, а интерфейс (`list network`),
# и решения о зоне устройства принимает fw_zone_id_of_dev, которая спрашивает и это.
fw_zone_of_device() {  # ИМЯ_УСТРОЙСТВА -> идентификатор секции зоны
    fw_sections zone | while IFS= read -r _fzd_s; do
        for _fzd_d in $(uci -q get "firewall.$_fzd_s.device" 2>/dev/null); do
            [ "$_fzd_d" = "$1" ] && { printf '%s' "$_fzd_s"; return 0; }
        done
    done
}

fw_zone_devices() {  # ИДЕНТИФИКАТОР_СЕКЦИИ
    uci -q get "firewall.$1.device" 2>/dev/null | tr ' ' '\n' | grep . | sort -u
}

# ЗОНЫ, В КОТОРЫХ ЛЕЖАТ УСТРОЙСТВА КЛИЕНТОВ из спеки (lan_devices; одиночная lan_device и
# отсутствие поля значат br-lan). Устройство входит в зону либо напрямую (`list device`), либо
# через сетевой интерфейс (`list network`, а у интерфейса `option device`) — у Tailscale и
# ZeroTier по руководствам встречаются оба способа, поэтому спрашиваются оба. Имена зон — по
# одному в строке, без повторов.
# Устройства, которые спека называет клиентами. Отдельной функцией, потому что спрашивают о
# них двое: перечень зон для пробросов (fw_client_zones) и перечень БЕЗЗОННЫХ устройств, для
# которых зону заводим мы (fw_client_devices_unzoned). Два списка, выведенных по-разному, рано
# или поздно разошлись бы ровно на том устройстве, из-за которого всё и заводилось.
fw_client_devices() {
    _fcd="$(jsonfilter -i "$(spec_json)" -e '@.lan.devices[*]' -e '@.lan_devices[*]' 2>/dev/null)"
    [ -n "$_fcd" ] || _fcd="$(jsonfilter -i "$(spec_json)" -e '@.lan_device' 2>/dev/null)"
    [ -n "$_fcd" ] || _fcd="br-lan"
    printf '%s\n' $_fcd | grep . | sort -u
}

# Логические интерфейсы netifd, которым принадлежит устройство. По одному в строке.
#
# Имя интерфейса и имя устройства — разные вещи, и фаервол называет в зоне то и другое:
# `list device` — устройство, `list network` — интерфейс. Устройство интерфейса — его опция
# `device` (прежде `ifname`), а у туннелей WireGuard и AmneziaWG опции нет: устройство называется
# так же, как интерфейс (`wg0`). Оба случая — из настройки сети (`uci show network`, без процесса
# на интерфейс). Имя, которое netifd выводит сам и которого в настройке нет (`pptp-vpn`, `6in4-he`),
# спрашивается у netifd (`ubus call network.interface dump`, NET_DUMP — его ответ, загруженный
# net_dump_load один раз на запрос), и только если настройка устройство не назвала.
net_ifaces_of_dev() {  # ИМЯ_УСТРОЙСТВА
    _nd_r="$(uci -q show network 2>/dev/null | awk -v dev="$1" '
        {
            eq = index($0, "=")
            if (!eq) next
            key = substr($0, 1, eq - 1); val = substr($0, eq + 1)
            n = split(key, p, ".")
            if (p[1] != "network" || p[2] ~ /^@/) next
            if (n == 2) { if (val == "interface" && !(p[2] in isif)) { isif[p[2]] = 1; sec[++ns] = p[2] } next }
            if (n != 3 || (p[3] != "device" && p[3] != "ifname")) next
            gsub("\047", "", val)
            nt = split(val, t, " ")
            for (i = 1; i <= nt; i++) { named[p[2]] = 1; if (t[i] == dev) hit[p[2]] = 1 }
        }
        END { for (k = 1; k <= ns; k++) if (hit[sec[k]] || (!named[sec[k]] && sec[k] == dev)) print sec[k] }')"
    if [ -z "$_nd_r" ] && [ -n "${NET_DUMP:-}" ]; then
        # Имя уходит в запрос jsonfilter, поэтому только то, что устройством быть может.
        case "$1" in
            ''|*[!A-Za-z0-9_.:@-]*) ;;
            *) _nd_r="$(printf '%s' "$NET_DUMP" | jsonfilter -e "@.interface[@.l3_device='$1'].interface" \
                    -e "@.interface[@.device='$1'].interface" 2>/dev/null)" ;;
        esac
    fi
    printf '%s\n' "$_nd_r" | awk 'NF && !seen[$0]++'
}

# Ответ netifd о логических интерфейсах — один раз на запрос (apply, spec_heal), ДО подоболочек: то,
# что загрузила подоболочка, до вызывающего не доезжает. Недоступен netifd — NET_DUMP пуст, и
# net_ifaces_of_dev обходится настройкой.
net_dump_load() {
    NET_DUMP="$(ubus -t 3 call network.interface dump 2>/dev/null)" || NET_DUMP=""
}

# Зона устройства — своя или через логический интерфейс. Пусто = зоны нет вовсе.
#
# ДВА СПОСОБА, А НЕ ОДИН, и второй не для красоты: зона `lan` перечисляет не устройства, а
# СЕТИ (`list network 'lan'`), поэтому поиск только по `device` объявил бы br-lan беззонным —
# и мы завели бы ему вторую зону рядом с той, в которой он и так лежит. Так пишет зоны и LuCI
# («Настройки фаервола» на странице интерфейса — это `list network`), так что то же верно для
# каждого туннеля, который человек положил в свою зону: прежде выходы (fw_zone_sync, лечение
# ipv6) спрашивали только `device` и принимали такое устройство за ничьё — добавляли его и во
# вторую зону, нашу, и писали ему ключ, хотя «чужой пакет — чужая настройка». Спрашивают оба:
# клиенты и выходы.
fw_zone_id_of_dev() {  # ИМЯ_УСТРОЙСТВА -> идентификатор секции зоны или пусто
    _fzc_i="$(fw_zone_of_device "$1")"
    if [ -z "$_fzc_i" ]; then
        for _fzc_n in $(net_ifaces_of_dev "$1"); do
            _fzc_i="$(fw_zone_of_network "$_fzc_n")"
            [ -n "$_fzc_i" ] && break
        done
    fi
    printf '%s' "$_fzc_i"
}

fw_client_zones() {
    for _fcz_d in $(fw_client_devices); do
        _fcz_i="$(fw_zone_id_of_dev "$_fcz_d")"
        [ -n "$_fcz_i" ] && uci -q get "firewall.$_fcz_i.name" 2>/dev/null
    done | grep . | sort -u
}

# Устройства клиентов, у которых зоны фаервола НЕТ ВООБЩЕ.
#
# ЗАЧЕМ ИМ НУЖНА ЗОНА, и это не про удобство. Интерфейс, не входящий ни в одну зону, fw4
# роняет дважды: `forward` — значит маршрутизации через нас нет совсем, и `input` — значит до
# самого роутера с него не доходит ничего. Второе бьёт по DNS: заворот `udp dport 53 → :5300`
# делает DNAT на адрес самого роутера, дальше пакет идёт через `input`, и без зоны он там и
# кончается. Снаружи это «выбрал tailscale0 в клиентах — правила стоят, а DNS не подхватывает».
#
# Так живут ровно те интерфейсы, из-за которых перечень клиентов и появился: `tailscale0` и
# интерфейс сервера WireGuard, заведённый мастером OpenWrt, — оба поднимаются без зоны, а
# руководства предлагают дописать её самому.
#
# УСЛОВИЕ РОВНО ОДНО: своей зоны нет. Устройство, которое человек положил в свою зону (хоть в
# `lan`, хоть в `ts` по руководству к Tailscale), мы не трогаем вовсе — ему нужен только
# проброс, и его заводит fw_client_zones выше.
# НАША СОБСТВЕННАЯ ЗОНА «СВОЕЙ ЗОНОЙ» НЕ СЧИТАЕТСЯ, и поэтому имя её здесь аргументом.
# Иначе выходило так: первое применение заводит зону и кладёт в неё tailscale0, второе видит
# устройство «устроенным», список беззонных пустеет — и та же самая зона снимается вместе с
# пробросами. Зона моргала бы через раз, а с ней и связность у клиентов. Поймано стендом.
fw_client_devices_unzoned() {  # ИМЯ_НАШЕЙ_ЗОНЫ
    for _fcu_d in $(fw_client_devices); do
        _fcu_i="$(fw_zone_id_of_dev "$_fcu_d")"
        [ -n "$_fcu_i" ] || { printf '%s\n' "$_fcu_d"; continue; }
        [ "$(uci -q get "firewall.$_fcu_i.name" 2>/dev/null)" = "$1" ] && printf '%s\n' "$_fcu_d"
    done | grep . | sort -u
}

fw_zone_of_network() {  # ИМЯ_ИНТЕРФЕЙСА -> идентификатор зоны, в чей список network он входит
    fw_sections zone | while IFS= read -r _fzn_s; do
        for _fzn_w in $(uci -q get "firewall.$_fzn_s.network" 2>/dev/null); do
            [ "$_fzn_w" = "$1" ] && { printf '%s' "$_fzn_s"; return 0; }
        done
    done
}

fw_forwardings_to() {  # ЗОНА-ПОЛУЧАТЕЛЬ -> идентификаторы секций проброса в неё, по одной в строке
    fw_sections forwarding | while IFS= read -r _fft_s; do
        [ "$(uci -q get "firewall.$_fft_s.dest" 2>/dev/null)" = "$1" ] && printf '%s\n' "$_fft_s"
    done
}

# Пробросы, у которых зона ИСТОЧНИК. Нужны при удалении зоны клиентов: из неё пробрасывают в
# wan и в зоны туннелей, и forwarding, чей `src` указывает на удалённую зону, fw4 при
# перезагрузке отвергает — то есть роутер остаётся без фаервола целиком. Тот же довод, по
# которому пробросы В зону снимаются раньше самой зоны.
fw_forwardings_from() {  # ЗОНА-ИСТОЧНИК -> идентификаторы секций проброса из неё
    fw_sections forwarding | while IFS= read -r _ffm_s; do
        [ "$(uci -q get "firewall.$_ffm_s.src" 2>/dev/null)" = "$1" ] && printf '%s\n' "$_ffm_s"
    done
}
fw_forwarding_id() {  # SRC DEST -> идентификатор секции проброса или пусто
    fw_forwardings_to "$2" | while IFS= read -r _ffi_f; do
        [ "$(uci -q get "firewall.$_ffi_f.src" 2>/dev/null)" = "$1" ] && { printf '%s' "$_ffi_f"; return 0; }
    done
}

# Принять существующую зону за свою, если отличить её от нашей нельзя.
#
# Зоны steer_vless и steer_iface (теперь слиты в steer_zone, см. fw_zone_migrate) заводились и прежними версиями, когда расписок ещё не было. Без принятия она
# навсегда осталась бы «чужой» и перестала бы убираться вместе с последним туннельным выходом —
# ровно та накопительная беда, от которой и просили избавить.
#
# Условие строгое: в зоне нет НИ ОДНОГО устройства, которого мы не завели бы сами. Есть
# постороннее — значит зону правили руками, и она чужая: дополняем, но не чистим и не удаляем.
fw_adopt_if_ours() {  # ЗОНА ИНДЕКС СПИСОК_НУЖНЫХ
    fw_noted "zone $1" && return 0
    for d in $(fw_zone_devices "$2"); do
        printf '%s\n' "$3" | grep -qx "$d" || return 1
    done
    fw_note "zone $1"
    for d in $(fw_zone_devices "$2"); do fw_note "dev $1 $d"; done
    return 0
}

# Одна зона: создать, дополнить, убрать ушедшее, удалить саму зону, когда её устройств не
# осталось. Удаляет ТОЛЬКО записанное за нами. Печатает, что сделала; код 1 — изменения были.
fw_zone_sync() {  # ЗОНА ВИДЫ MASQ
    _z="$1"; _kinds="$2"; _masq="$3"
    # `clients` — не вид выхода, а единственная зона, которую мы заводим не для туннеля, а для
    # устройств КЛИЕНТОВ без своей зоны (см. fw_client_devices_unzoned). Отдельной веткой здесь,
    # а не отдельной функцией рядом: всё остальное — отсев чужих устройств, расписка, порядок
    # «сначала пробросы, потом зона» — у неё то же самое, и вторая копия этого разошлась бы.
    if [ "$_kinds" = clients ]; then
        want="$(fw_client_devices_unzoned "$_z")"
    else
        want="$(fw_devices_of "$_kinds")"
    fi
    idx="$(zone_index "$_z")"
    changed=0
    msg=""
    skipped=""

    # Устройства, которым зона УЖЕ назначена человеком, отсеиваются здесь — до решения
    # создавать нашу. Иначе на роутере, где все туннели человек развёл по своим зонам,
    # оставалась бы пустая зона с пробросом в неё: мусор, который выглядит как недоделка.
    #
    # Отсев именно тут, а не при добавлении: там мы бы уже создали зону, а отменять
    # созданное — лишний путь, на котором легко оставить половину.
    #
    # ЗОНА УСТРОЙСТВА — ПО `device` И ПО `network` (fw_zone_id_of_dev). LuCI кладёт туннель в зону
    # списком network, и поиск одним `device` считал такое устройство ничьим: мы дописывали его и во
    # вторую зону, нашу, — устройство в двух зонах fw4 не прощает, — а чужая настройка (зона человека
    # со своим NAT и пробросами) оказывалась под нашей.
    if [ -n "$want" ]; then
        _keep=""
        for d in $want; do
            other="$(fw_zone_id_of_dev "$d")"
            if [ -n "$other" ] && { [ -z "$idx" ] || [ "$other" != "$idx" ]; }; then
                skipped="$skipped $d"
                continue
            fi
            _keep="$_keep$d
"
        done
        want="$(printf '%s' "$_keep" | grep . | sort -u)"
    fi
    # Говорится СРАЗУ, а не в конце: после отсева зона может оказаться ненужной вовсе, и
    # тогда работа кончится раньше, а человек так и не узнает, почему его туннель в нашу
    # зону не попал. Молчание здесь читается как «сделали и не помогло».
    [ -n "$skipped" ] &&
        echo "$(s2_t fw.devices_skipped "Devices{devices} are already in their own firewall zones and were left as they are" devices "$skipped")"

    if [ -z "$want" ]; then
        [ -n "$idx" ] || { fw_unnote "zone $_z"; return 0; }
        fw_adopt_if_ours "$_z" "$idx" "" || return 0
        # Сначала правила проброса на зону, потом сама зона: удалив зону первой, мы оставили бы
        # forwarding, ссылающийся в пустоту, и fw4 отказался бы перезагружаться.
        # Пробросы В зону и ИЗ зоны — оба: у зоны туннелей вторых не бывает вовсе, а у зоны
        # клиентов не бывает первых, и оставленный проброс с `src` на удалённую зону роняет
        # перезагрузку фаервола так же надёжно, как оставленный `dest`.
        while :; do
            f="$( { fw_forwardings_to "$_z"; fw_forwardings_from "$_z"; } | head -1)"
            [ -n "$f" ] || break
            uci -q delete "firewall.$f" || break
            fw_unnote "fwd wan $_z"
            changed=1
        done
        for d in $(fw_zone_devices "$idx"); do fw_unnote "dev $_z $d"; done
        uci -q delete "firewall.$idx" && changed=1
        if [ "$changed" = 1 ]; then
            uci -q commit firewall
            fw_unnote "zone $_z"
            echo "$(s2_t fw.zone_removed "Zone {zone} removed: no outputs with such devices are left in the spec" zone "$_z")"
        fi
        return "$changed"
    fi

    if [ -z "$idx" ]; then
        uci -q add firewall zone >/dev/null
        uci -q set firewall.@zone[-1].name="$_z"
        # input REJECT: зона нужна для транзита, а не для доступа к самому роутеру со стороны
        # туннеля. forward ACCEPT — иначе смысла в ней нет.
        #
        # У ЗОНЫ КЛИЕНТОВ input ACCEPT, И ЭТО ГЛАВНОЕ ЕЁ ОТЛИЧИЕ. С той стороны к роутеру
        # обращаются законно, и в первую очередь за именами: заворот DNS делает DNAT на адрес
        # самого роутера, дальше пакет идёт через `input`, и при REJECT там и кончается. Зона с
        # REJECT дала бы маршрутизацию без разрешения имён — то есть половину работы, которую
        # снаружи не отличить от полной поломки.
        if [ "$_kinds" = clients ]; then
            uci -q set firewall.@zone[-1].input='ACCEPT'
        else
            uci -q set firewall.@zone[-1].input='REJECT'
        fi
        uci -q set firewall.@zone[-1].output='ACCEPT'
        uci -q set firewall.@zone[-1].forward='ACCEPT'
        uci -q set firewall.@zone[-1].masq="$_masq"
        uci -q set firewall.@zone[-1].mtu_fix='1'
        idx="$(zone_index "$_z")"
        [ -n "$idx" ] || return 0
        fw_note "zone $_z"
        changed=1
        msg="$(s2_t fw.zone_created "Zone {zone} created" zone "$_z")"
    else
        fw_adopt_if_ours "$_z" "$idx" "$want" || true
    fi

    have="$(fw_zone_devices "$idx")"
    added=""
    for d in $want; do
        printf '%s\n' "$have" | grep -qx "$d" && continue
        uci -q add_list "firewall.$idx.device"="$d"
        fw_note "dev $_z $d"
        added="$added $d"
        changed=1
    done

    # Убираем только записанное за нами: устройство, положенное в эту зону руками, спека не
    # описывает и описывать не должна — вынести его значило бы поломать чужую настройку молча.
    removed=""
    for d in $have; do
        printf '%s\n' "$want" | grep -qx "$d" && continue
        fw_noted "dev $_z $d" || continue
        uci -q del_list "firewall.$idx.device"="$d"
        fw_unnote "dev $_z $d"
        removed="$removed $d"
        changed=1
    done

    # У ЗОНЫ КЛИЕНТОВ ПРОБРОСЫ СМОТРЯТ В ДРУГУЮ СТОРОНУ, и дальше её ветка отдельная.
    #
    # Зона туннеля — получатель: в неё пробрасывают из lan и из зон клиентов. Зона клиентов —
    # источник: из неё пробрасывают в зоны туннелей (это делает блок ниже при синхронизации
    # каждой из них — устройства-то теперь в зоне, и fw_client_zones её называет) и в `wan`.
    #
    # ЗАЧЕМ ИМЕННО `wan`. Правило канала забирает то, что названо в спеке; всё прочее у этих
    # клиентов идёт «напрямую», то есть в интернет через wan. Без этого проброса заведение зоны
    # сделало бы хуже, чем было: адресованное туннелю заработало бы, а всё остальное с того же
    # интерфейса продолжало бы молча падать — и объяснить разницу человеку было бы нечем.
    #
    # Обратного проброса (`lan -> зона клиентов`) мы не заводим: он открыл бы локальной сети
    # доступ к пирам чужого туннеля, а об этом нас никто не просил.
    if [ "$_kinds" = clients ]; then
        [ -n "$(fw_forwarding_id "$_z" wan)" ] || {
            uci -q add firewall forwarding >/dev/null
            uci -q set firewall.@forwarding[-1].src="$_z"
            uci -q set firewall.@forwarding[-1].dest='wan'
            fw_note "fwd wan $_z"
            changed=1
            msg="$(s2_t fw.fwd_wan_added "{prefix}forwarding {zone} -> wan added" prefix "${msg:+$msg, }" zone "$_z")"
        }
    else
        # Разрешение lan -> зона. Без него зона есть, а трафик всё равно не идёт: политика forward
        # у fw4 применяется к паре зон, а не к одной.
        [ -n "$(fw_forwardings_to "$_z")" ] || {
            uci -q add firewall forwarding >/dev/null
            uci -q set firewall.@forwarding[-1].src='lan'
            uci -q set firewall.@forwarding[-1].dest="$_z"
            changed=1
            msg="$(s2_t fw.fwd_lan_added "{prefix}forwarding lan -> {zone} added" prefix "${msg:+$msg, }" zone "$_z")"
        }

        # ПРОБРОС ИЗ ЗОН УСТРОЙСТВ КЛИЕНТОВ. Спека может назвать интерфейс из другой зоны — tailscale0
        # в своей зоне ts по руководствам: движок помечает пакет (iifname), маршрут ведёт в туннель,
        # а forward-цепочка fw4 его отбрасывает, потому что пары «ts -> зона туннелей» никто не
        # заводил. Так и пришло первое обращение по Андромеде: «выбираю tailscale0, проксирование не
        # взлетает». Устройства в спеке выбираем мы — значит и проброс из их зон наша забота. С
        # расписки: убирается, когда устройств из этой зоны в спеке больше нет; чужие пробросы (без
        # расписки) не трогаются. lan пробрасывается выше и всегда; зона туннеля сама в себя — нет.
        _cz_want="$(fw_client_zones)"
        for _cz in $_cz_want; do
            [ "$_cz" = lan ] && continue
            [ "$_cz" = "$_z" ] && continue
            [ -n "$(fw_forwarding_id "$_cz" "$_z")" ] && continue
            uci -q add firewall forwarding >/dev/null
            uci -q set firewall.@forwarding[-1].src="$_cz"
            uci -q set firewall.@forwarding[-1].dest="$_z"
            fw_note "fwd $_z $_cz"
            changed=1
            msg="$(s2_t fw.fwd_clients_added "{prefix}forwarding {from} -> {zone} added (zone {from} holds client devices)" prefix "${msg:+$msg, }" from "$_cz" zone "$_z")"
        done
        for _cz in $(sed -n "s/^fwd $_z //p" "$FW_OWNED" 2>/dev/null); do
            printf '%s\n' "$_cz_want" | grep -qx "$_cz" && continue
            _f="$(fw_forwarding_id "$_cz" "$_z")"
            [ -n "$_f" ] && uci -q delete "firewall.$_f" && changed=1
            fw_unnote "fwd $_z $_cz"
            msg="$(s2_t fw.fwd_clients_removed "{prefix}forwarding {from} -> {zone} removed: zone {from} holds no client devices any more" prefix "${msg:+$msg, }" from "$_cz" zone "$_z")"
        done
    fi

    if [ "$changed" = 1 ]; then
        uci -q commit firewall
        [ -n "$added" ] && msg="$(s2_t fw.devices_added "{prefix}devices added:{devices}" prefix "${msg:+$msg, }" devices "$added")"
        [ -n "$removed" ] && msg="$(s2_t fw.devices_removed "{prefix}departed devices removed:{devices}" prefix "${msg:+$msg, }" devices "$removed")"
        fw_noted "zone $_z" || msg="$(s2_t fw.zone_foreign "{msg} (zone {zone} is not ours: we only add to it and remove nothing)" msg "$msg" zone "$_z")"
        echo "$msg"
    fi
    return "$changed"
}

# Зоны прежних версий, слитые в steer_zone: steer_vless (masq 0) и steer_iface (masq 1).
FW_LEGACY_ZONES="${FW_LEGACY_ZONES:-steer_vless steer_iface}"

# МИГРАЦИЯ ПРЕЖНИХ ЗОН. Заведённые нами steer_vless и steer_iface убираются вместе с пробросами и
# расписками РАНЬШЕ, чем синхронизируется steer_zone: устройство в двух зонах fw4 не прощает, а
# fw_zone_sync оставил бы устройство в прежней зоне как «уже в своей». Зона с тем же именем, которой
# мы не заводили (есть устройство, не названное в спеке и без расписки), — зона человека: её не
# трогаем, а устройства из неё нашими не считаем — дальше о ней просто не заботимся.
# Печатает, что сделала; код 1 — изменения были (нужна перезагрузка fw4).
fw_zone_migrate() {
    _zm_any=0
    _zm_all="$(fw_devices_of vless,hysteria2,trojan,shadowsocks,socks,http,vmess,xsteer,warp-masque,interface,awg)"
    for _zm_z in $FW_LEGACY_ZONES; do
        _zm_i="$(zone_index "$_zm_z")"
        if [ -z "$_zm_i" ]; then
            # Зоны нет — расписки о ней устарели, чтобы не висели.
            fw_noted "zone $_zm_z" && fw_forget_zone "$_zm_z"
            continue
        fi
        fw_adopt_if_ours "$_zm_z" "$_zm_i" "$_zm_all" || true
        fw_noted "zone $_zm_z" || continue
        # Сначала пробросы (в зону и из неё), потом зона: проброс на несуществующую зону fw4 отвергает.
        while :; do
            _zm_f="$( { fw_forwardings_to "$_zm_z"; fw_forwardings_from "$_zm_z"; } | head -1)"
            [ -n "$_zm_f" ] || break
            uci -q delete "firewall.$_zm_f" || break
        done
        _zm_i="$(zone_index "$_zm_z")"
        [ -n "$_zm_i" ] && uci -q delete "firewall.$_zm_i"
        uci -q commit firewall
        fw_forget_zone "$_zm_z"
        _zm_any=1
        echo "$(s2_t fw.zone_dropped "Zone {zone} removed: the outputs are now in the zone steer_zone" zone "$_zm_z")"
    done
    return "$_zm_any"
}

# Вычеркнуть из расписки всё, что относится к зоне: саму зону, её устройства и пробросы.
fw_forget_zone() {  # ЗОНА
    [ -f "$FW_OWNED" ] || return 0
    grep -vE "^(zone $1|dev $1 .*|fwd $1 .*|fwd wan $1)\$" "$FW_OWNED" > "$FW_OWNED.tmp" 2>/dev/null
    mv "$FW_OWNED.tmp" "$FW_OWNED" 2>/dev/null || rm -f "$FW_OWNED.tmp"
}

# Привести фаервол в соответствие со спекой. Перезагрузка правил ОДНА на все зоны: fw4 reload
# перестраивает набор целиком, и звать его на каждую зону значило бы дважды уронить транзит.
fw_sync() {
    any=0
    _mout="$(fw_zone_migrate)" || any=1
    [ -n "$_mout" ] && printf '%s\n' "$_mout" | while IFS= read -r l; do
        [ -n "$l" ] && printf 'splify2: %s\n' "$l"
    done
    for z in $FW_ZONES; do
        _n="${z%%:*}"; _rest="${z#*:}"
        _k="${_rest%%:*}"; _m="${_rest##*:}"
        out="$(fw_zone_sync "$_n" "$_k" "$_m")" || any=1
        # По строке: fw_zone_sync печатает и «что сделали», и «что не тронули», а один
        # printf на многострочное значение оставил бы вторую строку без имени того, кто
        # говорит, — в общем выводе apply она читалась бы как сообщение движка.
        [ -n "$out" ] && printf '%s\n' "$out" | while IFS= read -r l; do
            [ -n "$l" ] && printf 'splify2: %s\n' "$l"
        done
    done
    if [ "$any" = 1 ]; then
        fw4 reload >/dev/null 2>&1 || /etc/init.d/firewall reload >/dev/null 2>&1
    fi
}

# Спека v1 — верхний ключ `schema` без `version`. Слово «schema» глубже (имя выхода или списка)
# v1 не делает, поэтому поиском по тексту это не определяется.
spec_is_v1() {
    [ -n "$(jsonfilter -i "$(spec_json)" -e '@.schema' 2>/dev/null)" ] &&
        [ -z "$(jsonfilter -i "$(spec_json)" -e '@.version' 2>/dev/null)" ]
}

# САМОЛЕЧЕНИЕ: выходу-интерфейсу без ключа `ipv6` в нашей зоне без masq6 записывается `ipv6: nat`
# или `ipv6: off` — смотря по тому, есть ли у его устройства адрес IPv6.
#
# ЗАЧЕМ. Зона steer_zone заводится без masq и без masq6 (IPv4 подменяет само ядро), и ядро steer (diag,
# output_nat6) пишет про такой выход «нет masquerade IPv6 — включите masq6 у зоны выхода»:
# человек добавил WARP, а панель жалуется на интерфейс, который создала сама. Подмену IPv6
# на устройство ставит само ядро по ключу `ipv6: nat` (у пира WARP один адрес, клиенты на ULA),
# и панель пишет его новым выходам. Эта функция лечит остальные: выходы, записанные прежней
# панелью, восстановленные из архива или заведённые руками без ключа.
#
# `nat` ТОЛЬКО ТАМ, ГДЕ У УСТРОЙСТВА ЕСТЬ АДРЕС IPv6. У туннеля с одним IPv4 подменять нечем, и
# ядро на выход с `nat` отвечает отказом («у X нет адреса IPv6»), а не жёлтой строкой: у LAN почти
# всегда есть ULA, и «Есть поломки» получил бы каждый такой туннель. Для него пишется `off` —
# выход IPv6 не несёт, клиенты идут по IPv4. Кто решает, — v6_mode_of_dev (common.sh): адрес
# живой либо записанный в настройке интерфейса (у выхода awg — в файле настройки, устройства до
# apply ещё нет); не решает он там, где у интерфейса задан ip6prefix (раздача префикса туннеля —
# дело человека, ключ ему не пишется) и где устройства нет вовсе.
#
# ЧТО ТРОГАЕМ, СТРОГО:
#   - только выходы kind interface и awg (остальным виды подмену IPv6 не нужны или делают сами);
#   - только без ключа `ipv6` — явные routed / off / nat человека остаются как есть;
#   - только если устройство лежит в зоне steer_zone, которую ведём мы, и у зоны нет masq6:
#     устройство в чужой зоне — чужая настройка (зона узнаётся и по `device`, и по `network`:
#     fw_zone_id_of_dev), а при masq6 у зоны жалобы и нет;
#   - только спека v2 (v1 ключа не знает).
# masq6 у зоны мы НЕ включаем: зона общая, и подмена всего её IPv6 сломала бы соседний выход с
# `ipv6: routed` (diag тогда советует masq6 снять).
#
# КАК ПРАВИТСЯ ФАЙЛ. Полным разбором и записью jshn спеку не переписать: он теряет порядок
# ключей и числа с плавающей точкой, а человек читает этот файл глазами. Поэтому вставка
# текстом: awk идёт по JSON со счётом глубины и строк и после `{` объекта подходящего выхода
# ставит `"ipv6":"nat",` или `"ipv6":"off",` — больше ни один байт не меняется. Проходов два
# (одна и та же программа, режимы scan и apply): первый называет выходы-кандидаты, оболочка
# решает по каждому, второй вставляет решённое. Результат до замены проверяет компилятор
# (engine_check), замена — mv рядом с целевым (атомарно, как в spec_set).
# Идемпотентна: после правки у выхода ключ есть. Печатает по строке «РЕЖИМ ВЫХОД» на каждый
# записанный ключ; код 0 — спека изменена, 1 — менять нечего.
spec_heal_ipv6() {
    [ -s "$(spec_json)" ] || return 1
    spec_is_v1 && return 1
    _sh_devs=""
    for _sh_d in $(fw_devices_of interface,awg); do
        _sh_z="$(fw_zone_id_of_dev "$_sh_d")"
        [ -n "$_sh_z" ] || continue
        [ "$(uci -q get "firewall.$_sh_z.name" 2>/dev/null)" = steer_zone ] || continue
        [ "$(uci -q get "firewall.$_sh_z.masq6" 2>/dev/null)" = 1 ] && continue
        _sh_devs="$_sh_devs $_sh_d"
    done
    [ -n "$_sh_devs" ] || return 1
    _sh_awk='
    # Вся спека в одну строку-накопитель: разбор по символам, а не по строкам, потому что
    # выход может лежать и в одной строке с соседями, и растянуться на много.
    { s = s $0 "\n" }
    # Строка JSON с позиции i (s[i] == кавычка): возвращает позицию закрывающей кавычки,
    # само значение — в глобальной STR.
    function str_end(i,   j, c, v) {
        v = ""; j = i + 1
        while (j <= n) {
            c = substr(s, j, 1)
            if (c == "\\") { v = v substr(s, j, 2); j += 2; continue }
            if (c == "\"") break
            v = v c; j++
        }
        STR = v
        return j
    }
    function skip_ws(i,   c) {
        while (i <= n) {
            c = substr(s, i, 1)
            if (c != " " && c != "\t" && c != "\n" && c != "\r") break
            i++
        }
        return i
    }
    END {
        n = length(s); depth = 0; inouts = 0; wantout = 0; wantobj = 0; inobj = 0; ins_n = 0
        i = 1
        while (i <= n) {
            c = substr(s, i, 1)
            if (c == "\"") {
                j = str_end(i); tok = STR
                k = skip_ws(j + 1)
                if (substr(s, k, 1) == ":") {
                    if (depth == 1 && tok == "outputs") wantout = 1
                    else if (depth == 2 && inouts) { cur = tok; wantobj = 1 }
                    else if (depth == 3 && inobj) {
                        if (tok == "ipv6") has = 1
                        else if (tok == "kind" || tok == "device" || tok == "conf") {
                            v = skip_ws(k + 1)
                            if (substr(s, v, 1) == "\"") {
                                e = str_end(v)
                                if (tok == "kind") kind = STR; else if (tok == "device") dev = STR; else conf = STR
                            }
                        }
                    }
                }
                i = j + 1; continue
            }
            if (c == "{" || c == "[") {
                depth++
                if (c == "{" && depth == 2 && wantout) { inouts = 1; wantout = 0 }
                else if (c == "{" && depth == 3 && inouts && wantobj) {
                    inobj = 1; wantobj = 0; objpos = i; has = 0; kind = ""; dev = ""; conf = ""
                }
                i++; continue
            }
            if (c == "}" || c == "]") {
                if (depth == 3 && inobj) {
                    inobj = 0
                    if ((kind == "interface" || kind == "awg") && !has) {
                        d = (dev != "") ? dev : cur
                        if (index(" " devs " ", " " d " ")) {
                            if (mode == "scan") print cur "|" kind "|" d "|" conf
                            else if (index(" " nat " ", " " cur " ")) { ins_n++; pos[ins_n] = objpos; nm[ins_n] = cur; md[ins_n] = "nat" }
                            else if (index(" " off " ", " " cur " ")) { ins_n++; pos[ins_n] = objpos; nm[ins_n] = cur; md[ins_n] = "off" }
                        }
                    }
                }
                else if (depth == 2 && inouts) inouts = 0
                depth--; i++; continue
            }
            i++
        }
        if (mode == "scan") exit 0
        if (!ins_n) exit 1
        out = ""; last = 1
        for (q = 1; q <= ins_n; q++) {
            out = out substr(s, last, pos[q] - last + 1) "\"ipv6\":\"" md[q] "\","
            last = pos[q] + 1
            print md[q], nm[q] > namesf
        }
        printf "%s%s", out, substr(s, last)
    }'
    # Первый проход: выходы-кандидаты — «имя|вид|устройство|файл настройки».
    _sh_cand="$(awk -v mode=scan -v devs="$_sh_devs" "$_sh_awk" "$(spec_json)" 2>/dev/null)"
    [ -n "$_sh_cand" ] || return 1
    _sh_tbl="$(net_v6_table)"
    _sh_nat=""; _sh_off=""
    while IFS='|' read -r _sh_n _sh_k _sh_dv _sh_cf; do
        [ -n "$_sh_n" ] || continue
        # Выход awg: файл — из спеки, а без него умолчание ядра `<каталог ядра>/awg/<имя>.conf`.
        [ "$_sh_k" = awg ] && _sh_cf="${_sh_cf:-${SPEC%/*}/awg/$_sh_n.conf}" || _sh_cf=""
        case "$(v6_mode_of_dev "$_sh_tbl" "$_sh_dv" "$_sh_cf")" in
            nat) _sh_nat="$_sh_nat $_sh_n" ;;
            off) _sh_off="$_sh_off $_sh_n" ;;
        esac
    done <<EOF
$_sh_cand
EOF
    [ -n "$_sh_nat$_sh_off" ] || return 1
    _sh_tmp="$SPEC.new.$$"
    _sh_names="$_sh_tmp.names"
    awk -v mode=apply -v devs="$_sh_devs" -v nat="$_sh_nat" -v off="$_sh_off" -v namesf="$_sh_names" \
        "$_sh_awk" "$(spec_json)" > "$_sh_tmp" 2>/dev/null || { rm -f "$_sh_tmp" "$_sh_names"; return 1; }
    # Компилятор — судья и здесь: не принял — спека остаётся прежней, жалоба диагностики
    # остаётся жалобой, а не превращается в отказ загрузки.
    if ! engine_check "$_sh_tmp" >/dev/null 2>&1; then
        rm -f "$_sh_tmp" "$_sh_names"
        return 1
    fi
    spec_put "$_sh_tmp" || { rm -f "$_sh_names"; return 1; }
    cat "$_sh_names" 2>/dev/null
    rm -f "$_sh_names"
    return 0
}

# ВЫХОДЫ `kind: zapret` БОЛЬШЕ НЕ ПОДДЕРЖИВАЮТСЯ: ядро отвергает такую спеку целиком. Прежняя панель
# и руки их писали, поэтому при обновлении (uci-defaults зовёт spec_heal) и при каждом apply спека
# приводится к виду, который ядро принимает:
#   - выход с kind zapret убирается из outputs;
#   - правила и апстримы DNS (`out`), ссылавшиеся на него, идут в `direct`; если выхода direct в
#     спеке не было, он заводится на месте первого убранного (слово direct в `out` ядро принимает и
#     так, но явный выход виден в редакторе);
#   - `on_fail: zapret` у остальных выходов становится `direct`.
# Правка текстом по тому же приёму, что у spec_heal_ipv6: awk идёт по JSON с глубиной и строками,
# меняются только названные участки, остальное — байт в байт. Пакет zapret и его настройку не
# трогаем никогда. Прежняя спека — копией spec.json.zapret.bak (одна, старейшая).
# Идемпотентна: после правки выходов этого вида нет. Печатает строки отчёта; код 0 — спека
# изменена, 1 — менять нечего (или ядро не приняло результат).
spec_heal_zapret() {
    [ -s "$(spec_json)" ] || return 1
    spec_is_v1 && return 1
    grep -q zapret "$(spec_json)" 2>/dev/null || return 1
    _sz_tmp="$SPEC.new.$$"
    _sz_rep="$_sz_tmp.rep"
    awk -v repf="$_sz_rep" '
    { s = s $0 "\n" }
    function str_end(i,   j, c, v) {
        v = ""; j = i + 1
        while (j <= n) {
            c = substr(s, j, 1)
            if (c == "\\") { v = v substr(s, j, 2); j += 2; continue }
            if (c == "\"") break
            v = v c; j++
        }
        STR = v
        return j
    }
    function skip_ws(i,   c) {
        while (i <= n) {
            c = substr(s, i, 1)
            if (c != " " && c != "\t" && c != "\n" && c != "\r") break
            i++
        }
        return i
    }
    function cover(a, b,   q) { for (q = a; q <= b; q++) skip[q] = 1 }
    END {
        n = length(s); depth = 0; top = ""; nm = 0; nr = 0; inobj = 0; hasdirect = 0
        i = 1
        while (i <= n) {
            c = substr(s, i, 1)
            if (c == "\"") {
                j = str_end(i); tok = STR
                k = skip_ws(j + 1)
                if (substr(s, k, 1) == ":") {
                    if (depth == 1) top = tok
                    else if (depth == 2 && top == "outputs") {
                        nm++; mname[nm] = tok; mks[nm] = i; mkind[nm] = ""; mve[nm] = 0; mca[nm] = 0
                        if (tok == "direct") hasdirect = 1
                    }
                    else if (depth == 3 && top == "outputs" && tok == "kind") {
                        v = skip_ws(k + 1)
                        if (substr(s, v, 1) == "\"") { e = str_end(v); mkind[nm] = STR }
                    }
                    if ((tok == "out" && top != "outputs") || tok == "on_fail") {
                        v = skip_ws(k + 1)
                        if (substr(s, v, 1) == "\"") {
                            e = str_end(v)
                            nr++; ra[nr] = v; rb[nr] = e; rv[nr] = STR; rk[nr] = tok
                        }
                    }
                }
                i = j + 1; continue
            }
            if (c == "{" || c == "[") { depth++; i++; continue }
            if (c == "}" || c == "]") {
                if (depth == 3 && top == "outputs" && c == "}") mve[nm] = i
                depth--; i++; continue
            }
            if (c == "," && depth == 2 && top == "outputs" && nm > 0 && mve[nm] > 0 && !mca[nm]) mca[nm] = i
            i++
        }
        zn = " "; nz = 0
        for (m = 1; m <= nm; m++) if (mkind[m] == "zapret") { nz++; zn = zn mname[m] " " }
        edits = 0
        # Ссылки: out на убранный выход — в direct; on_fail: zapret — в direct.
        nrules = 0
        for (q = 1; q <= nr; q++) {
            if ((rk[q] == "out" && index(zn, " " rv[q] " ")) || (rk[q] == "on_fail" && rv[q] == "zapret")) {
                rrep[q] = 1; edits++
                if (rk[q] == "out") nrules++
            }
        }
        if (!nz && !edits) exit 1
        # Убранные выходы.
        first = 1
        for (m = 1; m <= nm; m++) {
            if (mkind[m] != "zapret" || !mve[m]) continue
            gone[m] = 1
        }
        for (m = 1; m <= nm; m++) {
            if (!gone[m]) continue
            if (first && !hasdirect) {
                # Первый убранный выход становится выходом direct: запятые вокруг остаются.
                cover(mks[m], mve[m]); drep[mks[m]] = "\"direct\":{\"kind\":\"direct\"}"
                hasdirect = 1; first = 0; gone[m] = 0; repl[m] = 1
                continue
            }
            first = 0
        }
        for (m = 1; m <= nm; m++) {
            if (!gone[m]) continue
            if (mca[m]) cover(mks[m], mca[m])
            else {
                # Последний член: уходит и запятая перед ним (у ближайшего оставшегося члена).
                pc = 0
                for (p = m - 1; p >= 1; p--) if (!gone[p]) { pc = mca[p]; break }
                cover(pc ? pc : mks[m], mve[m])
            }
        }
        for (q = 1; q <= nr; q++) if (rrep[q] && !skip[ra[q]]) { cover(ra[q], rb[q]); drep[ra[q]] = "\"direct\"" }
        out = ""; run = 1
        for (q = 1; q <= n; q++) {
            if (!skip[q]) continue
            if (q > run) out = out substr(s, run, q - run)
            run = q + 1
            if (q in drep) out = out drep[q]
        }
        printf "%s%s", out, substr(s, run)
        names = ""
        for (m = 1; m <= nm; m++) if (mkind[m] == "zapret") names = names " " mname[m]
        print "outputs" names > repf
        print "rules " nrules > repf
    }' "$(spec_json)" > "$_sz_tmp" 2>/dev/null || { rm -f "$_sz_tmp" "$_sz_rep"; return 1; }
    [ -s "$_sz_tmp" ] || { rm -f "$_sz_tmp" "$_sz_rep"; return 1; }
    if ! engine_check "$_sz_tmp" >/dev/null 2>&1; then
        rm -f "$_sz_tmp" "$_sz_rep"
        return 1
    fi
    [ -e "$SPEC.zapret.bak" ] || cp "$(spec_json)" "$SPEC.zapret.bak" 2>/dev/null
    spec_put "$_sz_tmp" || { rm -f "$_sz_rep"; return 1; }
    _sz_o="$(sed -n 's/^outputs *//p' "$_sz_rep")"
    _sz_n="$(sed -n 's/^rules //p' "$_sz_rep")"
    rm -f "$_sz_rep"
    printf 'splify2: %s\n' "$(s2_t heal.zapret "DPI bypass (zapret) is no longer supported: outputs removed{outputs}, rules moved to direct: {rules}" outputs "${_sz_o:+ $_sz_o}" rules "${_sz_n:-0}")"
    logger -t splify2 "zapret outputs removed from the spec (${_sz_o# }), rules moved to direct: ${_sz_n:-0}; the previous spec is $SPEC.zapret.bak" 2>/dev/null
    return 0
}

# Имена выходов с этим режимом из вывода spec_heal_ipv6, через пробел.
# Лечение спеки плагинами (хук heal, splify2-api): рабочая копия спеки идёт по плагинам по порядку, изменённую
# копию, которую приняло ядро, кладём на место. Печатает, что сказали плагины; возврат 0 — спека изменена.
spec_heal_plugins() {
    need_ext && ext_has_hook heal || return 1
    _hp="$SPEC.heal.$$"
    cp "$(spec_json)" "$_hp" 2>/dev/null || return 1
    if ext_heal "$_hp" && engine_check "$_hp" >/dev/null && spec_put "$_hp"; then
        printf '%s' "${EXT_HEAL_MSG:-$(s2_t heal.plugin "A plugin fixed the spec")}"
        return 0
    fi
    rm -f "$_hp"
    return 1
}

heal_names() {  # РЕЖИМ ВЫВОД
    printf '%s\n' "$2" | sed -n "s/^$1 //p" | tr '\n' ' ' | sed 's/ $//'
}

# Что записало самолечение — строками для ответа apply: КАКОЙ ключ и КАКИМ выходам. Два режима —
# две строки, каждая только если есть выходы: «что-то подправлено» человеку ничего не говорит.
heal_report() {  # ВЫВОД spec_heal_ipv6
    _hr_n="$(heal_names nat "$1")"
    [ -n "$_hr_n" ] &&
        printf 'splify2: outputs without an ipv6 key got ipv6: nat (the tunnel has an IPv6 address): %s\n' "$_hr_n"
    _hr_f="$(heal_names off "$1")"
    [ -n "$_hr_f" ] &&
        printf 'splify2: outputs without an ipv6 key got ipv6: off (the tunnel has no IPv6 address, clients use IPv4): %s\n' "$_hr_f"
    return 0
}

# ТЕКСТ СПЕКИ ОТ КАРКАСА — YAML (его показывают человеку) или JSON (Andromeda, прежние клиенты, ssh).
# Текст, начинающийся с «{», идёт как JSON без перевода. Иное переводит ядро: `steer spec convert --json
# --spec -` (stdin) — оно же и разбирает YAML, и называет строку и колонку разбора: «stdin:5:1: …».
# Комментарии YAML при записи теряются: спеку на диск кладёт перевод ядром (spec_put), а не присланный текст.
SPEC_ERR_LINE=""; SPEC_ERR_COL=""

# Слова отказа ядра без адреса «steer: файл:строка:колонка: » — в SPEC_ERR_MSG (без подоболочки: значения
# переменных нужны вызывающему); строка и колонка — в SPEC_ERR_LINE/COL, когда адрес есть и $2 = keep
# (разбор самого текста: номера строк — те, что видит человек).
spec_err_split() {  # ТЕКСТ [keep]
    SPEC_ERR_LINE=""; SPEC_ERR_COL=""; SPEC_ERR_MSG="$1"
    _se_a="$(printf '%s' "$1" | sed -n '1s/^\(steer: \)\{0,1\}[^ :]*:\([0-9][0-9]*\):\([0-9][0-9]*\): .*/\2 \3/p')"
    [ -n "$_se_a" ] || return 0
    if [ "${2:-}" = keep ]; then
        SPEC_ERR_LINE="${_se_a% *}"; SPEC_ERR_COL="${_se_a#* }"
        # libyaml замечает незакрытую кавычку, скобку или ключ без двоеточия только на следующей записи или в конце
        # текста: адрес ошибки уезжает вниз на пустые строки и комментарии (ядро сообщает 10, ошибка на строке 8).
        # Ядро называет и строку, где конструкция началась («начало в строке 8») — человеку нужна она. Ошибки
        # разбора блоков («did not find expected key») остаются с адресом ядра: там начало — вся таблица выше.
        case "$1" in
            *"while scanning"*|*"while parsing a flow"*)
                _se_b="$(printf '%s' "$1" | sed -n '1s/.*начало в строке \([0-9][0-9]*\).*/\1/p')"
                if [ -n "$_se_b" ] && [ "$_se_b" -lt "$SPEC_ERR_LINE" ]; then SPEC_ERR_LINE="$_se_b"; SPEC_ERR_COL=1; fi ;;
        esac
    fi
    SPEC_ERR_MSG="$(printf '%s' "$1" | sed '1s/^\(steer: \)\{0,1\}[^ :]*:[0-9][0-9]*:[0-9][0-9]*: //')"
}

# Отказ спеки: {ok:false, error[, line, col]}.
spec_refuse() {  # СЛОВА
    s2_core_load "${SPEC_EARGS:-}"    # до json_init: json_load сбрасывает документ
    json_init; json_add_boolean ok 0
    if [ -n "${SPEC_ECODE:-}" ]; then s2_core_fields "$SPEC_ECODE" "$1"; else json_add_string error "$1"; fi
    if [ -n "$SPEC_ERR_LINE" ]; then json_add_int line "$SPEC_ERR_LINE"; json_add_int col "$SPEC_ERR_COL"; fi
    json_dump
    exit 0
}

# Текст спеки в JSON-файл. Код 1 — ядро не разобрало: слова в SPEC_ERR (+ SPEC_ERR_LINE/COL).
spec_text_to_json() {  # ТЕКСТ ФАЙЛ_JSON
    SPEC_ECODE=""; SPEC_EARGS=""
    _st_t="$2.txt"
    printf '%s' "$1" > "$_st_t" || { rm -f "$_st_t"; SPEC_ERR="$(s2_t spec.not_written "Cannot write the spec: no space left")"; return 1; }
    _st_c="$(sed -n '/[^[:space:]]/{s/^[[:space:]]*\(.\).*/\1/p;q}' "$_st_t")"
    if [ "$_st_c" = "{" ]; then
        mv "$_st_t" "$2" || { rm -f "$_st_t" "$2"; SPEC_ERR="$(s2_t spec.not_written "Cannot write the spec: no space left")"; return 1; }
        return 0
    fi
    _st_e="$(STEER_ERR_JSON=1 "$STEER" spec convert --json --spec - < "$_st_t" 2>&1 > "$2")"; _st_rc=$?
    rm -f "$_st_t"
    if [ "$_st_rc" != 0 ] || [ ! -s "$2" ]; then
        rm -f "$2"
        SPEC_ECODE=""; SPEC_EARGS=""
        if s2_core_split "$_st_e"; then SPEC_ECODE="$S2_CORE_CODE"; SPEC_EARGS="$S2_CORE_ARGS"; fi
        _st_e="$S2_CORE_TEXT"
        spec_err_split "${_st_e:-$(s2_t spec.core_cannot_parse "The core could not parse the spec")}" keep
        SPEC_ERR="$SPEC_ERR_MSG"
        return 1
    fi
    return 0
}

case "$2" in

    spec_set)
        read -r input
        json_load "$input" 2>/dev/null || fail_code req.unparsable "Unparsable request"
        json_get_var spec spec
        json_get_var rev rev
        [ -n "$spec" ] || fail_code spec.empty "The spec is empty"
        # Правка поверх чужой записи (D-P2.7): страница пишет спеку целиком, а за время, что она её
        # держала, файл могли переписать — вторая вкладка, ssh, подписка, самолечение apply. `rev` —
        # ревизия, с которой страница начала (spec_get); не совпала с лежащей — отказ с текущей
        # ревизией, и страница сливает правки с тем, что на роутере, вместо молчаливой замены.
        # Замок группы spec держится на весь вызов, так что между сверкой и записью файл не меняется.
        # Без `rev` (ssh) — пишется без сверки.
        if [ -n "$rev" ]; then
            cur="$(spec_rev)"
            if [ -n "$cur" ] && [ "$cur" != "$rev" ]; then
                json_init; json_add_boolean ok 0; json_add_boolean conflict 1
                json_add_string rev "$cur"
                s2_fail_fields spec.changed "The spec on the router changed after it was opened"
                json_dump
                exit 0
            fi
        fi
        # Временный файл РЯДОМ с целевым, а не в /tmp, и это не мелочь. /tmp на OpenWrt —
        # tmpfs, а спека лежит на overlay; mv между разными файловыми системами busybox
        # делает копированием с удалением, а не rename(). Значит подмена НЕ атомарна:
        # обрыв на середине (кончился overlay — а он 6,9 МБ) оставлял на месте рабочей
        # спеки обрубок, и интерфейс при этом отвечал «Сохранено». Внутри одной ФС mv —
        # это rename, то есть либо старый файл, либо новый, третьего не бывает.
        # Ровно так уже сделано в download() выше, по той же причине.
        mkdir -p "$(dirname "$SPEC")"
        tmp="$SPEC.new.$$"
        if ! spec_text_to_json "$spec" "$tmp"; then spec_refuse "$SPEC_ERR"; fi
        # Хук pre_spec_set (splify2-api): плагины могут переписать присланную спеку (transform), отказать (veto) и
        # довезти файлы, на которые она ссылается: ядро умирает на отсутствующем списке, и без этого выбор нового
        # сервиса не сохранялся бы вовсе (так делает плагин lists-catalog). Хук идёт ДО проверки: файлы нужны под
        # спеку, какой она станет, а судья — по-прежнему ядро. Предупреждения (например, о нескачанном списке) не
        # отменяют сохранение — спека с недоступным списком остаётся верной, просто её канал не поднимется.
        # Упавший хук ничего не останавливает: только предупреждение в ответе.
        hook_warn=""
        if need_ext; then
            ext_pre_spec_set "$tmp"
            if [ -n "$EXT_VETO" ]; then rm -f "$tmp"; fail "$EXT_VETO"; fi
            hook_warn="$EXT_WARN"
        fi
        set_warn=""
        # Компилятор — единственный судья: он же будет это применять. Проверка до
        # записи означает, что на диске не окажется спеки, которую движок отвергнет
        # при следующей загрузке.
        if ! err="$(engine_check "$tmp")"; then
            rm -f "$tmp"
            # Если список не скачался, ПРИЧИНА в этом, и её надо назвать первой. Сообщение
            # движка называет следствие — «cannot read a channel's list» — и отправляет
            # человека искать испорченный файл, которого никогда не было на диске. Проверено:
            # при недоступном списке ответ был ровно таким, без единого слова о загрузке.
            spec_err_split "$err"; err="$SPEC_ERR_MSG"
            engine_core_load
            S2_CORE_PREFIX="${hook_warn:+$hook_warn; }"
            fail "${hook_warn:+$hook_warn; }${err:-$(s2_t spec.core_rejected "The core rejected the spec")}" "$ENGINE_ECODE" "$ENGINE_EARGS"
        fi
        # СНИМОК ПРИМЕНЁННОГО — ДО ПЕРВОЙ ПРАВКИ. Пока снимка нет (свежая установка, ни разу не
        # нажатое «Применить»), applied_get отдаёт саму спеку, и любая записанная правка выглядела
        # применённой: страницу перезагрузили — пилюля «Применить · N» пропала, хотя ядро о правке
        # не знает. Прежняя спека на диске — это и есть то, что исполняет ядро (пустая у свежей
        # установки), поэтому снимок снимается с неё, как в backup_put, ровно один раз и ПЕРЕД
        # заменой; дальше его двигает только apply.
        if [ ! -s "$APPLIED" ]; then
            if spec_have; then cp "$(spec_json)" "$APPLIED.new.$$" 2>/dev/null
            else printf '{"version":2}\n' > "$APPLIED.new.$$" 2>/dev/null
            fi
            if [ -s "$APPLIED.new.$$" ]; then mv "$APPLIED.new.$$" "$APPLIED" 2>/dev/null || rm -f "$APPLIED.new.$$"
            else rm -f "$APPLIED.new.$$"
            fi
        fi
        # Код возврата mv проверяется: без этого «Сохранено» печаталось независимо от
        # того, легла спека на диск или нет.
        # spec_put (spec.sh): spec.yaml (переводом ядром).
        spec_put "$tmp" || fail_code spec.not_replaced "Cannot replace the spec"
        # Хук post_spec_set: плагины узнают, что новая спека легла (так плагин ставит отложенное применение).
        if need_ext; then
            ext_gate post_spec_set "{\"rev\":$(plugin_jstr "$(spec_rev)")}"
            [ -n "$EXT_WARN" ] && hook_warn="${hook_warn:+$hook_warn
}$EXT_WARN"
        fi
        [ -n "$hook_warn" ] && set_warn="${set_warn:+$set_warn
}$hook_warn"
        # Предупреждение о нескачанном списке едет В ОТВЕТЕ, а не в журнал: сохранение
        # прошло, спека верна, но канал, ссылающийся на недоступный список, не поднимется —
        # и узнать об этом человек должен там же, где нажимал, а не догадываться позже по
        # неработающему каналу.
        json_init; json_add_boolean ok 1
        [ -n "$set_warn" ] && json_add_string warn "$set_warn"
        # Новая ревизия — чтобы следующая запись страницы шла от неё, не перечитывая спеку.
        json_add_string rev "$(spec_rev)"
        json_dump
        ;;

    spec_check)
        # Check a spec WITHOUT saving it: the same judge as spec_set (`steer check`), the answer is
        # {ok:true[, warn]} or {ok:false, error}. Used by the raw spec editor of the splify2 frame.
        # The temporary file lies next to the real spec, not in /tmp: relative paths in a spec (lists,
        # subscriptions) are resolved from the directory of the spec file.
        read -r input
        json_load "$input" 2>/dev/null || fail_code req.unparsable "Unparsable request"
        json_get_var spec spec
        [ -n "$spec" ] || fail_code spec.empty "The spec is empty"
        mkdir -p "$(dirname "$SPEC")"
        chk="$SPEC.chk.$$"
        # YAML (what the frame shows) or JSON: the core translates YAML first and names the line and column.
        if ! spec_text_to_json "$spec" "$chk"; then spec_refuse "$SPEC_ERR"; fi
        err="$(engine_check "$chk")"; rc=$?
        rm -f "$chk"
        spec_err_split "$err"; err="$SPEC_ERR_MSG"
        engine_core_load
        s2_core_load "$ENGINE_EARGS"      # до json_init: json_load сбрасывает документ
        json_init
        if [ "$rc" = 0 ]; then
            json_add_boolean ok 1
            [ -n "$err" ] && json_add_string warn "$err"
        else
            json_add_boolean ok 0
            if [ -n "$ENGINE_ECODE" ]; then s2_core_fields "$ENGINE_ECODE" "${err:-the core rejected the spec}"
            else json_add_string error "${err:-the core rejected the spec}"; fi
        fi
        json_dump
        ;;

    apply)
        # Ядро ведёт steer-box-connector (podkop, forkop): `steer apply` без службы steer исполняет
        # само ядро и поставило бы таблицу inet steer поверх таблицы коннектора (box_busy).
        box_busy && fail_code core.busy "The core is busy: {by}" by "$BOX_BY"
        # Зона туннельных устройств приводится в порядок ДО apply: иначе первый же прогон
        # объявит, что устройство никому не известно, и будет прав. Синхронизация в обе
        # стороны — добавить появившееся и убрать ушедшее вместе с самой зоной, когда
        # туннельных выходов не осталось (см. fw_sync). Ответ netifd о логических интерфейсах
        # спрашивается один раз и здесь, до подоболочек fw_sync и лечения (net_dump_load).
        net_dump_load
        # Выходы zapret ядро больше не принимает: спека приводится к принимаемой до apply.
        zap_msg="$(spec_heal_zapret)"
        zone_msg="$(fw_sync 2>&1)"
        [ -n "$zap_msg" ] && zone_msg="$zap_msg${zone_msg:+
$zone_msg}"
        # Лечение плагинов (хук heal) — после зашитых: они приводят спеку к принимаемой, плагин дополняет.
        if heal_plug="$(spec_heal_plugins)"; then
            zone_msg="${zone_msg:+$zone_msg
}splify2: $heal_plug"
        fi
        # Самолечение выходов без ipv6 (spec_heal_ipv6, шапка там же): после fw_sync, потому что
        # устройство попадает в нашу зону именно им, и до `steer apply`, чтобы тот же apply
        # довёл правку до ядра — отдельной перезагрузки не нужно. В ответ apply — что записано и
        # каким выходам (heal_report).
        if heal_out="$(spec_heal_ipv6)"; then
            zone_msg="${zone_msg:+$zone_msg
}$(heal_report "$heal_out")"
        fi
        # Хук pre_apply (splify2-api): veto останавливает применение с причиной плагина, warn — строка в ответе. Так
        # плагин довозит списки, на которые ссылается спека, перед применением: спеку могли положить на диск в обход
        # интерфейса (spec_set — не единственный способ), да и файл мог быть удалён уборкой между сохранением и
        # применением.
        hook_warn=""
        if need_ext; then
            ext_gate pre_apply "{\"spec\":$(plugin_jstr "$(spec_json)")}"
            if [ -n "$EXT_VETO" ]; then
                json_init; json_add_boolean ok 0; json_add_boolean veto 1
                json_add_string error "$EXT_VETO"
                json_add_string output "$(s2_t apply.vetoed "splify2: apply stopped by a plugin: {reason}" reason "$EXT_VETO")"
                json_dump
                exit 0
            fi
            hook_warn="$EXT_WARN"
        fi
        out="$("$STEER" apply --spec "$SPEC" 2>&1)"; rc=$?
        # Снимок — только на успехе: неудавшийся apply ничего не изменил в ядре, и счётчик
        # обязан продолжать это показывать.
        #
        # Копия — во временный файл рядом и переименованием (I-327): `cp` прямо в снимок
        # усекает его и пишет заново, и кончившееся посреди копии место оставляло обрезанный
        # снимок, из которого applied_get и проверки движка читали полспеки. mv внутри одного
        # каталога атомарен: снимок либо прежний, либо новый целиком.
        if [ "$rc" -eq 0 ]; then
            # Прежнее применённое — рядом, как spec.prev.json (D-P2.4): откатить применение руками —
            # положить его на место спеки. Только когда применённое изменилось: повторный apply без
            # правок не должен затирать откат копией той же спеки.
            prev="${APPLIED%/*}/spec.prev.json"
            if [ -s "$APPLIED" ] && ! cmp -s "$APPLIED" "$(spec_json)" &&
                    cp "$APPLIED" "$prev.new.$$" 2>/dev/null; then
                mv "$prev.new.$$" "$prev" 2>/dev/null || rm -f "$prev.new.$$"
            fi
            if cp "$(spec_json)" "$APPLIED.new.$$" 2>/dev/null; then
                mv "$APPLIED.new.$$" "$APPLIED" 2>/dev/null || rm -f "$APPLIED.new.$$"
            else
                rm -f "$APPLIED.new.$$"
            fi
        fi
        [ -n "$zone_msg" ] && out="$zone_msg
$out"
        [ -n "$hook_warn" ] && out="$hook_warn
$out"
        # Хуки post_apply и post_apply_fail: плагины узнают исход. Исход они не меняют; их предупреждения — в конец.
        if need_ext; then
            if [ "$rc" -eq 0 ]; then _pa_hook=post_apply; else _pa_hook=post_apply_fail; fi
            ext_gate "$_pa_hook" "{\"rc\":$rc,\"output\":$(plugin_jstr "$out")}"
            [ -n "$EXT_WARN" ] && out="$out
$EXT_WARN"
        fi

        # ПОМОЩНИКОВ (клиенты VLESS и hysteria2, xsteer, обфускатор, мост Telegram) И РЕЗОЛВЕР
        # БОЛЬШЕ НЕ ПЕРЕЗАПУСКАЕМ САМИ. Их держит демон движка (`steerd --supervise`): `steer
        # apply` через него сверяет прежнюю спеку с новой и перезапускает ровно тех помощников,
        # у кого изменились параметры выхода или файл подписки, а резолверу отдаёт новую таблицу.
        # Прежние сигналы экземплярам procd (`vless_*`, `obfs_*`) уходили в пустоту — таких
        # экземпляров с 1.8 нет. Признаки `VLESS_DIRTY`/`OBFS_DIRTY` стали ненужными.
        # Вывод движка отдаётся целиком, включая предупреждения: он знает то, чего
        # интерфейс знать не может — например, что у туннеля нет NAT и трафик в него
        # уедет без возврата.
        json_init
        json_add_boolean ok $([ $rc -eq 0 ] && echo 1 || echo 0)
        json_add_string output "$out"
        json_dump
        ;;

    spec_heal)
        # Вызов из установки и обновления пакета (uci-defaults) и для рук: вылечить спеку
        # (spec_heal_ipv6) и, только если она изменилась И уже применялась, применить так же, как
        # применяет интерфейс. Спеку, которую ни разу не применяли, не применяем: включать
        # маршрутизацию без ведома человека — не наше дело. Сначала зоны (fw_sync в apply), а
        # лечение смотрит на зону, поэтому устройства в нашу зону доводит сам apply, а здесь
        # лечатся только те, что в ней уже стоят.
        box_busy && fail_code core.busy "The core is busy: {by}" by "$BOX_BY"
        net_dump_load
        # Было ли до лечения всё применено: снимок есть и равен спеке. Снимок теперь заводит и
        # spec_set (до первой правки), поэтому одного его наличия мало — неприменённые правки
        # человека лечение применять не должно.
        _sh_clean=0
        if [ -s "$APPLIED" ] && cmp -s "$(spec_json)" "$APPLIED" 2>/dev/null; then _sh_clean=1; fi
        healed=0
        # Лечение плагинов (хук heal) идёт первым по времени записи, а применяется вместе с остальным через apply.
        spec_heal_plugins >/dev/null && healed=1
        zap_msg="$(spec_heal_zapret)" && healed=1
        if heal_out="$(spec_heal_ipv6)"; then
            healed=1
        fi
        if [ "$healed" = 1 ]; then
            if [ "$_sh_clean" = 1 ]; then
                "$0" call apply </dev/null >/dev/null 2>&1
            fi
        fi
        json_init; json_add_boolean ok 1; json_add_boolean healed "$healed"
        [ -n "${zap_msg:-}" ] && json_add_string zapret "$zap_msg"
        json_add_string outputs "$(printf '%s\n' "${heal_out:-}" | sed -n 's/^[a-z]* //p' | tr '\n' ' ' | sed 's/ $//')"
        json_add_string nat "$(heal_names nat "${heal_out:-}")"
        json_add_string off "$(heal_names off "${heal_out:-}")"
        json_dump
        ;;


    *) fail_code req.unknown_method "Unknown method" ;;
esac
