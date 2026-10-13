'use strict'
// splify2 для компьютера: окно без системной рамки, значок в трее и мост к API роутера.

const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
const {
    app, BrowserWindow, Menu, Notification, Tray, ipcMain, nativeImage, nativeTheme, net, protocol, screen, shell,
} = require('electron')
const { Router } = require('./router.cjs')
const { Settings, BASE_ZOOM } = require('./backend/settings.cjs')
const { Monitor } = require('./backend/monitor.cjs')
const { discover, probe } = require('./backend/discover.cjs')
const setup = require('./backend/setup.cjs')
const { Updater } = require('./backend/updater.cjs')
const { Memory } = require('./backend/memory.cjs')
// Служебные запуски установщика Squirrel (Windows): ярлыки и выход; в остальных случаях — false.
if (require('./squirrel.cjs').handled()) return

const ROOT = path.join(__dirname, '..')
const RENDERER = path.join(ROOT, 'dist', 'renderer')
const RES = path.join(ROOT, 'resources')

// Страница грузится со своей схемы app://splify/, а не с file://: панель берёт логотип и шрифт
// флагов по адресу от корня (/favicon.svg), и у страницы должно быть постоянное происхождение —
// по нему браузер держит её память (localStorage) между запусками.
protocol.registerSchemesAsPrivileged([
    { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
])

if (!app.requestSingleInstanceLock()) {
    app.quit()
    process.exit(0)
}
app.setAppUserModelId('io.github.splify2.desktop')

/** @type {BrowserWindow | null} */
let win = null
/** @type {BrowserWindow | null} */
let splash = null
/** @type {Tray | null} */
let tray = null
let quitting = false
/** @type {Router} */
let router
/** @type {Settings} */
let settings
/** @type {Monitor} */
let monitor
/** @type {Updater} */
let updater
/** Память по роутеру: последние ответы роутера для мгновенного открытия окна. */
let memory
/** Раздел, который окно должно открыть, когда загрузится (щелчок по уведомлению при закрытом окне). */
let pendingNav = null

const HIDDEN_START = process.argv.includes('--hidden')

// ── окно ──────────────────────────────────────────────────────────────────────

function send(ch, v) {
    if (win && !win.isDestroyed()) win.webContents.send(ch, v)
}

function showWindow() {
    updater?.nudge()
    if (!win) {
        createWindow(true)
        return
    }
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
}

function navigate(section) {
    if (!section) return
    if (win && !win.webContents.isLoading()) send('nav', section)
    else pendingNav = section
}

function sendWinState() {
    if (!win || win.isDestroyed()) return
    send('win:state', { maximized: win.isMaximized(), focused: win.isFocused() })
}

function applyLook(s) {
    nativeTheme.themeSource = s.theme
    if (win && !win.isDestroyed()) win.webContents.setZoomFactor((s.zoom / 100) * BASE_ZOOM)
}

/** Заставка при запуске — как у Discord: маленькое окно с логотипом, пока поднимается главное. */
function createSplash() {
    splash = new BrowserWindow({
        width: 280,
        height: 300,
        frame: false,
        resizable: false,
        movable: true,
        transparent: true,
        skipTaskbar: false,
        show: false,
        alwaysOnTop: false,
        title: 'splify2',
        icon: path.join(RES, 'icon.png'),
        backgroundColor: '#00000000',
        webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
    })
    splash.loadURL('app://splify/splash.html')
    splash.once('ready-to-show', () => splash?.show())
    splash.on('closed', () => { splash = null })
}

/** Строка состояния на заставке («Проверяем обновления…»). */
function splashSay(text) {
    if (!splash || splash.isDestroyed()) return
    splash.webContents.executeJavaScript(`document.querySelector('.state').textContent = ${JSON.stringify(text)}`).catch(() => {})
}

function closeSplash() {
    if (!splash || splash.isDestroyed()) return
    const s = splash
    s.webContents.executeJavaScript('document.documentElement.classList.add("out")').catch(() => {})
    setTimeout(() => { if (!s.isDestroyed()) s.destroy() }, 220)
}

function createWindow(showNow) {
    const started = Date.now()
    // Размер окна ФИКСИРОВАННЫЙ (владелец: «у окна всё ещё можно менять размер, кнопку
    // полноэкрана надо убрать»): без растягивания, развёртывания и полного экрана — раскладка
    // всегда одна, широкая, с рельсом слева. Не больше 85 % рабочей области: в логических
    // пикселях 1280×820 на FHD с масштабом Windows 150 % — это 1920×1230 точек, больше экрана.
    const wa = screen.getPrimaryDisplay().workAreaSize
    const width = Math.min(1120, Math.round(wa.width * 0.85))
    const height = Math.min(740, Math.round(wa.height * 0.85))
    win = new BrowserWindow({
        width,
        height,
        center: true,
        resizable: false,
        maximizable: false,
        fullscreenable: false,
        frame: false,
        show: false,
        title: 'splify2',
        icon: path.join(RES, 'icon.png'),
        backgroundColor: nativeTheme.shouldUseDarkColors ? '#121317' : '#f4f5f8',
        webPreferences: {
            preload: path.join(__dirname, 'preload.cjs'),
            contextIsolation: true,
            sandbox: true,
            nodeIntegration: false,
            spellcheck: false,
            // Инструменты разработчика — только в сборке для разработки.
            devTools: !app.isPackaged,
            // Масштаб — с первого кадра, а не после загрузки: иначе окно мелькает крупным.
            zoomFactor: (settings.get().zoom / 100) * BASE_ZOOM,
        },
    })
    win.removeMenu()
    win.loadURL('app://splify/index.html')
    win.webContents.on('did-finish-load', () => {
        applyLook(settings.get())
        if (pendingNav) { send('nav', pendingNav); pendingNav = null }
    })
    win.once('ready-to-show', () => {
        if (!showNow) return
        // Заставка видна хотя бы мгновение: вспышка на 100 мс читается как сбой, а не как запуск.
        const wait = Math.max(0, 700 - (Date.now() - started))
        setTimeout(() => {
            if (!win || win.isDestroyed()) return
            win.show()
            closeSplash()
        }, wait)
    })
    // Крестик прячет окно в трей (если так настроено), выход — из меню значка.
    win.on('close', (e) => {
        if (!quitting && settings.get().closeToTray) {
            e.preventDefault()
            win.hide()
        }
    })
    win.on('closed', () => {
        win = null
        if (!settings.get().closeToTray && !quitting) app.quit()
    })
    for (const ev of ['maximize', 'unmaximize', 'focus', 'blur', 'enter-full-screen', 'leave-full-screen'])
        win.on(ev, sendWinState)

    // Ссылки наружу (выпуски на GitHub, страница подписки) — в браузер человека, а не новым окном.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (/^https?:\/\//i.test(url)) shell.openExternal(url)
        return { action: 'deny' }
    })
    win.webContents.on('will-navigate', (e, url) => {
        if (url.startsWith('app://splify/')) return
        e.preventDefault()
        if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    })

    // ПРИЛОЖЕНИЕ, А НЕ БРАУЗЕР (владелец: «перелопать браузер в полноценное приложение»). Клавиши
    // браузера — перезагрузка страницы, печать, её исходник, масштаб — не делают ничего: перезагрузка
    // сбрасывала бы состояние посреди правки, масштаб — свой, в настройках. Щипок тачпада не
    // увеличивает. Инструменты разработчика — только в сборке для разработки.
    win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {})
    win.webContents.on('before-input-event', (e, input) => {
        if (input.type !== 'keyDown') return
        const k = input.key.toLowerCase()
        const mod = input.control || input.meta
        if (k === 'f5' || (mod && ['r', 'p', 'u', '=', '+', '-', '0'].includes(k)) ||
            (app.isPackaged && (k === 'f12' || (mod && input.shift && ['i', 'j', 'c'].includes(k)))))
            e.preventDefault()
    })
    // Своё короткое меню правки — только там, где оно нужно: в поле ввода и на выделенном тексте.
    win.webContents.on('context-menu', (_e, p) => {
        const f = p.editFlags
        const items = p.isEditable
            ? [
                { role: 'cut', label: 'Вырезать', enabled: f.canCut },
                { role: 'copy', label: 'Копировать', enabled: f.canCopy },
                { role: 'paste', label: 'Вставить', enabled: f.canPaste },
                { type: 'separator' },
                { role: 'selectAll', label: 'Выделить всё', enabled: f.canSelectAll },
            ]
            : p.selectionText.trim() ? [{ role: 'copy', label: 'Копировать' }] : []
        if (items.length) Menu.buildFromTemplate(items).popup({ window: win })
    })
}

