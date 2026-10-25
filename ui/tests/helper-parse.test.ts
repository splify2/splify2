import { describe, expect, it } from 'vitest'
import { parseHelpers } from '@/lib/helper'

describe('разбор ответа helper', () => {
    it('строка на помощника; оборванная строка пропущена, остальные годны', () => {
        const r = { code: 0, stdout: '{"helper":"obfs","running":true,"up":true,"restarts":0}\n{"helper":"vl' }
        expect(parseHelpers(r).map((h) => h.helper)).toEqual(['obfs'])
        expect(parseHelpers({ code: 1, stdout: '' })).toEqual([])
    })
})
