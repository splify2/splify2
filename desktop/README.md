# splify2 для компьютера

Панель splify2 в своём окне: та же, что на странице LuCI, без браузера. Значок в трее, своя рамка
окна в стиле панели. Компьютер подключается к роутеру один раз по паролю, дальше входит сам
(API splify2 на роутере).

- **Windows** x64 — установщик `splify2-desktop-<версия>-setup-x64.exe` на Squirrel.Windows, как у
  Discord: без мастера, окошко с анимированным логотипом, установка в профиль
  (`%LocalAppData%\splify2`), приложение запускается сразу.
- **Linux** — AppImage (следующий шаг).

На роутере нужен splify2 новее 26.10.3: с него есть API, через который работает приложение.

## Как устроено

- `renderer/` — окно. Сама панель берётся из `../ui/src` без правок; вместо моста LuCI
  (`window.luci_rpc`) окно зовёт главный процесс.
- `electron/router.cjs` — клиент API: вход, пара токенов, обновление, вызовы. Токены хранятся
  зашифрованными средствами системы (`safeStorage`) в `connection.json` каталога данных
  приложения (`%APPDATA%\splify2` в Windows); окно их не видит.
- `electron/main.cjs` — окно без системной рамки, трей (крестик прячет окно в трей, выход — из
  меню значка), ссылки наружу — в браузер.
- `electron/squirrel.cjs` — служебные запуски Squirrel (`--squirrel-install` и другие): ярлыки в меню
  «Пуск» и на рабочем столе, выход; вне Windows и вне установщика ничего не делает.

## Сборка

```sh
sh build.sh          # установщик Windows (Squirrel, в docker: electronuserland/builder:wine-mono) —
                     # release/squirrel-windows/: Setup.exe, *-full.nupkg и RELEASES (их ждёт самообновление)
sh build.sh nsis     # запасной установщик NSIS
sh build.sh linux    # AppImage
npm start            # запустить из исходников
npm run icons        # иконки из ../ui/public/favicon.svg (без экрана — через xvfb-run)
npm run install-gif  # анимация установщика resources/install.gif (нужны xvfb-run и python3 с PIL)
```
