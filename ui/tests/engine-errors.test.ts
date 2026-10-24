import { describe, expect, it } from 'vitest'
import { engineErrorText, knownEngineError } from '../src/lib/engineerr'

describe('отказы движка для человека', () => {
    it('известный отказ — словами, исходная строка следом', () => {
        const raw = "/etc/steer/lists/x.lst: cannot read a channel's list"
        const t = engineErrorText(raw)
        expect(t).toContain('Обновите списки')
        expect(t).toContain(raw)
    })
    it('имя выхода подставляется', () => {
        expect(knownEngineError('dns.upstreams.cf.out: выхода «wg1» нет в outputs')).toContain('«wg1»')
        expect(knownEngineError('apply: output vless: cannot route via vless')).toContain('«vless»')
    })
    it('незнакомый отказ показывается как есть', () => {
        expect(engineErrorText('что-то новое от ядра')).toBe('что-то новое от ядра')
        expect(engineErrorText('')).toBe('')
    })
})
