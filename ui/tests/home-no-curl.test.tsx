import { render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Home from '@/components/sections/Home'
import { rpc } from '@/lib/rpc'
import { type Live } from '@/lib/live'
import type { Status } from '@/lib/model'

// splify2#32. Страну и отклик выходов меряет curl, и без него на обзоре оставались пустые
// строки без единого слова — так же выглядит выход, который молчит. Бэкенд теперь говорит
// curl=false, и обзор обязан назвать причину и что поставить; там, где curl есть, — молчать.

const live = {
    status: {
        outputs: { wg: { kind: 'interface', device: 'wg0', up: true } },
        channels: [{ name: 'всё', out: 'wg', kind: 'any', live: true }],
    } as unknown as Status,
    devices: {},
    net: { uptime: 1200, active_clients: 0 },
    diag: undefined,
    build: { present: true, version: '1.3.0' },
    releases: [],
    selfUpdate: { current: '1.2.5' },
    refresh: () => undefined,
} as unknown as Live

describe('обзор без curl', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        vi.spyOn(rpc, 'specGet').mockResolvedValue({ schema: 1, outputs: {}, channels: [] } as never)
        vi.spyOn(rpc, 'appliedGet').mockResolvedValue({ schema: 1, outputs: {}, channels: [] } as never)
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [] } as never)
        vi.spyOn(rpc, 'subQuota').mockRejectedValue(new Error('нет метода'))
    })

    it('curl нет — сказано, что не меряется и что поставить', async () => {
        vi.spyOn(rpc, 'outboundGeo').mockResolvedValue({ output: 'wg', curl: false } as never)
        render(<Home live={live} onSection={() => undefined} onAddRule={() => undefined} />)
        await waitFor(() => expect(screen.getByText(/Не установлен curl/)).toBeInTheDocument())
        expect(screen.getByText(/Установите пакет curl/)).toBeInTheDocument()
    })

    it('curl есть — ни слова о нём', async () => {
        const geo = vi.spyOn(rpc, 'outboundGeo').mockResolvedValue({ output: 'wg', cc: 'NL', ip: '203.0.113.1' } as never)
        render(<Home live={live} onSection={() => undefined} onAddRule={() => undefined} />)
        await waitFor(() => expect(geo).toHaveBeenCalled())
        await new Promise((r) => setTimeout(r, 20))
        expect(screen.queryByText(/curl/)).toBeNull()
    })
})
