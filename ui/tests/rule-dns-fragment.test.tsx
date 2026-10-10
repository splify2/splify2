import { fireEvent, render, screen } from '@testing-library/preact'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RuleEditor from '@/components/tabs/RuleEditor'
import { pending as pend } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { S } from '@/copy'
import type { Spec } from '@/lib/model'

// Выключатель «Делить первый пакет» у своего сервера DNS в правиле (fragment — только tls://, https://).

beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(rpc, 'leases').mockResolvedValue({ leases: [] } as never)
    vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] } as never)
})

const spec = (): Spec => ({ outputs: { direct: { name: 'direct', kind: 'direct' } }, channels: [] })

describe('правило со своим сервером DNS', () => {
    it('выключатель у https://, пропадает с ключом при смене адреса на udp://', async () => {
        pend.saved = spec()
        const changes: unknown[] = []
        const ch = { name: 'N', out: 'direct', match: { domains_files: ['/etc/steer/lists/n.lst'], mode: 'fakeip' }, dns: { url: 'https://dns.google/dns-query' } } as never
        const r = render(<RuleEditor ch={ch} index={0} services={[]} local={{}} outputs={{} as never} clash={null} rulesTotal={1}
            coveredBy={[]} dnsFragmentOk onChange={(c) => changes.push(c)} onClose={() => {}} onDelete={() => {}} />)
        await userEvent.click(screen.getByRole('switch', { name: S.dns.delitPervyyPaket }))
        const withFrag = changes.at(-1) as { dns: Record<string, unknown> }
        expect(withFrag.dns.fragment).toBe(true)
        r.rerender(<RuleEditor ch={withFrag as never} index={0} services={[]} local={{}} outputs={{} as never} clash={null} rulesTotal={1}
            coveredBy={[]} dnsFragmentOk onChange={(c) => changes.push(c)} onClose={() => {}} onDelete={() => {}} />)
        fireEvent.input(screen.getByLabelText(S.ruleEditor.adresDns), { target: { value: 'udp://1.1.1.1' } })
        expect((changes.at(-1) as { dns: Record<string, unknown> }).dns).toEqual({ url: 'udp://1.1.1.1' })
    })
})
