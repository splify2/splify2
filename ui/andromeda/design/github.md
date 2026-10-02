repo: xyzmean/splify2
branch: main
path: ui

## Last sync
date: 2026-08-28T06:52:00Z
commit: 924e0e542285

### Updated in this project
- Recreated the current LuCI console (status rail, rules, outbounds, catalog, logs, first run) from source.
- Copied `ui/public/icons.svg` and `ui/public/favicon.svg`.
- Lifted Argon token values from `ui/src/index.css` (light theme) as literal colours.
- Added the Andromeda 26.9 direction (two concepts, light + dark, desktop + mobile).
- Прототип Andromeda дополнен по коду: VlessPanel, ObfsPanel, CustomLists, EngineCard, SelfUpdateCard, BackupCard.
- Сверено с ui/src/lib/rpc.ts: sub_info отдаёт url/kind/path/bytes/mtime/hwid — остатка трафика в контракте НЕТ, блок «Подписка» на обзоре требует нового поля (заголовок subscription-userinfo).
- Обзор перекроен: убраны дубли (список выходов, счётчики, карточки-метрики), добавлен остаток трафика.
- Added the hosting question: embedded LuCI view vs. standalone window, grounded in luci/htdocs/.../view/splify2/home.js and menu.d/luci-app-splify2.json.

### Прежняя синхронизация
- 2026-08-22T20:09:06Z — прототип дополнен по VlessPanel, ObfsPanel, CustomLists, EngineCard, SelfUpdateCard, BackupCard.

## Screen map
| Screen (project) | Repo files |
|---|---|
| Splify2 сейчас.dc.html — оболочка, вкладки | ui/src/components/Console.tsx, ui/src/App.tsx, ui/src/main.tsx |
| Splify2 сейчас.dc.html — левая колонка | ui/src/components/StatusRail.tsx, ui/src/lib/live.ts, ui/src/lib/engine.ts |
| Splify2 сейчас.dc.html — правила и редактор | ui/src/components/tabs/RulesTab.tsx, ui/src/components/tabs/RuleEditor.tsx |
| Splify2 сейчас.dc.html — outbounds | ui/src/components/tabs/OutboundsTab.tsx |
| Splify2 сейчас.dc.html — каталог | ui/src/components/tabs/CatalogTab.tsx |
| Splify2 сейчас.dc.html — логи и диагностика | ui/src/components/tabs/LogsTab.tsx |
| Splify2 сейчас.dc.html — первый запуск | ui/src/components/FirstRun.tsx |
| Splify2 сейчас.dc.html — пилюля «Применить» | ui/src/components/ApplyPill.tsx |
| Токены, кнопки, карточки, бейджи | ui/src/index.css, ui/tailwind.config.js, ui/src/components/ui/*.tsx |
| Andromeda прототип.dc.html — Выходы (подписка, узлы, обфускация) | ui/src/components/VlessPanel.tsx, ui/src/components/ObfsPanel.tsx, ui/src/components/tabs/OutboundsTab.tsx |
| Andromeda прототип.dc.html — Каталог, свои списки | ui/src/components/tabs/CatalogTab.tsx, ui/src/components/CustomLists.tsx |
| Andromeda прототип.dc.html — Система | ui/src/components/EngineCard.tsx, ui/src/components/SelfUpdateCard.tsx, ui/src/components/BackupCard.tsx, ui/src/lib/engine.ts |
| Andromeda 26.9.dc.html — режимы 2a/2b (LuCI vs отдельное окно) | luci/htdocs/luci-static/resources/view/splify2/home.js, luci/root/usr/share/luci/menu.d/luci-app-splify2.json |
| Andromeda 26.9.dc.html | производное от всех перечисленных + uploads/logo-3c.svg |
