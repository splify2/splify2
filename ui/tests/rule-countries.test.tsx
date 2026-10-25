import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RuleTarget from '@/components/board/RuleTarget'
import { rpc } from '@/lib/rpc'
import type { Spec, Status } from '@/lib/model'
import { live } from './fixtures'

// Страны узлов подписки выбираются в блоке «Куда» правила (а не на экране VPN): «только эти» и
// «кроме этих» уходят в выход правила; ядру нужно умение node_only. Под блоком — страна, которую
// видят сайты, и предупреждение при расхождении с именем узла.

const SUB = '/etc/steer/subs/sub1'
const spec = (extra: Record<string, unknown> = {}): Spec => ({
    schema: 1,
    outputs: {
        direct: { name: 'direct', kind: 'direct' },
        a: { name: 'a', kind: 'vless', sub_file: SUB, on_fail: 'drop', ...extra },
    },
    channels: [{ name: 'a', out: 'a', match: {} }],
} as unknown as Spec)
const status = (features: string[], vless: Record<string, unknown> = {}) =>
    ({ schema: 1, features, channels: [], outputs: { a: { name: 'a', kind: 'vless', up: true, vless } } } as unknown as Status)

beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] } as never)
    vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [{ name: 'sub1', title: 'Мой провайдер', path: SUB, present: true, kind: 'url', url: '', used: 0 }] } as never)
    vi.spyOn(rpc, 'vlessNodesOfSub').mockResolvedValue({
        nodes: [
            { index: 0, name: '🇳🇱 Amsterdam', host: 'a', type: 'vless', cc: 'NL' },
            { index: 1, name: '🇩🇪 Berlin', host: 'b', type: 'vless', cc: 'DE' },
        ],
    } as never)
    vi.spyOn(rpc, 'hysteria2NodesOfSub').mockResolvedValue(null as never)
    vi.spyOn(rpc, 'proxyNodesOfSub').mockResolvedValue(null as never)
})

describe('страны в «Куда» правила', () => {
    it('отметка «только» пишет only выходу правила, «кроме» той же страны переносит её', async () => {
        const onSpec = vi.fn()
        render(<RuleTarget spec={spec()} index={0} live={live({ status: status(['node_only']) })} onSpec={onSpec} />)
        const only = await screen.findByRole('group', { name: 'Только эти страны' })
        const nl = [...only.querySelectorAll('button')].find((b) => /Нидерланды|NL/.test(b.textContent || ''))!
        fireEvent.click(nl)
        expect((onSpec.mock.calls.at(-1)![0] as Spec).outputs.a.only).toEqual(['NL'])
        const ex = screen.getByRole('group', { name: 'Кроме этих стран' })
        fireEvent.click([...ex.querySelectorAll('button')].find((b) => /Нидерланды|NL/.test(b.textContent || ''))!)
        const o = (onSpec.mock.calls.at(-1)![0] as Spec).outputs.a
        expect(o.exclude).toEqual(['NL'])
        expect(o.only).toBeUndefined()
    })

    it('без умения ядра выбора стран нет; записанные страны видны и без него', async () => {
        const { unmount } = render(<RuleTarget spec={spec()} index={0} live={live({ status: status([]) })} onSpec={() => {}} />)
        await screen.findByText(/Мой провайдер/)
        expect(screen.queryByRole('group', { name: 'Только эти страны' })).toBeNull()
        unmount()
        render(<RuleTarget spec={spec({ only: ['NL'] })} index={0} live={live({ status: status([]) })} onSpec={() => {}} />)
        expect(await screen.findByRole('group', { name: 'Только эти страны' })).toBeInTheDocument()
    })

    it('страна выхода и расхождение с именем узла видны в блоке', async () => {
        render(<RuleTarget spec={spec()} index={0} live={live({ status: status(['node_only'], { node: 'x', up: true, node_cc: 'NL', geo_cc: 'US', geo_mismatch: true }) })} onSpec={() => {}} />)
        await waitFor(() => expect(screen.getByText(/выход: .*, а в имени узла/)).toBeInTheDocument())
    })
})
