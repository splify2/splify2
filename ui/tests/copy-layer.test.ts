import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/** Барьер текстового слоя: в коде интерфейса нет строк по-русски — только в src/copy.
 *
 *  Строки живут в src/copy/ru.ts, компоненты ссылаются на них (`S.home.…`). Новая строка,
 *  вписанная прямо в разметку, снова смешала бы текст с вёрсткой — этот тест её найдёт и
 *  назовёт файл и место. Комментарии не в счёт: это не строки. */
const CY = /[А-Яа-яЁё]/

function files(dir: string, out: string[] = []): string[] {
    for (const f of readdirSync(dir)) {
        const p = join(dir, f)
        if (statSync(p).isDirectory()) { if (f !== 'copy') files(p, out) }
        else if (/\.tsx?$/.test(f) && !f.endsWith('.d.ts')) out.push(p)
    }
    return out
}

describe('текстовый слой', () => {
    it('строки интерфейса — только в src/copy', () => {
        const found: string[] = []
        for (const f of files(join(process.cwd(), 'src'))) {
            const src = readFileSync(f, 'utf8')
            const sf = ts.createSourceFile(f, src, ts.ScriptTarget.Latest, true, f.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
            const visit = (n: ts.Node) => {
                const lit = ts.isJsxText(n) || ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)
                if (lit && CY.test((n as ts.LiteralLikeNode).text)) {
                    const { line } = sf.getLineAndCharacterOfPosition(n.getStart(sf))
                    found.push(`${f.replace(process.cwd() + '/', '')}:${line + 1} ${(n as ts.LiteralLikeNode).text.trim().slice(0, 60)}`)
                }
                ts.forEachChild(n, visit)
            }
            visit(sf)
        }
        expect(found).toEqual([])
    })
})