// ── трей ──────────────────────────────────────────────────────────────────────

function trayImage(alert) {
    const name = alert ? 'tray-alert' : 'tray'
    if (process.platform === 'win32') {
        const ico = path.join(RES, name + '.ico')
        if (fs.existsSync(ico)) return nativeImage.createFromPath(ico)
    }
    const png = path.join(RES, name + '-32.png')
    const img = nativeImage.createFromPath(fs.existsSync(png) ? png : path.join(RES, 'tray-32.png'))
    return img.resize({ width: 22, height: 22 })
}

let trayAlert = false

function updateTray() {
    if (!tray) return
    const st = router.state
    const m = monitor?.state
    const bad = !!st.connected && (m?.reachable === false || m?.engine === false ||
        Object.values(m?.outputs || {}).includes('down'))
    if (bad !== trayAlert) {
        trayAlert = bad
        tray.setImage(trayImage(bad))
    }
    let line = 'роутер не подключён'
    if (st.connected) {
        const host = st.hostname || st.base
        if (m?.reachable === false) line = `${host} — нет связи`
        else if (m?.engine === false) line = `${host} — ядро не отвечает`
        else {
            const down = Object.entries(m?.outputs || {}).filter(([, v]) => v === 'down').map(([k]) => k)
            line = down.length ? `${host} — не отвечает: ${down.join(', ')}` : `${host} — всё работает`
        }
    }
    tray.setToolTip(`splify2 — ${line}`)
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Открыть splify2', click: showWindow },
        { label: 'Настройки', click: () => { showWindow(); send('settings:open', null) } },
        ...(updater?.state === 'ready'
            ? [{ label: 'Перезапустить в новой версии', click: () => updater.install() }]
            : []),
        { type: 'separator' },
        { label: line, enabled: false },
        { type: 'separator' },
        { label: 'Выход', click: () => { quitting = true; app.quit() } },
    ]))
}

