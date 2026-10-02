import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RuleEditor from '@/components/tabs/RuleEditor'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { toCatalog, type Channel, type RawManifest } from '@/lib/model'

// I-421: сужение подсетей (Discord: голос по udp и его порты) у записей КАТАЛОГА. Бэкенд,
// разбирая набор .srs каталога, кладёт сужение рядом со списком и отдаёт его в ответе
// list_fetch (`narrow`), а редактор спрашивал сужение только у записей второго издателя
// (`sv.publisher`, id записи — id списка). У записи каталога id — склейка частей, издателя нет,
// и Discord из каталога вставал в правило без proto/ports: подсети Cloudflare целиком в туннель.

const MANIFEST: RawManifest = {
    version: 'v',
    base_url: 'https://example.invalid/lists',
    categories: [
        { id: 'itdoginfo:discord', name_ru: 'Discord', file: 'itdoginfo/discord.srs.lst', format: 'srs' },
        { id: 'plain:news', name_ru: 'Новости', file: 'plain/news.lst' },
    ],
    domain_lists: [
        { id: 'svc_discord', kind: 'domains', name_ru: 'Discord', file: 'itdoginfo/domains/discord.srs.lst',
          format: 'srs', same_as_ip: ['itdoginfo:discord'] },
    ],
} as unknown as RawManifest

const services = toCatalog(MANIFEST).services
const discord = services.find((s) => s.name === 'Discord')!
const PFX = '/etc/steer/lists/itdoginfo/discord.srs.lst'
const NARROW = { proto: 'udp' as const, ports: ['50000-65535', '19294-19344'] }
const OUTPUTS = { direct: { kind: 'direct', up: true } } as never
const EMPTY: Channel = { name: 'Discord', out: 'direct', match: {} } as Channel

function mount(local: Record<string, { count: number; mtime: number }> = {}) {
    const changes: Channel[] = []
    const el = (c: Channel) => (
        <RuleEditor ch={c} index={0} services={services} local={local} outputs={OUTPUTS} clash={null} rulesTotal={1}
            coveredBy={[]} onChange={(n) => { changes.push(n); r.rerender(el(n)) }} onClose={() => {}} onDelete={() => {}} />
    )
    const r = render(el(EMPTY))
    return changes
}

beforeEach(() => {
    vi.restoreAllMocks()
    pending.saved = null
    vi.spyOn(rpc, 'leases').mockResolvedValue({ leases: [] } as never)
    vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] } as never)
})

describe('сужение подсетей у записи каталога', () => {
    it('набора нет на роутере: сужение из ответа list_fetch — в правило, без второго скачивания', async () => {
        const fetch = vi.spyOn(rpc, 'listFetch').mockResolvedValue({ ok: true, count: 9, narrow: NARROW } as never)
        const changes = mount()
        fireEvent.click(screen.getByRole('checkbox', { name: /^Discord/ }))
        await waitFor(() => expect(changes.at(-1)?.narrow).toEqual({ [PFX]: NARROW }))
        expect(changes.at(-1)!.match.prefixes_files).toEqual([PFX])
        expect(fetch).toHaveBeenCalledTimes(1)
        expect(fetch).toHaveBeenCalledWith('itdoginfo:discord', 'prefixes')
    })

    it('списки уже на роутере: сужение спрашивается по id части, а не записи', async () => {
        const fetch = vi.spyOn(rpc, 'listFetch').mockResolvedValue({ ok: true, count: 9, narrow: NARROW } as never)
        const changes = mount({
            'itdoginfo/discord.srs.lst': { count: 9, mtime: 1 },
            'itdoginfo/domains/discord.srs.lst': { count: 3, mtime: 1 },
        })
        fireEvent.click(screen.getByRole('checkbox', { name: /^Discord/ }))
        await waitFor(() => expect(changes.at(-1)?.narrow).toEqual({ [PFX]: NARROW }))
        expect(fetch).toHaveBeenCalledWith('itdoginfo:discord', 'prefixes')
    })

    it('обычный список каталога (не набор) сужения не бывает — в сеть не ходим', async () => {
        const fetch = vi.spyOn(rpc, 'listFetch')
        const changes = mount({ 'plain/news.lst': { count: 9, mtime: 1 } })
        fireEvent.click(screen.getByRole('checkbox', { name: /^Новости/ }))
        await waitFor(() => expect(changes.length).toBe(1))
        expect(fetch).not.toHaveBeenCalled()
        expect(changes[0].narrow).toBeUndefined()
    })
})

describe('«В правило» из каталога', () => {
    it('сужение из ответа роутера встаёт в новое правило', async () => {
        const RulesTab = (await import('@/components/tabs/RulesTab')).default
        const { live } = await import('./fixtures')
        vi.spyOn(rpc, 'listFetch').mockResolvedValue({ ok: true, count: 9, narrow: NARROW } as never)
        vi.spyOn(rpc, 'manifest').mockResolvedValue(MANIFEST as never)
        vi.spyOn(rpc, 'localLists').mockResolvedValue({ files: {} })
        const base = { schema: 1, outputs: { awg: { name: 'awg', kind: 'interface', devices: ['awg0'] } }, channels: [] }
        vi.spyOn(pending, 'load').mockResolvedValue(base as never)
        const edits: { channels: Channel[] }[] = []
        vi.spyOn(pending, 'edit').mockImplementation(((s: { channels: Channel[] }) => { edits.push(s) }) as never)
        render(<RulesTab live={live({ status: { outputs: base.outputs } as never })} wanted={discord} onWantedUsed={() => {}} />)
        await waitFor(() => expect(edits.length).toBe(1))
        expect(edits[0].channels[0].narrow).toEqual({ [PFX]: NARROW })
    })
})
