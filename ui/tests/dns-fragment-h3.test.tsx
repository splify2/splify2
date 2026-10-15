import { render, screen, fireEvent } from '@testing-library/preact'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Spec } from '@/lib/model'

const edit = vi.fn()
let current: Spec
vi.mock('@/lib/pending', () => ({
    pending: { load: vi.fn(async () => current), edit: (s: Spec) => edit(s), onReplaced: () => () => {} },
}))
vi.mock('@/lib/rpc', () => ({ rpc: { dnsLog: vi.fn(async () => ({ running: true, upstreams: [] })) } }))
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

import Dns from '@/components/sections/Dns'
import { dnsFragmentSupported, dnsH3Supported } from '@/lib/engine'
import { decodeSpec, encodeSpec } from '@/lib/specv2'
import { S } from '@/copy'
import type { Live } from '@/lib/live'

// `fragment: true` у DoT/DoH и адрес `h3://` (DoH по HTTP/3): ядро steer отвергает всю спеку, если
// fragment стоит у udp/tcp/quic/h3 или у группы.

const OUTS = { direct: { name: 'direct', kind: 'direct' } } as never
const spec = (dns: Spec['dns']): Spec => ({ outputs: OUTS, channels: [], dns })
const NEW = { status: { schema: 1, outputs: {}, channels: [], features: ['dns_fragment', 'dns_h3'] }, build: { version: '2.0.5' } } as unknown as Live
const OLD = { status: { schema: 1, outputs: {}, channels: [], features: ['dns_groups'] }, build: { version: '2.0.4' } } as unknown as Live

const dnsOf = (s: Spec) => (encodeSpec(s).dns as { upstreams: Record<string, Record<string, unknown>> }).upstreams

describe('fragment и h3 в спеке', () => {
    it('fragment у https и tls переживает запись и чтение', () => {
        const s = spec({ upstreams: { a: { url: 'https://dns.google/dns-query', fragment: true }, b: { url: 'tls://dns.google', fragment: true } } })
        const doc = encodeSpec(s)
        expect(dnsOf(s).a).toEqual({ url: 'https://dns.google/dns-query', fragment: true })
        expect(dnsOf(s).b.fragment).toBe(true)
        expect(decodeSpec(doc).dns?.upstreams?.a.fragment).toBe(true)
        expect(decodeSpec(doc).dns?.upstreams?.b.fragment).toBe(true)
    })

    it('fragment: false и отсутствие ключа — без ключа', () => {
        const d = decodeSpec({ version: 2, dns: { upstreams: { a: { url: 'tls://x', fragment: false } } } } as never)
        expect(d.dns?.upstreams?.a.fragment).toBeUndefined()
        expect(dnsOf(d).a).toEqual({ url: 'tls://x' })
    })

    it('при схеме, не допускающей fragment, ключ в спеку не пишется', () => {
        for (const url of ['udp://1.1.1.1', 'tcp://1.1.1.1', 'quic://x', 'h3://x/dns-query']) {
            expect(dnsOf(spec({ upstreams: { a: { url, fragment: true } } })).a).toEqual({ url })
        }
    })

    it('адрес h3:// читается и пишется как есть', () => {
        const doc = { version: 2, dns: { upstreams: { a: { url: 'h3://dns.adguard-dns.com:443/dns-query', ips: ['94.140.14.14'] } } } }
        const s = decodeSpec(doc as never)
        expect(s.dns?.upstreams?.a.url).toBe('h3://dns.adguard-dns.com:443/dns-query')
        expect(dnsOf(s).a).toEqual(doc.dns.upstreams.a)
    })
})

describe('умение ядра', () => {
    it('перечень называет умение — умеет; иначе по версии 2.0.5', () => {
        expect(dnsFragmentSupported({ features: ['dns_fragment'] } as never)).toBe(true)
        expect(dnsH3Supported({ features: ['dns_h3'] } as never)).toBe(true)
        expect(dnsFragmentSupported({ features: ['dns_groups'] } as never, '2.0.4')).toBe(false)
        expect(dnsFragmentSupported({ features: ['dns_groups'] } as never, '2.0.5')).toBe(true)
        expect(dnsH3Supported(null, '2.1')).toBe(true)
        expect(dnsH3Supported(null)).toBe(false)
    })
})

describe('раздел DNS: выключатель', () => {
    beforeEach(() => { edit.mockClear() })
    const sw = () => screen.queryByRole('switch', { name: S.dns.delitPervyyPaket })

    it('виден у https:// и tls://, не виден у udp, quic и h3', async () => {
        current = spec({ upstreams: { a: { url: 'https://dns.google/dns-query' }, b: { url: 'udp://1.1.1.1' }, c: { url: 'quic://x' }, d: { url: 'h3://x' } } })
        render(<Dns live={NEW} />)
        await screen.findByLabelText('имя сервера a')
        expect(screen.getAllByRole('switch', { name: S.dns.delitPervyyPaket })).toHaveLength(1)
    })

    it('включение пишет fragment, смена адреса на quic:// снимает его, возврат — не возвращает', async () => {
        current = spec({ upstreams: { a: { url: 'https://dns.google/dns-query' } } })
        render(<Dns live={NEW} />)
        await screen.findByLabelText('имя сервера a')
        await userEvent.click(sw()!)
        expect((edit.mock.calls.at(-1)![0] as Spec).dns?.upstreams?.a.fragment).toBe(true)
        fireEvent.input(screen.getByPlaceholderText('https://dns.example/dns-query'), { target: { value: 'quic://dns.google' } })
        const next = edit.mock.calls.at(-1)![0] as Spec
        expect(next.dns?.upstreams?.a).toEqual({ url: 'quic://dns.google' })
        expect('fragment' in next.dns!.upstreams!.a).toBe(false)
    })

    it('на ядре без умения выключателя нет, а записанный ключ виден и снимается', async () => {
        current = spec({ upstreams: { a: { url: 'https://dns.google/dns-query' } } })
        const r = render(<Dns live={OLD} />)
        await screen.findByLabelText('имя сервера a')
        expect(sw()).toBeNull()
        r.unmount()
        current = spec({ upstreams: { a: { url: 'https://dns.google/dns-query', fragment: true } } })
        render(<Dns live={OLD} />)
        await screen.findByLabelText('имя сервера a')
        await userEvent.click(sw()!)
        expect((edit.mock.calls.at(-1)![0] as Spec).dns?.upstreams?.a).toEqual({ url: 'https://dns.google/dns-query' })
    })

    it('h3:// на ядре без умения — сообщение, на ядре с умением — нет', async () => {
        current = spec({ upstreams: { a: { url: 'h3://dns.adguard-dns.com' } } })
        const r = render(<Dns live={OLD} />)
        await screen.findByLabelText('имя сервера a')
        expect(screen.getByText(S.dns.h3NuzhnoNovoeYadro)).toBeInTheDocument()
        r.unmount()
        render(<Dns live={NEW} />)
        await screen.findByLabelText('имя сервера a')
        expect(screen.queryByText(S.dns.h3NuzhnoNovoeYadro)).toBeNull()
    })
})
