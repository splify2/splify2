import { beforeEach, describe, expect, it, vi } from 'vitest'

// «Движок не отвечает: ubus is unavailable outside LuCI (splify.status)» — с экрана
// владельца, и ловилось это через раз. Гонка: загрузчик стал стартовать бандл, не дожидаясь
// build-id.txt, поэтому модуль мог исполниться раньше, чем LuCI отдаст мост к ubus
// (window.luci_rpc выставляется в render()). Мост читался при объявлении методов — и все
// сорок методов навсегда становились заглушкой с этой ошибкой.
//
// Проверяется главное свойство: мост берётся в момент ВЫЗОВА. Появился после загрузки модуля
// — работает; не появился вовсе (стенд, отдельный запуск) — честный отказ, а не выдуманные
// данные.

describe('мост к ubus', () => {
    beforeEach(() => {
        vi.resetModules()
        delete (window as unknown as Record<string, unknown>).luci_rpc
    })

    it('появился ПОСЛЕ загрузки модуля — вызовы работают', async () => {
        const { rpc } = await import('@/lib/rpc')
        const call = vi.fn(async () => ({ schema: 1, outputs: {}, channels: [] }))
        ;(window as unknown as Record<string, unknown>).luci_rpc = {
            declare: vi.fn(() => call),
        }
        await expect(rpc.conns()).resolves.toEqual({ schema: 1, outputs: {}, channels: [] })
        expect(call).toHaveBeenCalled()
    })

    it('мост объявляется один раз на метод, а не на каждый вызов', async () => {
        const { rpc } = await import('@/lib/rpc')
        const declare = vi.fn(() => async () => ({}))
        ;(window as unknown as Record<string, unknown>).luci_rpc = { declare }
        await rpc.conns()
        await rpc.conns()
        expect(declare).toHaveBeenCalledTimes(1)
    })

    it('моста нет вовсе — отказ с причиной, а не выдуманные данные', async () => {
        const { rpc } = await import('@/lib/rpc')
        await expect(rpc.conns()).rejects.toThrow(/ubus is unavailable/)
    })

    it('отказ метода плагина несёт текст на языке каркаса, code и args', async () => {
        const { callPlugin } = await import('@/plugins/rpc')
        const call = vi.fn(async () => ({
            ok: false, error: 'список больше 64 КБ', code: 'lists.too_big', args: { kb: '64' },
        }))
        ;(window as unknown as Record<string, unknown>).luci_rpc = { declare: vi.fn(() => call) }
        const e = await callPlugin('lists-catalog', 'list_put', {}).catch((x) => x)
        expect(e.message).toBe('список больше 64 КБ')
        expect([e.kind, e.code, e.args]).toEqual(['failed', 'lists.too_big', { kb: '64' }])
    })

    it('отказ без code и args — как прежде', async () => {
        const { callPlugin } = await import('@/plugins/rpc')
        ;(window as unknown as Record<string, unknown>).luci_rpc = {
            declare: vi.fn(() => async () => ({ ok: false, error: 'нет' })),
        }
        const e = await callPlugin('p', 'm', {}).catch((x) => x)
        expect([e.message, e.kind, e.code, e.args]).toEqual(['нет', 'failed', undefined, undefined])
    })
})
