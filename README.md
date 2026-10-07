<div align="center">

<img src="docs/img/logo.svg" width="104" alt="">

# splify2

**Нужные сервисы — через туннель на всех устройствах сети. Всё остальное — напрямую.**

[![Выпуск](https://img.shields.io/github/v/release/splify2/splify2?label=выпуск&color=6d5ce7)](https://github.com/splify2/splify2/releases)
[![Документация](https://img.shields.io/badge/документация-splify2.github.io-a897ff)](https://splify2.github.io/docs/splify2/)
[![Telegram](https://img.shields.io/badge/Telegram-чат_поддержки-2CA5E0?logo=telegram&logoColor=white)](https://t.me/ssplify)
[![Поддержать проект](https://img.shields.io/badge/❤️_Поддержать-Cloudtips-FF3355)](https://pay.cloudtips.ru/p/fb925110)

<img src="docs/img/before-after.svg" alt="Было: VPN на каждом устройстве по отдельности. Стало: одна настройка на роутере — правила для всей сети" width="100%">

</div>

Панель для роутера на OpenWrt — страница LuCI **Сервисы → splify2**. Вы выбираете сервисы и выход,
splify2 пишет спеку ядру [steer](https://github.com/splify2/steer), а маршрутизацию ведёт ядро steer
средствами ядра Linux: nftables, таблицы маршрутизации, домены через fake-IP.

## Возможности

- **Правила** — «что + кого касается + куда»: сервисы каталога и свои списки, вся сеть или выбранные
  устройства, выход. Читаются сверху вниз, побеждает первое совпадение
- **Выходы** — свой интерфейс роутера (WireGuard, AmneziaWG), подписки VLESS, hysteria2 и прокси
  (Trojan, Shadowsocks, SOCKS, HTTP(S), VMess), xsteer, WireGuard поверх поддельного TCP
- **Узлы подписок** — несколько узлов сразу с раздачей соединений и слежкой, «Не брать» по странам и
  словам в имени, бейджи протокола и защиты у каждого узла, внешний адрес выхода
- **Группы** — первый живой, самый быстрый, выбор вручную, раздача по весам (случайно, сайт — на
  одном выходе, сайт и устройство — на одном выходе); упало всё — трафик останавливается, а не
  уходит мимо туннеля
- **DNS** — серверы DoH, DoT, DoQ и обычные, у правила свой сервер; несколько серверов сразу или по
  очереди и свой сервер для остальных сайтов
- **Каталог сервисов** — списки обновляются сами; при закрытом GitHub — через зеркало и запасные хосты
- **Диагностика** — проверки ядра, соединения в выходах, недавние имена резолвера, журнал;
  «Куда пойдёт запрос» на главной — для любого имени

<div align="center">

<picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/framed/home-dark.webp"><img src="docs/img/framed/home-light.webp" alt="Главная: правила, выходы и остаток трафика подписок" width="100%"></picture>

<table><tr><td align="center" width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/framed/editor-dark.webp"><img src="docs/img/framed/editor-light.webp" alt="Правило" width="100%"></picture><br><sub>Правило: что, кого касается, куда</sub></td><td align="center" width="50%"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/framed/vpn-dark.webp"><img src="docs/img/framed/vpn-light.webp" alt="Выходы" width="100%"></picture><br><sub>Выходы и подписки</sub></td></tr><tr><td align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/framed/explain-dark.webp"><img src="docs/img/framed/explain-light.webp" alt="Куда пойдёт запрос" width="100%"></picture><br><sub>Куда пойдёт запрос</sub></td><td align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/img/framed/diag-dark.webp"><img src="docs/img/framed/diag-light.webp" alt="Диагностика" width="100%"></picture><br><sub>Диагностика</sub></td></tr></table>

</div>

## Установка

```sh
wget -O /tmp/splify2-install.sh https://gitlab.com/xyzmean/splify2/-/raw/main/install.sh && sh /tmp/splify2-install.sh
```

Установщик сам определяет архитектуру и менеджер пакетов (apk — на OpenWrt 25.12 и новее, opkg —
на 24.10 и старше) и ставит ядро steer 2.0 (`steer-core` и модули протоколов) и страницу LuCI.
Нужно ядро steer 2.0.0 или новее. Удаление — `splify2-purge` (без ключей показывает план, `--yes`
выполняет).

> **Счётчик на сайте.** Раз в 23 часа роутер отзывается счётчику сайта splify2.github.io
> (`dns.yo1nk.app/api/ping`) и сообщает свой идентификатор и внешний адрес — так сайт считает, на
> скольких роутерах работает splify2, и находит город для карты, даже когда трафик роутера идёт
> через туннель. Адрес сервер не хранит: на сутки запоминаются идентификатор, город, страна и
> координаты города. Включено по умолчанию; выключить:
> **Настройки → Интерфейс**, карточка «Счётчик на сайте». Подробно —
> [docs/TELEMETRY.md](docs/TELEMETRY.md).

## Документация

- [Быстрый старт](https://splify2.github.io/docs/quickstart/) и [как это работает](https://splify2.github.io/docs/how-it-works/)
- [Панель splify2 подробно](https://splify2.github.io/docs/splify2/) — [docs/guide.md](docs/guide.md)
- [API rpcd](https://splify2.github.io/docs/splify2/rpcd-api/) — методы бэкенда
- [Ядро steer](https://splify2.github.io/docs/steer/) и [каталог списков](https://github.com/splify2/splify2-lists)
