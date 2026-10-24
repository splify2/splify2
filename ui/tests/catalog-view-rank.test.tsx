import { render, screen, waitFor, fireEvent } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import CatalogTab from '@/components/tabs/CatalogTab'
import { rpc } from '@/lib/rpc'
import { wantedFirst } from '@/lib/model'
import { adPath, mockCatalog } from './ad-fixture'

// R-140: у записи каталога можно посмотреть домены и подсети; каталог в выборе — заблокированное
// сверху, хостинги в конце; R-141: свой список заводится рядом с готовыми.

describe('порядок выбора списка', () => {
    it('заблокированное первым, хостинги в конце, остальное в прежнем порядке', () => {
        const mk = (id: string, name: string) => ({ id, name })
        const out = wantedFirst([
            mk('itdog:hetzner', 'Hetzner'),
            mk('itdog:youtube', 'YouTube'),
            mk('itdog:hodca', 'H.O.D.C.A (Hetzner, OVH)'),
            mk('itdog:block', 'Заблокированное в РФ'),
            mk('itdog:telegram', 'Telegram'),
            mk('itdog:cloudflare', 'Cloudflare'),
        ]).map((x) => x.name)
        expect(out).toEqual(['Заблокированное в РФ', 'YouTube', 'Telegram', 'Hetzner', 'H.O.D.C.A (Hetzner, OVH)', 'Cloudflare'])
    })
})

describe('каталог: записи списка и свой список', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        mockCatalog(
            [
                { id: 'hetzner', name: 'Hetzner', kinds: ['domains'] },
                { id: 'youtube', name: 'YouTube', kinds: ['domains'] },
            ],
            {
                [adPath('hetzner', 'domains')]: { count: 5, mtime: 1 },
                [adPath('youtube', 'domains')]: { count: 100, mtime: 1 },
            },
        )
    })

    it('хостинг в таблице ниже YouTube', async () => {
        render(<CatalogTab onUseInRule={() => {}} />)
        const yt = await screen.findByText('YouTube')
        const hz = screen.getByText('Hetzner')
        expect(yt.compareDocumentPosition(hz) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('глазик открывает записи списка с роутера', async () => {
        const peek = vi.spyOn(rpc, 'listPeek').mockResolvedValue({ ok: true, total: 2, found: 2, text: 'youtube.com\nytimg.com' })
        render(<CatalogTab onUseInRule={() => {}} />)
        fireEvent.click(await screen.findByLabelText(/Посмотреть записи списка YouTube/))
        await waitFor(() => expect(screen.getByText(/ytimg\.com/)).toBeInTheDocument())
        expect(peek).toHaveBeenCalledWith(expect.stringContaining('youtube'), '')
    })

    it('кнопка «Свой список» открывает форму рядом с каталогом', async () => {
        render(<CatalogTab onUseInRule={() => {}} />)
        fireEvent.click(await screen.findByRole('button', { name: /Свой список/ }))
        expect(await screen.findByText(/Свои списки|своих списков|Свой список/i, { selector: ':not(button)' })).toBeTruthy()
    })
})
