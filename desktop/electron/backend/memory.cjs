'use strict'
// Память приложения по роутеру: последний ответ роутера по ключу (состояние, спека, каталог,
// подписки…) — чтобы окно открывалось сразу с данными, а свежее приходило в фоне.
//
// В ГЛАВНОМ ПРОЦЕССЕ, а не в localStorage окна: Chromium пишет localStorage на диск не сразу, и
// закрытие без сохранения (выключение Windows, снятая задача, сбой) теряло его целиком — окно
// открывалось с «Загрузка…». Здесь файл пишется сам, атомарно (через временный), через полсекунды
// тишины и при выходе. Свой файл на роутер: переключение роутеров не смешивает их данные.

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const WRITE_MS = 500

class Memory {
    constructor(dir) {
        this.dir = dir
        this.base = null
        this.data = {}
        this.timer = null
    }

    file(base) {
        const id = crypto.createHash('sha1').update(String(base)).digest('hex').slice(0, 16)
        return path.join(this.dir, `${id}.json`)
    }

    /** Роутер сменился (или подключился): память — его. */
    use(base) {
        if (base === this.base) return
        this.flush()
        this.base = base || null
        this.data = {}
        if (!this.base) return
        try {
            const v = JSON.parse(fs.readFileSync(this.file(this.base), 'utf8'))
            if (v && typeof v === 'object') this.data = v
        } catch { /* нет файла или испорчен — начинаем с пустой */ }
    }

    all() { return this.data }

    set(key, value) {
        if (!this.base || typeof key !== 'string') return
        this.data[key] = value
        if (this.timer) clearTimeout(this.timer)
        this.timer = setTimeout(() => this.flush(), WRITE_MS)
    }

    flush() {
        if (this.timer) { clearTimeout(this.timer); this.timer = null }
        if (!this.base) return
        try {
            fs.mkdirSync(this.dir, { recursive: true })
            const f = this.file(this.base)
            const tmp = `${f}.tmp`
            fs.writeFileSync(tmp, JSON.stringify(this.data))
            fs.renameSync(tmp, f)
        } catch { /* диск полон или нет прав — память не главное */ }
    }

    /** Забыть роутер (отключение): его файл удаляется. */
    forget(base) {
        const b = base || this.base
        if (!b) return
        try { fs.unlinkSync(this.file(b)) } catch { /* нечего удалять */ }
        if (b === this.base) { this.data = {}; if (this.timer) { clearTimeout(this.timer); this.timer = null } }
    }
}

module.exports = { Memory }
