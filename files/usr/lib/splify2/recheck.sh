# ReCheck — самостоятельная часть splify2: обход DPI на трафике, который уходит из сети напрямую в
# WAN (не в туннели). Движок — отдельный приватный пакет `recheck` (/usr/sbin/steer-dpi-live);
# здесь — его настройки, таблица nftables, которая отдаёт ему первые пакеты соединений, и запуск
# службой (/etc/init.d/splify2-recheck). Ядро steer об этом не знает и знать не должно.
#
# ЧЬЁ ЧТО. Ядро держит выходы в битах 0x0ff00000 и метит свой трафик и уведённый в выходы битом
# 0x40000000 — такие пакеты ReCheck пропускает (это не его трафик) и правил маршрутизации по этому
# биту не заводит. Свои порождённые пакеты движок метит 0xe0000000 (снимаются с conntrack), пробы —
# 0x1000. Очереди — 4340 (первые пакеты) и 4341 (наблюдение), вне номеров ядра (zapret — от 8300).

RECHECK_CONF=${RECHECK_CONF:-/etc/splify2/recheck.conf}
RECHECK_BIN=${RECHECK_BIN:-/usr/sbin/steer-dpi-live}
RECHECK_TABLE=splify2_recheck
RECHECK_QUEUE=4340
RECHECK_WATCH=4341

# Значение ключа настроек (первое); нет — второй аргумент.
recheck_get() {  # КЛЮЧ [УМОЛЧАНИЕ]
    _rv="$(sed -n "s/^$1=//p" "$RECHECK_CONF" 2>/dev/null | head -1)"
    printf '%s' "${_rv:-$2}"
}

# Есть ли ключ без значения (`watch-active`).
recheck_flag() {  # КЛЮЧ
    grep -qx "$1" "$RECHECK_CONF" 2>/dev/null
}

# WAN: из настроек, иначе устройство маршрута по умолчанию.
recheck_wan() {
    _w="$(recheck_get interface)"
    [ -n "$_w" ] || _w="$(ip -4 route show default 2>/dev/null | sed -n 's/.* dev \([^ ]*\).*/\1/p' | head -1)"
    printf '%s' "$_w"
}

# Устройства сети: из спеки ядра (lan.devices), иначе br-lan. Спека — JSON-видом (spec.sh).
recheck_lan() {
    STEER="${STEER:-/usr/sbin/steer}"
    . "${SPEC_SH:-/usr/lib/splify2/spec.sh}"
    _l="$(jsonfilter -i "$(spec_json)" -e '@.lan.devices[*]' 2>/dev/null | tr '\n' ' ')"
    printf '%s' "${_l:-br-lan}"
}

# Таблица nftables для движка: первые 12 пакетов соединения из сети и 8 ответов — в очередь, у TCP
# дальше до 65-го и поздние FIN/RST — в наблюдение; пробы движка и их ответы — туда же. По образцу
# стенда ReCheck (deploy/pc101.nft в его репозитории), только для сети роутера.
recheck_nft() {  # WAN LAN...
    _wan="$1"; shift
    _lan="$(printf '"%s", ' "$@" | sed 's/, $//')"
    cat <<EOF
table inet $RECHECK_TABLE {
 set private4 { type ipv4_addr; flags interval; elements = { 0.0.0.0/8,10.0.0.0/8,100.64.0.0/10,127.0.0.0/8,169.254.0.0/16,172.16.0.0/12,192.168.0.0/16,198.18.0.0/15,224.0.0.0/3 }; }
 chain probe_route {
  type filter hook output priority -140; policy accept;
  meta mark & 0x1000 != 0 meta mark set meta mark | 0x40000000
 }
 chain generated {
  type filter hook output priority -403; policy accept;
  meta mark & 0xe0000000 == 0xe0000000 notrack
 }
 chain out {
  type filter hook postrouting priority 104; policy accept;
  meta mark & 0xe0000000 == 0xe0000000 return
  oifname "$_wan" meta mark & 0x1000 != 0 ip daddr != @private4 meta l4proto { tcp, udp } ct mark set ct mark | 0x1000
  oifname "$_wan" meta mark & 0x1000 != 0 ip daddr != @private4 meta l4proto { tcp, udp } ct original packets <= 12 counter queue flags bypass to $RECHECK_QUEUE
  meta mark & 0x40000000 != 0 return
  iifname { $_lan } oifname "$_wan" ip daddr != @private4 meta l4proto { tcp, udp } ct direction original ct original packets <= 12 counter queue flags bypass to $RECHECK_QUEUE
 }
 chain incoming {
  type filter hook forward priority -5; policy accept;
  meta mark & 0x40000000 != 0 return
  iifname "$_wan" oifname { $_lan } ip saddr != @private4 meta l4proto { tcp, udp } ct direction reply ct reply packets <= 8 counter queue flags bypass to $RECHECK_QUEUE
 }
 chain local_reply {
  type filter hook input priority 0; policy accept;
  iifname "$_wan" ct mark & 0x1000 != 0 ip saddr != @private4 meta l4proto { tcp, udp } ct reply packets <= 8 meta mark set meta mark | 0x1000 counter queue flags bypass to $RECHECK_QUEUE
 }
 chain watch_out {
  type filter hook postrouting priority 105; policy accept;
  meta mark & 0xe0000000 == 0xe0000000 return
  meta mark & 0x1000 != 0 return
  ct mark & 0x1000 != 0 return
  meta mark & 0x40000000 != 0 return
  iifname { $_lan } oifname "$_wan" ip daddr != @private4 meta l4proto tcp ct direction original ct original packets > 12 ct original packets <= 65 counter queue flags bypass to $RECHECK_WATCH
  iifname { $_lan } oifname "$_wan" ip daddr != @private4 meta l4proto tcp ct direction original ct original packets > 65 tcp flags & (fin | rst) != 0 counter queue flags bypass to $RECHECK_WATCH
 }
 chain watch_in {
  type filter hook forward priority -4; policy accept;
  meta mark & 0x40000000 != 0 return
  iifname "$_wan" oifname { $_lan } ip saddr != @private4 meta l4proto tcp ct direction reply ct reply packets > 8 ct reply packets <= 65 counter queue flags bypass to $RECHECK_WATCH
  iifname "$_wan" oifname { $_lan } ip saddr != @private4 meta l4proto tcp ct direction reply ct reply packets > 65 tcp flags & (fin | rst) != 0 counter queue flags bypass to $RECHECK_WATCH
 }
}
EOF
}

# Аргументы движка по настройкам. Очереди и метки — свои, из настроек не берутся.
recheck_args() {  # WAN
    set -- --queue "$RECHECK_QUEUE" --watch-queue "$RECHECK_WATCH" --skip-mark 0xe0000000 --probe-mark 0x1000 \
        --interface "$1" --epoch "$(recheck_get epoch 1)" --state "$(recheck_get state /tmp/recheck.cache)" --learn
    _ca="$(recheck_get ca /etc/ssl/certs/ca-certificates.crt)"
    [ -r "$_ca" ] && set -- "$@" --ca "$_ca"
    _n=0
    for _r in $(sed -n 's/^probe-resource=//p' "$RECHECK_CONF" 2>/dev/null | head -4); do set -- "$@" --probe-resource "$_r"; _n=$((_n + 1)); done
    _pr="$(recheck_get priors)"
    [ -r "$_pr" ] && set -- "$@" --priors "$_pr"
    # Наблюдение за загрузками без адреса проверки движок не принимает (выходит с кодом 2).
    [ "$_n" -gt 0 ] && recheck_flag watch-active && set -- "$@" --watch-active
    printf '%s\n' "$@"
}
