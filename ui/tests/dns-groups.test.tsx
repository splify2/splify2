import { fireEvent, render, screen, waitFor, within } from '@testing-library/preact'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import type { Spec } from '@/lib/model'
import type { Live } from '@/lib/live'

const edit = vi.fn()
let current: Spec
vi.mock('@/lib/pending', () => ({
    pending: { load: vi.fn(async () => current), edit: (s: Spec) => edit(s) },
}))
vi.mock('@/lib/rpc', () => ({
    rpc: {
        dnsLog: vi.fn(async () => ({
            running: true,
            upstreams: [
                { name: 'q9', url: 'https://dns.quad9.net/dns-query', proto: 'doh', via: null, state: 'down', ok: 0 },
                { name: 'cf', url: 'https://cloudflare-dns.com/dns-query', proto: 'doh', via: null, state: 'ready', ok: 5 },
                {
                    name: 'rules', url: '', proto: 'group', via: null, state: 'ready', mode: 'failover', active: 'cf', ok: 5,
                    servers: [{ name: 'q9', pause: 17, ok: 0, failed: 3 }, { name: 'cf', pause: 0, ok: 5, failed: 0 }],
                },
            ],
            other: { name: 'cf', pause: 40, ok: 1, failed: 2, fallback: 2 },
        })),
    },
}))
const notify = vi.fn()
vi.mock('@/lib/notify', () => ({ notify: (...a: unknown[]) => notify(...a) }))

import Dns from '@/components/sections/Dns'
import { S } from '@/copy'

// Раздел DNS: «Для имён под правилами» и «Для остальных сайтов» — DNS роутера, один сервер или
// несколько (группа серверов ядра: порядок, «сразу все / по очереди»). Видимость — по умениям ядра
// dns_groups и dns_other; записанное в спеке видно и снимается и без них.

const live = (features: string[]) => ({ status: { features } }) as unknown as Live
const ALL = live(['groups', 'dns_groups', 'dns_other'])
const last = () => edit.mock.calls.at(-1)![0] as Spec
const rulesBox = () => screen.getByRole('group', { name: S.dns.dlyaImenPodPravilami })
const otherBox = () => screen.getByRole('group', { name: S.dns.dlyaOstalnyhSaytov })

beforeEach(() => {
    edit.mockClear()
    notify.mockClear()
    current = {
        outputs: { direct: { name: 'direct', kind: 'direct' }, wg0: { name: 'wg0', kind: 'interface', device: 'wg0' } },
        channels: [],
        dns: {
            upstreams: { q9: { url: 'https://dns.quad9.net/dns-query' }, cf: { url: 'https://cloudflare-dns.com/dns-query' }, g: { url: 'https://dns.google/dns-query' } },
            upstream: 'q9',
        },
    }
})

