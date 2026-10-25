import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RuleEditor from '@/components/tabs/RuleEditor'
import { GeoLine } from '@/components/OutputCards'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { decodeSpec, encodeSpec } from '@/lib/specv2'
import { outExtras } from '@/lib/outstate'
import { groupOnlySupported, nodeOnlySupported } from '@/lib/engine'
import type { Channel, Output, OutputStatus, Spec, Status } from '@/lib/model'

// Новые поля ядра: семейство IP правила, страны туннеля и группы, страна выхода, клиенты
// mesh-VPN. Кодек круглый (читаем и пишем те же ключи), экран пишет их в спеку.

const base = (p: Partial<Spec>): Spec => ({ outputs: { direct: { name: 'direct', kind: 'direct' } }, channels: [], ...p })

describe('спека: семейство IP правила', () => {
    const doc = {
        version: 2,
        outputs: { direct: { kind: 'direct' }, wg0: { kind: 'interface', device: 'wg0' } },
        lists: { bank: { domains_file: '/etc/steer/lists/bank.lst' } },
        rules: [{ name: 'bank', to: ['bank'], out: 'wg0', family: '6', on_family_unavailable: 'block' }],
    }
    it('family и on_family_unavailable читаются в поля правила и пишутся обратно', () => {
        const s = decodeSpec(doc)
        expect(s.channels[0].family).toBe('6')
        expect(s.channels[0].on_family_unavailable).toBe('block')
        const r = (encodeSpec(s).rules as Record<string, unknown>[])[0]
        expect(r.family).toBe('6')
        expect(r.on_family_unavailable).toBe('block')
    })
    it('число 4 в family читается как «4», both — умолчание и ключа нет', () => {
        const s = decodeSpec({ ...doc, rules: [{ ...doc.rules[0], family: 4, on_family_unavailable: undefined }] })
        expect(s.channels[0].family).toBe('4')
        const s2 = decodeSpec({ ...doc, rules: [{ ...doc.rules[0], family: 'both', on_family_unavailable: undefined }] })
        expect(s2.channels[0].family).toBeUndefined()
        expect('family' in (encodeSpec(s2).rules as Record<string, unknown>[])[0]).toBe(false)
    })
    it('block без family: 6 не пишется — ядро такой ключ отвергает', () => {
        const s = decodeSpec(doc)
        s.channels[0].family = '4'
        expect('on_family_unavailable' in (encodeSpec(s).rules as Record<string, unknown>[])[0]).toBe(false)
    })
})

describe('спека: страны туннеля и группы', () => {
    it('only туннеля — круг', () => {
        const s = base({ outputs: { direct: { name: 'direct', kind: 'direct' }, vl: { name: 'vl', kind: 'vless', sub_file: '/etc/steer/sub.txt', only: ['nl', 'DE', 'NL'] } as Output } })
        const o = (encodeSpec(s).outputs as Record<string, Record<string, unknown>>).vl
        expect(o.only).toEqual(['NL', 'DE'])
        expect(decodeSpec(encodeSpec(s)).outputs.vl.only).toEqual(['NL', 'DE'])
    })
    it('only и exclude группы пишутся при latency и order, не при balance и manual', () => {
        const g = (pick: Output['pick']): Spec => base({ outputs: {
            direct: { name: 'direct', kind: 'direct' },
            a: { name: 'a', kind: 'interface', device: 'a' },
            g: { name: 'g', kind: 'group', pick, members: ['a'], only: ['NL', 'DE'], exclude: ['DE', 'RU'] } as Output,
        } })
        const out = (pick: Output['pick']) => (encodeSpec(g(pick)).outputs as Record<string, Record<string, unknown>>).g
        expect(out('latency').only).toEqual(['NL', 'DE'])
        expect(out('latency').exclude).toEqual(['RU'])
        expect(out('order').only).toEqual(['NL', 'DE'])
        expect('only' in out('balance')).toBe(false)
        expect('exclude' in out('manual')).toBe(false)
        const back = decodeSpec(encodeSpec(g('latency'))).outputs.g
        expect(back.only).toEqual(['NL', 'DE'])
        expect(back.exclude).toEqual(['RU'])
    })
    it('умения node_only и group_only спрашиваются у состояния', () => {
        expect(nodeOnlySupported({ features: ['node_only'] } as unknown as Status)).toBe(true)
        expect(nodeOnlySupported({ features: ['exclude'] } as unknown as Status)).toBe(false)
        expect(groupOnlySupported({ features: ['group_only'] } as unknown as Status)).toBe(true)
        expect(groupOnlySupported(null)).toBe(false)
    })
})

