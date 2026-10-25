'use strict'
// Обновление внутри приложения — как у Discord: при запуске заставка проверяет ленту, новая
// версия скачивается и программа перезапускается уже в ней.
//
// ЗАЧЕМ. Установщик Squirrel — всегда полная установка: старый каталог программы сносится
// целиком, и при запущенной программе он занят (Update.exe: «Failed to remove existing directory
// on full install, is the app still running???» — владелец: «установить новую версию не даёт при
// открытой старой»). Обновление через autoUpdater ставит новую версию рядом (app-<версия>) и
// переключает на неё при перезапуске — закрывать ничего не нужно.
//
// Лента — каталог с RELEASES и .nupkg (то, что кладёт сборка в release/squirrel-windows/).
// Адрес задаётся на сборке (`DESKTOP_UPDATE_FEED`, поле updateFeed в package.json приложения);
// нет адреса или программа не из установщика Squirrel — обновлений нет, проверки тоже.

const fs = require('node:fs')
const path = require('node:path')
const { app, autoUpdater } = require('electron')
const { EventEmitter } = require('node:events')

// Раз в полчаса и при каждом открытии окна (не чаще MIN_GAP_MS): программа живёт в трее
// сутками, и проверка раз в 4 часа означала, что выложенную версию человек не видит полдня
// (владелец: «а где обновление то»).
const CHECK_EVERY_MS = 30 * 60 * 1000
const MIN_GAP_MS = 5 * 60 * 1000
const FIRST_CHECK_MS = 6000
// Загрузка при запуске держит заставку; оборвавшаяся без ошибки сеть не должна держать её вечно.
const DOWNLOAD_MAX_MS = 120_000

function feed() {
    try { return require(path.join(__dirname, '..', '..', 'package.json')).updateFeed || '' } catch { return '' }
}

function squirrelInstalled() {
    return process.platform === 'win32' && app.isPackaged &&
        fs.existsSync(path.resolve(path.dirname(process.execPath), '..', 'Update.exe'))
}

class Updater extends EventEmitter {
    constructor() {
        super()
        this.url = feed()
        this.enabled = !!this.url && squirrelInstalled()
        /** idle | checking | downloading | ready | none | error */
        this.state = 'idle'
        if (!this.enabled) return
        autoUpdater.setFeedURL({ url: this.url })
        autoUpdater.on('checking-for-update', () => this.set('checking'))
        autoUpdater.on('update-available', () => this.set('downloading'))
        autoUpdater.on('update-not-available', () => this.set('none'))
        autoUpdater.on('update-downloaded', () => this.set('ready'))
        autoUpdater.on('error', (e) => { this.error = e?.message; this.set('error') })
        setInterval(() => this.check(), CHECK_EVERY_MS)
        // Первый запуск сразу после установки: Squirrel ещё держит свою блокировку, и проверка
        // падает ошибкой (документация Electron, autoUpdater). Проверим чуть позже.
        this.firstRun = process.argv.includes('--squirrel-firstrun')
        if (this.firstRun) setTimeout(() => this.check(), 30000)
    }

    set(state) {
        this.state = state
        this.emit('state', state)
    }

    check() {
        if (!this.enabled || this.state === 'checking' || this.state === 'downloading' || this.state === 'ready') return
        this.lastCheck = Date.now()
        try { autoUpdater.checkForUpdates() } catch (e) { this.error = e?.message; this.set('error') }
    }

    /** Проверить, если давно не проверяли (окно открыли из трея). */
    nudge() {
        if (Date.now() - (this.lastCheck || 0) >= MIN_GAP_MS) this.check()
    }

    /** Проверка при запуске: ответ «нет обновлений» за FIRST_CHECK_MS — или идём дальше без него;
     *  обновление нашлось — ждём загрузки (заставка говорит, что происходит). */
    startup() {
        if (!this.enabled || this.firstRun) return Promise.resolve('none')
        return new Promise((resolve) => {
            let t = setTimeout(() => done('timeout'), FIRST_CHECK_MS)
            const on = (s) => {
                if (s === 'downloading') { clearTimeout(t); t = setTimeout(() => done('timeout'), DOWNLOAD_MAX_MS) }
                if (s === 'none' || s === 'error' || s === 'ready') done(s)
            }
            const done = (s) => { if (t) clearTimeout(t); t = null; this.off('state', on); resolve(s) }
            this.on('state', on)
            this.check()
        })
    }

    install() {
        if (this.state === 'ready') autoUpdater.quitAndInstall()
    }
}

module.exports = { Updater }
