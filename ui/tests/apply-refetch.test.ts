import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Channel, Spec } from '@/lib/model'

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

import { applyText, mergeSpec, pending } from '@/lib/pending'
import { notify } from '@/lib/notify'
import { rpc } from '@/lib/rpc'
import { decodeSpec } from '@/lib/specv2'

// После «Применить» страница перечитывает спеку с роутера.
//
// apply там не только применяет: самолечение (spec_heal_ipv6) вписывает `ipv6: nat|off` выходам без
// ключа прямо в spec.json. Память страницы об этом не знала, и первая же правка отправляла на роутер
// прежнюю спеку — вылеченные ключи пропадали до следующего apply, а после перезагрузки страницы
// пилюля «Применить · N» горела от разницы со снимком, которой человек не делал.
//
// Бэкенд здесь заменён маленькой моделью: файл спеки, файл снимка и apply, который вылечивает
// выходы-интерфейсы без ключа и снимает снимок с УЖЕ вылеченного файла — ровно как m-spec.sh.

const HEAL_OUT =
    'splify2: выходам без ключа ipv6 записан ipv6: nat (у туннеля есть адрес IPv6): warp'
const RULE: Channel = { name: 'всё', out: 'direct', match: { any: true } }
const DRAFT: Channel = { name: 'Новое', out: 'warp', match: {} }

const BEFORE: Spec = {
    outputs: {
        direct: { name: 'direct', kind: 'direct' },
        warp: { name: 'warp', kind: 'interface', device: 'warp' },
    },
    channels: [],
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T

/** Что приходит на `spec_set`: спека в форме движка, `ipv6` лежит у выхода. */
function written(set: ReturnType<typeof vi.spyOn>, n = -1): { outputs: Record<string, { ipv6?: string }>; rules?: unknown[] } {
    return JSON.parse(set.mock.calls.at(n)![0] as string)
}

let disk: Spec
let snapshot: Spec
let order: string[]
let set: ReturnType<typeof vi.spyOn>
let apply: ReturnType<typeof vi.spyOn>

/** apply бэкенда: лечит файл и снимает снимок с него. */
function backendApply(): { ok: boolean; output: string } {
    disk = clone(disk)
    for (const o of Object.values(disk.outputs)) if (o.kind === 'interface' && !o.ipv6) o.ipv6 = 'nat'
    snapshot = clone(disk)
    return { ok: true, output: HEAL_OUT }
}

async function open(initial: Spec = BEFORE) {
    disk = clone(initial)
    snapshot = clone(initial)
    order = []
    vi.spyOn(rpc, 'specGet').mockImplementation(async () => { order.push('spec_get'); return clone(disk) })
    vi.spyOn(rpc, 'appliedGet').mockImplementation(async () => { order.push('applied_get'); return clone(snapshot) })
    // Файл спеки лежит в форме движка, а страница читает его через decodeSpec — как в rpc.specGet.
    set = vi.spyOn(rpc, 'specSet').mockImplementation((async (json: string) => {
        order.push('spec_set')
        disk = decodeSpec(JSON.parse(json))
        return { ok: true }
    }) as never)
    apply = vi.spyOn(rpc, 'apply').mockImplementation((async () => { order.push('apply'); return backendApply() }) as never)
    // @ts-expect-error — сброс внутреннего состояния между проверками
    pending.saved = null; pending.applied = null; pending.dirty = false; pending.applying = false; pending.justApplied = false
    await pending.load()
    order.length = 0
}

describe('после применения спека перечитывается', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        vi.mocked(notify).mockClear()
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    })
    afterEach(() => { vi.useRealTimers() })

    it('после ответа apply читаются spec_get и applied_get, спека и снимок — с роутера', async () => {
        await open()
        expect(pending.saved?.outputs.warp.ipv6).toBeUndefined()
        await pending.apply()
        expect(order).toEqual(['apply', 'spec_get', 'applied_get'])
        // В памяти — то, что теперь на роутере, с вылеченным ключом.
        expect(pending.saved?.outputs.warp.ipv6).toBe('nat')
        expect(pending.applied?.outputs.warp.ipv6).toBe('nat')
        // Применённое и сохранённое одинаковы — пилюле гореть нечем.
        expect(pending.count()).toBe(0)
        expect(pending.justApplied).toBe(true)
    })

    it('первая правка после применения не стирает вылеченный ключ', async () => {
        // Сама найденная ошибка: spec_set после apply нёс спеку без `ipv6`, и до следующего apply
        // ключ на роутере пропадал.
        await open()
        await pending.apply()
        set.mockClear()
        pending.edit({ ...pending.saved!, channels: [RULE] })
        await pending.flush()
        expect(set).toHaveBeenCalledTimes(1)
        const sent = written(set)
        expect(sent.outputs.warp.ipv6).toBe('nat')
        expect(sent.rules).toHaveLength(1)
        // И после перезагрузки страницы счётчик показывает ровно одну правку, а не две.
        expect(pending.count()).toBe(1)
    })

    it('ничего не вылечено — спека в памяти остаётся той же, а не пересобирается', async () => {
        const healthy = clone(BEFORE)
        healthy.outputs.warp.ipv6 = 'off'
        await open(healthy)
        const before = pending.saved
        await pending.apply()
        expect(pending.saved).toBe(before)
        expect(pending.count()).toBe(0)
    })

    it('правка, уехавшая до применения, правкой «за время применения» не считается', async () => {
        await open()
        pending.edit({ ...pending.saved!, channels: [RULE] })
        await pending.apply()
        // До apply — одна запись (её сделал сам apply перед вызовом), после — ни одной.
        expect(order).toEqual(['spec_set', 'apply', 'spec_get', 'applied_get'])
        await vi.advanceTimersByTimeAsync(1000)
        expect(set).toHaveBeenCalledTimes(1)
        expect(pending.saved?.outputs.warp.ipv6).toBe('nat')
        expect(pending.saved?.channels).toHaveLength(1)
        expect(pending.count()).toBe(0)
    })

    it('черновик правила переживает сверку и не вызывает лишней записи', async () => {
        await open()
        pending.edit({ ...pending.saved!, channels: [DRAFT] })
        await pending.flush()
        order.length = 0
        await pending.apply()
        await vi.advanceTimersByTimeAsync(1000)
        // Черновик на месте — ровно там, где стоял, — а вылеченный ключ приехал.
        expect(pending.saved?.channels).toEqual([DRAFT])
        expect(pending.saved?.outputs.warp.ipv6).toBe('nat')
        // На роутер он не ездит: после ответа apply записывать нечего (запись до вызова — прежняя
        // повадка apply, пока есть черновик, признак «не записано» не снимается).
        expect(order.slice(order.indexOf('apply') + 1)).toEqual(['spec_get', 'applied_get'])
        expect(pending.hasUnsaved()).toBe(true)
    })

    it('судья сохранённому — файл, судья применённому — снимок: расхождение между ними видно', async () => {
        // Файл после снятия снимка поправили мимо страницы (ssh, второй вкладкой): сохранённое берётся
        // из файла, применённое — из снимка, и пилюля честно считает эту правку неприменённой.
        await open()
        apply.mockImplementation((async () => {
            order.push('apply')
            const reply = backendApply()
            disk = clone(disk)
            disk.channels = [RULE]
            return reply
        }) as never)
        await pending.apply()
        expect(pending.applied?.channels).toEqual([])
        expect(pending.saved?.channels).toHaveLength(1)
        expect(pending.count()).toBe(1)
    })
})

