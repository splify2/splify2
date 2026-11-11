#!/bin/sh
# Откат с линии 26.11 / ядра steer 2.1 на прежнюю: ядро steer 2.0.5 с модулями и панель splify2 26.10.4.
# Настройки (/etc/steer) остаются, их копия — /root/steer-before-rollback.tgz.
#   wget -O /tmp/rollback.sh https://raw.githubusercontent.com/splify2/splify2/main/rollback-26.10.sh && sh /tmp/rollback.sh
# Модули, кроме vless hysteria2 proxy: MODS="vless hysteria2 proxy xsteer obfs tgws" sh /tmp/rollback.sh
SV=2.0.5; UV=26.10.4; MODS="${MODS:-vless hysteria2 proxy}"
ARCH="$(. /etc/openwrt_release; echo "$DISTRIB_ARCH")"
if command -v apk >/dev/null 2>&1; then EXT=apk; UI="luci-app-splify2-$UV-1_noarch.apk"; else EXT=ipk; UI="luci-app-splify2-$UV-1_all.ipk"; fi
D=/tmp/splify2-rollback; mkdir -p "$D"; cd "$D" || exit 1
# Файл, уже лежащий в $D (положен руками, если GitHub с роутера закрыт), заново не качается.
get() {
    [ -s "$D/$3" ] || wget -q -T 30 -O "$D/$3" "https://github.com/$1/releases/download/$2/$3" ||
        wget -q -T 30 -O "$D/$3" "https://github.com/splify2/releases/releases/download/$4/$3"
    [ -s "$D/$3" ] || { rm -f "$D/$3"; echo "не скачалось: $3 — откат не начат, на роутере ничего не изменено"; exit 1; }
    echo "  $3"
}
echo "Скачиваю пакеты ($ARCH, $EXT)"
for p in core $MODS; do get splify2/steer "v$SV" "steer-$p-$SV-1_$ARCH.$EXT" "steer-v$SV"; done
get splify2/splify2 "v$UV" "$UI" "splify2-v$UV"
tar czf /root/steer-before-rollback.tgz -C / etc/steer etc/splify2 2>/dev/null; echo "Копия настроек: /root/steer-before-rollback.tgz"
echo "Снимаю 2.1"
OURS="splify2 luci-app-splify2 steer-core steer-vless steer-hysteria2 steer-proxy steer-xsteer steer-obfs steer-tgws steer-extended"
bad() { echo "$1 — возвращаю службу как была"; /etc/init.d/steer start >/dev/null 2>&1; exit 1; }
/etc/init.d/steer stop >/dev/null 2>&1
if [ "$EXT" = apk ]; then
    # Имена прежних пакетов закреплены в /etc/apk/world и у 2.1 живут как provides — снимаются все разом.
    apk del $OURS 2>&1 | grep -v "^OK:\|Purging\|Executing" ; apk list -I 2>/dev/null | grep -qE "^(splify2|steer-core)-" && bad "пакеты 2.1 не снялись"
    apk add --allow-untrusted "$D"/steer-*.apk "$D/$UI" || bad "установка не прошла"
else
    opkg remove splify2 steer-core >/dev/null 2>&1
    opkg install "$D"/steer-core-*.ipk && opkg install "$D"/steer-*.ipk "$D/$UI" || bad "установка не прошла"
fi
rm -rf /usr/lib/steer/plugins /tmp/splify2-releases.json* "$D"
# Следы линии 26.11, которые пакет не снимает: задания плагинов в cron, экраны плагинов, служба событий.
sed -i '/^# splify2-plugins begin/,/^# splify2-plugins end/d' /etc/crontabs/root 2>/dev/null; /etc/init.d/cron restart >/dev/null 2>&1
rm -rf /www/luci-static/resources/view/splify2/p-* /tmp/luci-indexcache* /tmp/luci-modulecache
[ -x /etc/init.d/splify2-events ] && /etc/init.d/splify2-events restart >/dev/null 2>&1 || killall splify2-events 2>/dev/null
/etc/init.d/steer enable >/dev/null 2>&1; /etc/init.d/steer restart >/dev/null 2>&1; /etc/init.d/rpcd restart >/dev/null 2>&1
sleep 5; echo "Готово: $(steer --version 2>&1 | head -1)"
