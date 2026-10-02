import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** Размытие (backdrop-filter) — только у плавающего стекла (.an-glass-float).
 *
 *  У карточки со своей прокруткой внутри (журнал имён в «Диагностике») размытие давало пустую
 *  полосу во всю ширину карточки поверх строк: Chrome выносит элемент с backdrop-filter в свой
 *  слой, заново размывает его на каждом кадре прокрутки и не успевает дорисовать полосу списка.
 *  Под неподвижной карточкой лежит плавный градиент подложки, и размытие его не меняет, —
 *  backdrop-filter там лишний. Тест ловит его возвращение в общие правила стекла и в утилиты. */
const ROOT = join(__dirname, '..')
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')

/** Правила с backdrop-filter: селектор → объявление. @supports раскрывается в свои правила. */
function blurRules(css: string): string[] {
    const out: string[] = []
    const re = /([^{}]+)\{([^{}]*)\}/g
    const text = strip(css)
    for (let m = re.exec(text); m; m = re.exec(text)) {
        if (/backdrop-filter\s*:\s*(?!none)/.test(m[2])) out.push(m[1].replace(/@supports[^{]*\{/, '').trim())
    }
    return out
}

function sources(dir: string, out: string[] = []): string[] {
    for (const f of readdirSync(dir)) {
        const p = join(dir, f)
        if (statSync(p).isDirectory()) out.push(...sources(p))
        else if (/\.(tsx?|css)$/.test(f)) out.push(p)
    }
    return out
}

describe('стекло: размытие только у плавающих поверхностей', () => {
    it('glass.css размывает только .an-glass-float', () => {
        const rules = blurRules(readFileSync(join(ROOT, 'andromeda/tokens/glass.css'), 'utf8'))
        expect(rules.length).toBeGreaterThan(0)
        for (const sel of rules) {
            for (const one of sel.split(',')) expect(one.trim()).toMatch(/\.an-glass-float$/)
        }
    })

    it('в пульте нет своих backdrop-filter и backdrop-blur', () => {
        const hits = sources(join(ROOT, 'src')).flatMap((p) => {
            const text = p.endsWith('.css') ? strip(readFileSync(p, 'utf8')) : readFileSync(p, 'utf8')
            return /backdrop-filter\s*:\s*(?!none)|\bbackdrop-blur/.test(text) ? [p] : []
        })
        expect(hits).toEqual([])
    })

    it('плавают нижняя панель разделов и окно подтверждения', () => {
        const rail = readFileSync(join(ROOT, 'src/components/Rail.tsx'), 'utf8')
        expect(rail).toMatch(/className="[^"]*\ban-glass-float\b[^"]*\bsp-bottom-bar\b/)
        const confirm = readFileSync(join(ROOT, 'src/components/ui/confirm.tsx'), 'utf8')
        expect(confirm).toMatch(/<Card className="[^"]*\ban-glass-float\b/)
    })
})