// ── уведомления ───────────────────────────────────────────────────────────────

function notify(ev) {
    console.log(`splify2: ${ev.down ? 'сбой' : 'починилось'} — ${ev.title}: ${ev.body}`)
    const n = settings.get().notify
    if (!n.enabled || !n[ev.kind]) return
    if (!ev.down && !n.recover) return
    if (!Notification.isSupported()) return
    const note = new Notification({
        title: ev.title,
        body: ev.body,
        silent: !n.sound,
        icon: path.join(RES, 'icon.png'),
    })
    note.on('click', () => {
        showWindow()
        navigate(ev.section)
    })
    note.show()
}

// ── автозапуск ────────────────────────────────────────────────────────────────

function applyLoginItem(s) {
    // Из исходников (npm start) автозапуск не трогаем: он записал бы в систему путь к electron
    // из node_modules.
    if (!app.isPackaged || process.platform === 'linux') return
    const opts = { openAtLogin: s.launchAtLogin, args: ['--hidden'] }
    // Установка Squirrel кладёт программу в app-<версия>\ рядом с Update.exe: запуск через него
    // переживает обновление (путь к exe с номером версии после обновления бы умер).
    const update = path.resolve(path.dirname(process.execPath), '..', 'Update.exe')
    if (process.platform === 'win32' && fs.existsSync(update)) {
        opts.path = update
        opts.args = ['--processStart', path.basename(process.execPath), '--process-start-args', '--hidden']
    }
    app.setLoginItemSettings(opts)
}

// ── связь с окном ─────────────────────────────────────────────────────────────

