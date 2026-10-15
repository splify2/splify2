'use strict'
// Сторож роутера: из ответов роутера — состояние и события «что сломалось и что починилось».
//
// САМ СПРАШИВАЕТ РЕДКО. Панель в окне и так опрашивает `live` каждые несколько секунд, и её
// ответы проходят через главный процесс (router.cjs, событие `call`) — сторож читает их. Свой
// вопрос он задаёт, только когда панель молчит дольше `pollHidden` (окно скрыто в трей): роутер
// слабый, и второй круг опроса рядом с панелью был бы ему лишней работой.
//
// СОБЫТИЕ — ТОЛЬКО ПО ПЕРЕХОДУ, и переход подтверждается вторым наблюдением: одиночный
// пропущенный ответ или выход, мигнувший на один круг, — не повод будить человека. Первое
// наблюдение после запуска — точка отсчёта: о том, что было сломано до запуска, программа
// расскажет в окне, а не всплывающим сообщением.

const { EventEmitter } = require('node:events')

const NET_CODES = new Set(['network', 'timeout'])
const TICK_MS = 5000

/** Состояние выхода одним словом: up | down. Выходы-группы и члены групп — по группе. */
function outWord(st) {
    if (st.node_down || st.failed) return 'down'
    if (st.probe?.state === 'excluded') return 'down'
    return 'up'
}

const FAIL_TEXT = {
    drop: 'Трафик этого выхода остановлен',
    direct: 'Трафик этого выхода идёт напрямую',
    zapret: 'Трафик этого выхода идёт через обход',
}

class Monitor extends EventEmitter {
    constructor(router, settings) {
        super()
        this.router = router
        this.settings = settings
        this.lastLiveAt = 0
        this.polling = false
        // Наблюдения: подтверждённое значение и кандидат с числом подряд.
        this.seen = new Map()
        this.state = { reachable: null, engine: null, outputs: {}, diagFail: 0, at: 0 }
        this.timer = setInterval(() => this.tick(), TICK_MS)
        router.on('call', (method, result, error) => this.observe(method, result, error))
        router.on('changed', () => this.reset())
    }

    reset() {
        this.seen.clear()
        this.state = { reachable: null, engine: null, outputs: {}, diagFail: 0, at: 0 }
        this.lastLiveAt = 0
        this.emit('state', this.state)
    }

    stop() {
        clearInterval(this.timer)
    }

    /** Событие ядра (/v1/events): состояние спрашивается сразу, не дожидаясь своего круга, — так
     *  уведомление об упавшем выходе приходит через секунду, а не через опрос. Окно, если открыто,
     *  перечитает его само (api:event), и сторож увидит ответ в observe. */
    async now() {
        if (!this.router.state.connected || this.polling) return
        this.polling = true
        try {
            await this.router.call('live', this.settings.get().notify.diag ? { diag: true } : {})
        } catch { /* ответ уже пришёл в observe как ошибка */ }
        finally { this.polling = false }
    }

    async tick() {
        if (!this.router.state.connected || this.polling) return
        const quiet = Date.now() - this.lastLiveAt
        if (quiet < this.settings.get().pollHidden * 1000) return
        this.polling = true
        try {
            // diag — только когда о нём просили: проверки стоят роутеру вдвое дороже состояния.
            await this.router.call('live', this.settings.get().notify.diag ? { diag: true } : {})
        } catch { /* ответ уже пришёл в observe как ошибка */ }
        finally { this.polling = false }
    }

    observe(method, result, error) {
        if (error) {
            if (NET_CODES.has(error.code)) this.confirm('router', 'down')
            if (method === 'live') this.lastLiveAt = Date.now()
            return
        }
        this.confirm('router', 'up')
        if (method !== 'live' || !result) return
        this.lastLiveAt = Date.now()
        if (result.ok === false) {
            this.confirm('engine', 'down')
            return
        }
        this.confirm('engine', 'up')
        const outs = result.status?.outputs || {}
        // Члены групп (у WARP — `<выход>.<n>`, у пула — части) говорят через свою группу:
        // по сообщению на каждый туннель группы было бы шумом.
        const members = new Set()
        for (const st of Object.values(outs)) for (const m of st.group?.members || []) members.add(m)
        const now = {}
        for (const [name, st] of Object.entries(outs)) {
            if (st.kind === 'direct' || members.has(name)) continue
            now[name] = outWord(st)
            this.confirm('out:' + name, now[name], { name, onFail: st.on_fail })
        }
        if (result.diag) this.confirm('diag', result.diag.fail > 0 ? 'down' : 'up', { fail: result.diag.fail })
        this.state = {
            reachable: true,
            engine: true,
            outputs: now,
            diagFail: result.diag ? result.diag.fail : this.state.diagFail,
            at: Date.now(),
        }
        this.emit('state', this.state)
    }

    /** Значение `key` подтверждается вторым наблюдением подряд; переход — событие. */
    confirm(key, value, info = {}) {
        let s = this.seen.get(key)
        if (!s) {
            this.seen.set(key, { value, cand: value, n: 0 })
            this.mirror(key, value)
            return
        }
        if (value === s.value) {
            s.cand = value
            s.n = 0
            return
        }
        if (value !== s.cand) {
            s.cand = value
            s.n = 1
            return
        }
        if (++s.n < 2) return
        const before = s.value
        s.value = value
        this.mirror(key, value)
        this.emit('event', this.describe(key, before, value, info))
    }

    mirror(key, value) {
        if (key === 'router') this.state.reachable = value === 'up'
        if (key === 'engine') this.state.engine = value === 'up'
        if (key === 'router' || key === 'engine') this.emit('state', this.state)
    }

    describe(key, before, value, info) {
        const host = this.router.state.hostname || 'роутер'
        const down = value === 'down'
        if (key === 'router') {
            return down
                ? { kind: 'router', down, title: 'Роутер не отвечает', body: `Нет связи с ${host}` }
                : { kind: 'router', down, title: 'Роутер снова на связи', body: host }
        }
        if (key === 'engine') {
            return down
                ? { kind: 'engine', down, title: 'Ядро steer не отвечает', body: `Правила на ${host} могут не работать`, section: 'diag' }
                : { kind: 'engine', down, title: 'Ядро steer снова работает', body: host }
        }
        if (key === 'diag') {
            return down
                ? { kind: 'diag', down, title: 'Диагностика нашла сбой', body: `Проверок с отказом: ${info.fail}`, section: 'diag' }
                : { kind: 'diag', down, title: 'Сбоев в диагностике больше нет', body: host, section: 'diag' }
        }
        const name = info.name
        return down
            ? { kind: 'outputs', down, title: `Выход «${name}» не отвечает`, body: FAIL_TEXT[info.onFail] || FAIL_TEXT.drop, section: 'vpn' }
            : { kind: 'outputs', down, title: `Выход «${name}» снова работает`, body: host, section: 'vpn' }
    }
}

module.exports = { Monitor }
