import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Spec } from '@/lib/model'

const edit = vi.fn()
let current: Spec
vi.mock('@/lib/pending', () => ({
    pending: { load: vi.fn(async () => current), edit: (s: Spec) => edit(s), onReplaced: () => () => {} },
}))
vi.mock('@/lib/rpc', () => ({
    rpc: {
        dnsLog: vi.fn(async () => ({
            running: true,
            upstreams: [{ name: 'google', url: 'https://dns.google/dns-query', proto: 'doh', via: 'wg0', state: 'down', ok: 0, error: 'нет ответа за 4000 мс' }],
            cache: { entries: 12, max: 512, hits: 40, misses: 7, stored: 12, evicted: 0 },
        })),
    },
}))
vi.mock('@/lib/notify', () => ({ notify: vi.fn() }))

import Dns from '@/components/sections/Dns'
import { rpc } from '@/lib/rpc'
import { S } from '@/copy'

// Раздел DNS: серверы резолвера движка (DoH, DoT, DoQ, обычный DNS), выход для запроса, общий
// сервер, кэш и режим. Проверяется то, что уходит в спеку, и что состояние серверов видно.

beforeEach(() => {
    edit.mockClear()
    current = {
        outputs: { direct: { name: 'direct', kind: 'direct' }, wg0: { name: 'wg0', kind: 'interface', device: 'wg0' } },
        channels: [],
        dns: { upstreams: { google: { url: 'https://dns.google/dns-query', out: 'wg0' } }, upstream: 'google', cache: 512 },
    }
})

