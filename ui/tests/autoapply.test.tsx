import { render } from '@testing-library/preact'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

import Console from '@/components/Console'
import { AUTO_APPLY_MS, startAutoApply } from '@/lib/autoapply'
import { notify } from '@/lib/notify'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { decodeSpec } from '@/lib/specv2'
import type { Spec, Status } from '@/lib/model'

// КНОПКИ «ПРИМЕНИТЬ» НЕТ: сохранённое применяется само, в LuCI так же, как в приложении.
//
// Проверяется lib/autoapply.ts на хранилище с поддельным роутером (диск + снимок применённого, как
// в rpcd), и что Console подключает его без `board`. Пачки правок держат применение через
// pending.hold/batch и применяются ОДНИМ применением в конце.

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T
const BASE: Spec = { outputs: { direct: { name: 'direct', kind: 'direct' } }, channels: [] } as Spec
const withRule = (n: number): Spec => ({
    ...BASE,
    channels: Array.from({ length: n }, (_, i) => ({ name: `r${i}`, out: 'direct', match: { any: true } })),
}) as Spec

let disk: Spec
let snapshot: Spec
let apply: ReturnType<typeof vi.spyOn>
let set: ReturnType<typeof vi.spyOn>
let applyOk = true

async function open(onDisk: Spec = BASE, applied: Spec = BASE) {
    vi.restoreAllMocks()
    vi.mocked(notify).mockClear()
    disk = clone(onDisk); snapshot = clone(applied); applyOk = true
    vi.spyOn(rpc, 'specGet').mockImplementation(async () => clone(disk))
    vi.spyOn(rpc, 'appliedGet').mockImplementation(async () => clone(snapshot))
    set = vi.spyOn(rpc, 'specSet').mockImplementation((async (json: string) => { disk = decodeSpec(JSON.parse(json)); return { ok: true } }) as never)
    apply = vi.spyOn(rpc, 'apply').mockImplementation((async () => {
        if (!applyOk) return { ok: false, output: '' }
        snapshot = clone(disk)
        return { ok: true, output: '' }
    }) as never)
    pending.saved = null; pending.applied = null; pending.dirty = false; pending.applying = false
    pending.justApplied = false; pending.savedFlash = false; pending.appliedAt = 0
    pending.saveError = null; pending.applyFailed = false
    await pending.load()
}

const said = () => vi.mocked(notify).mock.calls.map(([t, k]) => [t, k])
const tick = (ms: number) => vi.advanceTimersByTimeAsync(ms)
/** Сколько нужно тишины от правки до применения: запись (500) + её «Сохранено» (1800) + пауза. */
const QUIET = 500 + 1800 + AUTO_APPLY_MS + 200

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }) })
afterEach(() => { vi.useRealTimers() })

describe('автоприменение', () => {
    it('правка записывается и применяется сама, один раз', async () => {
        await open()
        const stop = startAutoApply()
        try {
            await tick(10) // первый показ: применять нечего
            expect(apply).not.toHaveBeenCalled()
            pending.edit(withRule(1))
            await tick(QUIET)
            expect(set).toHaveBeenCalledTimes(1)
            expect(apply).toHaveBeenCalledTimes(1)
            expect(snapshot.channels).toHaveLength(1)
            expect(pending.count()).toBe(0)
            await tick(QUIET)
            expect(apply).toHaveBeenCalledTimes(1)
        } finally { stop() }
    })

    it('серия правок подряд — одно применение с последним состоянием', async () => {
        await open()
        const stop = startAutoApply()
        try {
            await tick(10)
            for (let n = 1; n <= 4; n++) { pending.edit(withRule(n)); await tick(300) }
            await tick(QUIET)
            expect(apply).toHaveBeenCalledTimes(1)
            expect(snapshot.channels).toHaveLength(4)
        } finally { stop() }
    })

    it('записанное и не применённое до открытия применяется сразу после загрузки', async () => {
        await open(withRule(2), BASE)
        expect(pending.count()).toBeGreaterThan(0)
        const stop = startAutoApply()
        try {
            await tick(10)
            expect(apply).toHaveBeenCalledTimes(1)
            expect(snapshot.channels).toHaveLength(2)
        } finally { stop() }
    })

    it('применять нечего (сохранённое равно применённому) — роутер не трогается', async () => {
        await open()
        const stop = startAutoApply()
        try {
            pending.edit(clone(BASE))
            await tick(QUIET)
            expect(apply).not.toHaveBeenCalled()
        } finally { stop() }
    })
})

