'use strict'
// Несколько роутеров в одном приложении: у каждого свой файл с токенами (Router), окно работает с
// одним — активным — через этот фасад теми же вызовами, что и прежде с единственным роутером.
// Неактивные не простаивают: у каждого свой сторож (backend/monitor.cjs) и свой цикл событий, так
// что уведомление об упавшем выходе приходит с любого роутера.

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { EventEmitter } = require('node:events')
const { Router, normalizeBase } = require('./router.cjs')

class Routers extends EventEmitter {
    /** `dir` — каталог файлов роутеров. */
    constructor(dir) {
        super()
        this.dir = dir
        this.indexFile = path.join(dir, 'index.json')
        this.list = new Map()
        this.activeId = null
        fs.mkdirSync(dir, { recursive: true })
        let index = null
        try { index = JSON.parse(fs.readFileSync(this.indexFile, 'utf8')) } catch { /* первый запуск */ }
        for (const id of index?.order ?? []) {
            const r = new Router(this.fileOf(id))
            if (!r.state.connected) { try { fs.unlinkSync(this.fileOf(id)) } catch { /* нет файла */ } continue }
            this.attach(id, r)
        }
        this.activeId = this.list.has(index?.active) ? index.active : this.list.keys().next().value ?? null
        this.saveIndex()
    }

    newId() { return crypto.randomBytes(6).toString('hex') }
    fileOf(id) { return path.join(this.dir, `${id}.json`) }

    saveIndex() {
        const d = { active: this.activeId, order: [...this.list.keys()] }
        const tmp = this.indexFile + '.tmp'
        fs.writeFileSync(tmp, JSON.stringify(d), { mode: 0o600 })
        fs.renameSync(tmp, this.indexFile)
    }

    attach(id, r) {
        this.list.set(id, r)
        r.on('changed', () => {
            const was = id === this.activeId
            // Роутер сам себя забыл (отключили в его панели, сброшен) — убрать из списка.
            if (!r.state.connected && this.list.get(id) === r) this.drop(id)
            if (was) this.emit('changed')
            this.emit('list')
        })
        r.on('lost', (msg) => { if (id === this.activeId) this.emit('lost', msg) })
        r.on('call', (...a) => { if (id === this.activeId) this.emit('call', ...a) })
        this.emit('added', id, r)
    }

    drop(id) {
        const r = this.list.get(id)
        if (!r) return
        r.stopEvents()
        this.list.delete(id)
        this.emit('removed', id, r)
        if (this.activeId === id) this.activeId = this.list.keys().next().value ?? null
        this.saveIndex()
    }

    get active() { return this.activeId ? this.list.get(this.activeId) ?? null : null }

    /** Перечень для рамки окна: адрес, имя, активный ли. */
    routers() {
        return [...this.list.entries()].map(([id, r]) => ({ id, ...r.state, active: id === this.activeId }))
    }

    /** Сделать роутер активным: окно перезагрузится на нём (api:changed). */
    use(id) {
        if (!this.list.has(id) || id === this.activeId) return this.state
        this.activeId = id
        this.saveIndex()
        this.emit('changed')
        this.emit('list')
        return this.state
    }

    // ── фасад активного роутера: те же вызовы, что у Router ─────────────────

    get state() {
        return this.active?.state ?? { connected: false, base: null, hostname: '', device: null }
    }

    /** Подключить роутер: уже известный (тот же адрес) — заново, новый — добавить и сделать
     *  активным. Пароль уходит роутеру один раз и нигде не хранится. */
    async connect(address, password, username) {
        const base = normalizeBase(address)
        for (const [id, r] of this.list) {
            if (r.state.base !== base) continue
            await r.connect(address, password, username)
            return this.use(id)
        }
        const id = this.newId()
        const r = new Router(this.fileOf(id))
        try {
            await r.connect(address, password, username)
        } catch (e) {
            try { fs.unlinkSync(this.fileOf(id)) } catch { /* файл и не создавался */ }
            throw e
        }
        this.attach(id, r)
        this.activeId = id
        this.saveIndex()
        this.emit('changed')
        this.emit('list')
        return this.state
    }

    /** Отключить активный роутер: он забывает это устройство, активным становится следующий. */
    async disconnect() {
        const id = this.activeId
        const r = this.active
        if (!r) return
        await r.disconnect()
        this.drop(id)
        this.emit('changed')
        this.emit('list')
    }

    call(method, params) { return this.need().call(method, params) }
    devices() { return this.need().devices() }
    revoke(id) { return this.need().revoke(id) }
    info() { return this.active ? this.active.info() : Promise.resolve(null) }

    need() {
        const r = this.active
        if (!r) { const e = new Error('Устройство не подключено'); e.code = 'lost'; throw e }
        return r
    }
}

module.exports = { Routers }
