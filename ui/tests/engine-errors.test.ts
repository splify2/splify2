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

describe('ответ «Куда пойдёт запрос» и пустая установка', () => {
    it('строка ядра — словами; незнакомый вывод не разбирается', async () => {
        const { explainSummary } = await import('../src/lib/engineerr')
        expect(explainSummary('youtube.com -> vless (правило: Youtube)')).toBe('youtube.com пойдёт через выход «vless» — по правилу «Youtube».')
        expect(explainSummary('example.org -> direct')).toBe('example.org пойдёт напрямую, мимо туннелей.')
        expect(explainSummary('какой-то другой вывод')).toBeNull()
    })
    it('пустая установка — только когда движок ответил и в нём нет выходов и правил', async () => {
        const { blankInstall } = await import('../src/lib/blank')
        const st = (outputs: object, channels: unknown[]) => ({ status: { outputs, channels }, error: null, phase: null }) as never
        expect(blankInstall(st({ direct: { kind: 'direct' } }, []))).toBe(true)
        expect(blankInstall(st({ wg0: { kind: 'interface' } }, []))).toBe(false)
        expect(blankInstall({ status: null, error: null, phase: null } as never)).toBe(false)
        expect(blankInstall({ status: { outputs: {}, channels: [] }, error: 'нет', phase: null } as never)).toBe(false)
    })
})
