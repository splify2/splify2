import { describe, expect, it, vi, beforeEach } from 'vitest'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { type Spec } from '@/lib/model'

// Переход 26.9 → 26.10: пакет интерфейса обновился, ядро ещё 1.5.x. Спека на диске — v1
// (`schema`), и перенос её в v2 на открытии страницы уходил в spec_set, где ядро 1.5.9 отвергало
// `kind: tunnel` («outputs.nl: неизвестный kind») — красный тост поверх «Ядро устарело» и вечная
// несохранённая правка (снято со второго стенда QEMU: 26.9.2 + steer-extended 1.5.9 → 26.10.0).

const V1: Spec = {
    schema: 2,
    outputs: {
        direct: { name: 'direct', kind: 'direct' },
        nl: { name: 'nl', kind: 'vless', device: 'nl', sub_file: '/etc/steer/sub.txt' },
    },
    channels: [{ name: 'YouTube', match: { domains_files: ['/etc/steer/lists/yt.lst'], mode: 'fakeip' }, out: 'nl' }],
} as Spec

async function open(engine: object | Error) {
    vi.spyOn(rpc, 'specGet').mockResolvedValue(V1)
    vi.spyOn(rpc, 'appliedGet').mockResolvedValue(V1)
    const set = vi.spyOn(rpc, 'specSet').mockResolvedValue({ ok: true })
    if (engine instanceof Error) vi.spyOn(rpc, 'engine').mockRejectedValue(engine)
    else vi.spyOn(rpc, 'engine').mockResolvedValue(engine as never)
    // @ts-expect-error — сброс внутреннего состояния между проверками
    pending.saved = null; pending.applied = null; pending.dirty = false
    await pending.load()
    await pending.flush()
    return set
}

describe('перенос спеки v1 → v2 на открытии', () => {
    beforeEach(() => { vi.restoreAllMocks() })

    it('ядро 1.5.9 при минимуме 2.0.0 — спека не переписывается', async () => {
        const set = await open({ present: true, vless: true, version: '1.5.9', min_version: '2.0.0' })
        expect(set).not.toHaveBeenCalled()
        expect(pending.dirty).toBe(false)
    })

    it('ядро 2.0.0 — переписывается в v2', async () => {
        const set = await open({ present: true, vless: true, version: '2.0.0', min_version: '2.0.0' })
        expect(set).toHaveBeenCalledTimes(1)
        expect(JSON.parse(set.mock.calls[0][0] as string).version).toBe(2)
    })

    it('бэкенд не ответил — переносится, как прежде', async () => {
        const set = await open(new Error('нет ответа'))
        expect(set).toHaveBeenCalledTimes(1)
    })
})