describe('раздел DNS', () => {
    it('показывает сервер, его выход и состояние из журнала резолвера', async () => {
        render(<Dns />)
        expect(await screen.findByLabelText('имя сервера google')).toBeInTheDocument()
        await waitFor(() => expect(screen.getByText(/DoH · не отвечает/)).toBeInTheDocument())
        expect(screen.getByText('нет ответа за 4000 мс')).toBeInTheDocument()
        expect(screen.getByText(/в кэше 12 из 512/)).toBeInTheDocument()
    })

    it('добавление готового сервера пишет его в dns.upstreams с адресами', async () => {
        render(<Dns />)
        await screen.findByLabelText('имя сервера google')
        await userEvent.selectOptions(screen.getByDisplayValue('Cloudflare (DoH)'), 'quad9')
        fireEvent.click(screen.getByRole('button', { name: /Добавить$/ }))
        const next = edit.mock.calls.at(-1)![0] as Spec
        expect(next.dns?.upstreams?.quad9).toEqual({ url: 'tls://dns.quad9.net', ips: ['9.9.9.9', '149.112.112.112'] })
        expect(next.dns?.upstreams?.google).toBeDefined()
    })

    it('смена выхода сервера и режима доходит до спеки', async () => {
        render(<Dns />)
        await screen.findByLabelText('имя сервера google')
        await userEvent.selectOptions(screen.getByDisplayValue('wg0'), '')
        const a = edit.mock.calls.at(-1)![0] as Spec
        expect(a.dns?.upstreams?.google.out).toBeUndefined()
        fireEvent.click(screen.getByText('Настоящие адреса'))
        const b = edit.mock.calls.at(-1)![0] as Spec
        expect(b.dns?.mode).toBe('realip')
    })

    it('удаление сервера снимает его и общий выбор', async () => {
        render(<Dns />)
        await screen.findByLabelText('имя сервера google')
        fireEvent.click(screen.getByLabelText('убрать google'))
        const next = edit.mock.calls.at(-1)![0] as Spec
        expect(next.dns?.upstreams).toBeUndefined()
        expect(next.dns?.upstream).toBeUndefined()
    })

    it('сервер, выбранный в правиле, не удаляется', async () => {
        current = { ...current, channels: [{ name: 'Новости', out: 'wg0', dns: 'google', match: { domains_files: ['/l/a.lst'] } }] }
        render(<Dns />)
        await screen.findByLabelText('имя сервера google')
        fireEvent.click(screen.getByLabelText('убрать google'))
        expect(edit).not.toHaveBeenCalled()
    })

    it('bootstrap у отдельного сервера уходит в его upstream', async () => {
        render(<Dns />)
        await screen.findByLabelText('имя сервера google')
        await userEvent.type(screen.getByLabelText(S.dns.razreshatImyaCherez), '1.1.1.1, 9.9.9.9')
        await userEvent.tab()
        const next = edit.mock.calls.at(-1)![0] as Spec
        expect(next.dns?.upstreams?.google.bootstrap).toEqual(['1.1.1.1', '9.9.9.9'])
    })

    it('сроки кэша — в dns.cache_ttl, пока кэш включён', async () => {
        render(<Dns />)
        await screen.findByLabelText('имя сервера google')
        fireEvent.input(screen.getByLabelText(S.dns.hranitNeMenshe), { target: { value: '60' } })
        let next = edit.mock.calls.at(-1)![0] as Spec
        expect(next.dns?.cache_ttl).toEqual({ min: 60 })
        fireEvent.input(screen.getByLabelText(S.dns.hranitNeDolshe), { target: { value: '7200' } })
        fireEvent.input(screen.getByLabelText(S.dns.otritsatelnyyOtvetHranit), { target: { value: '5' } })
        next = edit.mock.calls.at(-1)![0] as Spec
        expect(next.dns?.cache_ttl).toEqual({ min: 60, max: 7200, negative: 5 })
    })

    it('сроков кэша нет, пока кэш выключен', async () => {
        current = { ...current, dns: { ...current.dns, cache: undefined } }
        render(<Dns />)
        await screen.findByLabelText('имя сервера google')
        expect(screen.queryByLabelText(S.dns.hranitNeMenshe)).toBeNull()
    })

    it('у сервера видно HTTP-версию и 0-RTT из журнала резолвера', async () => {
        vi.mocked(rpc.dnsLog).mockResolvedValue({
            running: true,
            upstreams: [
                { name: 'google', url: 'https://dns.google/dns-query', proto: 'doh', via: null, state: 'ready', ok: 3, http: 'h2' },
                { name: 'adguard', url: 'quic://dns.adguard-dns.com', proto: 'doq', via: null, state: 'ready', ok: 9, early: 4, early_rejected: 1 },
            ],
        } as never)
        current = { ...current, dns: { upstreams: { ...current.dns!.upstreams, adguard: { url: 'quic://dns.adguard-dns.com', ips: ['94.140.14.14'] } } } }
        render(<Dns />)
        await waitFor(() => expect(screen.getByText(/DoH · работает/).textContent).toContain(S.dns.http('h2')))
        expect(screen.getByText(/DoQ · работает/).textContent).toContain(S.dns.early(4, 1))
    })

    it('старая ошибка не висит под работающим сервером: после неё уже были ответы', async () => {
        vi.mocked(rpc.dnsLog).mockResolvedValue({
            running: true,
            upstreams: [{ name: 'google', url: 'https://dns.google/dns-query', proto: 'doh', via: 'wg0', state: 'ready',
                ok: 5551, error: 'нет ответа за 4000 мс', error_ago: 600, last_ok_ago: 2 }],
        } as never)
        render(<Dns />)
        await waitFor(() => expect(screen.getByText(/DoH · работает/)).toBeInTheDocument())
        expect(screen.queryByText('нет ответа за 4000 мс')).toBeNull()
    })

    it('«сервер закрыл соединение» не висит под «ждёт вопросов»', async () => {
        vi.mocked(rpc.dnsLog).mockResolvedValue({
            running: true,
            upstreams: [{ name: 'google', url: 'https://dns.google/dns-query', proto: 'doh', via: 'wg0', state: 'idle',
                ok: 595, error: 'сервер закрыл соединение', error_ago: 30, last_ok_ago: 300 }],
        } as never)
        render(<Dns />)
        await waitFor(() => expect(screen.getByText(/DoH · ждёт вопросов/)).toBeInTheDocument())
        expect(screen.queryByText('сервер закрыл соединение')).toBeNull()
    })

    it('свежая ошибка видна: после неё сервер ещё не отвечал', async () => {
        vi.mocked(rpc.dnsLog).mockResolvedValue({
            running: true,
            upstreams: [{ name: 'google', url: 'https://dns.google/dns-query', proto: 'doh', via: 'wg0', state: 'down',
                ok: 10, error: 'нет ответа за 4000 мс', error_ago: 3, last_ok_ago: 120 }],
        } as never)
        render(<Dns />)
        expect(await screen.findByText('нет ответа за 4000 мс')).toBeInTheDocument()
    })
})