describe('спека: клиенты mesh-VPN', () => {
    it('dns.mesh_clients — круг, без ключа остаётся без ключа', () => {
        const s = decodeSpec({ version: 2, outputs: { direct: { kind: 'direct' } }, dns: { mesh_clients: true } })
        expect(s.dns?.mesh_clients).toBe(true)
        expect(s.dns?.extra).toBeUndefined()
        expect((encodeSpec(s).dns as Record<string, unknown>).mesh_clients).toBe(true)
        expect(encodeSpec(decodeSpec({ version: 2, outputs: { direct: { kind: 'direct' } } })).dns).toBeUndefined()
    })
})

describe('страна выхода', () => {
    const st = (p: object) => ({ kind: 'vless', up: true, vless: p }) as unknown as OutputStatus
    it('фактическая страна — словом строки выхода', () => {
        const r = outExtras({ name: 'vl', kind: 'vless' }, st({ node_cc: 'NL', geo_cc: 'NL' }))
        expect(r.words).toContain('выход: Нидерланды')
        expect(r.alarm).toBe(false)
    })
    it('геомисмэтч — обе страны и беда', () => {
        const r = outExtras({ name: 'vl', kind: 'vless' }, st({ node_cc: 'NL', geo_cc: 'US', geo_mismatch: true }))
        expect(r.words).toContain('выход: США, а в имени узла: Нидерланды')
        expect(r.alarm).toBe(true)
    })
    it('у hysteria2 те же поля; без geo_cc строки нет', () => {
        const h = { kind: 'hysteria2', up: true, hysteria2: { node: 'x', up: true, geo_cc: 'DE' } } as unknown as OutputStatus
        expect(outExtras({ name: 'h', kind: 'hysteria2' }, h).words).toContain('выход: Германия')
        expect(outExtras({ name: 'vl', kind: 'vless' }, st({ node_cc: 'NL' })).words).toEqual([])
    })
    it('GeoLine рисует расхождение предупреждением', () => {
        render(<GeoLine sts={[st({ node_cc: 'NL', geo_cc: 'US', geo_mismatch: true })]} />)
        expect(screen.getByText(/США, а в имени узла: Нидерланды/)).toBeInTheDocument()
    })
})

describe('редактор правила: семейство IP', () => {
    const OUTPUTS = { wg0: { kind: 'interface', up: true } } as never
    beforeEach(() => {
        vi.restoreAllMocks()
        pending.saved = null
        vi.spyOn(rpc, 'leases').mockResolvedValue({ leases: [] } as never)
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] } as never)
    })
    it('«Только IPv6» пишет family и открывает выбор на случай без IPv6', async () => {
        const seen: Channel[] = []
        let ch: Channel = { name: 'bank', out: 'wg0', match: { domains_files: ['/etc/steer/lists/bank.lst'] } }
        const view = () => (
            <RuleEditor ch={ch} index={0} services={[]} local={{}} outputs={OUTPUTS} clash={null} rulesTotal={1}
                coveredBy={[]} onChange={(c) => { seen.push(c); ch = c }} onClose={() => {}} onDelete={() => {}} />
        )
        const { rerender } = render(view())
        await userEvent.click(screen.getByRole('button', { name: 'Только IPv6' }))
        expect(seen.at(-1)?.family).toBe('6')
        rerender(view())
        await userEvent.click(screen.getByRole('button', { name: 'Не пропускать' }))
        expect(seen.at(-1)?.on_family_unavailable).toBe('block')
        await userEvent.click(screen.getByRole('button', { name: 'Оба' }))
        expect(seen.at(-1)?.family).toBeUndefined()
        expect(seen.at(-1)?.on_family_unavailable).toBeUndefined()
        void fireEvent; void waitFor
    })
})