function registerIpc() {
    ipcMain.on('win:minimize', () => win?.minimize())
    ipcMain.on('win:close', () => win?.close())
    ipcMain.handle('win:state', () => ({ maximized: !!win?.isMaximized(), focused: !!win?.isFocused() }))

    // Ошибки уходят в окно значением, а не исключением: исключение через IPC приезжает с
    // приставкой «Error invoking remote method…», а человеку нужен текст роутера как есть.
    const wrap = (fn) => async (_e, ...args) => {
        try {
            return { ok: true, result: await fn(...args) }
        } catch (e) {
            return { ok: false, error: e?.code ?? 'error', message: e?.message ?? String(e) }
        }
    }
    ipcMain.handle('api:state', wrap(() => router.state))
    // Память по роутеру (backend/memory.cjs): окно читает её синхронно при запуске — первый кадр уже
    // с данными; пишет — по каждому ответу роутера.
    ipcMain.on('memory:load', (e) => { memory.use(router.state.base); e.returnValue = memory.all() })
    ipcMain.on('memory:set', (_e, key, value) => memory.set(key, value))
    ipcMain.handle('api:connect', wrap((address, password) => router.connect(address, password)))
    ipcMain.handle('api:disconnect', wrap(() => { memory.forget(router.state.base); return router.disconnect() }))
    ipcMain.handle('api:call', wrap((method, params) => router.call(method, params)))
    ipcMain.handle('api:devices', wrap(() => router.devices()))
    ipcMain.handle('api:revoke', wrap((id) => router.revoke(id)))
    ipcMain.handle('api:info', wrap(() => router.info()))
    ipcMain.handle('warp:state', wrap(() => router.warp()))
    ipcMain.handle('warp:scan', wrap((group) => router.warpScan(group)))
    ipcMain.handle('warp:scan-state', wrap((group) => router.warpScanState(group)))

    ipcMain.handle('settings:get', wrap(() => settings.get()))
    ipcMain.handle('settings:set', wrap((patch) => settings.set(patch)))
    ipcMain.handle('monitor:state', wrap(() => monitor.state))
    ipcMain.handle('app:info', wrap(() => ({
        version: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        platform: process.platform,
    })))
    ipcMain.handle('notify:test', wrap(() => {
        if (!Notification.isSupported()) throw Object.assign(new Error('Система не показывает уведомления'), { code: 'unsupported' })
        const n = new Notification({
            title: 'Уведомления включены',
            body: 'Так splify2 сообщит о сбое на роутере',
            silent: !settings.get().notify.sound,
            icon: path.join(RES, 'icon.png'),
        })
        n.on('click', showWindow)
        n.show()
        return true
    }))
    // Мастер первого запуска: поиск роутера, осмотр и установка splify2 по SSH (backend/).
    ipcMain.handle('wizard:discover', wrap(() => discover()))
    ipcMain.handle('wizard:probe', wrap((address) => probe(address)))
    ipcMain.handle('wizard:inspect', wrap((address, password) => setup.inspect(address, password)))
    ipcMain.handle('wizard:install', wrap((address, password) =>
        setup.install(address, password, (line) => send('wizard:log', line))))

    ipcMain.handle('shell:open', wrap((url) => {
        if (!/^https?:\/\//i.test(url)) throw new Error('Только адреса http(s)')
        return shell.openExternal(url)
    }))
}

app.on('second-instance', showWindow)

app.on('before-quit', () => { quitting = true; memory?.flush() })

// Окно прячется в трей, поэтому закрытие всех окон программу не завершает.
app.on('window-all-closed', () => {})

app.whenReady().then(() => {
    settings = new Settings(path.join(app.getPath('userData'), 'settings.json'))
    router = new Router(path.join(app.getPath('userData'), 'connection.json'))
    memory = new Memory(path.join(app.getPath('userData'), 'memory'))
    memory.use(router.state.base)
    monitor = new Monitor(router, settings)

    nativeTheme.themeSource = settings.get().theme
    applyLoginItem(settings.get())
    settings.on('changed', (s, before) => {
        applyLook(s)
        if (s.launchAtLogin !== before.launchAtLogin) applyLoginItem(s)
        send('settings:changed', s)
    })

    router.on('changed', () => {
        memory.use(router.state.base)
        if (router.state.connected) router.startEvents(); else router.stopEvents()
        updateTray()
        send('api:changed', router.state)
    })
    // События ядра: окно перечитывает состояние; скрытое окно — сторож спрашивает сам. Перебор узлов
    // подписки (`node`) и пути моста (`health`) идут часто и состояния выходов не меняют — мимо.
    router.on('event', (ev) => {
        if (ev?.ev === 'node' || ev?.ev === 'health') return
        if (win && !win.isDestroyed() && win.isVisible()) send('api:event', ev)
        else void monitor.now()
    })
    if (router.state.connected) router.startEvents()
    router.on('lost', (msg) => send('api:lost', msg))
    monitor.on('state', (st) => { updateTray(); send('monitor:state', st) })
    monitor.on('event', notify)

    protocol.handle('app', (req) => {
        const u = new URL(req.url)
        const rel = path.normalize(decodeURIComponent(u.pathname)).replace(/^[/\\]+/, '') || 'index.html'
        const file = path.join(RENDERER, rel)
        if (file !== RENDERER && !file.startsWith(RENDERER + path.sep))
            return new Response('', { status: 403 })
        return net.fetch(pathToFileURL(file).toString())
    })

    registerIpc()
    tray = new Tray(trayImage(false))
    tray.on('click', showWindow)
    updateTray()

    // Запуск вместе с системой — в трей, без окна: сторож и уведомления работают и так. Окно
    // создаётся при первом открытии.
    updater = new Updater()
    updater.on('state', (st) => {
        // Обновление скачалось, пока программа работала, — поставится при следующем запуске
        // (Squirrel переключает ярлык на новую версию); предлагаем перезапуск сейчас.
        if (st === 'ready' && win && !splash) send('update:ready', null)
        if (st === 'ready') updateTray()
    })
    ipcMain.handle('update:install', () => updater.install())
    ipcMain.handle('update:state', () => updater.state)

    if (HIDDEN_START && settings.get().startHidden) {
        updater.startup().then((r) => { if (r === 'ready') updater.install() })
        return
    }
    createSplash()
    splash.webContents.once('did-finish-load', () => { if (updater.enabled) splashSay('Проверяем обновления…') })
    updater.on('state', (st) => {
        if (st === 'downloading') splashSay('Загружаем обновление…')
        if (st === 'ready' && splash) splashSay('Перезапускаем…')
    })
    updater.startup().then((r) => {
        if (r === 'ready') {
            updater.install()
            return
        }
        splashSay('Запуск…')
        createWindow(true)
    })
})