describe('опора слияния — то, что на роутере', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        vi.mocked(notify).mockClear()
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    })
    afterEach(() => { vi.useRealTimers() })

    it('два применения подряд с правкой между ними: вторая правка не принимается за «за время применения»', async () => {
        await open()
        await pending.apply()
        pending.edit({ ...pending.saved!, channels: [RULE] })
        await pending.flush()
        set.mockClear()
        order.length = 0
        await pending.apply()
        await vi.advanceTimersByTimeAsync(1000)
        // Правка уехала до второго apply и приехала в нём же: записывать после ответа нечего.
        expect(set).not.toHaveBeenCalled()
        expect(pending.saved?.channels).toEqual([RULE])
        expect(pending.saved?.outputs.warp.ipv6).toBe('nat')
        expect(pending.count()).toBe(0)
        expect(pending.hasUnsaved()).toBe(false)
    })

    it('уход со страницы без применения пишет, как и раньше', async () => {
        await open()
        pending.edit({ ...pending.saved!, channels: [RULE] })
        window.dispatchEvent(new Event('pagehide'))
        await vi.advanceTimersByTimeAsync(10)
        expect(set).toHaveBeenCalledTimes(1)
        expect(pending.hasUnsaved()).toBe(false)
    })

    it('ядро старше минимума: спека прежнего формата остаётся прежней, переноса после применения нет', async () => {
        // Спеку v1 при открытии не переписывают, пока ядро не обновлено (pending-migrate.test.ts); после
        // применения сверка не должна запустить этот перенос заново.
        vi.spyOn(rpc, 'engine').mockResolvedValue({ present: true, vless: true, version: '1.5.9', min_version: '2.0.0' } as never)
        const v1 = { ...BEFORE, schema: 2 } as Spec
        await open(v1)
        expect(pending.saved?.schema).toBeUndefined()
        apply.mockImplementation((async () => { order.push('apply'); return { ok: true, output: '' } }) as never)
        await pending.apply()
        await vi.advanceTimersByTimeAsync(1000)
        expect(set).not.toHaveBeenCalled()
        expect(pending.saved?.schema).toBeUndefined()
        expect(pending.count()).toBe(0)
        expect(pending.hasUnsaved()).toBe(false)
    })
})

