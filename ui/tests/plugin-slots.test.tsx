import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Rail from '@/components/Rail'
import { PluginTiles, usePluginTiles } from '@/components/PluginTile'
import { PluginTargets } from '@/components/board/RuleTarget'
import { usePluginDiag } from '@/plugins/diag'
import { HOST_OWNER, registry } from '@/plugins/registry'
import { sectionTitle, useSections } from '@/lib/sections'
import { HostLiveProvider } from '@/plugins/hostlive'
import type { Spec } from '@/lib/model'
import type { Live } from '@/lib/live'
import { live as liveFixture } from './fixtures'

// Слоты вне карточки плагина: рельс разделов, плитки доски, «Куда» правила, диагностика. Встроенные
// разделы записаны в тот же реестр, что и разделы плагинов.

beforeEach(() => {
    for (const o of ['p1', 'p2']) registry.clearOwner(o)
})

const nav = (name: string | RegExp) => screen.getAllByRole('button', { name })[0]

describe('разделы — записи реестра', () => {
    it('встроенные разделы стоят в порядке рельса, «Плагины» — между «Диагностикой» и «Настройками»', () => {
        const ids = registry.list('section').filter((r) => r.owner === HOST_OWNER).map((r) => r.id)
        expect(ids).toEqual(['home', 'rules', 'vpn', 'dns', 'requests', 'diag', 'plugins', 'settings'])
        expect(sectionTitle('plugins')).toBe('Плагины')
    })

    it('рельс рисует раздел плагина (railSection) после встроенных; счётчик — из badge', () => {
        registry.register('section', 'p1', 'demo', {
            id: 'demo', label: 'Демо', icon: () => null, plugin: 'p1', render: () => null,
            badge: () => ({ text: '3', alarm: true }),
        }, 900)
        const live = liveFixture()
        function Probe() { return <>{useSections().map((r) => r.value.id).join(',')}</> }
        const { container } = render(
            <>
                <Rail live={live} section="home" onSection={() => {}} counts={{ demo: { text: '3', alarm: true } }} />
                <span data-testid="ids"><Probe /></span>
            </>,
        )
        expect(screen.getByTestId('ids').textContent).toBe('home,rules,vpn,dns,requests,diag,plugins,settings,demo')
        expect(nav(/Демо/)).toBeInTheDocument()
        expect(nav(/Плагины/)).toBeInTheDocument()
        expect(container.textContent).toContain('3')
    })

    it('раздел плагина отдаёт щелчок рельса наружу', () => {
        registry.register('section', 'p1', 'demo', { id: 'demo', label: 'Демо', icon: () => null, plugin: 'p1' }, 900)
        const go = vi.fn()
        render(<Rail live={liveFixture()} section="home" onSection={go} counts={{}} />)
        fireEvent.click(nav(/Демо/))
        expect(go).toHaveBeenCalledWith('demo')
    })
})

describe('плитки доски (boardTile)', () => {
    function Tiles({ live }: { live: Live }) {
        const tiles = usePluginTiles()
        return <div><PluginTiles tiles={tiles} live={live} /></div>
    }

    it('плитки по order, when скрывает, упавшая плитка исчезает, остальные живут', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        registry.register('boardTile', 'p1', 'b', { id: 'b', when: () => true, render: () => <i>вторая</i> }, 20)
        registry.register('boardTile', 'p1', 'a', { id: 'a', when: () => true, render: () => <i>первая</i> }, 10)
        registry.register('boardTile', 'p1', 'hidden', { id: 'hidden', when: () => false, render: () => <i>скрытая</i> }, 15)
        registry.register('boardTile', 'p2', 'boom', { id: 'boom', when: () => true, render: () => { throw new Error('x') } }, 12)
        registry.register('boardTile', 'p2', 'boom2', { id: 'boom2', when: () => { throw new Error('y') }, render: () => null }, 13)
        render(<HostLiveProvider live={liveFixture()}><Tiles live={liveFixture()} /></HostLiveProvider>)
        expect(screen.getAllByText(/первая|вторая/).map((e) => e.textContent)).toEqual(['первая', 'вторая'])
        expect(screen.queryByText('скрытая')).toBeNull()
    })
})

