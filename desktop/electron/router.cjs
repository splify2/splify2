'use strict'
// Клиент API splify2 (docs/api.md): подключение устройства, пара токенов и вызовы методов.
//
// Токены живут ЗДЕСЬ, в главном процессе, а не в окне: страница видит только «вызови метод», и
// никакой код страницы не может прочитать токен обновления. На диске оба токена лежат
// зашифрованными средствами системы (safeStorage: DPAPI в Windows, связка ключей в Linux).

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { safeStorage } = require('electron')

const PREFIX = '/cgi-bin/splify2-api'

// Методы, которые бывают дольше минуты (установка пакетов, скачивание списков и подписок,
// восстановление архива). Их шлюз выполняет заданием (?async=1), иначе uhttpd оборвал бы ответ
// на 60-й секунде. Остальные идут прямым вызовом — он дешевле.
const LONG = new Set([
    'apply', 'steer_install', 'splify2_install', 'steer_module_add', 'steer_module_del',
    'list_fetch', 'lists_update', 'sub_set', 'sub_refresh', 'backup_put',
])

// Токен доступа обновляется заранее, за минуту до конца срока, — чтобы вызов не упирался в 401.
const EARLY_MS = 60_000
const TIMEOUT_MS = 70_000

class ApiError extends Error {
    constructor(status, code, message) {
        super(message)
        this.status = status
        this.code = code
    }
}

function seal(text) {
    if (safeStorage.isEncryptionAvailable()) return { enc: safeStorage.encryptString(text).toString('base64') }
    return { plain: text }
}

function unseal(v) {
    if (!v) return null
    try {
        if (v.enc) return safeStorage.decryptString(Buffer.from(v.enc, 'base64'))
        return v.plain ?? null
    } catch {
        return null
    }
}

