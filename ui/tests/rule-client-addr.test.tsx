import { render, screen } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RuleEditor from '@/components/tabs/RuleEditor'
import { isClientAddr } from '@/lib/validate'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { S } from '@/copy'
import type { Channel } from '@/lib/model'

// «Кому» в правиле: ядро steer 2.0 принимает у клиента адреса, подсети и диапазоны `a-b` IPv4 и
// IPv6 (spec-v2.md, `clients.addr`; addr_check в src/model/v2.c). Редактор помечал ошибкой всё,
// что не IPv4 и не подсеть IPv4, а запись с двоеточием считал MAC — и IPv6 называл «не MAC».

const OUTPUTS = { direct: { kind: 'direct', up: true } } as never

function mount(from: string[]) {
    const ch: Channel = { name: 'Кому', out: 'direct', from, match: { domains_files: ['/etc/steer/lists/a.lst'] } } as Channel
    render(
        <RuleEditor ch={ch} index={0} services={[]} local={{}} outputs={OUTPUTS} clash={null} rulesTotal={1}
            coveredBy={[]} onChange={() => {}} onClose={() => {}} onDelete={() => {}} />,
    )
}

beforeEach(() => {
    vi.restoreAllMocks()
    pending.saved = null
    vi.spyOn(rpc, 'leases').mockResolvedValue({ leases: [] } as never)
    vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] } as never)
})

describe('адреса клиентов правила — как у ядра 2.0', () => {
    const good = [
        '192.168.1.50', '192.168.1.0/24', '192.168.1.10-192.168.1.20',
        '2001:db8::1', 'fd00::/64', '2001:db8::1-2001:db8::ff', '::ffff:192.168.1.1', 'fe80::1/128',
    ]
    const bad = ['192.168.1', '192.168.1.0/33', 'fd00::/129', '192.168.1.1-2001:db8::1', '2001:db8::1/64-2001:db8::2',
        'fd00:::1', 'example.org', '10.0.0.1-', 'aa:bb:cc']

    it('проверка принимает IPv6 и диапазоны и отвергает негодное', () => {
        for (const a of good) expect(isClientAddr(a), a).toBe(true)
        for (const a of bad) expect(isClientAddr(a), a).toBe(false)
    })

    it('IPv6, подсеть IPv6 и диапазоны не помечаются ошибкой', () => {
        mount([...good, 'aa:bb:cc:dd:ee:ff'])
        expect(screen.queryByText(new RegExp(S.ruleEditor.neAdresINe))).toBeNull()
    })

    it('негодная запись помечается, годные рядом — нет', () => {
        mount(['2001:db8::1', 'aa:bb:cc', '10.0.0.1-'])
        const p = screen.getByText(new RegExp(S.ruleEditor.neAdresINe))
        expect(p.textContent).toContain('aa:bb:cc, 10.0.0.1-')
        expect(p.textContent).not.toContain('2001:db8::1')
    })
})
