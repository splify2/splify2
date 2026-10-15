'use strict'
// Установщик Windows на Squirrel (как у Discord): Setup.exe кладёт приложение в
// %LocalAppData%\splify2 без мастера и запускает его. Squirrel зовёт приложение с ключами
// --squirrel-install / -updated / -uninstall / -obsolete / -firstrun; здесь — ответ на них.
// Вне Windows и вне Squirrel (запуск из исходников, AppImage) модуль ничего не делает.

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { app } = require('electron')

// Имя пакета в nuspec (build.squirrelWindows.name в package.json) и имя exe без расширения:
// из них Squirrel собирает AppUserModelId ярлыков.
const SQUIRREL_NAME = 'splify2'
const EXE = path.basename(process.execPath)
const UPDATE = path.resolve(path.dirname(process.execPath), '..', 'Update.exe')
const UNDER_SQUIRREL = process.platform === 'win32' && fs.existsSync(UPDATE)

// AppUserModelId. Всплывающие уведомления Windows привязаны к ярлыку Пуска, и id в приложении
// обязан совпасть с id ярлыка. Update.exe --createShortcut ставит на ярлык id вида
// com.squirrel.<имя пакета>.<exe без расширения> — задать свой он не даёт. Поэтому под Squirrel
// выбор обратный прежнему: не ярлык подгоняем под io.github.splify2.desktop, а приложению
// подставляем id Squirrel. main.cjs зовёт setAppUserModelId со своим id уже после этого модуля —
// перехватываем вызов, правка main.cjs не нужна. Вне Squirrel вызов идёт как был.
const SQUIRREL_AUMID = `com.squirrel.${SQUIRREL_NAME}.${path.basename(EXE, '.exe')}`
if (UNDER_SQUIRREL) {
    const set = app.setAppUserModelId.bind(app)
    app.setAppUserModelId = () => set(SQUIRREL_AUMID)
}

/** Update.exe с ключом; ждём конца, пока приложение не вышло, иначе Squirrel не дождётся ярлыков. */
function update(arg) {
    try {
        spawnSync(UPDATE, [arg], { stdio: 'ignore', windowsHide: true })
    } catch { /* ярлык не вышел — не причина ронять установку */ }
}

/**
 * Обрабатывает событие Squirrel из командной строки. Возвращает true, если запуск был служебным и
 * приложение уже выходит — main.cjs в этом случае дальше не идёт.
 */
function handled(argv = process.argv) {
    if (!UNDER_SQUIRREL) return false
    const cmd = argv[1]
    switch (cmd) {
        case '--squirrel-install':
        case '--squirrel-updated':
            // Меню «Пуск» и рабочий стол; при обновлении ярлыки пересоздаются на новую папку версии.
            update(`--createShortcut=${EXE}`)
            app.quit()
            return true
        case '--squirrel-uninstall':
            update(`--removeShortcut=${EXE}`)
            // Автозапуск, записанный приложением, уходит вместе с ним.
            try { app.setLoginItemSettings({ openAtLogin: false }) } catch { /* нет записи — и ладно */ }
            app.quit()
            return true
        case '--squirrel-obsolete':
            // Зовётся у прежней версии перед удалением её папки.
            app.quit()
            return true
        default:
            // --squirrel-firstrun — обычный запуск сразу после установки: приложение стартует как всегда.
            return false
    }
}

module.exports = { handled, SQUIRREL_AUMID }
