import { describe, expect, it } from 'vitest'
import type { Spec } from '@/lib/model'
import { decodeSpec, encodeSpec } from '@/lib/specv2'

// ВЫХОД, СОЗДАННЫЙ НАМИ, НЕ ДОЛЖЕН СОБИРАТЬ ЖАЛОБУ ЯДРА. Обращение: «при добавлении выхода варпа
// s2 жалуется на созданный им самим интерфейс без параметра IPv6 Masquerading». Зона
// steer_iface создаётся с masq (IPv4), а masq6 нет, и diag ядра писал «нет masquerade IPv6 —
// включите masq6 у зоны выхода». Подмену IPv6 у выхода-интерфейса ставит само ядро по ключу
// `ipv6: nat`; панель обязана писать его новым выходам, и пулу — каждому члену (ядро берёт
// режим у члена, не у группы).
describe('ipv6: nat у созданных выходов-интерфейсов', () => {
    it('одиночный выход пишется с ipv6: nat и читается обратно', () => {
        const spec: Spec = {
            outputs: { warp: { name: 'warp', kind: 'interface', device: 'warp', ipv6: 'nat' } },
            channels: [],
        }
        const doc = encodeSpec(spec) as { outputs: Record<string, { ipv6?: string }> }
        expect(doc.outputs.warp.ipv6).toBe('nat')
        expect(decodeSpec(doc).outputs.warp.ipv6).toBe('nat')
    })

    it('пул с ipv6: nat пишет ключ каждому члену и собирается обратно в пул', () => {
        const spec: Spec = {
            outputs: {
                p: { name: 'p', kind: 'interface', devices: ['wg0', 'warp'], device: 'wg0', ipv6: 'nat' },
            },
            channels: [],
        }
        const doc = encodeSpec(spec) as { outputs: Record<string, { ipv6?: string; kind: string }> }
        const members = Object.entries(doc.outputs).filter(([n]) => n.startsWith('p.'))
        expect(members.length).toBe(2)
        for (const [, m] of members) expect(m.ipv6).toBe('nat')
        expect(doc.outputs.p.ipv6).toBeUndefined()
        const back = decodeSpec(doc)
        expect(back.outputs.p.devices).toEqual(['wg0', 'warp'])
        expect(back.outputs.p.ipv6).toBe('nat')
    })

    it('пул без ключа остаётся без ключа', () => {
        const spec: Spec = {
            outputs: { p: { name: 'p', kind: 'interface', devices: ['wg0', 'wg1'], device: 'wg0' } },
            channels: [],
        }
        const doc = encodeSpec(spec) as { outputs: Record<string, { ipv6?: string }> }
        expect(doc.outputs['p.wg0']?.ipv6 ?? doc.outputs['p.1']?.ipv6).toBeUndefined()
        expect(decodeSpec(doc).outputs.p.ipv6).toBeUndefined()
    })
})
