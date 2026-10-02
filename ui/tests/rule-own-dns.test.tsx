import { fireEvent, render, screen } from '@testing-library/preact'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RuleEditor from '@/components/tabs/RuleEditor'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { decodeSpec, encodeSpec } from '@/lib/specv2'
import { S } from '@/copy'
import type { Channel, Spec } from '@/lib/model'

// Сервер DNS прямо в правиле (`dns: { url, out, ips, bootstrap }` правила спеки v2): ядро 2.0
// принимает его наравне с именем апстрима из раздела «DNS». Редактор правила выбирал сервер
// только по имени, и то лишь когда в разделе «DNS» что-то было заведено.

const DOM = '/etc/steer/lists/news.lst'
const OUTPUTS = { direct: { kind: 'direct', up: true }, wg0: { kind: 'interface', device: 'wg0', up: true } } as never
const SPEC: Spec = {
    outputs: { direct: { name: 'direct', kind: 'direct' }, wg0: { name: 'wg0', kind: 'interface', device: 'wg0' } },
    channels: [],
}

function mount(ch: Channel) {
    const changes: Channel[] = []
    const r = render(
        <RuleEditor ch={ch} index={0} services={[]} local={{}} outputs={OUTPUTS} clash={null} rulesTotal={1}
            coveredBy={[]} onChange={(c) => { changes.push(c); r.rerender(el(c)) }} onClose={() => {}} onDelete={() => {}} />,
    )
    const el = (c: Channel) => (
        <RuleEditor ch={c} index={0} services={[]} local={{}} outputs={OUTPUTS} clash={null} rulesTotal={1}
            coveredBy={[]} onChange={(n) => { changes.push(n); r.rerender(el(n)) }} onClose={() => {}} onDelete={() => {}} />
    )
    return changes
}

const base: Channel = { name: 'Новости', out: 'wg0', match: { domains_files: [DOM], mode: 'fakeip' } } as Channel

beforeEach(() => {
    vi.restoreAllMocks()
    pending.saved = SPEC
    pending.dirty = false
    vi.spyOn(rpc, 'leases').mockResolvedValue({ leases: [] } as never)
    vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] } as never)
})

describe('свой сервер DNS у правила', () => {
    it('выбор «свой адрес» без серверов в разделе DNS, адрес, выход и адреса сервера', async () => {
        const changes = mount(base)
        await userEvent.selectOptions(screen.getByLabelText(S.ruleEditor.serverDns), S.ruleEditor.svoyAdresDns)
        expect(changes.at(-1)!.dns).toEqual({ url: 'https://' })
        fireEvent.input(screen.getByLabelText(S.ruleEditor.adresDns), { target: { value: 'tls://one.one.one.one' } })
        await userEvent.selectOptions(screen.getByLabelText(S.ruleEditor.dnsCherezVyhod), 'wg0')
        await userEvent.type(screen.getByLabelText(S.ruleEditor.dnsAdresaServera), '1.1.1.1, 1.0.0.1')
        await userEvent.tab()
        const ch = changes.at(-1)!
        expect(ch.dns).toEqual({ url: 'tls://one.one.one.one', out: 'wg0', ips: ['1.1.1.1', '1.0.0.1'] })
        // В спеке — отображение у правила, и обратно читается тем же.
        const doc = encodeSpec({ ...SPEC, channels: [ch] })
        expect((doc.rules as Record<string, unknown>[])[0].dns).toEqual({ url: 'tls://one.one.one.one', out: 'wg0', ips: ['1.1.1.1', '1.0.0.1'] })
        expect(decodeSpec(doc).channels[0].dns).toEqual(ch.dns)
    })

    it('правило со своим сервером открывается с ним, «по умолчанию» снимает его', async () => {
        const changes = mount({ ...base, dns: { url: 'quic://dns.adguard-dns.com', ips: ['94.140.14.14'] } })
        expect((screen.getByLabelText(S.ruleEditor.adresDns) as HTMLInputElement).value).toBe('quic://dns.adguard-dns.com')
        await userEvent.selectOptions(screen.getByLabelText(S.ruleEditor.serverDns), S.ruleEditor.poUmolchaniyu)
        expect(changes.at(-1)!.dns).toBeUndefined()
        expect(screen.queryByLabelText(S.ruleEditor.adresDns)).toBeNull()
    })
})
