import { act, render, renderHook, screen, waitFor } from '@testing-library/preact'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { useLive } from '@/lib/live'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import Home from '@/components/sections/Home'
import { live } from './fixtures'

// Карточка состояния, когда не отозвался САМ роутер, а не ядро.
//
// Снято на роутере: у rpcd нет объекта splify2 (пакет не стоит или rpcd не перечитал объекты) —
// и под заголовком «Ядро не отвечает» стояло исключение LuCI целиком: «RPC call to splify2/status
// failed with error -32000: Object not found at ClassConstructor.handleCallReply (http://…».
// Человеку из него нечего сделать, а заголовок обвинял ядро, о котором в этот момент ничего не
// известно. Теперь отказ вызова — это состояние словами («Роутер не ответил») и действие под ним
// («Обновите страницу или проверьте, что splify2 установлен»); слова самого ядра (роутер ответил,
// что оно молчит) остаются как есть и под прежним заголовком.

const RAW =
    'RPC call to splify2/status failed with error -32000: Object not found at ' +
    'ClassConstructor.handleCallReply (http://192.168.1.1/luci-static/resources/luci.js?v=git-24.1:1:1)'
const RAW_RE = /RPC call|ClassConstructor|handleCallReply|Object not found|-32000/

/** Ещё один круг опроса без ожидания пяти секунд: возврат на вкладку опрашивает сразу. */
async function poll() {
    await act(async () => {
        document.dispatchEvent(new Event('visibilitychange'))
        await new Promise((r) => setTimeout(r, 30))
    })
}

function mockHomeRpc() {
    vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] })
    vi.spyOn(rpc, 'subInfo').mockResolvedValue({ kind: 'none', present: false } as never)
    vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [] } as never)
}

describe('роутер не ответил — состояние и действие, а не исключение', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        pending.appliedAt = 0
        vi.spyOn(rpc, 'engine').mockRejectedValue(new Error(RAW))
        vi.spyOn(rpc, 'steerVersions').mockResolvedValue({} as never)
        vi.spyOn(rpc, 'splify2Versions').mockResolvedValue({} as never)
    })
    afterEach(() => { pending.appliedAt = 0 })

    it('объекта splify2 нет: опрос уходит на прежние вызовы, и текст исключения не доезжает до error', async () => {
        // «Object not found» узнаётся как «метода нет» — и круг идёт прежними вызовами, а они
        // отказывают тем же исключением: именно оно и показывалось на экране.
        vi.spyOn(rpc, 'live').mockRejectedValue(new Error(RAW))
        vi.spyOn(rpc, 'status').mockRejectedValue(new Error(RAW))
        vi.spyOn(rpc, 'devStats').mockRejectedValue(new Error(RAW))
        vi.spyOn(rpc, 'netInfo').mockRejectedValue(new Error(RAW))
        vi.spyOn(rpc, 'diag').mockRejectedValue(new Error(RAW))
        const { result } = renderHook(() => useLive())
        for (let i = 0; i < 4 && result.current.error === null; i++) await poll()
        await waitFor(() => expect(result.current.error).toBe('Роутер не ответил'))
        expect(result.current.errorKind).toBe('router')
        expect(result.current.error).not.toMatch(RAW_RE)
    })

    it.each([
        ['обрыв запроса', 'XHR request timed out'],
        ['кончился вход в LuCI', 'RPC call to splify2/live failed with error -32002: Access denied'],
        ['ответ не разобран', 'Unexpected token < in JSON at position 0'],
    ])('%s: в error — состояние словами, не исключение', async (_name, why) => {
        vi.spyOn(rpc, 'live').mockRejectedValue(new Error(why))
        const { result } = renderHook(() => useLive())
        for (let i = 0; i < 4 && result.current.error === null; i++) await poll()
        await waitFor(() => expect(result.current.error).toBe('Роутер не ответил'))
        expect(result.current.errorKind).toBe('router')
    })

    it('роутер ответил отказом — слова ядра как есть, и беда названа ядра', async () => {
        vi.spyOn(rpc, 'live').mockResolvedValue({ ok: false, error: 'ядро не ответило' } as never)
        const { result } = renderHook(() => useLive())
        for (let i = 0; i < 4 && result.current.error === null; i++) await poll()
        await waitFor(() => expect(result.current.error).toBe('ядро не ответило'))
        expect(result.current.errorKind).toBe('core')
    })

    it('ответ пришёл — беда снимается вместе с видом', async () => {
        const call = vi.spyOn(rpc, 'live').mockRejectedValue(new Error('XHR request timed out'))
        const { result } = renderHook(() => useLive())
        for (let i = 0; i < 4 && result.current.error === null; i++) await poll()
        await waitFor(() => expect(result.current.errorKind).toBe('router'))
        call.mockResolvedValue({ status: { schema: 1, outputs: {}, channels: [] } } as never)
        await poll()
        await waitFor(() => expect(result.current.error).toBeNull())
        expect(result.current.errorKind).toBeNull()
    })

    it('карточка: «Роутер не ответил» и что делать, без текста исключения', () => {
        mockHomeRpc()
        render(<Home live={live({ error: 'Роутер не ответил', errorKind: 'router' })} onSection={() => {}} onAddRule={() => {}} />)
        expect(screen.getByRole('heading', { name: 'Роутер не ответил' })).toBeInTheDocument()
        expect(screen.getByText('Обновите страницу или проверьте, что splify2 установлен')).toBeInTheDocument()
        // Ядро не обвиняется: про него в этот момент ничего не известно.
        expect(screen.queryByText(/Ядро не отвечает/)).toBeNull()
    })

    it('карточка: слова ядра остаются под заголовком «Ядро не отвечает»', () => {
        mockHomeRpc()
        render(<Home live={live({ error: 'ядро не ответило', errorKind: 'core' })} onSection={() => {}} onAddRule={() => {}} />)
        expect(screen.getByRole('heading', { name: 'Ядро не отвечает' })).toBeInTheDocument()
        expect(screen.getByText('ядро не ответило')).toBeInTheDocument()
        expect(screen.queryByText(/Обновите страницу/)).toBeNull()
    })

    it('со страницы целиком: отказ объекта rpcd не оставляет на экране ни слова исключения', async () => {
        mockHomeRpc()
        vi.spyOn(rpc, 'live').mockRejectedValue(new Error(RAW))
        vi.spyOn(rpc, 'status').mockRejectedValue(new Error(RAW))
        vi.spyOn(rpc, 'devStats').mockRejectedValue(new Error(RAW))
        vi.spyOn(rpc, 'netInfo').mockRejectedValue(new Error(RAW))
        vi.spyOn(rpc, 'diag').mockRejectedValue(new Error(RAW))
        function Page() {
            const l = useLive()
            return <Home live={l} onSection={() => {}} onAddRule={() => {}} />
        }
        render(<Page />)
        for (let i = 0; i < 4; i++) await poll()
        expect(await screen.findByRole('heading', { name: 'Роутер не ответил' })).toBeInTheDocument()
        expect(screen.getByText('Обновите страницу или проверьте, что splify2 установлен')).toBeInTheDocument()
        expect(document.body.textContent).not.toMatch(RAW_RE)
    })
})
