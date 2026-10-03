import { render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LooseBlock } from '@/components/OutputCards'
import PoolList from '@/components/PoolList'
import Home from '@/components/sections/Home'
import { outDownWord, outExcluded } from '@/lib/outstate'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import type { OutputStatus, Spec } from '@/lib/model'
import { live } from './fixtures'

// Все кандидаты выхода исключены («Не брать»): ядро говорит probe.state `excluded`. Строка
// выхода называет состояние и действие, а не «в подписке нет пригодных узлов» (узлы есть, их не
// велено брать) и не «нет соединения».

describe('выход без кандидатов из-за исключения', () => {
    it('состояние excluded — «Все узлы исключены» и что сделать', () => {
        const st = { kind: 'vless', device: 'vl', up: false, probe: { state: 'excluded', total: 5 } } as unknown as OutputStatus
        render(<LooseBlock name="vl" st={st} />)
        expect(screen.getByText('Все узлы исключены')).toBeInTheDocument()
        expect(screen.getByText(/Не брать/)).toBeInTheDocument()
        expect(screen.queryByText(/в подписке нет пригодных узлов/)).toBeNull()
        expect(screen.queryByText('Нет соединения')).toBeNull()
    })

    it('failed с нулём остаётся про подписку', () => {
        const st = { kind: 'vless', device: 'vl', up: false, probe: { state: 'failed', total: 0 } } as unknown as OutputStatus
        render(<LooseBlock name="vl" st={st} />)
        expect(screen.getByText(/в подписке нет пригодных узлов/)).toBeInTheDocument()
        expect(screen.queryByText('Все узлы исключены')).toBeNull()
    })
})

// То же состояние в перечне «Выходов» (раздел VPN). Сторож при исключённых кандидатах тоже считает
// выход неработающим (`failed`), а помощник не запускается и перезапускается — и строка говорила
// «не отвечает · не запущен · подписка · перезапусков: N», то есть отправляла чинить службу, когда
// чинится «Не брать». Здесь — то же слово, что в блоке выхода, и то же действие под ним.

const SPEC: Spec = {
    outputs: { vl: { name: 'vl', kind: 'vless', sub_file: '/etc/steer/sub.txt', exclude: ['RU'], on_fail: 'drop' } },
    channels: [{ name: 'tv', out: 'vl', match: { domains_files: ['/etc/steer/lists/tv.lst'] } }],
}
/** Помощник выхода глазами демона: процесс не запущен и уже перезапускался. */
const HELPER = {
    code: 0,
    stdout: JSON.stringify({ out: 'vl', helper: 'vless', running: false, up: false, since: 0, started: 0, restarts: 4 }),
}
const statusOf = (probe: unknown) => live({
    build: { modules: ['vless'] } as never,
    status: {
        schema: 1,
        outputs: { vl: { name: 'vl', kind: 'vless', device: 'vl', up: false, failed: true, on_fail: 'drop', probe } },
        channels: [],
    } as never,
})

