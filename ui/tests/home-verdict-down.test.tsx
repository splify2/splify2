import { fireEvent, render, screen, waitFor } from '@testing-library/preact'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import Home from '@/components/sections/Home'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { type Live } from '@/lib/live'
import type { OutputStatus, Status } from '@/lib/model'

// Снято с QEMU-стенда: у правила T единственный выход vl (туннель vless, on_fail: drop), выход не
// поднят — строка правила так и говорит «vl не поднят», — а заголовок главной зелёный:
// «Маршрутизация работает». Трафик правила при этом отбрасывается. Вердикт брался только из
// проверок ядра, а `steer diag` выход с устройством в состоянии down не находит (он смотрит, есть
// ли устройство, а не поднято ли оно), — и зелёная надпись стояла над остановленным трафиком.
//
// Теперь вердикт смотрит и на выходы, которые несут правила: выход не отвечает и on_fail: drop —
// поломка (трафик правила стоит), on_fail: direct или zapret — предупреждение (трафик идёт мимо
// туннеля). Перебор узлов — не поломка: ядро само зовёт его «ждать, а не чинить».

const DIAG_OK = { checks: [], warn: 0, fail: 0 }

function liveWith(vl: Partial<OutputStatus> | null, channels = [{ name: 'vl_ip', out: 'vl', kind: 'prefixes', live: true, channels: ['T'] }]): Live {
    const outputs: Record<string, unknown> = { direct: { kind: 'direct' } }
    if (vl) outputs.vl = { kind: 'vless', device: 'vl', mark: '0x00100000', table: 300, ...vl }
    return {
        status: { outputs, channels } as unknown as Status,
        devices: {},
        devs: {},
        net: { uptime: 1200, active_clients: 1 },
        diag: DIAG_OK,
        build: { present: true, version: '2.0.0' },
        releases: [],
        selfUpdate: { current: '26.10.0' },
        phase: null,
        refresh: () => undefined,
    } as unknown as Live
}

function dot() {
    return screen.getByRole('heading', { level: 1 }).parentElement!.previousElementSibling as HTMLElement
}

describe('вердикт главной: выход правила не отвечает', () => {
    beforeEach(() => {
        vi.restoreAllMocks()
        window.localStorage.clear()
        document.body.innerHTML = ''
        pending.saved = null
        pending.applied = null
        vi.spyOn(rpc, 'specGet').mockResolvedValue({ schema: 1, outputs: {}, channels: [] } as never)
        vi.spyOn(rpc, 'appliedGet').mockResolvedValue({ schema: 1, outputs: {}, channels: [] } as never)
        vi.spyOn(rpc, 'subList').mockResolvedValue({ subs: [] } as never)
        vi.spyOn(rpc, 'subQuota').mockRejectedValue(new Error('нет метода'))
        vi.spyOn(rpc, 'outboundGeo').mockRejectedValue(new Error('нет метода'))
        vi.spyOn(rpc, 'vlessNodes').mockRejectedValue(new Error('нет метода'))
        vi.spyOn(rpc, 'devices').mockResolvedValue({ devices: [] } as never)
    })

    it('не поднят, on_fail: drop — поломка, а не «работает»', () => {
        render(<Home live={liveWith({ up: false, on_fail: 'drop' })} onSection={() => undefined} />)
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Выход не отвечает')
        expect(dot().className).toContain('bg-destructive')
        expect(screen.getByText('vl: трафик правила T остановлен')).toBeInTheDocument()
    })

    it('и дорога — к выходам, в VPN', async () => {
        const go = vi.fn()
        render(<Home live={liveWith({ up: false, on_fail: 'drop' })} onSection={go} />)
        fireEvent.click(screen.getByText('vl: трафик правила T остановлен'))
        await waitFor(() => expect(go).toHaveBeenCalledWith('vpn'))
    })

    it('сторож поставил on_fail (failed) — то же самое', () => {
        render(<Home live={liveWith({ up: false, failed: true, on_fail: 'drop' })} onSection={() => undefined} />)
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Выход не отвечает')
    })

    it('on_fail: direct — предупреждение: трафик идёт мимо туннеля', () => {
        render(<Home live={liveWith({ up: false, on_fail: 'direct' })} onSection={() => undefined} />)
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Выход не отвечает')
        expect(dot().className).toContain('bg-warning')
        expect(screen.getByText('vl: трафик правила T идёт напрямую')).toBeInTheDocument()
    })

    it('несколько правил на одном выходе — названы все', () => {
        render(
            <Home
                live={liveWith({ up: false, on_fail: 'drop' }, [
                    { name: 'vl_ip', out: 'vl', kind: 'prefixes', live: true, channels: ['T', 'U'] },
                ])}
                onSection={() => undefined}
            />,
        )
        expect(screen.getByText('vl: трафик правил T, U остановлен')).toBeInTheDocument()
    })

    it('перебор узлов — не поломка: ждать, а не чинить', () => {
        render(<Home live={liveWith({ up: false, on_fail: 'drop', probe: { state: 'probing', node: 1, total: 3 } })} onSection={() => undefined} />)
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Маршрутизация работает')
    })

    it('выход поднят — работает', () => {
        render(<Home live={liveWith({ up: true, on_fail: 'drop' })} onSection={() => undefined} />)
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Маршрутизация работает')
        expect(dot().className).toContain('bg-success')
    })

    it('выход не поднят, но правила через него нет — на маршрутизацию не влияет', () => {
        render(<Home live={liveWith({ up: false, on_fail: 'drop' }, [])} onSection={() => undefined} />)
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Маршрутизация работает')
    })

    it('отказ проверок ядра остаётся первым', () => {
        const l = liveWith({ up: false, on_fail: 'drop' })
        render(<Home live={{ ...l, diag: { checks: [], warn: 0, fail: 1 } } as Live} onSection={() => undefined} />)
        expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Есть поломки')
    })
})
