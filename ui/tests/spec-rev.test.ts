import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

// Правка из двух вкладок или с двух устройств не затирает молча (D-P2.7).
//
// Бэкенд здесь — маленькая модель через мост ubus: файл спеки с ревизией, spec_get с полем `rev`
// и spec_set, который отказывает (`conflict`), если присланная ревизия не равна лежащей, — как
// m-spec.sh. Страница обязана прочитать лежащее, слить с правкой и записать от свежей ревизии.

type J = Record<string, unknown>
let disk: J
let n: number
let calls: { method: string; args: unknown[] }[]

const base = (): J => ({ version: 2, outputs: { direct: { kind: 'direct' } }, rules: [] })
const rule = (name: string): J => ({ name, to: 'all', out: 'direct' })

function bridge() {
    ;(window as unknown as Record<string, unknown>).luci_rpc = {
        declare: ({ method }: { method: string }) => async (...args: unknown[]) => {
            calls.push({ method, args })
            if (method === 'spec_get') return { rev: `r${n}`, ...structuredClone(disk) }
            if (method === 'applied_get') return structuredClone(disk)
            if (method === 'engine') return { present: true }
            if (method === 'spec_set') {
                const [spec, rev] = args as [string, string | undefined]
                if (rev && rev !== `r${n}`) return { ok: false, conflict: true, rev: `r${n}`, error: 'изменилась' }
                disk = JSON.parse(spec)
                n++
                return { ok: true, rev: `r${n}` }
            }
            return {}
        },
    }
}

/** Свежая страница: модули заново, спека прочитана. */
async function open() {
    vi.resetModules()
    const { notify } = await import('@/lib/notify')
    vi.mocked(notify).mockClear()
    const { pending } = await import('@/lib/pending')
    await pending.load()
    return { pending, notify }
}

const sets = () => calls.filter((c) => c.method === 'spec_set')

beforeEach(() => {
    disk = base()
    n = 1
    calls = []
    bridge()
})

describe('ревизия спеки', () => {
    it('запись идёт с той ревизией, что прочитана, и следующая — с новой', async () => {
        const { pending } = await open()
        pending.edit({ ...pending.saved!, channels: [{ name: 'a', out: 'direct', match: { any: true } }] })
        await pending.flush()
        expect(sets()[0].args[1]).toBe('r1')
        pending.edit({ ...pending.saved!, channels: [...pending.saved!.channels, { name: 'b', out: 'direct', match: { any: true } }] })
        await pending.flush()
        expect(sets()).toHaveLength(2)
        expect(sets()[1].args[1]).toBe('r2')
    })

    it('чужая запись за спиной: чужое подтянуто, своё сохранено, роутеру уходит слитое', async () => {
        const { pending, notify } = await open()
        // Вторая вкладка дописала своё правило.
        disk = { ...disk, rules: [rule('чужое')] }
        n++
        pending.edit({ ...pending.saved!, channels: [{ name: 'моё', out: 'direct', match: { any: true } }] })
        await pending.flush()
        const names = (disk.rules as J[]).map((r) => r.name)
        expect(names).toEqual(expect.arrayContaining(['чужое', 'моё']))
        expect(sets().map((c) => c.args[1])).toEqual(['r1', 'r2'])
        expect(pending.saved!.channels.map((c) => c.name).sort()).toEqual(['моё', 'чужое'])
        expect(notify).toHaveBeenCalledWith(expect.stringMatching(/изменились/), 'info')
        expect(pending.saveError).toBeNull()
    })

    it('чужая запись не задела моё место — тоста нет', async () => {
        const { pending, notify } = await open()
        disk = base()
        n++ // ревизия сменилась, содержимое то же (например, самолечение вписало ничего)
        pending.edit({ ...pending.saved!, channels: [{ name: 'моё', out: 'direct', match: { any: true } }] })
        await pending.flush()
        expect(notify).not.toHaveBeenCalled()
        expect((disk.rules as J[]).map((r) => r.name)).toEqual(['моё'])
    })

    it('бэкенд без ревизий: пишется как прежде, без второго параметра', async () => {
        ;(window as unknown as { luci_rpc: { declare: unknown } }).luci_rpc.declare = ({ method }: { method: string }) => async (...args: unknown[]) => {
            calls.push({ method, args })
            if (method === 'spec_get' || method === 'applied_get') return structuredClone(disk)
            if (method === 'spec_set') { disk = JSON.parse(args[0] as string); return { ok: true } }
            return { present: true }
        }
        const { pending } = await open()
        pending.edit({ ...pending.saved!, channels: [{ name: 'a', out: 'direct', match: { any: true } }] })
        await pending.flush()
        expect(sets()[0].args).toHaveLength(1)
    })
})

describe('слияние правил по именам', () => {
    const ch = (name: string, out = 'direct') => ({ name, out, match: { any: true } })
    const spec = (...names: string[]) => ({ outputs: { direct: { name: 'direct', kind: 'direct' } }, channels: names.map((x) => ch(x)) }) as never
    const names = (s: { channels: { name: string }[] }) => s.channels.map((c) => c.name)

    it('обе стороны добавили по правилу — остались оба, порядок человека сохранён', async () => {
        const { mergeSpec } = await import('@/lib/pending')
        const r = names(mergeSpec(spec('a'), spec('b', 'a', 'c'), spec('a', 'd')))
        expect(r.slice(0, 2)).toEqual(['b', 'a'])
        expect(new Set(r)).toEqual(new Set(['a', 'b', 'c', 'd']))
        expect(r.indexOf('d')).toBe(r.indexOf('a') + 1)
    })

    it('роутер убрал правило, которого мы не трогали, — оно уходит; тронутое остаётся', async () => {
        const { mergeSpec } = await import('@/lib/pending')
        expect(names(mergeSpec(spec('a', 'b'), spec('a', 'b'), spec('a')))).toEqual(['a'])
        const touched = { ...spec('a', 'b'), channels: [ch('a'), ch('b', 'other')] } as never
        expect(names(mergeSpec(spec('a', 'b'), touched, spec('a')))).toEqual(['a', 'b'])
    })

    it('правило, которое мы убрали, а роутер поправил, возвращается', async () => {
        const { mergeSpec } = await import('@/lib/pending')
        const theirs = { ...spec('a', 'b'), channels: [ch('a'), ch('b', 'other')] } as never
        expect(names(mergeSpec(spec('a', 'b'), spec('a'), theirs))).toEqual(['a', 'b'])
    })
})
