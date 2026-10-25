import { describe, expect, it } from 'vitest'
import { satisfies } from '@/plugins/semver'

// Сверка версий host API по синтаксису npm (manifest.md, compat): minor добавляет, major ломает —
// плагин `^1.2` на панели 1.0 не грузится.
describe('satisfies', () => {
    it('каретка: тот же major, не ниже названной версии', () => {
        expect(satisfies('1.0.0', '^1.0')).toBe(true)
        expect(satisfies('1.4.2', '^1.2')).toBe(true)
        expect(satisfies('1.0.0', '^1.2')).toBe(false)
        expect(satisfies('2.0.0', '^1.2')).toBe(false)
    })
    it('нулевой major: каретка держит minor', () => {
        expect(satisfies('0.2.5', '^0.2.1')).toBe(true)
        expect(satisfies('0.3.0', '^0.2.1')).toBe(false)
    })
    it('тильда, сравнения, пробел — «и», || — «или»', () => {
        expect(satisfies('1.2.9', '~1.2.3')).toBe(true)
        expect(satisfies('1.3.0', '~1.2.3')).toBe(false)
        expect(satisfies('1.5.0', '>=1.2.0 <2.0.0')).toBe(true)
        expect(satisfies('2.0.0', '>=1.2.0 <2.0.0')).toBe(false)
        expect(satisfies('1.0.0', '>= 1.0.0')).toBe(true)
        expect(satisfies('3.1.0', '^1.0 || ^3.0')).toBe(true)
        expect(satisfies('2.1.0', '^1.0 || ^3.0')).toBe(false)
    })
    it('точное и частичное равенство', () => {
        expect(satisfies('1.2.3', '1.2.3')).toBe(true)
        expect(satisfies('1.2.4', '1.2.3')).toBe(false)
        expect(satisfies('1.2.4', '1.2')).toBe(true)
        expect(satisfies('1.3.0', '1.2')).toBe(false)
    })
    it('пустой диапазон годится, непонятная версия — нет', () => {
        expect(satisfies('1.0.0', undefined)).toBe(true)
        expect(satisfies('1.0.0', '')).toBe(true)
        expect(satisfies('не версия', '^1.0')).toBe(false)
    })
})