describe('правки за время применения', () => {
    let finish: (r: { ok: boolean; output?: string }) => void

    /** apply, который отвечает, когда скажет тест, — а до того «идёт». Возвращает ход применения;
     *  `finish` появляется, когда вызов бэкенда действительно ушёл (после записи, что apply делает
     *  перед ним), поэтому тест сначала отдаёт ход таймерам. */
    function slowApply(): Promise<void> {
        apply.mockImplementation((() => new Promise((r) => {
            order.push('apply')
            finish = (v) => r(v.ok ? backendApply() : v)
        })) as never)
        return pending.apply()
    }

    beforeEach(() => {
        vi.restoreAllMocks()
        vi.mocked(notify).mockClear()
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    })
    afterEach(() => { vi.useRealTimers() })

    it('запись ждёт конца применения и уезжает поверх свежей спеки', async () => {
        await open()
        const run = slowApply()
        await vi.advanceTimersByTimeAsync(0)
        // Человек правит, пока применяется; таймер дебаунса отрабатывает.
        pending.edit({ ...pending.saved!, channels: [RULE] })
        await vi.advanceTimersByTimeAsync(600)
        expect(set).not.toHaveBeenCalled()
        expect(pending.hasUnsaved()).toBe(true)

        finish({ ok: true })
        await run
        await vi.advanceTimersByTimeAsync(10)
        // Правка в памяти — и вылеченный ключ тоже.
        expect(pending.saved?.channels).toEqual([RULE])
        expect(pending.saved?.outputs.warp.ipv6).toBe('nat')
        // Применено то, что ядро видело, а правка — не применена: пилюля горит ровно на ней.
        expect(pending.applied?.channels).toEqual([])
        expect(pending.count()).toBe(1)
        // Записана после ответа, одним spec_set, с обеими частями.
        expect(set).toHaveBeenCalledTimes(1)
        const sent = written(set)
        expect(sent.rules).toHaveLength(1)
        expect(sent.outputs.warp.ipv6).toBe('nat')
        expect(pending.hasUnsaved()).toBe(false)
        // Порядок: apply кончился раньше записи.
        expect(order.indexOf('spec_set')).toBeGreaterThan(order.indexOf('applied_get'))
    })

    it('правка не оставлена без записи, даже если таймер дебаунса успел сработать до ответа', async () => {
        await open()
        const run = slowApply()
        await vi.advanceTimersByTimeAsync(0)
        pending.edit({ ...pending.saved!, channels: [RULE] })
        void pending.flush() // то, что сделал бы таймер через 500 мс
        await vi.advanceTimersByTimeAsync(700)
        expect(set).not.toHaveBeenCalled()
        finish({ ok: true })
        await run
        await vi.advanceTimersByTimeAsync(10)
        expect(set).toHaveBeenCalledTimes(1)
        expect(pending.count()).toBe(1)
    })

    it('правка того же выхода, что лечится, сливается с лечением по ключам', async () => {
        const two = clone(BEFORE)
        two.outputs.wg2 = { name: 'wg2', kind: 'interface', device: 'wg2', ipv6: 'off' }
        await open(two)
        const run = slowApply()
        await vi.advanceTimersByTimeAsync(0)
        // Человек поправил warp, которому лечение как раз вписывает ipv6; у wg2 ключ явный — его
        // лечение не трогает. До результата доходит и правка, и лечение.
        pending.edit({ ...pending.saved!, outputs: { ...pending.saved!.outputs, warp: { ...pending.saved!.outputs.warp, on_fail: 'direct' } } })
        finish({ ok: true })
        await run
        await vi.advanceTimersByTimeAsync(600)
        expect(pending.saved?.outputs.warp.on_fail).toBe('direct')
        expect(pending.saved?.outputs.warp.ipv6).toBe('nat')
        expect(pending.saved?.outputs.wg2.ipv6).toBe('off')
        const sent = written(set)
        expect(sent.outputs.warp.ipv6).toBe('nat')
        expect(sent.outputs.wg2.ipv6).toBe('off')
        expect(pending.count()).toBe(1)
    })

    it('уход со страницы пишет сразу, не дожидаясь конца применения', async () => {
        // После ухода писать будет некому — правка важнее, чем согласие с самолечением бэкенда.
        await open()
        const run = slowApply()
        await vi.advanceTimersByTimeAsync(0)
        pending.edit({ ...pending.saved!, channels: [RULE] })
        window.dispatchEvent(new Event('pagehide'))
        await vi.advanceTimersByTimeAsync(10)
        expect(set).toHaveBeenCalledTimes(1)
        finish({ ok: true })
        await run
        await vi.advanceTimersByTimeAsync(1000)
        // Уехавшее до ответа второй раз не пишется: после ответа в файле то же, что в памяти.
        expect(set).toHaveBeenCalledTimes(1)
        expect(pending.saved?.channels).toEqual([RULE])
        expect(pending.saved?.outputs.warp.ipv6).toBe('nat')
        expect(pending.hasUnsaved()).toBe(false)
    })

    it('запись при уходе со страницы, ещё летящая к концу применения, дописывается до сверки', async () => {
        await open()
        let landed!: () => void
        set.mockImplementation((async (json: string) => {
            order.push('spec_set начат')
            await new Promise<void>((r) => { landed = r })
            disk = decodeSpec(JSON.parse(json))
            order.push('spec_set записан')
            return { ok: true }
        }) as never)
        const run = slowApply()
        await vi.advanceTimersByTimeAsync(0)
        pending.edit({ ...pending.saved!, channels: [RULE] })
        window.dispatchEvent(new Event('pagehide'))
        await vi.advanceTimersByTimeAsync(10)
        finish({ ok: true })
        await vi.advanceTimersByTimeAsync(10)
        // Ответ apply пришёл, а запись ещё летит: спеку читать рано.
        expect(order).not.toContain('spec_get')
        landed()
        await run
        await vi.advanceTimersByTimeAsync(1000)
        expect(order.indexOf('spec_get')).toBeGreaterThan(order.indexOf('spec_set записан'))
        // Прочитанное уже содержит запись: второй раз она не уезжает.
        expect(set).toHaveBeenCalledTimes(1)
        expect(pending.saved?.channels).toEqual([RULE])
    })

    it('flush извне (резервная копия) тоже ждёт конца применения', async () => {
        await open()
        const run = slowApply()
        await vi.advanceTimersByTimeAsync(0)
        pending.edit({ ...pending.saved!, channels: [RULE] })
        let flushed = false
        void pending.flush().then(() => { flushed = true })
        await vi.advanceTimersByTimeAsync(100)
        expect(flushed).toBe(false)
        finish({ ok: true })
        await run
        await vi.advanceTimersByTimeAsync(10)
        expect(flushed).toBe(true)
        expect(set).toHaveBeenCalledTimes(1)
    })

    it('повторное нажатие во время применения ничего не запускает', async () => {
        await open()
        const run = slowApply()
        await vi.advanceTimersByTimeAsync(0)
        await pending.apply()
        finish({ ok: true })
        await run
        expect(apply).toHaveBeenCalledTimes(1)
    })
})

