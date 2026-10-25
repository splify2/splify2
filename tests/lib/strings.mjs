// Перечень строк каркаса: литералы в T('…') / TN(n, {…}) всех модулей view/splify2/core и title/description
// схемы ядра. SDK сверяет словарь языка с этим перечнем (SPLIFY2_PLATFORM.md, 8.3).
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

export const stringsFile = (core) => resolve(core, 'strings.json')

const LIT = String.raw`'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"`
const unesc = (s) => s.replace(/\\(.)/g, (m, c) => (c === 'n' ? '\n' : c === 't' ? '\t' : c))

function sources(core) {
  return readdirSync(core).filter((f) => f.endsWith('.js')).map((f) => [f, readFileSync(resolve(core, f), 'utf8')])
}

export function scanStrings(core, schemaRoot) {
  const out = new Set()
  for (const [, src] of sources(core)) {
    for (const m of src.matchAll(new RegExp(String.raw`\bT\(\s*(?:${LIT})`, 'g'))) out.add(unesc(m[1] ?? m[2]))
    // N('…') — строка, которую каркас покажет позже через T() (тексты проверок в schema.js)
    for (const m of src.matchAll(new RegExp(String.raw`(?<![A-Za-z0-9_.$])N\(\s*(?:${LIT})`, 'g'))) out.add(unesc(m[1] ?? m[2]))
    // TN(n, { one: '…', other: '…' }): ключ словаря — форма other
    for (const m of src.matchAll(/\bTN\([^,]+,\s*\{([^}]*)\}/g)) {
      const o = m[1].match(new RegExp(String.raw`other:\s*(?:${LIT})`))
      if (o) out.add(unesc(o[1] ?? o[2]))
    }
  }
  const walk = (n) => {
    if (!n || typeof n !== 'object') return
    if (typeof n.title === 'string') out.add(n.title)
    if (typeof n.description === 'string') out.add(n.description)
    for (const v of Object.values(n.properties || {})) walk(v)
    for (const v of Object.values(n['x-kinds'] || {})) walk(v)
    if (n['x-map']) walk(n['x-map'])
    if (n.items) walk(n.items)
  }
  walk(schemaRoot)
  return [...out].sort()
}

// T( или TN( с первым аргументом не строкой — такое в перечень не попадёт.
scanStrings.nonLiteral = (core) => {
  const bad = []
  for (const [f, src] of sources(core)) {
    for (const m of src.matchAll(/(?<![A-Za-z0-9_.$])T\(\s*([^'"\s)][^,)]*)/g)) bad.push(`${f}: T(${m[1]}`)
  }
  return bad
}
