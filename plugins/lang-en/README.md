# lang-en — English

Official splify2 plugin (`splify2-core-plugins`), `type: language`. The splify2 frame is written in English, so its
dictionary is the identity map; the real content for the Andromeda panel is the English host dictionary.

## What is inside

| File | For | Format |
|---|---|---|
| `i18n/core/en.json` | the frame (classic LuCI JS) | "English string -> string"; every string of `luci/.../core/strings.json` maps to itself. It is kept in full so that a wording fix is one edit here and so that the coverage test is the same for every language |
| `i18n/host/en.json` | Andromeda | "`ns.key` -> string", `{0}`, `{1}` placeholders; the same keys as `ui/src/copy/en.json` |
| `i18n/backend/en.json` | the backend (rpcd, host services, official plugins) | "code -> text" with `{name}` placeholders; the code is the first argument of `fail_code` / `s2_fail_code` / `s2_t`. It equals the English default text in the code (`tests/i18nmatch.sh` checks it), so it is the reference for translators |
| `i18n/ru.json`, `i18n/en.json` | the plugin card | `plugin.name`, `plugin.description` |

Without any language plugin the frame is English anyway (a missing translation shows the key). The plugin matters for
Andromeda, whose strings are Russian in code (`ui/src/copy/ru.ts`): the panel stores this dictionary in the browser
(`registerHostDict`) and shows English after the language is switched.

## Tests

`tests/langmatch.sh`: coverage of `strings.json` without extra keys, the Andromeda dictionary equals `ui/src/copy/en.json`,
the real `i18n_get` returns the dictionary of an enabled plugin, `s2p lint --official` passes.

## Not covered

Log lines (`logger`, stderr), developer output and the messages of the `/cgi-bin/splify2-api` gateway (the `desktop-api` plugin; its refusals carry a
`gateway.*` code and the plugin's own `i18n/backend` dictionaries) are not translated by this plugin.