describe('сверка не ломает применение', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        vi.mocked(notify).mockClear()
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    })
    afterEach(() => { vi.useRealTimers() })

    it('роутер не отдал спеку — применено, память прежняя, красного тоста нет', async () => {
        await open()
        vi.spyOn(rpc, 'specGet').mockRejectedValue(new Error('нет ответа'))
        vi.spyOn(rpc, 'appliedGet').mockRejectedValue(new Error('нет ответа'))
        const run = pending.apply()
        await vi.advanceTimersByTimeAsync(800) // пауза повторной попытки — 700 мс; «Применено» гаснет через 1800
        await run
        // Применённое — то, что мы отправили до вызова.
        expect(pending.applied).toEqual(BEFORE)
        expect(pending.saved).toEqual(BEFORE)
        expect(pending.count()).toBe(0)
        expect(pending.applying).toBe(false)
        expect(pending.justApplied).toBe(true)
        expect(vi.mocked(notify).mock.calls.filter(([, k]) => k === 'error')).toEqual([])
    })

    it('роутер ответил не спекой — как отказ, а не как пустая настройка', async () => {
        await open()
        vi.spyOn(rpc, 'specGet').mockResolvedValue({} as never)
        const run = pending.apply()
        await vi.advanceTimersByTimeAsync(800)
        await run
        expect(pending.saved).toEqual(BEFORE)
        expect(pending.loadFailed).toBe(false)
    })

    it('отказ apply: спека перечитана (файл мог быть исправлен), снимок прежний, пилюля остаётся', async () => {
        await open()
        apply.mockImplementation((async () => {
            order.push('apply')
            // Лечение прошло до отказа ядра, а снимок не снят — как в m-spec.sh.
            disk = clone(disk)
            disk.outputs.warp.ipv6 = 'nat'
            return { ok: false, output: HEAL_OUT + '\nsteer: нет такого выхода' }
        }) as never)
        await pending.apply()
        expect(pending.saved?.outputs.warp.ipv6).toBe('nat')
        expect(pending.applied?.outputs.warp.ipv6).toBeUndefined()
        expect(pending.count()).toBe(1)
        expect(pending.justApplied).toBe(false)
        // Причина отказа — без строки самолечения.
        expect(vi.mocked(notify)).toHaveBeenCalledWith('steer: нет такого выхода', 'error')
    })

    it('apply оборвался исключением — спека всё равно сверена', async () => {
        await open()
        apply.mockImplementation((async () => {
            disk = clone(disk)
            disk.outputs.warp.ipv6 = 'nat'
            throw new Error('таймаут ubus')
        }) as never)
        await pending.apply()
        expect(vi.mocked(notify)).toHaveBeenCalledWith('таймаут ubus', 'error')
        expect(pending.saved?.outputs.warp.ipv6).toBe('nat')
        expect(pending.applying).toBe(false)
    })
})

