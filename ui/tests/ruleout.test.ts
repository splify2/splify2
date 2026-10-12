import { describe, expect, it } from 'vitest'
import { applyTarget, EMPTY_TARGET, sharedWith, shape, targetOf, type Target } from '@/lib/ruleout'
import type { Channel, Output, Spec } from '@/lib/model'
import { decodeSpec, encodeSpec } from '@/lib/specv2'
import { overridePortOf, withOverridePort } from '@/lib/rulefiles'

// Выход правила в приложении для компьютера (lib/ruleout.ts): набор пилюль → спека и обратно,
// общий выход у одинаковых наборов, разведение при правке, уборка осиротевшего.

const SUB = '/etc/steer/subs/sub1.txt'
const SUB2 = '/etc/steer/subs/sub2.txt'
const rule = (name: string, out: string): Channel => ({ name, out, match: { prefixes_files: [`/etc/steer/lists/${name}.lst`] } })

function spec(outputs: Record<string, Output>, channels: Channel[]): Spec {
    return { outputs: { direct: { name: 'direct', kind: 'direct' }, ...outputs }, channels }
}

const subs = (mode: Target['subs']['mode'], picks: Target['subs']['picks']): Target =>
    ({ ...structuredClone(EMPTY_TARGET), subs: { mode, picks } })

describe('набор правила → спека', () => {
    it('первый живой из одной подписки — один туннель с узлами по порядку', () => {
        const s = applyTarget(spec({}, [rule('YouTube', 'direct')]), 0, subs('order', [
            { sub: SUB, proto: 'vless', idx: 3 }, { sub: SUB, proto: 'vless', idx: 1 },
        ]))
        const out = s.channels[0].out
        expect(out).toBe('youtube')
        expect(s.outputs[out]).toMatchObject({ kind: 'vless', sub_file: SUB, nodes: [3, 1] })
    })

    it('самый быстрый — пул latency из частей по узлу', () => {
        const s = applyTarget(spec({}, [rule('Игры', 'direct')]), 0, subs('latency', [
            { sub: SUB, proto: 'vless', idx: 0 }, { sub: SUB, proto: 'vless', idx: 2 },
        ]))
        const out = s.channels[0].out
        expect(out).toBe('igry')
        const top = s.outputs[out]
        expect(top).toMatchObject({ kind: 'interface', pick: 'latency' })
        expect(top.devices).toHaveLength(2)
        for (const d of top.devices!) expect(s.outputs[d]).toMatchObject({ kind: 'vless', part_of: out })
        expect(top.devices!.map((d) => s.outputs[d].nodes)).toEqual([[0], [2]])
    })

    it('раздача внутри одной подписки — active, у hysteria2 — группа balance из частей', () => {
        const v = applyTarget(spec({}, [rule('a', 'direct')]), 0, subs('balance', [
            { sub: SUB, proto: 'vless', idx: 0 }, { sub: SUB, proto: 'vless', idx: 1 },
        ]))
        expect(v.outputs.a).toMatchObject({ kind: 'vless', nodes: [0, 1], active: 2 })
        const h = applyTarget(spec({}, [rule('a', 'direct')]), 0, subs('balance', [
            { sub: SUB, proto: 'hysteria2', idx: 0 }, { sub: SUB, proto: 'hysteria2', idx: 1 },
        ]))
        expect(h.outputs.a).toMatchObject({ kind: 'group', pick: 'balance' })
        expect(h.outputs.a.members!.map((m) => h.outputs[m].nodes)).toEqual([[0], [1]])
    })

    it('несколько блоков — группа order над ними; WARP — сам выход', () => {
        const base = spec({ cf: { name: 'cf', kind: 'warp' as Output['kind'] } }, [rule('a', 'direct')])
        const t: Target = { ...subs('order', [{ sub: SUB, proto: 'vless' }]), warp: ['cf'] }
        const s = applyTarget(base, 0, t)
        expect(s.outputs.a).toMatchObject({ kind: 'group', pick: 'order' })
        expect(s.outputs.a.members![1]).toBe('cf')
        expect(targetOf(s, 'a')).toMatchObject({ warp: ['cf'], subs: { mode: 'order', picks: [{ sub: SUB, proto: 'vless' }] } })
    })

    it('один WARP — правило ведёт прямо в него, прежний выход убран', () => {
        const base = spec({ cf: { name: 'cf', kind: 'warp' as Output['kind'] }, a: { name: 'a', kind: 'vless', sub_file: SUB } }, [rule('a', 'a')])
        const s = applyTarget(base, 0, { ...structuredClone(EMPTY_TARGET), warp: ['cf'] })
        expect(s.channels[0].out).toBe('cf')
        expect(s.outputs.a).toBeUndefined()
        expect(s.outputs.cf).toBeDefined()
    })
})

