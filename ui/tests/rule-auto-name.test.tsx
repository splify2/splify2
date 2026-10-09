import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RuleEditor from '@/components/tabs/RuleEditor'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { toCatalog, type Channel, type RawManifest, type Spec } from '@/lib/model'

// QEMU-стенд, проход новичком 2026-10-07: «Новое правило» называлось «правило1», и в списке
// правил и на главной оно так и стояло — «правило1 → vpn», без слова о том, что оно делает.
// Первый выбранный сервис теперь называет правило; набранное человеком имя не трогается.

const MANIFEST: RawManifest = {
    version: 'v',
    base_url: 'https://example.invalid/lists',
    categories: [
        { id: 'plain:youtube', name_ru: 'YouTube', file: 'plain/youtube.lst' },
        { id: 'plain:news', name_ru: 'Новости', file: 'plain/news.lst' },
        { id: 'plain:long', name_ru: 'Очень длинное название сервиса', file: 'plain/long.lst' },
    ],
} as unknown as RawManifest

const services = toCatalog(MANIFEST).services
const OUTPUTS = { direct: { kind: 'direct', up: true } } as never

function mount(ch: Channel) {
    const changes: Channel[] = []
    const el = (c: Channel) => (
        <RuleEditor ch={c} index={0} services={services} local={{}} outputs={OUTPUTS} clash={null} rulesTotal={1}
            coveredBy={[]} onChange={(n) => { changes.push(n); r.rerender(el(n)) }} onClose={() => {}} onDelete={() => {}} />
    )
    const r = render(el(ch))
    return changes
}

const pick = (name: RegExp) => fireEvent.click(screen.getByRole('checkbox', { name }))

beforeEach(() => {
    vi.restoreAllMocks()
    pending.saved = null
    vi.spyOn(rpc, 'leases').mockResolvedValue({ leases: [] } as never)
    vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] } as never)
    vi.spyOn(rpc, 'listFetch').mockResolvedValue({ ok: true, count: 1 } as never)
})

describe('имя нового правила по первому сервису', () => {
    it('«правило1» становится «YouTube», второй сервис имя не меняет', async () => {
        const changes = mount({ name: 'правило1', out: 'direct', match: {} } as Channel)
        pick(/^YouTube/)
        await waitFor(() => expect(changes.at(-1)?.name).toBe('YouTube'))
        pick(/^Новости/)
        await waitFor(() => expect(changes.at(-1)?.match.prefixes_files).toHaveLength(2))
        expect(changes.at(-1)!.name).toBe('YouTube')
    })

    it('имя, набранное человеком, остаётся', async () => {
        const changes = mount({ name: 'Видео детям', out: 'direct', match: {} } as Channel)
        pick(/^YouTube/)
        await waitFor(() => expect(changes.length).toBeGreaterThan(0))
        expect(changes.at(-1)!.name).toBe('Видео детям')
    })

    it('занятое имя получает номер', async () => {
        pending.saved = { outputs: {}, channels: [{ name: 'YouTube', out: 'direct', match: {} }, { name: 'правило2', out: 'direct', match: {} }] } as unknown as Spec
        const changes = mount({ name: 'правило2', out: 'direct', match: {} } as Channel)
        pick(/^YouTube/)
        await waitFor(() => expect(changes.at(-1)?.name).toBe('YouTube 2'))
    })

    it('имя длиннее, чем примет ядро (31 байт), не ставится', async () => {
        const changes = mount({ name: 'правило1', out: 'direct', match: {} } as Channel)
        pick(/^Очень длинное/)
        await waitFor(() => expect(changes.length).toBeGreaterThan(0))
        expect(changes.at(-1)!.name).toBe('правило1')
    })
})
