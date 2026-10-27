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
    /** Память по роутеру в главном процессе (backend/memory.cjs): снимок — синхронно, один раз при
     *  загрузке окна, чтобы первый кадр уже был с данными; запись — по каждому ответу роутера. */
    memory: {
        snapshot: ipcRenderer.sendSync('memory:load'),
        set: (key, value) => ipcRenderer.send('memory:set', key, value),
    },
    win: {
        minimize: () => ipcRenderer.send('win:minimize'),
        close: () => ipcRenderer.send('win:close'),
        state: () => ipcRenderer.invoke('win:state'),
        onState: (cb) => listen('win:state', cb),
        /** Главный процесс просит открыть раздел панели (щелчок по уведомлению). */
        onNav: (cb) => listen('nav', cb),
        /** …или настройки (пункт меню трея). */
        onOpenSettings: (cb) => listen('settings:open', cb),
        /** Трей: переключить правило с этим номером; перейти на другой роутер (адрес). */
        onTrayRule: (cb) => listen('tray:rule', cb),
        onRouterSwitched: (cb) => listen('router:switched', cb),
    },
    api: {
        state: () => invoke('api:state'),
        connect: (address, password) => invoke('api:connect', address, password),
        disconnect: () => invoke('api:disconnect'),
        /** Роутеры приложения: перечень, переход на другой, перемены перечня. */
        routers: () => invoke('api:routers'),
        use: (id) => invoke('api:use', id),
        onRouters: (cb) => listen('api:routers', cb),
        call: (method, params) => invoke('api:call', method, params),
        devices: () => invoke('api:devices'),
        revoke: (id) => invoke('api:revoke', id),
        info: () => invoke('api:info'),
        /** Событие ядра роутера (выход переключился, отказал, ожил; спека применена). */
        onEvent: (cb) => listen('api:event', cb),
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
    wizard: {
        discover: () => invoke('wizard:discover'),
        probe: (address) => invoke('wizard:probe', address),
        inspect: (address, password) => invoke('wizard:inspect', address, password),
        install: (address, password) => invoke('wizard:install', address, password),
        onLog: (cb) => listen('wizard:log', cb),
    },
    update: {
        onReady: (cb) => listen('update:ready', cb),
        install: () => ipcRenderer.invoke('update:install'),
        state: () => ipcRenderer.invoke('update:state'),
    },
    app: {
        info: () => invoke('app:info'),
        testNotification: () => invoke('notify:test'),
        open: (url) => invoke('shell:open', url),
    },
})
