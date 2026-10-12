'use strict'
// splify2 для компьютера: окно без системной рамки, значок в трее и мост к API роутера.

const path = require('node:path')
const { pathToFileURL } = require('node:url')
const {
    app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, nativeTheme, net, protocol, shell,
} = require('electron')
const { Router } = require('./router.cjs')
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
/** @type {Tray | null} */
let tray = null
let quitting = false
let router

function showWindow() {
    if (!win) return createWindow()
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
}

function sendState() {
    if (!win || win.isDestroyed()) return
    win.webContents.send('win:state', { maximized: win.isMaximized(), focused: win.isFocused() })
}

function createWindow() {
    win = new BrowserWindow({
        width: 1280,
        height: 820,
        minWidth: 360,
        minHeight: 480,
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
        },
    })
    win.removeMenu()
    win.loadURL('app://splify/index.html')
    win.once('ready-to-show', () => {
        if (!process.argv.includes('--hidden')) win.show()
    })
    // Крестик прячет окно в трей, а не закрывает программу: выход — из меню значка.
    win.on('close', (e) => {
        if (!quitting) {
            e.preventDefault()
            win.hide()
        }
    })
    win.on('closed', () => { win = null })
    for (const ev of ['maximize', 'unmaximize', 'focus', 'blur', 'enter-full-screen', 'leave-full-screen'])
        win.on(ev, sendState)

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
}

function trayImage() {
    if (process.platform === 'win32') return nativeImage.createFromPath(path.join(RES, 'tray.ico'))
    const img = nativeImage.createFromPath(path.join(RES, 'tray-32.png'))
    return img.resize({ width: 22, height: 22 })
}

function updateTray() {
    if (!tray) return
    const st = router.state
    tray.setToolTip(st.connected ? `splify2 — ${st.hostname || st.base}` : 'splify2 — роутер не подключён')
    tray.setContextMenu(Menu.buildFromTemplate([
        { label: 'Открыть splify2', click: showWindow },
        { type: 'separator' },
        { label: 'Выход', click: () => { quitting = true; app.quit() } },
    ]))
}

function createTray() {
    tray = new Tray(trayImage())
    tray.on('click', showWindow)
    updateTray()
}

function registerIpc() {
    ipcMain.on('win:minimize', () => win?.minimize())
    ipcMain.on('win:toggle-maximize', () => {
        if (!win) return
        if (win.isMaximized()) win.unmaximize()
        else win.maximize()
    })
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
    ipcMain.handle('api:connect', wrap((address, password) => router.connect(address, password)))
    ipcMain.handle('api:disconnect', wrap(() => router.disconnect()))
    ipcMain.handle('api:call', wrap((method, params) => router.call(method, params)))
}

app.on('second-instance', showWindow)

app.on('before-quit', () => { quitting = true })

// Окно прячется в трей, поэтому закрытие всех окон программу не завершает.
app.on('window-all-closed', () => {})

app.whenReady().then(() => {
    router = new Router(path.join(app.getPath('userData'), 'connection.json'))
    router.on('changed', updateTray)
    router.on('lost', (msg) => win?.webContents.send('api:lost', msg))

    protocol.handle('app', (req) => {
        const u = new URL(req.url)
        const rel = path.normalize(decodeURIComponent(u.pathname)).replace(/^[/\\]+/, '') || 'index.html'
        const file = path.join(RENDERER, rel)
        if (file !== RENDERER && !file.startsWith(RENDERER + path.sep))
            return new Response('', { status: 403 })
        return net.fetch(pathToFileURL(file).toString())
    })

    registerIpc()
    createTray()
    createWindow()
})