describe('общий выход и разведение', () => {
    it('одинаковый набор у второго правила — тот же выход', () => {
        let s = spec({}, [rule('a', 'direct'), rule('b', 'direct')])
        const t = subs('order', [{ sub: SUB, proto: 'vless', idx: 4 }, { sub: SUB2, proto: 'vless' }])
        s = applyTarget(s, 0, t)
        s = applyTarget(s, 1, t)
        expect(s.channels[1].out).toBe(s.channels[0].out)
        expect(sharedWith(s, 1)).toEqual(['a'])
        expect(Object.keys(s.outputs).filter((n) => !s.outputs[n].part_of && n !== 'direct')).toEqual(['a'])
    })

    it('правка общего — правилу свой выход, у соседа прежний; совпало снова — свой убран', () => {
        let s = spec({}, [rule('a', 'direct'), rule('b', 'direct')])
        const t = subs('order', [{ sub: SUB, proto: 'vless', idx: 4 }])
        s = applyTarget(s, 0, t)
        s = applyTarget(s, 1, t)
        const before = shape(s.outputs, 'a')
        s = applyTarget(s, 1, subs('order', [{ sub: SUB, proto: 'vless', idx: 5 }]))
        expect(s.channels[0].out).toBe('a')
        expect(shape(s.outputs, 'a')).toBe(before)
        expect(s.channels[1].out).toBe('b')
        expect(s.outputs.b.nodes).toEqual([5])
        s = applyTarget(s, 1, t)
        expect(s.channels[1].out).toBe('a')
        expect(s.outputs.b).toBeUndefined()
    })

    it('свой выход правится на месте, под тем же именем; части с тем же содержимым сохраняют имя', () => {
        let s = applyTarget(spec({}, [rule('a', 'direct')]), 0, subs('latency', [
            { sub: SUB, proto: 'vless', idx: 0 }, { sub: SUB, proto: 'vless', idx: 1 },
        ]))
        const part0 = s.outputs.a.devices![0]
        s = applyTarget(s, 0, subs('latency', [
            { sub: SUB, proto: 'vless', idx: 0 }, { sub: SUB, proto: 'vless', idx: 7 },
        ]))
        expect(s.channels[0].out).toBe('a')
        expect(s.outputs.a.devices![0]).toBe(part0)
        expect(s.outputs[s.outputs.a.devices![1]].nodes).toEqual([7])
        expect(Object.values(s.outputs).filter((o) => o.part_of === 'a')).toHaveLength(2)
    })

    it('напрямую — выход direct, собранный набор убран; WARP и свои туннели не трогаются', () => {
        const base = spec({ cf: { name: 'cf', kind: 'warp' as Output['kind'] } }, [rule('a', 'direct')])
        let s = applyTarget(base, 0, { ...subs('order', [{ sub: SUB, proto: 'vless' }]), warp: ['cf'] })
        s = applyTarget(s, 0, { ...structuredClone(EMPTY_TARGET), direct: true })
        expect(s.channels[0].out).toBe('direct')
        expect(Object.keys(s.outputs).sort()).toEqual(['cf', 'direct'])
    })

    it('напрямую — домены настоящими адресами, подмены порта нет', () => {
        const ch: Channel = { name: 'a', out: 'direct', match: { domains_files: ['/etc/steer/lists/d.lst'], mode: 'fakeip' } }
        const base = spec({}, [withOverridePort(ch, 8443)])
        const s = applyTarget(base, 0, { ...structuredClone(EMPTY_TARGET), direct: true })
        expect(s.channels[0].match.mode).toBe('realip')
        expect(overridePortOf(s.channels[0])).toBeUndefined()
    })

    it('выход, через который идёт DNS, не убирается', () => {
        let s = applyTarget(spec({}, [rule('a', 'direct')]), 0, subs('order', [{ sub: SUB, proto: 'vless' }]))
        s = { ...s, dns: { upstreams: { cf: { url: 'https://1.1.1.1/dns-query', out: 'a' } } } } as Spec
        s = applyTarget(s, 0, subs('order', [{ sub: SUB2, proto: 'vless' }]))
        expect(s.outputs.a).toMatchObject({ sub_file: SUB })
        expect(s.channels[0].out).not.toBe('a')
    })

    it('пустой выбор спеку не меняет', () => {
        const s = spec({}, [rule('a', 'direct')])
        expect(applyTarget(s, 0, structuredClone(EMPTY_TARGET))).toBe(s)
    })
})

