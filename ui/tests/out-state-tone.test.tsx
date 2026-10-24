import { render } from '@testing-library/preact'
import { describe, expect, it } from 'vitest'
import { LooseBlock } from '@/components/OutputCards'
import { PROTO_TONE } from '@/lib/badges'
import { outTone } from '@/lib/outstate'
import type { OutputStatus } from '@/lib/model'

// Цвет точки выхода значит состояние (splify2#42): работает — зелёный, не работает — красный,
// подключается — янтарный, данных нет — серый; рядом всегда слово. Цвет протокола — отдельная
// шкала и красным/зелёным не бывает.

const st = (x: Partial<OutputStatus>) => x as OutputStatus

describe('outTone', () => {
    it('работает — зелёный со словом', () => {
        expect(outTone(st({ up: true }))).toEqual({ tone: 'good', label: 'работает' })
    })
    it('поднят, но сторож признал неработающим — красный', () => {
        expect(outTone(st({ up: true, failed: true })).tone).toBe('bad')
        expect(outTone(st({ up: false })).tone).toBe('bad')
    })
    it('идёт проверка или применение — янтарный', () => {
        expect(outTone(st({ up: false, probe: { state: 'probing' } as never })).tone).toBe('warn')
        expect(outTone(st({ up: false }), 'applying').tone).toBe('warn')
    })
    it('состояния нет — серый, «нет данных»', () => {
        expect(outTone(undefined)).toEqual({ tone: 'idle', label: 'нет данных' })
    })
})

describe('точка выхода', () => {
    it('рисуется цветом состояния и подписана словом', () => {
        const { container } = render(<LooseBlock name="a" st={st({ up: true })} />)
        const dot = container.querySelector('[data-state]')!
        expect(dot.getAttribute('data-state')).toBe('good')
        expect(dot.className).toContain('bg-success')
        expect(dot.getAttribute('aria-label')).toBe('работает')
    })
})

describe('цвет протокола не занимает цвета состояния', () => {
    it('ни один протокол не красный (cat-5, цвет отказа)', () => {
        expect(PROTO_TONE.wireguard).not.toBe(5)
        expect(PROTO_TONE.awg).not.toBe(5)
        expect(Object.values(PROTO_TONE)).not.toContain(5)
    })
})
