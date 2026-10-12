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
    },
    api: {
        state: () => invoke('api:state'),
        connect: (address, password) => invoke('api:connect', address, password),
        disconnect: () => invoke('api:disconnect'),
        call: (method, params) => invoke('api:call', method, params),
        onLost: (cb) => listen('api:lost', cb),
    },
})
