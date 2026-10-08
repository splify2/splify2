import { render, screen, waitFor, within } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PoolEditor from '@/components/PoolEditor'
import { rpc } from '@/lib/rpc'
import { type Spec } from '@/lib/model'
import { live } from './fixtures'

// «Порядок предпочтения»: пометка строки («все узлы исключены», «не берётся») не отбирает место у
// названия. Пометка стояла отдельным столбцом справа без переноса — около ста пикселей, — и в
// колонке редактора на 26rem название сжималось до нуля (на 1440 пикселях), на телефоне — до
// «London №…». Теперь она — строка под названием, в одном с ним столбце: переносится по словам и
// названия не трогает. Название помеченной строки переносится, а не усекается: по нему узнают,
// какой узел не берётся, а в колонке на 26rem рядом с подписью подписки ему остаётся около ста
// пикселей. Теперь так у любой строки: «Великобри…» и «Нидерланд…» вместо имени узла
// (жалоба из чата splify2) — название переносится и без пометки.
//
// jsdom раскладки не считает, поэтому здесь сторожится строение, от которого раскладка зависит:
// где стоит пометка и что приглушено. Как это выглядит на 1440 и 390 пикселях, смотрится глазами
// на настоящем браузере.

const SUB = { name: 'main', title: 'Riot VPN (Основной)', path: '/etc/steer/sub.txt', present: true, kind: 'links' }
const reply = (nodes: unknown[]) =>
    ({ output: '', sub_file: SUB.path, node: -1, chosen: [], usable: nodes.length, skipped: 0, foreign: 0, nodes }) as never
const WITH = live({
    status: { schema: 1, features: ['lan_devices', 'nodes', 'pool', 'groups', 'balance_by', 'exclude'], outputs: {}, channels: [] },
    build: { modules: ['vless', 'hysteria2', 'proxy'] },
})

describe('пометка строки порядка', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] })
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [SUB] } as never)
        vi.spyOn(rpc, 'vlessNodesOfSub').mockResolvedValue(reply([
            { index: 0, name: '🇬🇧 London №1 Premium', type: 'tcp', security: 'reality', cc: 'GB' },
            { index: 1, name: '🇩🇪 Frankfurt', type: 'tcp', security: 'reality', cc: 'DE' },
        ]))
        vi.spyOn(rpc, 'hysteria2NodesOfSub').mockResolvedValue(reply([]))
        vi.spyOn(rpc, 'proxyNodesOfSub').mockResolvedValue(reply([]))
    })

    const open = async (nodes: number[]) => {
        const spec: Spec = {
            outputs: { v: { name: 'v', kind: 'vless', sub_file: SUB.path, nodes, exclude: ['GB'], on_fail: 'drop' } },
            channels: [],
        }
        render(<PoolEditor spec={spec} name="v" live={WITH} onCancel={() => {}} onSave={() => {}} />)
        return screen.findByRole('list', { name: /порядок предпочтения/ })
    }

    it('«все узлы исключены» — под названием, в одном с ним столбце, а не столбцом справа', async () => {
        const order = await open([0])
        const mark = await within(order).findByText('все узлы исключены')
        const label = within(order).getByText('London №1 Premium')
        // Название и пометка — соседи в одном столбце строки; столбец тянется и ужимается, а
        // пометка переносится по словам внутри него.
        expect(mark.parentElement).toBe(label.parentElement)
        expect(mark.parentElement!.parentElement).toBe(mark.closest('li'))
        expect(mark.className).toMatch(/\bblock\b/)
        // И не фиксированной ширины: такой элемент строки и отбирал место у названия.
        expect(mark.className).not.toMatch(/shrink-0/)
        expect(mark.className).not.toMatch(/whitespace-nowrap|truncate/)
    })

    it('приглушено название, а не пометка: предупреждение остаётся читаемым', async () => {
        const order = await open([0])
        const mark = await within(order).findByText('все узлы исключены')
        const label = within(order).getByText('London №1 Premium')
        expect(label.className).toMatch(/opacity-60/)
        expect(mark.className).toMatch(/text-warning-fg/)
        expect(mark.closest('.opacity-60')).toBeNull()
    })

    it('название переносится, а не усекается — и у помеченной строки, и у остальных', async () => {
        const order = await open([0, 1])
        await within(order).findByText('не берётся')
        const marked = within(order).getByText('London №1 Premium')
        expect(marked.className).toMatch(/break-words/)
        expect(marked.className).not.toMatch(/truncate/)
        const plain = within(order).getByText('Frankfurt')
        expect(plain.className).toMatch(/break-words/)
        expect(plain.className).not.toMatch(/truncate/)
    })

    it('«не берётся» у части с живым узлом — там же, под названием', async () => {
        const order = await open([0, 1])
        const mark = await within(order).findByText('не берётся')
        const label = within(order).getByText('London №1 Premium')
        expect(mark.parentElement).toBe(label.parentElement)
        // У живой соседней строки пометки нет и название не приглушено.
        const live1 = within(order).getByText('Frankfurt')
        expect(live1.className).not.toMatch(/opacity-60/)
        await waitFor(() => expect(within(order).queryByText('все узлы исключены')).toBeNull())
    })
})