describe('раздел DNS: несколько серверов и сервер для остальных сайтов', () => {
    it('«Несколько» заводит группу с нынешним сервером, по очереди', async () => {
        render(<Dns live={ALL} />)
        await screen.findByLabelText('имя сервера q9')
        fireEvent.click(within(rulesBox()).getByText(S.dns.neskolkoServerov))
        const n = last()
        expect(n.dns?.upstream).toBe('rules')
        expect(n.dns?.groups?.rules).toEqual({ servers: ['q9'], mode: 'failover' })
    })

    it('группа: добавить сервер, порядок, «сразу все», убрать из группы', async () => {
        current.dns = { ...current.dns, upstream: 'rules', groups: { rules: { servers: ['q9', 'cf'], mode: 'failover' } } }
        render(<Dns live={ALL} />)
        await screen.findByLabelText('имя сервера q9')
        await userEvent.selectOptions(screen.getByLabelText(S.dns.dobavitVGruppu(S.dns.dlyaImenPodPravilami)), 'g')
        expect(last().dns?.groups?.rules.servers).toEqual(['q9', 'cf', 'g'])
        fireEvent.click(screen.getByLabelText(S.dns.vyshe('cf')))
        expect(last().dns?.groups?.rules.servers).toEqual(['cf', 'q9', 'g'])
        fireEvent.click(screen.getByText(S.dns.srazuVse))
        expect(last().dns?.groups?.rules.mode).toBe('race')
        fireEvent.click(screen.getByLabelText(S.dns.ubratIzGruppy('q9')))
        expect(last().dns?.groups?.rules).toEqual({ servers: ['cf', 'g'], mode: 'race' })
    })

    it('видно, кто на паузе и кого спросят первым', async () => {
        current.dns = { ...current.dns, upstream: 'rules', groups: { rules: { servers: ['q9', 'cf'], mode: 'failover' } } }
        render(<Dns live={ALL} />)
        await waitFor(() => expect(screen.getByText(S.dns.pauza(17))).toBeInTheDocument())
        expect(screen.getByText(S.dns.otvechaetPervym)).toBeInTheDocument()
    })

    it('назад к одному серверу — первый член группы, ненужная группа уходит', async () => {
        current.dns = { ...current.dns, upstream: 'rules', groups: { rules: { servers: ['cf', 'q9'] } } }
        render(<Dns live={ALL} />)
        await screen.findByLabelText('имя сервера q9')
        fireEvent.click(within(rulesBox()).getByText(S.dns.odinServer))
        const n = last()
        expect(n.dns?.upstream).toBe('cf')
        expect(n.dns?.groups).toBeUndefined()
    })

    it('группа, выбранная в правиле, при смене не удаляется', async () => {
        current.dns = { ...current.dns, upstream: 'rules', groups: { rules: { servers: ['cf', 'q9'] } } }
        current.channels = [{ name: 'Новости', out: 'wg0', dns: 'rules', match: { domains_files: ['/l/a.lst'] } }]
        render(<Dns live={ALL} />)
        await screen.findByLabelText('имя сервера q9')
        fireEvent.click(within(rulesBox()).getByText(S.dns.dnsRoutera))
        const n = last()
        expect(n.dns?.upstream).toBeUndefined()
        expect(n.dns?.groups?.rules).toBeDefined()
    })

    it('для остальных сайтов: сервер, затем DNS роутера', async () => {
        render(<Dns live={ALL} />)
        await screen.findByLabelText('имя сервера q9')
        fireEvent.click(within(otherBox()).getByText(S.dns.odinServer))
        expect(last().dns?.other).toBe('q9')
        current = last()
        await userEvent.selectOptions(screen.getByLabelText(S.dns.serverDlya(S.dns.dlyaOstalnyhSaytov)), 'cf')
        expect(last().dns?.other).toBe('cf')
        fireEvent.click(within(otherBox()).getByText(S.dns.dnsRoutera))
        expect(last().dns?.other).toBeUndefined()
        expect(last().dns?.upstream).toBe('q9')
    })

    it('сервер для остальных не отвечает — видно, что они идут через DNS роутера', async () => {
        current.dns = { ...current.dns, other: 'cf' }
        render(<Dns live={ALL} />)
        await waitFor(() => expect(screen.getByText(S.dns.ostalnyeCherezRouter(40))).toBeInTheDocument())
    })

    it('ядро без умений: нет «Несколько» и нет «Для остальных сайтов»', async () => {
        render(<Dns live={live(['groups'])} />)
        await screen.findByLabelText('имя сервера q9')
        expect(within(rulesBox()).queryByText(S.dns.neskolkoServerov)).toBeNull()
        expect(screen.queryByRole('group', { name: S.dns.dlyaOstalnyhSaytov })).toBeNull()
    })

    it('ядро без умений: записанное в спеке видно и снимается', async () => {
        current.dns = { ...current.dns, upstream: 'rules', other: 'cf', groups: { rules: { servers: ['q9'] } } }
        render(<Dns live={live(['groups'])} />)
        await screen.findByLabelText('имя сервера q9')
        expect(within(rulesBox()).getByText(S.dns.neskolkoServerov)).toBeInTheDocument()
        fireEvent.click(within(otherBox()).getByText(S.dns.dnsRoutera))
        expect(last().dns?.other).toBeUndefined()
    })

    it('сервер в группе не удаляется; переименование ведёт за собой группу и остальные сайты', async () => {
        current.dns = { ...current.dns, upstream: 'rules', other: 'cf', groups: { rules: { servers: ['q9', 'cf'] } } }
        render(<Dns live={ALL} />)
        await screen.findByLabelText('имя сервера q9')
        fireEvent.click(screen.getByLabelText('убрать cf'))
        expect(edit).not.toHaveBeenCalled()
        expect(notify).toHaveBeenCalledWith(S.dns.serverVGruppe('cf'), 'warning')
        const inp = screen.getByLabelText('имя сервера cf')
        await userEvent.clear(inp)
        await userEvent.type(inp, 'cloud')
        await userEvent.tab()
        const n = last()
        expect(n.dns?.groups?.rules.servers).toEqual(['q9', 'cloud'])
        expect(n.dns?.other).toBe('cloud')
        expect(n.dns?.upstreams?.cloud).toBeDefined()
    })

    it('удаление сервера снимает его с остальных сайтов', async () => {
        current.dns = { ...current.dns, other: 'g' }
        render(<Dns live={ALL} />)
        await screen.findByLabelText('имя сервера g')
        fireEvent.click(screen.getByLabelText('убрать g'))
        expect(last().dns?.other).toBeUndefined()
        expect(last().dns?.upstreams?.g).toBeUndefined()
    })
})
