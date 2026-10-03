import { render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Home from '@/components/sections/Home'
import { rpc } from '@/lib/rpc'
import { type Live } from '@/lib/live'
import type { Status } from '@/lib/model'

// Правила и выходы на обзоре — две половины одного вопроса «куда идёт трафик», и стоят они
// рядом в двух столбцах. Оформлены они были по-разному: у выходов заголовок РАЗДЕЛА над
// карточками (и ссылка «проверить» справа от него), а у правил — заголовок ВНУТРИ карточки.
// Первые строки столбцов из-за этого не совпадали по высоте — заголовок карточки ниже на её
// отступ, — и два соседних столбца читались как два разных вида вещей. Владелец на это и
// указал.
//
// С Bode 26.10 оба столбца — карточки приложения Splify2: заголовок стоит ВНУТРИ карточки
// строкой «заголовок — подпись справа» (CardHead, h3.sp-sub). Барьер тот же по смыслу: вид
// заголовков у обоих один и тот же, и оба — ПЕРВАЯ строка своей карточки.

const status = {
    outputs: {
        vless: { kind: 'vless', device: 'vless', up: true, mark: '0x00100000', table: 300 },
    },
    channels: [{ name: 'Youtube', out: 'vless', kind: 'domains', live: true }],
} as unknown as Status

const live = {
    status,
    devices: {},
    net: { uptime: 1200, active_clients: 0 },
    diag: undefined,
    build: { present: true, version: '1.3.0' },
    releases: [],
    selfUpdate: { current: '1.2.5' },
    refresh: () => undefined,
} as unknown as Live

describe('обзор: правила и выходы оформлены одинаково', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        document.body.innerHTML = ''
        vi.spyOn(rpc, 'specGet').mockResolvedValue({
            schema: 1,
            outputs: { vless: { name: 'vless', kind: 'vless' } },
            channels: [{ name: 'Youtube', out: 'vless', match: { domains_files: ['/a.lst'] } }],
        } as never)
        vi.spyOn(rpc, 'appliedGet').mockResolvedValue({
            schema: 1, outputs: {}, channels: [],
        } as never)
        vi.spyOn(rpc, 'subList').mockRejectedValue(new Error('нет метода'))
        vi.spyOn(rpc, 'subQuota').mockRejectedValue(new Error('нет метода'))
        vi.spyOn(rpc, 'outboundGeo').mockRejectedValue(new Error('нет метода'))
    })

    it('оба заголовка — одинаковые заголовки карточек', async () => {
        render(<Home live={live} onSection={() => undefined} onAddRule={() => undefined} />)
        const rules = await waitFor(() => screen.getByText('Правила'))
        const outs = await waitFor(() => screen.getByText('Выходы'))
        expect(rules.tagName).toBe('H3')
        expect(outs.tagName).toBe('H3')
        expect(rules.className).toContain('sp-sub')
        expect(outs.className).toContain('sp-sub')
    })

    it('и каждый — первая строка своей карточки', async () => {
        // Именно из-за этого столбцы и разъезжались: у одного над заголовком стоял отступ
        // карточки, у другого нет. Теперь обе шапки — первая строка карточки.
        render(<Home live={live} onSection={() => undefined} onAddRule={() => undefined} />)
        const rules = await waitFor(() => screen.getByText('Правила'))
        const outs = await waitFor(() => screen.getByText('Выходы'))
        // Карточка — родитель строки заголовка; строка заголовка обязана быть в ней первой.
        for (const h of [rules, outs]) {
            const headRow = h.parentElement!
            const column = headRow.parentElement!
            expect(column.firstElementChild).toBe(headRow)
        }
    })

    it('подпись справа от заголовка осталась на месте', async () => {
        // «с загрузки роутера» отвечает на вопрос, за какой срок числа: без неё счётчики
        // читаются как «сейчас».
        render(<Home live={live} onSection={() => undefined} onAddRule={() => undefined} />)
        await waitFor(() => expect(screen.getByText('с загрузки роутера')).toBeInTheDocument())
        const hint = screen.getByText('с загрузки роутера')
        // В шапке карточки — правой группой вместе с действием, если оно есть (CardHead).
        expect(screen.getByText('Правила').parentElement!.contains(hint)).toBe(true)
    })
})