/** Адрес роутера из того, что набрал человек: «192.168.1.1», «router.lan:8080», «https://…». */
function normalizeBase(input) {
    let s = String(input || '').trim()
    if (!s) throw new ApiError(0, 'bad_address', 'Укажите адрес роутера')
    if (!/^https?:\/\//i.test(s)) s = 'http://' + s
    let u
    try { u = new URL(s) } catch { throw new ApiError(0, 'bad_address', 'Адрес роутера не распознан') }
    return u.origin
}

class Router extends EventEmitter {
    constructor(file) {
        super()
        this.file = file
        this.base = null
        this.hostname = ''
        this.device = null
        this.access = null
        this.accessExp = 0
        this.refreshToken = null
        this.refreshing = null
        this.load()
    }

    load() {
        let d
        try { d = JSON.parse(fs.readFileSync(this.file, 'utf8')) } catch { return }
        this.base = d.base ?? null
        this.hostname = d.hostname ?? ''
        this.device = d.device ?? null
        this.refreshToken = unseal(d.refresh)
        this.access = unseal(d.access)
        this.accessExp = d.accessExp ?? 0
        if (!this.refreshToken) this.base = null
    }

    save() {
        fs.mkdirSync(path.dirname(this.file), { recursive: true })
        const d = {
            base: this.base, hostname: this.hostname, device: this.device,
            refresh: this.refreshToken ? seal(this.refreshToken) : null,
            access: this.access ? seal(this.access) : null,
            accessExp: this.accessExp,
        }
        const tmp = this.file + '.tmp'
        fs.writeFileSync(tmp, JSON.stringify(d), { mode: 0o600 })
        fs.renameSync(tmp, this.file)
    }

    forget() {
        this.base = null
        this.hostname = ''
        this.device = null
        this.access = null
        this.accessExp = 0
        this.refreshToken = null
        try { fs.unlinkSync(this.file) } catch { /* файла и не было */ }
    }

    get state() {
        return {
            connected: !!this.base,
            base: this.base,
            hostname: this.hostname,
            device: this.device,
        }
    }

    async http(base, method, url, body, token) {
        const headers = { Accept: 'application/json' }
        if (body !== undefined) headers['Content-Type'] = 'application/json'
        if (token) headers.Authorization = 'Bearer ' + token
        let res
        try {
            res = await fetch(base + PREFIX + url, {
                method, headers,
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(TIMEOUT_MS),
                redirect: 'error',
            })
        } catch (e) {
            if (e?.name === 'TimeoutError') throw new ApiError(0, 'timeout', 'Роутер не ответил вовремя')
            throw new ApiError(0, 'network', 'Роутер не отвечает')
        }
        let data = null
        try { data = await res.json() } catch { /* не JSON */ }
        return { status: res.status, data }
    }

    take(t) {
        this.access = t.access_token
        this.accessExp = Date.now() + (t.expires_in ?? 3600) * 1000
        this.refreshToken = t.refresh_token
        if (t.device) this.device = t.device
    }

    /** Подключить это устройство: пароль уходит роутеру один раз и нигде не хранится. */
    async connect(address, password, username = 'root') {
        const base = normalizeBase(address)
        const info = await this.http(base, 'GET', '/v1/info')
        if (info.status === 404 || info.data?.product !== 'splify2')
            throw new ApiError(info.status, 'no_api', 'На роутере нет splify2 нужной версии — обновите splify2')
        const r = await this.http(base, 'POST', '/v1/auth/login', {
            username, password,
            device_name: os.hostname().slice(0, 64) || 'Компьютер',
            platform: process.platform,
        })
        if (r.status !== 200) throw new ApiError(r.status, r.data?.error ?? 'http', r.data?.message ?? `Ошибка ${r.status}`)
        this.base = base
        this.hostname = info.data.hostname || ''
        this.take(r.data)
        this.save()
        this.emit('changed')
        return this.state
    }

    /** Отключить устройство: роутер забывает его токены, здесь стирается всё. */
    async disconnect() {
        if (this.base) {
            try { await this.request('POST', '/v1/auth/logout', {}) } catch { /* роутер недоступен — забываем у себя */ }
        }
        this.forget()
        this.emit('changed')
    }

    /** Одно обновление на всех: два вызова, упёршиеся в срок одновременно, не тратят токен дважды. */
    refresh() {
        if (!this.refreshing) {
            this.refreshing = this.doRefresh().finally(() => { this.refreshing = null })
        }
        return this.refreshing
    }

    async doRefresh() {
        if (!this.base || !this.refreshToken) throw new ApiError(401, 'lost', 'Устройство не подключено')
        const r = await this.http(this.base, 'POST', '/v1/auth/refresh', { refresh_token: this.refreshToken })
        if (r.status === 200) {
            this.take(r.data)
            this.save()
            return
        }
        if (r.status === 401) {
            // Роутер устройство не знает: отключили в панели, сбросили роутер или токен украден.
            const msg = r.data?.message ?? 'Роутер больше не узнаёт это устройство'
            this.forget()
            this.emit('lost', msg)
            this.emit('changed')
            throw new ApiError(401, 'lost', msg)
        }
        throw new ApiError(r.status, r.data?.error ?? 'http', r.data?.message ?? `Ошибка ${r.status}`)
    }

    async request(method, url, body) {
        if (!this.base) throw new ApiError(401, 'lost', 'Устройство не подключено')
        if (!this.access || Date.now() > this.accessExp - EARLY_MS) await this.refresh()
        let r = await this.http(this.base, method, url, body, this.access)
        if (r.status === 401) {
            // Токен доступа живёт в памяти роутера: после его перезагрузки токена там нет.
            this.access = null
            await this.refresh()
            r = await this.http(this.base, method, url, body, this.access)
        }
        if (r.status !== 200 && r.status !== 202)
            throw new ApiError(r.status, r.data?.error ?? 'http', r.data?.message ?? `Ошибка ${r.status}`)
        return r
    }

    /** Вызов метода ubus-объекта splify2 — ровно то, что панель LuCI зовёт через rpc.declare. */
    async call(method, params) {
        const q = LONG.has(method) ? '?async=1' : ''
        let r = await this.request('POST', `/v1/call/${encodeURIComponent(method)}${q}`, params ?? {})
        while (r.status === 202) r = await this.request('GET', `/v1/jobs/${r.data.job}`)
        return r.data
    }
}

module.exports = { Router, ApiError }