describe('спека → набор', () => {
    it('свои туннели: пул устройств, одно устройство, раздача', () => {
        const s = spec({
            p: { name: 'p', kind: 'interface', devices: ['wg0', 'wg1'], device: 'wg0', pick: 'latency' },
            one: { name: 'one', kind: 'interface', device: 'wg0' },
        }, [])
        expect(targetOf(s, 'p')?.own).toEqual({ mode: 'latency', picks: ['dev:wg0', 'dev:wg1'] })
        expect(targetOf(s, 'one')?.own).toEqual({ mode: 'manual', picks: ['dev:wg0'] })
        const b = applyTarget(spec({}, [rule('a', 'direct')]), 0, { ...structuredClone(EMPTY_TARGET), own: { mode: 'balance', picks: ['dev:wg0', 'dev:wg1'] } })
        expect(b.outputs.a).toMatchObject({ kind: 'group', pick: 'balance' })
        expect(targetOf(b, 'a')?.own).toEqual({ mode: 'balance', picks: ['dev:wg0', 'dev:wg1'] })
    })

    it('набор, собранный не правилом, — null', () => {
        const s = spec({ g: { name: 'g', kind: 'group', pick: 'manual', members: ['x'] }, x: { name: 'x', kind: 'interface', device: 'wg0' } }, [])
        expect(targetOf(s, 'g')).toBeNull()
    })
})

describe('через спеку ядра и обратно', () => {
    const cases: [string, Target][] = [
        ['первый живой, две подписки', subs('order', [{ sub: SUB, proto: 'vless', idx: 1 }, { sub: SUB2, proto: 'vless' }])],
        ['самый быстрый', subs('latency', [{ sub: SUB, proto: 'vless', idx: 0 }, { sub: SUB, proto: 'trojan', idx: 2 }])],
        ['вручную', subs('manual', [{ sub: SUB, proto: 'vless', idx: 6 }])],
        ['раздача', subs('balance', [{ sub: SUB, proto: 'vless', idx: 0 }, { sub: SUB, proto: 'vless', idx: 3 }])],
        ['раздача hysteria2', subs('balance', [{ sub: SUB, proto: 'hysteria2', idx: 0 }, { sub: SUB, proto: 'hysteria2', idx: 1 }])],
        ['свои: пул', { ...structuredClone(EMPTY_TARGET), own: { mode: 'order', picks: ['dev:wg0', 'dev:wg1'] } }],
        ['подписка и WARP', { ...subs('order', [{ sub: SUB, proto: 'vless' }]), warp: ['cf'] }],
    ]
    for (const [title, t] of cases) {
        it(title, () => {
            const base = spec({ cf: { name: 'cf', kind: 'warp' as Output['kind'] } }, [rule('a', 'direct')])
            const s = applyTarget(base, 0, t)
            const back = decodeSpec(encodeSpec(s))
            expect(targetOf(back, back.channels[0].out)).toEqual(t)
            /* Тот же набор после перечитывания — тот же выход, без нового. */
            const again = applyTarget(back, 0, t)
            expect(again).toBe(back)
        })
    }
})

describe('блок', () => {
    it('«Блок» — выход kind: block (заводится один), домены настоящими адресами; обратно читается', () => {
        const ch: Channel = { name: 'ads', out: 'direct', match: { domains_files: ['/etc/steer/lists/ads.lst'], mode: 'fakeip' } }
        const s = applyTarget(spec({}, [ch, { ...ch, name: 'ads2' }]), 0, { ...structuredClone(EMPTY_TARGET), block: true })
        expect(s.outputs[s.channels[0].out]).toMatchObject({ kind: 'block' })
        expect(s.channels[0].match.mode).toBe('realip')
        expect(targetOf(s, s.channels[0].out)?.block).toBe(true)
        const s2 = applyTarget(s, 1, { ...structuredClone(EMPTY_TARGET), block: true })
        expect(s2.channels[1].out).toBe(s.channels[0].out)
        expect(Object.values(s2.outputs).filter((o) => (o.kind as string) === 'block')).toHaveLength(1)
        const back = decodeSpec(encodeSpec(s2))
        expect(back.outputs[s.channels[0].out].kind).toBe('block')
    })
})
