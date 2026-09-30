import { describe, expect, it, vi } from 'vitest'
import { pending } from '@/lib/pending'
import { rpc } from '@/lib/rpc'
import { type Spec } from '@/lib/model'

// «Применить» обязано применять то, что уже ЛЕГЛО на роутер.
//
// Правка уезжает на роутер через полсекунды тишины (edit → flush → spec_set), а spec_set там
// небыстрый: доскачивание списков и проверка движком — секунды. Флаг dirty flush снимает в
// начале записи, и apply(), нажатое, пока запись летит, видел «записывать нечего» и шёл сразу
// в rpc.apply. На роутере apply приводит зону фаервола к спеке (fw_sync) — и приводил к
// ПРЕЖНЕЙ: пул, в который только что добавили локации подписки, применялся, а устройства его
// частей оставались вне зоны фаервола («вне зоны фаервола» в диагностике, снято с роутера:
// fw-owned переписан за две секунды до того, как легла спека).

const SPEC: Spec = { schema: 1, outputs: { direct: { name: 'direct', kind: 'direct' } }, channels: [] } as Spec

describe('применение ждёт летящую запись', () => {
    it('rpc.apply уходит только после ответа spec_set', async () => {
        vi.restoreAllMocks()
        const order: string[] = []
        let release!: () => void
        vi.spyOn(rpc, 'specSet').mockImplementation((() => new Promise((r) => {
            order.push('spec_set начат')
            release = () => { order.push('spec_set записан'); r({ ok: true }) }
        })) as never)
        vi.spyOn(rpc, 'apply').mockImplementation((async () => { order.push('apply'); return { ok: true } }) as never)
        // @ts-expect-error — сброс внутреннего состояния
        pending.saved = SPEC; pending.applied = SPEC; pending.dirty = false; pending.applying = false

        pending.edit({ ...SPEC, channels: [{ name: 'всё', out: 'direct', match: { any: true } }] } as Spec)
        void pending.flush()                     // то, что сделал бы таймер через 500 мс
        await Promise.resolve()
        const applying = pending.apply()         // человек нажал «Применить», пока запись летит
        await new Promise((r) => setTimeout(r, 20))
        expect(order).toEqual(['spec_set начат'])
        release()
        await applying
        expect(order).toEqual(['spec_set начат', 'spec_set записан', 'apply'])
    })
})
