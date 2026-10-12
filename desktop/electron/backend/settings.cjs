'use strict'
// Настройки приложения: файл settings.json в каталоге данных, умолчания — здесь.
//
// Хранилище — в главном процессе, а окно получает копию и шлёт правки: настройки читает и
// бэкенд (сторож, уведомления, автозапуск), и он работает, когда окна нет вовсе.

const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')

const DEFAULTS = Object.freeze({
    /** system | light | dark */
    theme: 'system',
    /** Масштаб окна, проценты. */
    zoom: 100,
    /** Анимации интерфейса. Системное «уменьшить движение» выключает их и так. */
    motion: true,
    /** Запускаться вместе с системой — иначе уведомлений о сбоях нет, пока программу не откроют. */
    launchAtLogin: true,
    /** При запуске вместе с системой — сразу в трей, без окна. */
    startHidden: true,
    /** Крестик окна прячет в трей, а не закрывает программу. */
    closeToTray: true,
    notify: {
        enabled: true,
        sound: true,
        /** Роутер пропал и вернулся. */
        router: true,
        /** Ядро steer не отвечает. */
        engine: true,
        /** Выход перестал отвечать. */
        outputs: true,
        /** Сказать, когда сбой прошёл. */
        recover: true,
        /** Новые отказы в диагностике. */
        diag: false,
    },
    /** Как часто сторож спрашивает роутер сам, когда окно скрыто (секунды). */
    pollHidden: 30,
    /** Мастер первого запуска пройден. */
    wizardDone: false,
})

const ZOOMS = [80, 90, 100, 110, 125, 150]
const POLLS = [15, 30, 60, 300]

function merge(base, over) {
    const out = { ...base }
    for (const [k, v] of Object.entries(over || {})) {
        if (!(k in base)) continue
        const b = base[k]
        if (b && typeof b === 'object' && !Array.isArray(b)) out[k] = merge(b, v)
        else if (typeof v === typeof b) out[k] = v
    }
    return out
}

/** Значение в допустимых пределах: файл правят и руками. */
function sane(s) {
    if (!['system', 'light', 'dark'].includes(s.theme)) s.theme = DEFAULTS.theme
    if (!ZOOMS.includes(s.zoom)) s.zoom = DEFAULTS.zoom
    if (!POLLS.includes(s.pollHidden)) s.pollHidden = DEFAULTS.pollHidden
    return s
}

class Settings extends EventEmitter {
    constructor(file) {
        super()
        this.file = file
        let raw = {}
        try { raw = JSON.parse(fs.readFileSync(file, 'utf8')) } catch { /* первый запуск */ }
        this.data = sane(merge(DEFAULTS, raw))
    }

    get() {
        return structuredClone(this.data)
    }

    /** Правка частью: { notify: { sound: false } } меняет одно поле. */
    set(patch) {
        const before = this.data
        this.data = sane(merge(before, patch))
        fs.mkdirSync(path.dirname(this.file), { recursive: true })
        const tmp = this.file + '.tmp'
        fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2))
        fs.renameSync(tmp, this.file)
        this.emit('changed', this.get(), before)
        return this.get()
    }
}

module.exports = { Settings, DEFAULTS, ZOOMS, POLLS }