describe('пачки правок', () => {
    it('hold: правки пачки записываются, но применение ждёт конца и идёт одним разом', async () => {
        await open()
        const stop = startAutoApply()
        try {
            await tick(10)
            const release = pending.hold()
            pending.edit(withRule(1))
            await tick(QUIET)
            pending.edit(withRule(2))
            await tick(QUIET)
            expect(set).toHaveBeenCalledTimes(2)
            expect(apply).not.toHaveBeenCalled() // даже долгая пауза посреди пачки роутер не дёргает
            expect(pending.unfinished()).toBe(true)
            release()
            await tick(QUIET)
            expect(apply).toHaveBeenCalledTimes(1)
            expect(snapshot.channels).toHaveLength(2)
        } finally { stop() }
    })

    it('вложенные пачки: применение — после отпускания последней, повторное отпускание безвредно', async () => {
        await open()
        const stop = startAutoApply()
        try {
            await tick(10)
            const a = pending.hold(); const b = pending.hold()
            pending.edit(withRule(1))
            await tick(QUIET)
            a(); a()
            await tick(QUIET)
            expect(apply).not.toHaveBeenCalled()
            b()
            await tick(QUIET)
            expect(apply).toHaveBeenCalledTimes(1)
        } finally { stop() }
    })

    it('batch отпускает и при исключении', async () => {
        await open()
        await expect(pending.batch(async () => { throw new Error('x') })).rejects.toThrow('x')
        expect(pending.held).toBe(false)
    })

    it('загрузка страницы под hold (восстановление) не применяет, пока пачка держится', async () => {
        await open(withRule(2), BASE)
        const release = pending.hold()
        const stop = startAutoApply()
        try {
            await tick(QUIET)
            expect(apply).not.toHaveBeenCalled()
            release()
            await tick(QUIET)
            expect(apply).toHaveBeenCalledTimes(1)
        } finally { stop() }
    })
})

describe('отказ применения', () => {
    it('тост: что случилось и что делать; по кругу не повторяется; уход со страницы предупреждает', async () => {
        await open()
        const stop = startAutoApply()
        try {
            await tick(10)
            applyOk = false
            pending.edit(withRule(1))
            await tick(QUIET)
            expect(apply).toHaveBeenCalledTimes(1)
            const [text, kind] = said().find(([, k]) => k === 'error') as [string, string]
            expect(kind).toBe('error')
            expect(text).toMatch(/^Не применено, роутер работает по прежним настройкам/)
            expect(text).toMatch(/сбой применения/)
            await tick(QUIET * 3)
            expect(apply).toHaveBeenCalledTimes(1)
            expect(pending.applyFailed).toBe(true)
            expect(pending.unfinished()).toBe(true)

            applyOk = true // человек поправил — следующая правка применяет снова
            pending.edit(withRule(2))
            await tick(QUIET)
            expect(apply).toHaveBeenCalledTimes(2)
            expect(pending.applyFailed).toBe(false)
            expect(pending.unfinished()).toBe(false)
        } finally { stop() }
    })

    it('beforeunload: тишина, когда всё применено; предупреждение, пока применение не удалось', async () => {
        await open()
        const ev = () => { const e = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(e); return e.defaultPrevented }
        expect(ev()).toBe(false)
        pending.applyFailed = true
        expect(ev()).toBe(true)
        pending.applyFailed = false
        pending.applying = true
        expect(ev()).toBe(true)
        pending.applying = false
        expect(ev()).toBe(false)
    })
})

describe('Console в режиме LuCI (без board)', () => {
    it('нет кнопки «Применить», а сохранённое и не применённое применяется само', async () => {
        await open(withRule(1), BASE)
        const STATUS: Status = { schema: 1, outputs: {}, channels: [] } as unknown as Status
        vi.spyOn(rpc, 'live').mockResolvedValue({ status: STATUS, devices: {}, net: { uptime: 1, active_clients: 0 }, diag: { warn: 0, fail: 0, checks: [] } } as never)
        vi.spyOn(rpc, 'engine').mockResolvedValue({ present: true, vless: true, version: '1.1.2', enabled: true, running: true })
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] })
        vi.spyOn(rpc, 'engineState').mockResolvedValue({ instances: {}, log: [] })
        vi.spyOn(rpc, 'subInfo').mockResolvedValue({ kind: 'none', path: '', present: false } as never)
        const { container } = render(<Console />)
        await tick(50)
        expect(container.textContent).not.toMatch(/Применить/)
        expect(apply).toHaveBeenCalledTimes(1)
        expect(snapshot.channels).toHaveLength(1)
    })
})
