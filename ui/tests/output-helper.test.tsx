import { render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { parseHelpers } from '@/lib/helper'
import type { Spec } from '@/lib/model'
import { live } from './fixtures'

// Помощник выхода глазами демона (`steer ctl helper`, метод rpcd `helper`): метод был объявлен,
// но экран его не спрашивал. Модуль другой версии (демон его отверг — `rejected`), процесс не
// запущен и перезапуски видны только здесь: status говорит лишь, что выход не поднят.

const SPEC: Spec = {
    schema: 1,
    outputs: {
        vl: { name: 'vl', kind: 'vless', sub_file: '/etc/steer/sub.txt' },
        wg: { name: 'wg', kind: 'interface', device: 'wg0' },
    },
    channels: [],
} as Spec

const reply = (...lines: object[]) => ({ code: 0, stdout: lines.map((l) => JSON.stringify(l)).join('\n') + '\n', stderr: '' })

async function show(helper: (o: string) => unknown) {
    pending.saved = SPEC
    pending.applied = SPEC
    vi.spyOn(rpc, 'specGet').mockResolvedValue(SPEC)
    vi.spyOn(rpc, 'appliedGet').mockResolvedValue(SPEC)
    const spy = vi.spyOn(rpc, 'helper').mockImplementation(((o: string) => Promise.resolve(helper(o))) as never)
    const { default: PoolList } = await import('@/components/PoolList')
    render(
        <PoolList
            live={live({
                status: {
                    schema: 1,
                    outputs: {
                        vl: { name: 'vl', kind: 'vless', device: 'vl', up: false },
                        wg: { name: 'wg', kind: 'interface', device: 'wg0', up: true },
                    },
                    channels: [],
                },
            })}
        />,
    )
    return spy
}

describe('помощник у выхода', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [] } as never)
        vi.spyOn(rpc, 'outboundGeo').mockResolvedValue({} as never)
    })

    it('модуль другой версии — сказано и названо действие; у выхода без помощника не спрашиваем', async () => {
        const spy = await show(() =>
            reply({
                schema: 1, out: 'vl', helper: 'vless', running: false, up: false, since: 0, started: 1790000000,
                restarts: 0, module: 'steer-vless', module_ver: '1.9.0', rejected: true,
                last_down: 'модуль steer-vless версии 1.9.0, а ядро 2.0.0 — обновите пакеты steer вместе',
            }),
        )
        expect(await screen.findByText(/^модуль другой версии — обновите ядро · подписка/)).toBeInTheDocument()
        expect(spy).toHaveBeenCalledWith('vl')
        expect(spy).not.toHaveBeenCalledWith('wg')
    })

    it('бинарника модуля нет — «нужен пакет steer-vless»', async () => {
        await show(() =>
            reply({
                schema: 1, out: 'vl', helper: 'vless', running: false, up: false, since: 0, started: 0,
                restarts: 0, module: 'steer-vless', last_down: 'нужен пакет steer-vless',
            }),
        )
        expect(await screen.findByText(/^нужен пакет steer-vless/)).toBeInTheDocument()
    })

    it('процесс упал — «не запущен», без слов процесса; перезапуски сосчитаны', async () => {
        await show(() =>
            reply({
                schema: 1, out: 'vl', helper: 'vless', running: false, up: false, since: 0, started: 0,
                restarts: 3, module: 'steer-vless', module_ver: '2.0.0', last_down: 'процесс вышел (код 1)',
            }),
        )
        expect(await screen.findByText(/^не запущен · подписка · перезапусков: 3$/)).toBeInTheDocument()
        expect(screen.queryByText(/код 1/)).toBeNull()
    })

    it('помощника нет или демон не ответил — строка прежняя', async () => {
        await show(() => ({ code: 1, stdout: '', stderr: 'steer: helper: у выхода vl нет помощника' }))
        await waitFor(() => expect(screen.getByText('подписка')).toBeInTheDocument())
    })
})

describe('разбор ответа helper', () => {
    it('строка на помощника; оборванная строка пропущена, остальные годны', () => {
        const r = { code: 0, stdout: '{"helper":"obfs","running":true,"up":true,"restarts":0}\n{"helper":"vl' }
        expect(parseHelpers(r).map((h) => h.helper)).toEqual(['obfs'])
        expect(parseHelpers({ code: 1, stdout: '' })).toEqual([])
    })
})
