import { describe, expect, it } from 'vitest'
import { country } from '@/lib/geo'

describe('country', () => {
    it('своё название — как раньше', () => {
        expect(country('de')).toBe('Германия')
    })
    it('код вне списка называется словами, если браузер умеет', () => {
        expect(country('AL')).toBe('Албания')
    })
    it('не код — пусто', () => {
        expect(country('x')).toBe('')
    })
})
