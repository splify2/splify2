import { describe, expect, it } from 'vitest'
import { decodeSpec, encodeSpec } from '@/lib/specv2'
import type { Output, Spec } from '@/lib/model'

// WarpBox (приложение для ПК): исключения стран пишутся явным списком, пустой — тоже. Без ключа
// модуль steer-warpbox исключает RU сам, а по решению владельца страну по умолчанию не исключаем.

describe('kind: warp — страны', () => {
    it('пустой exclude_countries доходит до ядра и читается обратно', () => {
        const spec = {
            outputs: { cf: { name: 'cf', kind: 'warp' as Output['kind'], extra: { count: 3, exclude_countries: [] } } },
            channels: [],
        } as unknown as Spec
        const doc = encodeSpec(spec) as { outputs: Record<string, Record<string, unknown>> }
        expect(doc.outputs.cf).toMatchObject({ kind: 'warp', count: 3, exclude_countries: [] })
        const back = decodeSpec(doc)
        expect(back.outputs.cf.extra).toMatchObject({ exclude_countries: [] })
    })
})
