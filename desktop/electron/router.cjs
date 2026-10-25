'use strict'
// Клиент API splify2 (SPLIFY2_API.md в хабе): подключение устройства, пара токенов и вызовы методов.
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

// Сколько ждать, собирая одновременные вызовы в пакет (/v1/batch).
const BATCH_MS = 8

// Токен доступа обновляется заранее, за минуту до конца срока, — чтобы вызов не упирался в 401.
const EARLY_MS = 60_000
const TIMEOUT_MS = 70_000
// Подключение — разговор с человеком у экрана: адрес, в котором ошиблись, не должен держать форму
// минуту с лишним. Роутер в сети отвечает на эти два запроса за доли секунды.
const CONNECT_INFO_MS = 12_000
const CONNECT_LOGIN_MS = 30_000

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

/** Почему запрос не дошёл — словами для человека. Код остаётся `network`: по нему сторож судит, что
 *  роутер пропал со связи. */
function networkError(e) {
    const c = e?.cause
    // Несколько адресов (IPv4 и IPv6) дают AggregateError: причина — в первом из вложенных.
    const code = String(c?.code ?? c?.errors?.[0]?.code ?? '')
    const text = String(c?.message ?? e?.message ?? '')
    if (/CERT|TLS|SSL|SELF_SIGNED/i.test(code + ' ' + text))
        return new ApiError(0, 'network', 'Сертификат роутера не принят — подключитесь по адресу http://…')
    if (/redirect/i.test(text))
        return new ApiError(0, 'network', 'Роутер перенаправляет на другой адрес — укажите его полностью, например https://192.168.1.1')
    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return new ApiError(0, 'network', 'Адрес роутера не найден')
    if (code === 'ECONNREFUSED') return new ApiError(0, 'network', 'Роутер не принимает подключения по этому адресу и порту')
    if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH') return new ApiError(0, 'network', 'Нет пути к роутеру — проверьте сеть и адрес')
    return new ApiError(0, 'network', 'Роутер не отвечает')
}

