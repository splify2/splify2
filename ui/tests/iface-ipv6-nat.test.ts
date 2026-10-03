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

// ПУЛ И КЛЮЧ ipv6: ЧЛЕНЫ-ИНТЕРФЕЙСЫ И ЧАСТИ ПО ПОДПИСКЕ. Самолечение при apply (m-spec.sh,
// spec_heal_ipv6) пишет ключ каждому члену пула по его устройству: nat — у устройства есть адрес
// IPv6, off — нет. Панель обязана читать это так, чтобы пул не распадался на группу и отдельные
// выходы, и писать обратно то же самое. Часть пула по подписке (устройство заводит ядро, адреса
// IPv6 у него нет) ключа не получает ни от панели, ни от самолечения — и в расчёт пула не идёт:
// `nat` на таком устройстве ядро встретило бы отказом «нет адреса IPv6».
describe('пул: nat и off у членов, части по подписке', () => {
    type Doc = { outputs: Record<string, { ipv6?: string; kind: string; device?: string }> }

    it('пул с ipv6: off пишет off каждому члену и собирается обратно в пул', () => {
        const spec: Spec = {
            outputs: {
                p: { name: 'p', kind: 'interface', devices: ['wg0', 'wg1'], device: 'wg0', ipv6: 'off' },
            },
            channels: [],
        }
        const doc = encodeSpec(spec) as Doc
        const members = Object.entries(doc.outputs).filter(([n]) => n.startsWith('p.'))
        expect(members.length).toBe(2)
        for (const [, m] of members) expect(m.ipv6).toBe('off')
        expect(doc.outputs.p.ipv6).toBeUndefined()
        const back = decodeSpec(doc)
        expect(back.outputs.p.devices).toEqual(['wg0', 'wg1'])
        expect(back.outputs.p.ipv6).toBe('off')
    })

    it('у членов разные ключи (у одного адрес IPv6 есть, у другого нет) — группа с членами, а не пул', () => {
        const back = decodeSpec({
            version: 2,
            outputs: {
                direct: { kind: 'direct' },
                p: { kind: 'group', pick: 'order', members: ['p.wg0', 'p.wg1'] },
                'p.wg0': { kind: 'interface', device: 'wg0', ipv6: 'nat' },
                'p.wg1': { kind: 'interface', device: 'wg1', ipv6: 'off' },
            },
        })
        expect(back.outputs.p.kind).toBe('group')
        expect(back.outputs['p.wg0'].ipv6).toBe('nat')
        expect(back.outputs['p.wg1'].ipv6).toBe('off')
    })

    it('ключ у одного члена из двух — тоже не пул (разная настройка не теряется молча)', () => {
        const back = decodeSpec({
            version: 2,
            outputs: {
                direct: { kind: 'direct' },
                p: { kind: 'group', pick: 'order', members: ['p.wg0', 'p.wg1'] },
                'p.wg0': { kind: 'interface', device: 'wg0', ipv6: 'off' },
                'p.wg1': { kind: 'interface', device: 'wg1' },
            },
        })
        expect(back.outputs.p.kind).toBe('group')
    })

    const WITH_PART = {
        version: 2,
        outputs: {
            direct: { kind: 'direct' },
            p: { kind: 'group', pick: 'order', members: ['p.p-1', 'p.wg0'] },
            'p.p-1': { kind: 'interface', device: 'p-1' },
            'p.wg0': { kind: 'interface', device: 'wg0', ipv6: 'nat' },
            'p-1': { kind: 'tunnel', protocol: 'vless', subscription: '/etc/steer/sub.txt', nodes: [0], on_fail: 'drop' },
        },
    }

    it('пул с частью по подписке и членом-интерфейсом с nat не распадается', () => {
        const back = decodeSpec(WITH_PART)
        expect(back.outputs.p.kind).toBe('interface')
        expect(back.outputs.p.devices).toEqual(['p-1', 'wg0'])
        expect(back.outputs.p.ipv6).toBe('nat')
        expect(back.outputs['p-1'].part_of).toBe('p')
    })

    it('пул с частью по подписке: ключ пишется только члену-интерфейсу, части — нет', () => {
        const doc = encodeSpec(decodeSpec(WITH_PART)) as Doc
        expect(doc.outputs['p.wg0'].ipv6).toBe('nat')
        expect(doc.outputs['p.p-1'].ipv6).toBeUndefined()
    })

    it('прежняя запись (nat у всех членов, и у части по подписке тоже) читается пулом, а пишется без ключа у части', () => {
        const old = decodeSpec({
            ...WITH_PART,
            outputs: { ...WITH_PART.outputs, 'p.p-1': { kind: 'interface', device: 'p-1', ipv6: 'nat' } },
        })
        expect(old.outputs.p.kind).toBe('interface')
        expect(old.outputs.p.ipv6).toBe('nat')
        const doc = encodeSpec(old) as Doc
        expect(doc.outputs['p.p-1'].ipv6).toBeUndefined()
        expect(doc.outputs['p.wg0'].ipv6).toBe('nat')
    })

    it('off у члена-части — выбор человека: пул не сворачивается, ключ не теряется', () => {
        const back = decodeSpec({
            ...WITH_PART,
            outputs: { ...WITH_PART.outputs, 'p.p-1': { kind: 'interface', device: 'p-1', ipv6: 'off' } },
        })
        expect(back.outputs.p.kind).toBe('group')
        expect(back.outputs['p.p-1'].ipv6).toBe('off')
    })
})
