import { render, screen, waitFor, within } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Home from '@/components/sections/Home'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { type Live } from '@/lib/live'
import type { Spec, Status } from '@/lib/model'

// Снято с QEMU-стенда: выход vl (туннель vless по подписке sub-test.txt, заведённой в спеке мимо
// splify2) в «VPN → Выходы» стоит, а карточка «Выходы» на главной — пустая, одна шапка. Блок
// подписки рисовался только по подпискам из перечня sub_list, и выход, чья подписка в перечень
// не входит (файл, положенный руками, или узел прямо в выходе), не попадал ни в один блок —
// вместе со своим состоянием «не поднят».
//
// Путь подписки в спеке v2 бывает и относительным — от каталога спеки (/etc/steer): такой выход
// принадлежит подписке из перечня с тем же файлом, а не висит отдельной строкой.

function liveWith(outputs: Status['outputs']): Live {
    return {
        status: { outputs, channels: [{ name: 'T', out: 'vl', kind: 'prefixes', live: true }] } as unknown as Status,
        devices: {},
        net: { uptime: 1200, active_clients: 1 },
        diag: undefined,
        build: { present: true, version: '2.0.0' },
        releases: [],
        selfUpdate: { current: '26.10.0' },
        refresh: () => undefined,
    } as unknown as Live
}

function mockSpec(spec: Spec) {
    pending.saved = spec
    pending.applied = spec
}

async function outputsColumn() {
    const h = await waitFor(() => screen.getByText('Выходы'))
    return h.parentElement!.parentElement!
}

const SPEC = {
    schema: 1,
    outputs: { vl: { name: 'vl', kind: 'vless', sub_file: 'sub-test.txt', on_fail: 'drop' } },
    channels: [{ name: 'T', out: 'vl', match: { prefixes_files: ['/etc/steer/lists/test.net'] } }],
} as unknown as Spec

const DOWN = { vl: { kind: 'vless', device: 'vl', up: false, on_fail: 'drop' } } as unknown as Status['outputs']

describe('главная: выход вне перечня подписок', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        vi.spyOn(rpc, 'subQuota').mockRejectedValue(new Error('нет метода'))
        vi.spyOn(rpc, 'outboundGeo').mockRejectedValue(new Error('нет метода'))
        vi.spyOn(rpc, 'vlessNodes').mockRejectedValue(new Error('нет метода'))
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] } as never)
        mockSpec(SPEC)
    })

    it('подписок в перечне нет — выход всё равно в «Выходах», со своим состоянием', async () => {
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [] } as never)
        render(<Home live={liveWith(DOWN)} onSection={() => undefined} onAddRule={() => undefined} />)
        const col = await outputsColumn()
        await waitFor(() => expect(within(col).getByText('vl')).toBeInTheDocument(), { timeout: 2000 })
        expect(within(col).getByText('Нет соединения')).toBeInTheDocument()
    })

    it('подписка в перечне другая — выход не пропадает', async () => {
        vi.spyOn(rpc, 'subList').mockResolvedValue({
            subs: [{ name: 'main', path: '/etc/steer/sub.txt', present: true, kind: 'url' }],
        } as never)
        render(<Home live={liveWith(DOWN)} onSection={() => undefined} onAddRule={() => undefined} />)
        const col = await outputsColumn()
        await waitFor(() => expect(within(col).getByText('vl')).toBeInTheDocument(), { timeout: 2000 })
    })

    it('относительный путь — та же подписка из перечня, строкой в её блоке, а не второй раз', async () => {
        vi.spyOn(rpc, 'subList').mockResolvedValue({
            subs: [{ name: 'test', title: 'Тестовая', path: '/etc/steer/sub-test.txt', present: true, kind: 'links' }],
        } as never)
        render(<Home live={liveWith(DOWN)} onSection={() => undefined} onAddRule={() => undefined} />)
        const col = await outputsColumn()
        await waitFor(() => expect(within(col).getByText('Тестовая')).toBeInTheDocument(), { timeout: 2000 })
        expect(within(col).getAllByText('Нет соединения')).toHaveLength(1)
        // Отдельной строки с именем выхода нет: он стоит локацией внутри блока подписки.
        expect(within(col).queryByText('vl')).toBeNull()
    })
})