describe('строка выхода в «Выходах»: все кандидаты исключены', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        pending.saved = SPEC
        pending.applied = SPEC
        vi.spyOn(rpc, 'specGet').mockResolvedValue(SPEC)
        vi.spyOn(rpc, 'appliedGet').mockResolvedValue(SPEC)
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [] } as never)
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] })
        // Прежнее измерение выхода — страна и отклик прежнего узла: рядом с «Все узлы исключены» их быть не должно.
        vi.spyOn(rpc, 'outboundGeo').mockResolvedValue({ cc: 'NL', ms: 42 } as never)
        vi.spyOn(rpc, 'vlessNodes').mockRejectedValue(new Error('не спрашиваем'))
    })

    it('предикат и слово: excluded — своё слово, остальное как было', () => {
        const mk = (over: Partial<OutputStatus>) => ({ kind: 'vless', up: false, ...over }) as OutputStatus
        expect(outExcluded(mk({ probe: { state: 'excluded', total: 5 } }))).toBe(true)
        expect(outExcluded(mk({ probe: { state: 'failed', total: 0 } }))).toBe(false)
        expect(outExcluded(null)).toBe(false)
        // Сторож при этом тоже ставит failed — исключение называется раньше общего «не отвечает».
        expect(outDownWord(mk({ failed: true, probe: { state: 'excluded', total: 5 } }))).toBe('Все узлы исключены')
        expect(outDownWord(mk({ failed: true, probe: { state: 'failed', total: 3 } }))).toBe('не отвечает')
        expect(outDownWord(mk({ node_down: { why: 'TCP', since: 1 } }))).toBe('узел не отвечает')
        expect(outDownWord(mk({}))).toBeNull()
    })

    it('excluded — «Все узлы исключены» и что сделать, без «не отвечает · не запущен · перезапусков»', async () => {
        const helper = vi.spyOn(rpc, 'helper').mockResolvedValue(HELPER as never)
        render(<PoolList live={statusOf({ state: 'excluded', total: 5 })} />)
        expect(await screen.findByText(/^Все узлы исключены/)).toBeInTheDocument()
        // То же действие, что в блоке выхода на главной (OutputCards).
        expect(screen.getByText(/Уберите часть исключений в «Не брать» или возьмите другую локацию/)).toBeInTheDocument()
        // Состояние помощника спрашивается — и всё равно не пересказывается: это следствия исключения.
        await waitFor(() => expect(helper).toHaveBeenCalled())
        await new Promise((r) => setTimeout(r, 30))
        expect(screen.queryByText(/не отвечает/)).toBeNull()
        expect(screen.queryByText(/не запущен/)).toBeNull()
        expect(screen.queryByText(/перезапусков/)).toBeNull()
        // Страна и отклик прежнего узла — тоже: беда стоит вместо локации. Правила на выходе остаются.
        expect(screen.queryByText(/Нидерланды/)).toBeNull()
        expect(screen.queryByText(/42 мс/)).toBeNull()
        expect(screen.getByText(/^Все узлы исключены · подписка · правил: 1$/)).toBeInTheDocument()
    })

    it('контроль: failed без исключения — прежние слова сторожа и помощника', async () => {
        const helper = vi.spyOn(rpc, 'helper').mockResolvedValue(HELPER as never)
        render(<PoolList live={statusOf({ state: 'failed', total: 3 })} />)
        // Страна и отклик приезжают отдельным вызовом, поэтому ждём всю строку целиком.
        expect(await screen.findByText(/^не отвечает · не запущен · Нидерланды · подписка · 42 мс · правил: 1 · перезапусков: 4$/)).toBeInTheDocument()
        expect(helper).toHaveBeenCalled()
        expect(screen.queryByText(/Все узлы исключены/)).toBeNull()
        expect(screen.queryByText(/Уберите часть исключений/)).toBeNull()
    })
})

// Слово из outDownWord стоит и в строке правила на главной: «куда ведёт» говорит то же, что перечень.
describe('строка правила на главной: выход без кандидатов', () => {
    const HOME_SPEC = {
        outputs: {
            direct: { name: 'direct', kind: 'direct' },
            nl: { name: 'nl', kind: 'tunnel', protocol: 'vless', sub_file: '/etc/steer/sub.txt', device: 'nl' },
        },
        channels: [{ name: 'YouTube', match: { domains_files: ['/etc/steer/lists/yt.lst'], mode: 'fakeip' }, out: 'nl' }],
    } as unknown as Spec
    const homeLive = (probe: unknown) => live({
        status: {
            schema: 1,
            outputs: {
                direct: { kind: 'direct' },
                nl: { kind: 'tunnel', protocol: 'vless', device: 'nl', up: false, failed: true, on_fail: 'drop', mark: '0x00100000', table: 300, probe },
            },
            channels: [{ name: 'nl_dom', out: 'nl', kind: 'domains', live: true, channels: ['YouTube'] }],
        } as never,
        net: { uptime: 1200, active_clients: 1 },
        diag: { checks: [], warn: 0, fail: 0 },
    })

    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        pending.saved = HOME_SPEC
        pending.applied = HOME_SPEC
        vi.spyOn(rpc, 'specGet').mockResolvedValue(HOME_SPEC)
        vi.spyOn(rpc, 'appliedGet').mockResolvedValue(HOME_SPEC)
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [] } as never)
        vi.spyOn(rpc, 'subQuota').mockRejectedValue(new Error('нет метода'))
        vi.spyOn(rpc, 'outboundGeo').mockResolvedValue({ output: 'nl', curl: false } as never)
        vi.spyOn(rpc, 'vlessNodes').mockRejectedValue(new Error('нет метода'))
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] } as never)
    })

    it('excluded — «Все узлы исключены», а не «не отвечает»', async () => {
        render(<Home live={homeLive({ state: 'excluded', total: 5 })} onSection={() => undefined} />)
        const row = (await screen.findByText('YouTube')).closest('li')!
        expect(row).toHaveTextContent('Все узлы исключены')
        expect(row).not.toHaveTextContent('не отвечает')
    })

    it('failed без исключения — по-прежнему «не отвечает»', async () => {
        render(<Home live={homeLive({ state: 'failed', total: 3 })} onSection={() => undefined} />)
        const row = (await screen.findByText('YouTube')).closest('li')!
        expect(row).toHaveTextContent('не отвечает')
        expect(row).not.toHaveTextContent('Все узлы исключены')
    })
})