describe('что человек читает в тосте', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        vi.mocked(notify).mockClear()
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    })
    afterEach(() => { vi.useRealTimers() })

    it('строки самолечения в тост не попадают: «Применено» вместо них', async () => {
        await open()
        await pending.apply()
        expect(vi.mocked(notify)).toHaveBeenCalledWith('Применено', 'info')
    })

    it('слова ядра и зон фаервола остаются', () => {
        const out = [
            'splify2: устройства wg_f уже в своих зонах фаервола — оставлены как есть',
            HEAL_OUT,
            'steer: у туннеля nl нет NAT',
        ].join('\n')
        expect(applyText(out)).toBe(
            'splify2: устройства wg_f уже в своих зонах фаервола — оставлены как есть\nsteer: у туннеля nl нет NAT',
        )
        expect(applyText(undefined)).toBe('')
    })

    it('опознаются обе строки, которые пишет бэкенд, — по его исходнику', () => {
        // Текст строк живёт в m-spec.sh, а узнаёт их интерфейс: разойдутся — человек снова увидит
        // «записан ipv6: nat» в тосте. Сверяемся с самим исходником, а не с копией в тесте.
        const src = readFileSync(join(process.cwd(), '..', 'files/usr/lib/splify2/rpcd/m-spec.sh'), 'utf8')
        const formats = [...src.matchAll(/printf '(splify2: выходам без ключа ipv6 записан [^']*)\\n'/g)].map((m) => m[1])
        expect(formats).toHaveLength(2)
        for (const f of formats) {
            const line = f.replace('%s', 'warp wgv4')
            expect(applyText(line)).toBe('')
            expect(applyText(`первая\n${line}\nпоследняя`)).toBe('первая\nпоследняя')
        }
    })
})

