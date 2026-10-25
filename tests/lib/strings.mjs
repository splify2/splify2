// Перечень строк каркаса: литералы в T(…) / TN(n, {…}) всех модулей view/splify2/core (тексты схемы ядра — слова самого ядра, в перечень не входят). SDK сверяет словарь языка с этим перечнем (SPLIFY2_PLATFORM.md, 8.3).
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
  // title/description of the schema of the core are the core's own text (the language of the core), not strings of the frame
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