describe('«Куда» правила (outputKind.ruleTarget)', () => {
    const spec = (): Spec => ({
        outputs: {
            direct: { name: 'direct', kind: 'direct' },
            d1: { name: 'd1', kind: 'demo' },
            d2: { name: 'd2', kind: 'demo' },
            other: { name: 'other', kind: 'vless' },
        },
        channels: [{ name: 'r', out: 'direct', match: {} }],
    } as unknown as Spec)

    it('выходы вида плагина — пилюлями своей группы; выбор пилюли меняет выход правила; редактор вида — под ними', async () => {
        registry.register('outputKind', 'p1', 'demo', {
            kind: 'demo', label: 'Демо-вид', icon: () => null, create: () => ({ kind: 'demo' }),
            editor: (o: { kind: string }, _set: unknown, name: string) => <p>редактор {name}</p>,
            ruleTarget: { group: 'Мои выходы' },
        })
        const onSpec = vi.fn()
        const s = spec()
        const { rerender } = render(<PluginTargets spec={s} index={0} live={liveFixture()} onSpec={onSpec} />)
        expect(screen.getByText('Мои выходы')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /d1/ })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /d2/ })).toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /other/ })).toBeNull()
        fireEvent.click(screen.getByRole('button', { name: /d2/ }))
        expect(onSpec).toHaveBeenCalledTimes(1)
        expect(onSpec.mock.calls[0][0].channels[0].out).toBe('d2')
        rerender(<PluginTargets spec={{ ...s, channels: [{ ...s.channels[0], out: 'd1' }] }} index={0} live={liveFixture()} onSpec={onSpec} />)
        await waitFor(() => expect(screen.getByText('редактор d1')).toBeInTheDocument())
    })

    it('своя пилюля плагина заменяет стандартную; упавший редактор не роняет блок', () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        registry.register('outputKind', 'p1', 'demo', {
            kind: 'demo', label: 'Демо-вид', icon: () => null, create: () => ({ kind: 'demo' }),
            editor: () => { throw new Error('boom') },
            ruleTarget: { group: 'Мои выходы', pill: (name: string) => <b>моя-{name}</b> },
        })
        const s = spec()
        render(<PluginTargets spec={{ ...s, channels: [{ ...s.channels[0], out: 'd1' }] }} index={0} live={liveFixture()} onSpec={() => {}} />)
        expect(screen.getByText('моя-d1')).toBeInTheDocument()
        expect(screen.getByText('Плагин p1 не отрисовался')).toBeInTheDocument()
    })
})

describe('диагностика (diag)', () => {
    it('проверки плагинов собираются; упавшая не мешает остальным', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        registry.register('diag', 'p1', 'ok', { id: 'ok', label: 'ok', run: async () => [{ id: 'x', verdict: 'warn', what: 'находка плагина', why: 'потому что' }] })
        registry.register('diag', 'p2', 'bad', { id: 'bad', label: 'bad', run: async () => { throw new Error('x') } })
        function Out() { return <>{usePluginDiag().map((c) => `${c.verdict}:${c.what}:${c.why}`).join('|')}</> }
        const { container } = render(<Out />)
        await waitFor(() => expect(container.textContent).toBe('warn:находка плагина:потому что'))
    })
})

describe('значки выхода (badge)', () => {
    it('значок плагина встаёт в свою группу после значков панели; упавший match не мешает', async () => {
        const { outputBadges } = await import('@/lib/badges')
        vi.spyOn(console, 'error').mockImplementation(() => {})
        registry.register('badge', 'p1', 'ok', { id: 'ok', group: 'feature', match: (o: { kind: string }) => (o.kind === 'demo' ? { text: 'Особый', warn: false } : null) })
        registry.register('badge', 'p2', 'bad', { id: 'bad', group: 'feature', match: () => { throw new Error('x') } })
        const out = { name: 'd', kind: 'demo' } as never
        expect(outputBadges({ out }).map((b) => b.text)).toEqual(['Особый'])
        expect(outputBadges({ out: { name: 'v', kind: 'vless' } as never }).map((b) => b.text)).toEqual(['VLESS'])
    })
})
