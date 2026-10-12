'use strict'
// Мост окна к главному процессу. Страница получает только действия — токенов она не видит.

const { contextBridge, ipcRenderer } = require('electron')

function unwrap(r) {
    if (r.ok) return r.result
    const e = new Error(r.message)
    e.code = r.error
    throw e
}

const invoke = (ch, ...args) => ipcRenderer.invoke(ch, ...args).then(unwrap)

function listen(ch, cb) {
    const h = (_e, v) => cb(v)
    ipcRenderer.on(ch, h)
    return () => ipcRenderer.removeListener(ch, h)
}

contextBridge.exposeInMainWorld('splifyDesktop', {
    platform: process.platform,
    win: {
        minimize: () => ipcRenderer.send('win:minimize'),
        toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
        close: () => ipcRenderer.send('win:close'),
        state: () => ipcRenderer.invoke('win:state'),
        onState: (cb) => listen('win:state', cb),
        /** Главный процесс просит открыть раздел панели (щелчок по уведомлению). */
        onNav: (cb) => listen('nav', cb),
        /** …или настройки (пункт меню трея). */
        onOpenSettings: (cb) => listen('settings:open', cb),
    },
    api: {
        state: () => invoke('api:state'),
        connect: (address, password) => invoke('api:connect', address, password),
        disconnect: () => invoke('api:disconnect'),
        call: (method, params) => invoke('api:call', method, params),
        devices: () => invoke('api:devices'),
        revoke: (id) => invoke('api:revoke', id),
        info: () => invoke('api:info'),
        onLost: (cb) => listen('api:lost', cb),
        onChanged: (cb) => listen('api:changed', cb),
    },
    settings: {
        get: () => invoke('settings:get'),
        set: (patch) => invoke('settings:set', patch),
        onChanged: (cb) => listen('settings:changed', cb),
    },
    monitor: {
        state: () => invoke('monitor:state'),
        onState: (cb) => listen('monitor:state', cb),
    },
    warp: {
        state: () => invoke('warp:state'),
        scan: (group) => invoke('warp:scan', group),
        scanState: (group) => invoke('warp:scan-state', group),
    },
    wizard: {
        discover: () => invoke('wizard:discover'),
        probe: (address) => invoke('wizard:probe', address),
        inspect: (address, password) => invoke('wizard:inspect', address, password),
        install: (address, password) => invoke('wizard:install', address, password),
        onLog: (cb) => listen('wizard:log', cb),
    },
    app: {
        info: () => invoke('app:info'),
        testNotification: () => invoke('notify:test'),
        open: (url) => invoke('shell:open', url),
    },
})