/** «Слишком много неверных паролей»: сколько ждать — из ответа роутера. */
function retryText(secs) {
    if (!Number.isFinite(secs) || secs <= 0) return ''
    return secs < 90 ? ` Подождите ${Math.ceil(secs)} с.` : ` Подождите ${Math.ceil(secs / 60)} мин.`
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

    async http(base, method, url, body, token, timeoutMs = TIMEOUT_MS) {
        const headers = { Accept: 'application/json' }
        if (body !== undefined) headers['Content-Type'] = 'application/json'
        if (token) headers.Authorization = 'Bearer ' + token
        let res
        try {
            res = await fetch(base + PREFIX + url, {
                method, headers,
                body: body === undefined ? undefined : JSON.stringify(body),
                signal: AbortSignal.timeout(timeoutMs),
                redirect: 'error',
            })
        } catch (e) {
            if (e?.name === 'TimeoutError') throw new ApiError(0, 'timeout', 'Роутер не ответил вовремя')
            throw networkError(e)
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
        const info = await this.http(base, 'GET', '/v1/info', undefined, undefined, CONNECT_INFO_MS)
        if (info.status === 404 || info.data?.product !== 'splify2')
            throw new ApiError(info.status, 'no_api', 'На роутере нет splify2 нужной версии — обновите splify2')
        const r = await this.http(base, 'POST', '/v1/auth/login', {
            username, password,
            device_name: os.hostname().slice(0, 64) || 'Компьютер',
            platform: process.platform,
        }, undefined, CONNECT_LOGIN_MS)
        if (r.status !== 200) {
            const wait = r.status === 429 ? retryText(Number(r.data?.retry_after)) : ''
            throw new ApiError(r.status, r.data?.error ?? 'http', (r.data?.message ?? `Ошибка ${r.status}`) + wait)
        }
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

    /** Вызов метода ubus-объекта splify2 — ровно то, что панель LuCI зовёт через rpc.declare.
     *
     *  Короткие вызовы, ушедшие в одну и ту же минуту окна (BATCH_MS), едут одним пакетом
     *  (/v1/batch): у роутера это один процесс шлюза и одно соединение ubus вместо стольких, сколько
     *  вызовов, — открытие раздела спрашивает пять-семь методов разом. Шлюз постарше пакета не знает
     *  (404) — тогда по одному, как раньше. */
    async call(method, params) {
        try {
            const data = LONG.has(method) ? await this.callOne(method, params, true) : await this.enqueue(method, params)
            this.emit('call', method, data, null)
            return data
        } catch (e) {
            // Ответы видит сторож (backend/monitor.cjs): по ним он судит о роутере, не спрашивая сам.
            this.emit('call', method, null, e)
            throw e
        }
    }

    async callOne(method, params, long = false) {
        let r = await this.request('POST', `/v1/call/${encodeURIComponent(method)}${long ? '?async=1' : ''}`, params ?? {})
        while (r.status === 202) r = await this.request('GET', `/v1/jobs/${r.data.job}`)
        return r.data
    }

    enqueue(method, params) {
        if (this.noBatch) return this.callOne(method, params)
        return new Promise((resolve, reject) => {
            (this.queue ??= []).push({ method, params: params ?? {}, resolve, reject })
            if (!this.queueTimer) this.queueTimer = setTimeout(() => void this.flushQueue(), BATCH_MS)
        })
    }

    async flushQueue() {
        const q = this.queue ?? []
        this.queue = []
        this.queueTimer = null
        if (q.length === 1) {
            const [x] = q
            this.callOne(x.method, x.params).then(x.resolve, x.reject)
            return
        }
        let r
        try {
            r = await this.request('POST', '/v1/batch', { calls: q.map((x) => ({ method: x.method, params: x.params })) })
        } catch (e) {
            if (e?.status === 404) {
                this.noBatch = true
                for (const x of q) this.callOne(x.method, x.params).then(x.resolve, x.reject)
                return
            }
            for (const x of q) x.reject(e)
            return
        }
        const res = r.data?.results ?? []
        q.forEach((x, i) => {
            const v = res[i]
            if (v?.ok) x.resolve(v.result)
            else x.reject(new ApiError(v?.status ?? 502, v?.error ?? 'error', v?.message ?? 'Роутер не ответил'))
        })
    }

    /** События ядра (/v1/events, длинный запрос): цикл, пока устройство подключено. На каждое
     *  событие — `event`; шлюз постарше или ядро без подписки — цикл засыпает и пробует реже. */
    startEvents() {
        if (this.eventsOn) return
        this.eventsOn = true
        const loop = async () => {
            let pause = 0
            while (this.eventsOn && this.base) {
                if (pause) await new Promise((r) => setTimeout(r, pause))
                if (!this.eventsOn || !this.base) break
                const t0 = Date.now()
                try {
                    const r = await this.request('GET', '/v1/events')
                    const evs = r.data?.events ?? []
                    for (const ev of evs) this.emit('event', ev)
                    /* Нет подписки (ядро без демона, старое ядро) или ответ подозрительно быстрый без
                     * событий — не долбить роутер: следующая попытка через полминуты. */
                    pause = r.data?.unsupported || (!evs.length && Date.now() - t0 < 2000) ? 30_000 : 0
                } catch (e) {
                    pause = e?.status === 404 ? 300_000 : 10_000
                }
            }
            this.eventsOn = false
        }
        void loop()
    }

    stopEvents() { this.eventsOn = false }

    /** Подключённые к роутеру устройства (GET /v1/devices) и отключение одного из них. */
    async devices() {
        return (await this.request('GET', '/v1/devices')).data.devices
    }

    async revoke(id) {
        await this.request('POST', `/v1/devices/${encodeURIComponent(id)}/revoke`, {})
    }

    /** WarpBox: группы WARP, их туннели и точки, подбор (шлюз /v1/warp, только для ПК). */
    async warp() {
        return (await this.request('GET', '/v1/warp')).data
    }

    async warpScan(group) {
        return (await this.request('POST', `/v1/warp/${encodeURIComponent(group)}/scan`, {})).data
    }

    async warpScanState(group) {
        return (await this.request('GET', `/v1/warp/${encodeURIComponent(group)}/scan`)).data
    }

    /** Что за роутер: версия splify2 и имя (без токена). */
    async info() {
        if (!this.base) return null
        const r = await this.http(this.base, 'GET', '/v1/info')
        return r.status === 200 ? r.data : null
    }
}

module.exports = { Router, ApiError, normalizeBase, networkError, retryText }
