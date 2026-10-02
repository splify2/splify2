import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import RuleEditor, { selectedIds } from '@/components/tabs/RuleEditor'
import RulesTab from '@/components/tabs/RulesTab'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { decodeSpec, encodeSpec } from '@/lib/specv2'
import { toCatalog, type Channel, type RawManifest, type Spec } from '@/lib/model'
import { live } from './fixtures'

// splify2-lists#1: в каталог добавлен фильтр AdGuard в .srs. Ядро понимает такой набор, но
// списком его не выразить — исключения `@@`. Решение владельца: роутер кладёт сам набор
// (list_fetch отвечает полем `srs`), и правило берёт его ключом `srs` списка спеки v2.
// Выразимые наборы — прежним путём, списками.

const MANIFEST: RawManifest = {
    version: 'v',
    base_url: 'https://example.invalid/lists',
    categories: [
        { id: 'ex:telegram', name_ru: 'Telegram', file: 'ex/telegram.srs.lst', format: 'srs' },
    ],
    domain_lists: [
        { id: 'svc_ex_telegram', kind: 'domains', name_ru: 'Telegram', file: 'ex/domains/telegram.srs.lst',
          format: 'srs', same_as_ip: ['ex:telegram'] },
        { id: 'jinndi:adguard', kind: 'domains', name_ru: 'Реклама (AdGuard)',
          file: 'jinndi/domains/adguard.srs.lst', format: 'srs' },
    ],
} as unknown as RawManifest

const SET = '/etc/steer/lists/jinndi/domains/adguard.srs'
const services = toCatalog(MANIFEST).services
const adguard = services.find((s) => s.name === 'Реклама (AdGuard)')!
const telegram = services.find((s) => s.name === 'Telegram')!

const OUTPUTS = { direct: { kind: 'direct', up: true } } as never
const EMPTY: Channel = { name: 'Реклама', out: 'direct', match: {} } as Channel

function mount(ch: Channel, local: Record<string, { count: number; mtime: number }> = {}) {
    const changes: Channel[] = []
    render(
        <RuleEditor
            ch={ch}
            index={0}
            services={services}
            local={local}
            outputs={OUTPUTS}
            clash={null}
            rulesTotal={1}
            coveredBy={[]}
            onChange={(c) => changes.push(c)}
            onClose={() => {}}
            onDelete={() => {}}
        />,
    )
    return changes
}

beforeEach(() => {
    vi.restoreAllMocks()
    pending.saved = null
    pending.applied = null
    pending.dirty = false
    vi.spyOn(rpc, 'leases').mockResolvedValue({ leases: [] } as never)
    vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] } as never)
})

describe('набор каталога, который списком не выразим, — файлом в правиле', () => {
    it('каталог помечает записи-наборы', () => {
        expect(adguard.srs).toBe(true)
        expect(telegram.srs).toBe(true)
    })

    it('выбор: роутер ответил `srs` — правило берёт набор файлом, а не .lst', async () => {
        const fetch = vi.spyOn(rpc, 'listFetch').mockResolvedValue({ ok: true, srs: SET, path: SET } as never)
        const changes = mount(EMPTY)
        fireEvent.click(screen.getByRole('checkbox', { name: /Реклама \(AdGuard\)/ }))
        await waitFor(() => expect(changes.length).toBe(1))
        expect(fetch).toHaveBeenCalledWith('jinndi:adguard', 'domains')
        const m = changes[0].match
        expect(m.srs_files).toEqual([SET])
        expect(m.domains_files).toBeUndefined()
        expect(m.mode).toBe('fakeip')
    })

    it('в спеке v2 — ключ `srs` списка, и обратно правило читается тем же', () => {
        const ch: Channel = { ...EMPTY, match: { srs_files: [SET], mode: 'fakeip' } } as Channel
        const doc = encodeSpec({ outputs: { direct: { name: 'direct', kind: 'direct' } }, channels: [ch] } as Spec)
        const lists = doc.lists as Record<string, Record<string, unknown>>
        expect(Object.values(lists)).toEqual([{ srs: [SET] }])
        expect((doc.rules as Record<string, unknown>[])[0]).toMatchObject({ out: 'direct', resolve: 'fakeip' })
        const back = decodeSpec(doc).channels[0]
        expect(back.match.srs_files).toEqual([SET])
        // И выбранным он показывается: галочка стоит у записи каталога.
        expect(selectedIds(back, services)).toEqual([adguard.id])
    })

    it('снятие галочки убирает набор из правила', () => {
        const ch: Channel = { ...EMPTY, match: { srs_files: [SET], mode: 'fakeip' } } as Channel
        const changes = mount(ch, { 'jinndi/domains/adguard.srs': { count: 0, mtime: 1 } })
        const box = screen.getByRole('checkbox', { name: /Реклама \(AdGuard\)/ }) as HTMLInputElement
        expect(box.checked).toBe(true)
        fireEvent.click(box)
        expect(changes[0].match.srs_files).toBeUndefined()
        expect(changes[0].match.mode).toBeUndefined()
    })

    it('набор уже лежит на роутере — в сеть за ответом не ходим', async () => {
        const fetch = vi.spyOn(rpc, 'listFetch')
        const changes = mount(EMPTY, { 'jinndi/domains/adguard.srs': { count: 0, mtime: 1 } })
        fireEvent.click(screen.getByRole('checkbox', { name: /Реклама \(AdGuard\)/ }))
        await waitFor(() => expect(changes.length).toBe(1))
        expect(fetch).not.toHaveBeenCalled()
        expect(changes[0].match.srs_files).toEqual([SET])
        const row = screen.getByRole('checkbox', { name: /Реклама \(AdGuard\)/ }).closest('label')!
        expect(row.textContent).not.toContain('скачается')
    })

    it('выразимый набор — прежним путём: обе половины списками', async () => {
        vi.spyOn(rpc, 'listFetch').mockResolvedValue({ ok: true, count: 3, path: '/x' } as never)
        const changes = mount(EMPTY)
        fireEvent.click(screen.getByRole('checkbox', { name: /^Telegram/ }))
        await waitFor(() => expect(changes.length).toBe(1))
        const m = changes[0].match
        expect(m.prefixes_files).toEqual(['/etc/steer/lists/ex/telegram.srs.lst'])
        expect(m.domains_files).toEqual(['/etc/steer/lists/ex/domains/telegram.srs.lst'])
        expect(m.srs_files).toBeUndefined()
    })

    it('«В правило» из каталога: набор встаёт файлом', async () => {
        vi.spyOn(rpc, 'listFetch').mockResolvedValue({ ok: true, srs: SET, path: SET } as never)
        vi.spyOn(rpc, 'manifest').mockResolvedValue(MANIFEST as never)
        vi.spyOn(rpc, 'localLists').mockResolvedValue({ files: {} })
        const base = { schema: 1, outputs: { awg: { name: 'awg', kind: 'interface', devices: ['awg0'] } }, channels: [] }
        vi.spyOn(pending, 'load').mockResolvedValue(base as never)
        const edits: Spec[] = []
        vi.spyOn(pending, 'edit').mockImplementation(((s: Spec) => { edits.push(s) }) as never)
        render(<RulesTab live={live({ status: { outputs: base.outputs } as never })} wanted={adguard} onWantedUsed={() => {}} />)
        await waitFor(() => expect(edits.length).toBe(1))
        expect(edits[0].channels[0].match).toEqual({ srs_files: [SET], mode: 'fakeip' })
    })
})