describe('трёхстороннее слияние спеки', () => {
    const base = (): Spec => clone({
        outputs: {
            direct: { name: 'direct', kind: 'direct' },
            a: { name: 'a', kind: 'interface', device: 'wga' },
            b: { name: 'b', kind: 'interface', device: 'wgb' },
        },
        channels: [{ name: 'r1', out: 'a', match: { any: true } }],
    } as Spec)

    it('человек не трогал — берётся роутерное', () => {
        const theirs = base()
        theirs.outputs.a.ipv6 = 'nat'
        expect(mergeSpec(base(), base(), theirs)).toEqual(theirs)
    })

    it('роутер не менял — берётся то, что в памяти', () => {
        const mine = base()
        mine.channels = [...mine.channels, RULE]
        expect(mergeSpec(base(), mine, base())).toEqual(mine)
    })

    it('тронули разное — доходит и то и другое, порядок выходов — как в памяти', () => {
        const mine = base()
        mine.outputs.b.on_fail = 'direct'
        const reordered: Spec = { ...mine, outputs: { b: mine.outputs.b, a: mine.outputs.a, direct: mine.outputs.direct } }
        const theirs = base()
        theirs.outputs.a.ipv6 = 'nat'
        theirs.outputs.b.ipv6 = 'off'
        const merged = mergeSpec(base(), reordered, theirs)
        expect(Object.keys(merged.outputs)).toEqual(['b', 'a', 'direct'])
        expect(merged.outputs.a.ipv6).toBe('nat')
        expect(merged.outputs.b.ipv6).toBe('off')
        expect(merged.outputs.b.on_fail).toBe('direct')
    })

    it('тронули одно и то же — побеждает память', () => {
        const mine = base()
        mine.outputs.a.ipv6 = 'off'
        const theirs = base()
        theirs.outputs.a.ipv6 = 'nat'
        expect(mergeSpec(base(), mine, theirs).outputs.a.ipv6).toBe('off')
    })

    it('убранное человеком остаётся убранным, а добавленное — добавленным', () => {
        const mine = base()
        delete (mine.outputs as Record<string, unknown>).b
        mine.outputs.c = { name: 'c', kind: 'interface', device: 'wgc' }
        const theirs = base()
        theirs.outputs.b.ipv6 = 'off'
        const merged = mergeSpec(base(), mine, theirs)
        expect(Object.keys(merged.outputs).sort()).toEqual(['a', 'c', 'direct'])
    })

    it('списки не склеиваются поэлементно: правила человека целиком', () => {
        const mine = base()
        mine.channels = [RULE, ...mine.channels]
        const theirs = base()
        theirs.channels = [{ ...theirs.channels[0], name: 'другое' }]
        expect(mergeSpec(base(), mine, theirs).channels).toEqual(mine.channels)
    })

    it('роутер сменил вид записи, которую правил человек, — вся спека из памяти, без гибрида', () => {
        // Пул из двух устройств стал группой с членами-выходами (файл поправили мимо страницы:
        // член с `ipv6: routed` пулом не читается). Человек в это время добавил пулу устройство.
        // Самолечение так не делает — пул с разным ipv6 у членов остаётся пулом
        // (pool-mixed-ipv6.test.tsx), — но слияние обязано пережить и такую смену вида.
        const pool: Spec = {
            outputs: {
                direct: { name: 'direct', kind: 'direct' },
                vpn: { name: 'vpn', kind: 'interface', devices: ['wg0', 'wg1'] },
                warp: { name: 'warp', kind: 'interface', device: 'warp' },
            },
            channels: [],
        }
        const mine = clone(pool)
        mine.outputs.vpn.devices = ['wg0', 'wg1', 'wg2']
        const theirs: Spec = {
            outputs: {
                direct: { name: 'direct', kind: 'direct' },
                vpn: { name: 'vpn', kind: 'group', pick: 'order', members: ['vpn.wg0', 'vpn.wg1'] } as never,
                warp: { name: 'warp', kind: 'interface', device: 'warp', ipv6: 'nat' },
                'vpn.wg0': { name: 'vpn.wg0', kind: 'interface', device: 'wg0', ipv6: 'nat' },
                'vpn.wg1': { name: 'vpn.wg1', kind: 'interface', device: 'wg1', ipv6: 'routed' },
            },
            channels: [],
        }
        const merged = mergeSpec(pool, mine, theirs)
        expect(merged).toEqual(mine)
        expect(Object.keys(merged.outputs)).toEqual(['direct', 'vpn', 'warp'])
        // А пул, которого человек не трогал, лечение принимает целиком — вместе с членами.
        expect(Object.keys(mergeSpec(pool, pool, theirs).outputs)).toContain('vpn.wg0')
    })

    it('явное умолчание не считается правкой', () => {
        // Интерфейс пишет `enabled: true` явно, роутер хранит без него: это одно и то же.
        const mine = base()
        mine.channels = [{ ...mine.channels[0], enabled: true }]
        const theirs = base()
        theirs.outputs.a.ipv6 = 'nat'
        expect(mergeSpec(base(), mine, theirs).outputs.a.ipv6).toBe('nat')
    })
})
