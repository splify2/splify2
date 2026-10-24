#!/bin/sh
# ReCheck (files/usr/lib/splify2/recheck.sh, init-скрипт splify2-recheck, m-recheck.sh) — таблица
# nftables, служба без движка и ответ rpcd без движка.
#
# Что стережётся. (1) Таблица ловит и IPv6: каждое правило с адресным условием стоит в паре
# `ip`/`ip6`, иначе v6-трафик в WAN идёт мимо движка молча. (2) Пропуск чужих меток (0x40000000
# ядра, 0xe0000000 порождённых движком) стоит РАНЬШЕ очередей — для обоих семейств. (3) Таблица
# проходит `nft -c` (если есть nft и сетевое пространство имён; иначе пропуск вслух). (4) Без
# движка служба ничего не ставит и снимает прежнюю таблицу, а rpcd отвечает installed=false.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
T="$(mktemp -d /tmp/recheckmatch.XXXXXX)"
trap 'rm -rf "$T"' EXIT INT TERM
fails=0
check() {  # ОПИСАНИЕ ОЖИДАЕМОЕ ПОЛУЧЕННОЕ
    if [ "$2" = "$3" ]; then printf '%-64s ok\n' "$1"
    else printf '%-64s ПРОВАЛ\n    ожидалось: %s\n    получено:  %s\n' "$1" "$2" "$3"; fails=$((fails + 1)); fi
}
RSH="$ROOT/files/usr/lib/splify2/recheck.sh"

# ---- таблица ---------------------------------------------------------------------
( set +u; RECHECK_CONF="$T/none"; . "$RSH"; recheck_nft eth1 br-lan guest ) > "$T/r.nft"
n4="$(grep -c 'ip [ds]addr != @private4' "$T/r.nft")"
n6="$(grep -c 'ip6 [ds]addr != @private6' "$T/r.nft")"
check "правила v4 есть" "yes" "$([ "$n4" -gt 0 ] && echo yes || echo no)"
check "у каждого правила v4 есть пара v6" "$n4" "$n6"
check "множество private6 заведено" "1" "$(grep -c 'set private6 { type ipv6_addr' "$T/r.nft")"
check "в таблице не осталось маркеров %D%/%S%" "0" "$(grep -c '%[DS]%' "$T/r.nft")"
# Порядок в цепочке out: возврат для метки ядра раньше пересылаемых очередей обоих семейств.
ret="$(grep -n 'meta mark & 0x40000000 != 0 return' "$T/r.nft" | head -1 | cut -d: -f1)"
fw6="$(grep -n 'iifname { "br-lan", "guest" } oifname "eth1" ip6 daddr' "$T/r.nft" | head -1 | cut -d: -f1)"
check "метка ядра пропускается раньше очереди v6" "yes" \
    "$([ -n "$ret" ] && [ -n "$fw6" ] && [ "$ret" -lt "$fw6" ] && echo yes || echo no)"
check "порождённые движком (0xe0000000) пропускаются в out" "1" \
    "$(sed -n '/chain out /,/^ }/p' "$T/r.nft" | head -3 | grep -c '0xe0000000 == 0xe0000000 return')"
if command -v nft >/dev/null 2>&1 && command -v unshare >/dev/null 2>&1 && { printf "table inet x {}\n" > "$T/probe.nft"; unshare -rn nft -c -f "$T/probe.nft" 2>/dev/null; }; then
    out="$(unshare -rn nft -c -f "$T/r.nft" 2>&1)"; check "таблица проходит nft -c" "" "$out"
else
    echo "nft -c пропущен: нет nft или unshare -rn"
fi

# ---- служба и rpcd без движка ------------------------------------------------------
mkdir -p "$T/bin"
cat > "$T/bin/nft" <<'EOF'
#!/bin/sh
echo "nft $*" >> "$SANDBOX/nft.log"; exit 0
EOF
cat > "$T/bin/logger" <<'EOF'
#!/bin/sh
exit 0
EOF
chmod +x "$T/bin/nft" "$T/bin/logger"
printf 'enabled=1\n' > "$T/recheck.conf"
(
    set +u; SANDBOX="$T"; export SANDBOX
    PATH="$T/bin:$PATH"
    RECHECK_CONF="$T/recheck.conf"; RECHECK_BIN="$T/нет-движка"; RECHECK_SH="$RSH"
    procd_open_instance() { echo open >> "$T/procd.log"; }
    procd_set_param() { :; }; procd_close_instance() { :; }; procd_add_interface_trigger() { :; }
    . "$ROOT/files/etc/init.d/splify2-recheck"
    start_service; echo "rc=$?" > "$T/start.rc"
)
check "без движка служба не падает" "rc=0" "$(cat "$T/start.rc")"
check "без движка процесс не заводится" "no" "$([ -s "$T/procd.log" ] && echo yes || echo no)"
check "без движка прежняя таблица снимается, новая не ставится" "nft delete table inet splify2_recheck" \
    "$(cat "$T/nft.log")"

info="$(echo '{}' | env PATH="$T/bin:$PATH" SANDBOX="$T" JSHN_SH="$ROOT/tests/stub/jshn.sh" \
    RPCD_LIB="$ROOT/files/usr/lib/splify2/rpcd" RECHECK_SH="$RSH" RECHECK_CONF="$T/recheck.conf" \
    RECHECK_BIN="$T/нет-движка" sh "$ROOT/files/usr/libexec/rpcd/splify2" call recheck_info)"
check "recheck_info без движка: installed=false" "1" "$(printf '%s' "$info" | grep -c '"installed":false')"
check "  и enabled=true, running=false" "1" "$(printf '%s' "$info" | grep -c '"running":false,"enabled":true')"
# Только IPv6: устройство WAN берётся из маршрута v6.
cat > "$T/bin/ip" <<'EOF'
#!/bin/sh
case "$*" in
    "-4 route show default") ;;
    "-6 route show default") echo "default from 2001:db8::/32 via fe80::1 dev wan6x proto static metric 1" ;;
esac
EOF
chmod +x "$T/bin/ip"
check "WAN без v4-маршрута — из маршрута v6" "wan6x" \
    "$(set +u; PATH="$T/bin:$PATH" RECHECK_CONF="$T/none"; . "$RSH"; recheck_wan)"

if [ "$fails" -gt 0 ]; then printf '\n%d ПРОВАЛЕНО\n' "$fails"; exit 1; fi
printf '\nвсе проверки прошли\n'
