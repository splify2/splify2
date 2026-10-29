# lists-catalog — каталог списков

Официальный плагин splify2 (`splify2-core-plugins`): каталог списков сервисов и сайтов, загрузка списков, свои списки,
суточное обновление. Служит образцом: он пользуется платформой **только через её API**
([splify2-api](https://github.com/splify2/plugin-sdk/blob/main/docs/splify2-api.md)) и больше ни через что — `s2p lint
--official` и стенд `tests/pluginhygiene.sh` отказывают плагину, который заглянет в файлы, переменные или функции каркаса.

## Что делает

| Что | Как |
|---|---|
| Каталог списков и второй издатель (`itdoginfo/allow-domains`) | методы `lists`, `allow_domains`, `list_fetch`, `list_remove`, `local_lists`, `list_peek` |
| Свои списки: текстом, ссылкой, файлом, набором `.srs` | `list_put`, `list_srs_put`, `list_custom`, `list_get` |
| Обновление раз в сутки и по кнопке | задача `update-lists` и метод `lists_update` |
| Откуда брать каталог, как качать | `lists_source*` (настройка плагина), `fetch_mode*` (режим хоста) |

Имена методов на объекте `splify2` прежние (`splify2.methods.alias`), интерфейс их не заметил.

## Какие точки API использует

| Точка API | Где |
|---|---|
| Манифест: `compat`, `permissions` (`splify2.hooks`, `http`, `fs:/etc/steer/lists`), `i18n`, `rpc`, `splify2` | `plugin.json` |
| **Хуки** `pre_spec_set` и `pre_apply` (режим `warn`) — довезти списки, на которые ссылается спека: ядро умирает на отсутствующем файле | `hooks/ensure-lists`, `lib/fetch-missing.sh` |
| **Хук** `backup_sections` — свои списки и настройки в архиве настроек (операции `export`, `check`, `restore`) | `hooks/backup` |
| **Хуки** `support_report` и `purge` | `hooks/support`, `hooks/purge` |
| **Задача** `update-lists` (`cron: M 5 * * *`, `jitter: random-minute`, `only_if: spec-present`) вместо строки crontab | `bin/update-lists` |
| **Методы rpc** и псевдонимы старых имён | `bin/lists`, `lib/methods.sh` |
| **Схема настроек** и значения через API (`s2_setting`, `splify2-host settings`) | `settings.schema.json` |
| **Словари** `i18n`: `plugin.name`, `plugin.description` (RU, EN), строки схемы настроек для каркаса (`i18n/core/ru.json`) | `i18n/` |
| **Службы хоста**: `fetch`, `fetch-mode`, `paths`, `spec get\|uses`, `apply`, `engine`, `settings` | вызываются через `$SPLIFY2_HOST` |
| **Ресурсы ядра**: каталог списков и программа ядра (`srs-read`, `fit`) — их называет хост (`paths`) | `lib/base.sh` (`lists_init`) |
| Рабочие каталоги: `STEER_PLUGIN_CONF` (кэш каталога, отметки версий), `STEER_PLUGIN_STATE` (замок, временные файлы) | `lib/base.sh` |

Слот интерфейса плагину не нужен: вкладка каталога — часть каркаса и работает через те же методы, а форма настроек
рисуется каркасом по схеме.

## Настройки

Хранятся в `conf/lists-catalog/settings.json`, форма — по `settings.schema.json`:

| Ключ | Что |
|---|---|
| `manifest_url` | адрес файла каталога; пусто — каталог splify2-lists |
| `list_shrink_factor` | список, уменьшившийся при обновлении во столько раз и больше, не применяется; 0 — без порога |
| `allow_domains_tag` | тег релиза списков второго издателя; пусто — тег, зашитый в плагин (`lib/allow-domains.sh`) |

Режим «качать через туннель» — не настройка плагина: он общий для всего, что скачивает каркас, поэтому им владеет хост
(`splify2-host fetch-mode`).

## Раскладка

```
plugin.json              манифест
settings.schema.json     схема настроек
i18n/                    словари RU и EN (и i18n/core/ru.json — строки схемы для каркаса)
bin/lists                методы rpc (диспетчер по первому аргументу)
bin/update-lists         суточное обновление (задача и метод lists_update)
hooks/                   ensure-lists, backup, support, purge
lib/base.sh              общее: пути от хоста, скачивание, разбор каталога, свои списки
lib/methods.sh           тела методов
lib/fetch-missing.sh     довоз списков спеки (хук)
lib/allow-domains.sh     описание второго издателя и разбор его наборов
```

## Свои списки в архиве настроек

Архив настроек (плагин `backup`) просит плагин отдать разделы: `list_domains_<имя>`, `list_prefixes_<имя>` на каждый свой
список и `settings`. В имени раздела допустимы только буквы, цифры и подчёркивание, поэтому в имени списка `_` удваивается
(`__`), а `-` пишется `_d`: список `mine-a` едет разделом `list_prefixes_mine_da`. Кодировка однозначна. При
восстановлении списки проходят **тот же** санитайзер, что и при загрузке своего списка.

## Проверка

```sh
sh tests/listsmatch.sh      # обновление, откат, порог, второй издатель
sh tests/srsmatch.sh        # наборы .srs с настоящим ядром
sh tests/pluginhygiene.sh   # граница API
sh /путь/к/plugin-sdk/tests/compat/run.sh plugins/lists-catalog
```
