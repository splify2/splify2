// Словарь строк хоста из src/copy/ru.ts — плоский JSON «ns.key → строка».
//
// Русский вшит в сборку кодом (ru.ts), а переводам нужен словарь без кода: плагин языка
// (host-api.md, i18n; open.md, О-21) несёт `i18n/host/<язык>.json` с теми же ключами. Этот скрипт
// строит такой словарь из ru.ts:
//   - простая строка — как есть;
//   - функция со строкой-шаблоном — шаблон с `{0}`, `{1}` по порядку параметров;
//   - `plural(n, "один", "два", "много")` — `{0#один|два|много}`: число и слово нужной формы;
//   - всё, что не сводится к шаблону (условия, вызовы), в словарь не попадает и остаётся кодом ru.
//
//   node scripts/copy-dict.mjs          — записать src/copy/ru.json
//   node scripts/copy-dict.mjs --check  — проверить, что ru.json совпадает с ru.ts
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const here = path.dirname(fileURLToPath(import.meta.url))
const FILE = path.join(here, '..', 'src', 'copy', 'ru.ts')
const OUT = path.join(here, '..', 'src', 'copy', 'ru.json')

const esc = (s) => s.replace(/[{}|#\\]/g, (c) => '\\' + c)

/** Выражение внутри `${…}` или тело стрелки → кусок шаблона или null. */
function piece(e, params) {
    if (ts.isParenthesizedExpression(e)) return piece(e.expression, params)
    if (ts.isIdentifier(e) && params.includes(e.text)) return `{${params.indexOf(e.text)}}`
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return esc(e.text)
    if (ts.isTemplateExpression(e)) return template(e, params)
    if (ts.isCallExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'plural') {
        const [n, ...forms] = e.arguments
        if (forms.length !== 3 || !ts.isIdentifier(n) || !params.includes(n.text)) return null
        if (!forms.every((f) => ts.isStringLiteral(f) || ts.isNoSubstitutionTemplateLiteral(f))) return null
        return `{${params.indexOf(n.text)}#${forms.map((f) => esc(f.text)).join('|')}}`
    }
    return null
}

function template(t, params) {
    if (ts.isNoSubstitutionTemplateLiteral(t)) return esc(t.text)
    let out = esc(t.head.text)
    for (const span of t.templateSpans) {
        const p = piece(span.expression, params)
        if (p === null) return null
        out += p + esc(span.literal.text)
    }
    return out
}

export function extract(src = fs.readFileSync(FILE, 'utf8')) {
    const sf = ts.createSourceFile(FILE, src, ts.ScriptTarget.Latest, true)
    const dict = {}
    const skipped = []
    let root = null
    const find = (n) => {
        if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === 'ru' && n.initializer) {
            root = n.initializer
            if (ts.isAsExpression(root)) root = root.expression
        }
        if (!root) ts.forEachChild(n, find)
    }
    find(sf)
    const walk = (obj, prefix) => {
        for (const p of obj.properties) {
            if (!ts.isPropertyAssignment(p)) continue
            const name = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null
            if (name === null) continue
            const key = prefix ? `${prefix}.${name}` : name
            let v = p.initializer
            while (ts.isAsExpression(v) || ts.isParenthesizedExpression(v)) v = v.expression
            if (ts.isObjectLiteralExpression(v)) walk(v, key)
            else if (ts.isStringLiteral(v) || ts.isNoSubstitutionTemplateLiteral(v)) dict[key] = v.text
            else if (ts.isArrowFunction(v)) {
                const params = v.parameters.map((x) => (ts.isIdentifier(x.name) ? x.name.text : ''))
                let body = v.body
                if (ts.isBlock(body)) {
                    skipped.push(key)
                    continue
                }
                const t = piece(body, params)
                if (t === null) skipped.push(key)
                else dict[key] = t
            } else skipped.push(key)
        }
    }
    walk(root, '')
    return { dict, skipped }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const { dict, skipped } = extract()
    const text = JSON.stringify(dict, null, 1) + '\n'
    if (process.argv.includes('--check')) {
        if (fs.readFileSync(OUT, 'utf8') !== text) {
            console.error('src/copy/ru.json разошёлся с ru.ts: node scripts/copy-dict.mjs')
            process.exit(1)
        }
    } else {
        fs.writeFileSync(OUT, text)
        console.log(`ru.json: ${Object.keys(dict).length} строк, кодом остаётся ${skipped.length}`)
        if (process.argv.includes('--list')) console.log(skipped.join('\n'))
    }
}
