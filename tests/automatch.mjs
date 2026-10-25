// Стенд каркаса splify2 на классическом LuCI JS: автоформа «схема -> поля», словарь T(), покрытие ключей
// схемы полями и круг «заполнить поле -> прочитать» для КАЖДОГО ключа фикстуры схемы ядра.
// Модули — настоящие файлы luci/htdocs/…/view/splify2/core, LuCI заменён заглушками (tests/lib/luci-stub.mjs).
// Запуск: node tests/automatch.mjs [--write-strings]   (sh tests/automatch.sh ищет подходящий node)
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { ROOT, RES, makeLoader, E } from './lib/luci-stub.mjs'

let fails = 0, total = 0
const canon = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x))
const check = (what, want, got) => {
  total++
  const w = JSON.stringify(want), g = JSON.stringify(got)
  if (w === g) { console.log(`${what.padEnd(88)} ok`); return }
  fails++
  console.log(`${what.padEnd(88)} ПРОВАЛ\n    ожидалось: ${w.slice(0, 700)}\n    получено:  ${g.slice(0, 1500)}`)
}

const CORE = resolve(RES, 'view/splify2/core')
const FIXTURE = JSON.parse(readFileSync(resolve(ROOT, 'files/usr/share/splify2/spec-schema.json'), 'utf8'))

const calls = [], replies = {}
const { load } = makeLoader({ rpcCalls: calls, rpcReplies: replies })
const i18n = load('view.splify2.core.i18n')
const schema = load('view.splify2.core.schema')
const autoform = load('view.splify2.core.autoform')

// ---- 1. словарь -------------------------------------------------------------------------
{
  check('T без словаря возвращает ключ', 'Add', i18n.T('Add'))
  check('T подставляет {имя}', 'Cannot remove a: used by b', i18n.T('Cannot remove {name}: used by {used}', { name: 'a', used: 'b' }))
  i18n.merge({ Add: 'Добавить', '{n} outputs': { one: '{n} выход', few: '{n} выхода', many: '{n} выходов', other: '{n} выхода' } })
  check('T берёт строку словаря', 'Добавить', i18n.T('Add'))
  check('T без перевода остаётся ключом', 'Remove', i18n.T('Remove'))
  i18n.lang = 'ru'
  const forms = { one: '{n} output', other: '{n} outputs' }
  const ru = { one: '{n} выход', few: '{n} выхода', many: '{n} выходов', other: '{n} выхода' }
  i18n.dict['{n} outputs'] = ru
  check('TN: множественное число словаря (1)', '1 выход', i18n.TN(1, forms))
  check('TN: множественное число словаря (3)', '3 выхода', i18n.TN(3, forms))
  check('TN: множественное число словаря (5)', '5 выходов', i18n.TN(5, forms))
  i18n.dict = {}; i18n.lang = 'en'
  check('TN: английские формы', '2 outputs', i18n.TN(2, forms))
  // загрузка: язык LuCI и словари плагинов
  const i2 = makeLoader({ rpcCalls: calls, rpcReplies: {
    prefs_get: { ok: true, lang: 'pt-BR' },
    i18n_get: (lang) => lang === 'pt' ? { ok: true, dicts: [ { plugin: 'lang-pt', dict: { Add: 'Adicionar' } } ] } : { ok: true, dicts: [] },
  } }).load('view.splify2.core.i18n')
  await i2.load()
  check('словарь грузится по языку LuCI с откатом pt-BR -> pt', 'Adicionar', i2.T('Add'))
}

// ---- 2. покрытие ключей фикстуры полями ---------------------------------------------------
const paths = schema.paths(FIXTURE, '')
check('фикстура: ключей в схеме не меньше 100', true, paths.length >= 100)

// минимальная спека с одним элементом в каждой карте и в списке правил
const SAMPLE = { clients: { a: {} }, lists: { a: {} }, outputs: { a: { kind: 'direct' } }, dns: { upstreams: { a: {} } }, rules: [ { out: 'a' } ] }
const ctx = { spec: SAMPLE, devices: [ 'br-lan', 'wg0' ], notify() {} }
const form = autoform.build(FIXTURE, SAMPLE, ctx)
const have = new Set(form.fields.map((f) => f.path))
check('каждый ключ схемы имеет поле (' + paths.length + ')', [], paths.filter((p) => !have.has(p)))
check('поля без ключа в схеме нет', [], [...have].filter((p) => p && !paths.includes(p) && !/\.\*$|\.\[\]$/.test(p) && !/^(clients|lists|outputs|rules|dns\.upstreams)$/.test(p) && !/^(lan|dns|dns\.cache_ttl)$/.test(p) && !/\.obfs$/.test(p) && !/\.inline$/.test(p)))

// ---- 3. круг по каждому ключу ------------------------------------------------------------
function sample(node) {
  const t = schema.typeOf(node)
  if (node.const !== undefined) return node.const
  if (node.enum) return node.enum[0]
  if (t === 'array') {
    const it = node.items || { type: 'string' }
    return [ sample(it) ]
  }
  if (t === 'integer' || t === 'number') {
    let v = node.minimum != null ? node.minimum : 1
    if (node.default === v) v = v + 1
    if (node.maximum != null && v > node.maximum) v = node.maximum
    return v
  }
  if (t === 'boolean') return node.default === true ? false : true
  if (node.pattern) {
    if (node.pattern === '^[A-Z]{2}$') return 'NL'
    if (node.pattern.startsWith('^https?://')) return 'http://probe.example/'
    if (node.pattern.includes('0-9A-Fa-f')) return 'aa:bb:cc:dd:ee:01'
    if (node.pattern.startsWith('^[0-9]+')) return '443'
    if (node.pattern.startsWith('^[A-Za-z0-9_.-]')) return 'n1'
  }
  return 'x'
}
// положить значение по пути (+ дискриминаторы слоя и x-when) во вложенную спеку; вернуть узел-лист
function place(path) {
  const segs = path.split('.')
  const spec = {}
  let cur = spec, node = FIXTURE, parentNode = null
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i], last = i === segs.length - 1
    if (s === '*') { node = schema.mapNode(node); cur.e1 = {}; cur = cur.e1; continue }
    if (s === '[]') { node = node.items; const o = {}; cur.push(o); cur = o; continue }
    if (s.startsWith('@')) {
      const layer = s.slice(1), [kind, proto] = layer.split(':')
      cur.kind = kind
      if (proto) cur.protocol = proto
      parentNode = node
      node = { properties: node['x-kinds'][layer].properties }
      continue
    }
    const sub = node.properties[s]
    // условия видимости: значения соседей, а их условия — рекурсивно (prefix -> ipv6 -> kind)
    const need = (n) => { if (n['x-when']) for (const [k, vals] of Object.entries(n['x-when'])) { if (cur[k] === undefined) cur[k] = vals[0]; const sib = (node.properties || {})[k]; if (sib) need(sib) } }
    need(sub)
    if (last) { cur[s] = sample(sub); return { spec, leaf: sub, holder: cur, key: s } }
    const st = schema.typeOf(sub)
    if (st === 'array' && sub.items && (sub.items.properties || schema.typeOf(sub.items) === 'object')) { cur[s] = []; cur = cur[s]; node = sub; continue }
    cur[s] = schema.isMap(sub) ? {} : {}
    cur = cur[s]; node = sub
  }
  throw new Error('нет листа: ' + path)
}
let rtFail = []
for (const p of paths) {
  const segs = p.split('.')
  // промежуточные узлы (объекты, карты) не листья
  let sub = FIXTURE
  const node = (() => { try { const r = place(p); return r } catch { return null } })()
  if (!node) continue
  const { spec, leaf } = node
  const lt = schema.typeOf(leaf)
  if ((lt === 'object' || leaf.properties || schema.isMap(leaf) || leaf['x-kinds']) && lt !== 'union') continue
  if (lt === 'array' && leaf.items && (leaf.items.properties || schema.typeOf(leaf.items) === 'object')) continue
  if (p === 'version') continue
  const f = autoform.build(FIXTURE, spec, { spec, devices: [ 'br-lan' ], notify() {} })
  const got = f.get()
  const same = canon(got) === canon(spec)
  if (!same) rtFail.push(p + ': ' + JSON.stringify(spec) + ' -> ' + JSON.stringify(got))
}
check('круг «значение -> форма -> значение» без потерь по каждому ключу', [], rtFail)

// заполнить поле руками в пустой записи -> прочитать
{
  let miss = []
  for (const p of paths) {
    const r = (() => { try { return place(p) } catch { return null } })()
    if (!r) continue
    const lt = schema.typeOf(r.leaf)
    if ((r.leaf.properties || schema.isMap(r.leaf) || r.leaf['x-kinds']) && lt !== 'union') continue
    if (lt === 'array' && r.leaf.items && (r.leaf.items.properties || schema.typeOf(r.leaf.items) === 'object')) continue
    if (p === 'version') continue
    // пустая запись с теми же дискриминаторами, но без самого ключа
    const spec = JSON.parse(JSON.stringify(r.spec)); delete r.holder[r.key]
    const empty = JSON.parse(JSON.stringify(r.spec))
    // holder указывает в r.spec: удаляем ключ из копии через повторный place
    const r2 = place(p); delete r2.holder[r2.key]
    const f = autoform.build(FIXTURE, r2.spec, { spec: r2.spec, devices: [ 'br-lan' ], notify() {} })
    const field = f.fields.filter((x) => x.path === p).pop()?.field
    if (!field) { miss.push(p + ': нет поля'); continue }
    const want = sample(r.leaf)
    const w = field.widget
    if (field.kind === 'const' || !w) continue
    const setRaw = (v) => { if (w.constructor.name === 'Checkbox') w.type(v ? '1' : '0'); else if (Array.isArray(v)) w.type(v.map(String)); else if (typeof v === 'boolean') w.type(String(v)); else w.type(String(v)) }
    if (lt === 'union') { setRaw(want) }
    else setRaw(want)
    const got = f.get()
    const exp = place(p).spec
    if (canon(got) !== canon(exp)) miss.push(p + ': ' + JSON.stringify(got) + ' != ' + JSON.stringify(exp))
  }
  check('заполнить поле -> прочитать: значение попадает в спеку (каждый ключ)', [], miss)
}

// ---- 4. видимость, виды, неизвестное ----------------------------------------------------
{
  const v = (spec) => autoform.build(FIXTURE, spec, { spec, devices: [], notify() {} })
  const shown = (f, path) => { const x = f.fields.filter((y) => y.path === path).pop().field; return x.el.shown !== false && !x.hidden }
  let f = v({ outputs: { g: { kind: 'group', members: [ 'a' ], pick: 'latency' } } })
  check('группа pick:latency показывает tolerance', true, shown(f, 'outputs.*.@group.tolerance'))
  check('группа pick:latency прячет weights', false, shown(f, 'outputs.*.@group.weights'))
  check('группа без pick (умолчание order) показывает only', true, shown(f, 'outputs.*.@group.only'))
  check('группа не показывает ключи туннеля (members есть, nodes нет)', false, shown(f, 'outputs.*.@tunnel.nodes'))
  f = v({ outputs: { t: { kind: 'tunnel', protocol: 'vless', subscription: 's', nodes: [ 1 ] } } })
  check('туннель vless показывает transport', true, shown(f, 'outputs.*.@tunnel:vless.transport'))
  check('туннель vless прячет members группы', false, shown(f, 'outputs.*.@group.members'))
  f = v({ outputs: { t: { kind: 'tunnel', protocol: 'socks', subscription: 's' } } })
  check('туннель socks прячет transport', false, shown(f, 'outputs.*.@tunnel:vless.transport'))
  // неизвестное сохраняется
  const spec = { version: 2, future: { a: 1 }, outputs: { z: { kind: 'zzz', secret_key: 'abc' }, d: { kind: 'direct', extra: [ 1 ] } } }
  f = v(spec)
  check('неизвестные ключи верхнего уровня, вида и записи сохраняются', JSON.stringify(spec.outputs), JSON.stringify(f.get().outputs))
  check('неизвестный вид выхода остаётся в списке видов, а не заменяется первым', 'zzz', f.fields.find((x) => x.path === 'outputs.*.kind' && x.field.widget.value === 'zzz').field.get())
  // отказ: обязательное
  f = v({ outputs: { g: { kind: 'group' } } })
  check('валидация: у группы нужен members', true, f.validate().some((e) => e.path === 'outputs.*.@group.members'))
  f = v({ outputs: { t: { kind: 'tunnel', active: 70000 } } })
  check('валидация: число вне границ', true, f.validate().some((e) => e.path === 'outputs.*.@tunnel.active'))
  f = v({ outputs: { t: { kind: 'tunnel', exclude: [ 'ru' ] } } })
  check('валидация: шаблон кода страны', true, f.validate().some((e) => e.path === 'outputs.*.@tunnel.exclude'))
  // секрет и путь
  const sec = autoform.build({ type: 'object', properties: { token: { type: 'string', 'x-secret': true }, file: { type: 'string', 'x-path': 'conf' } } }, {}, {})
  check('x-secret даёт поле пароля', true, sec.fields.find((x) => x.path === 'token').field.widget.options.password)
  check('x-path даёт подсказку про путь', true, sec.fields.find((x) => x.path === 'file').field.el.textContent.includes('settings directory'))
  // x-ref: выбор из спеки
  const s2 = { outputs: { a: { kind: 'direct' }, b: { kind: 'block' } }, rules: [ { out: 'a' } ] }
  f = v(s2)
  check('x-ref outputs даёт выбор из выходов спеки', [ 'a', 'b' ], Object.keys(f.fields.find((x) => x.path === 'rules.[].out').field.widget.choices).filter(Boolean))
  check('x-ref clients добавляет lan', true, Object.keys(f.fields.find((x) => x.path === 'rules.[].for').field.widget.choices || {}).includes('lan'))
  check('usedBy: выход, названный правилом', [ 'rules[0].out' ], autoform.usedBy({ spec: s2 }, 'outputs', 'a'))
  check('usedBy: kind: direct не ссылка', [], autoform.usedBy({ spec: { outputs: { direct: { kind: 'direct' }, x: { kind: 'group', on_fail: 'direct' } } } }, 'outputs', 'direct'))
}

// ---- 5. карты и списки: добавить, убрать, порядок -----------------------------------------
{
  const spec = { outputs: { a: { kind: 'direct' } }, rules: [ { name: 'r1', out: 'a' }, { name: 'r2', out: 'a' } ] }
  const notes = []
  const f = autoform.build(FIXTURE, spec, { spec, devices: [], notify: (s) => notes.push(s) })
  const outs = f.fields.find((x) => x.path === 'outputs').field
  outs.nameInput.setValue('b'); outs.addButton.listeners.click[0]({ preventDefault() {} })
  check('карта: добавленный выход попадает в значение с первым видом', { kind: 'direct' }, f.get().outputs.b)
  outs.nameInput.setValue('b'); outs.addButton.listeners.click[0]({ preventDefault() {} })
  check('карта: повтор имени — отказ с сообщением', 1, notes.filter((n) => /already taken/.test(n)).length)
  outs.nameInput.setValue('bad name!'); outs.addButton.listeners.click[0]({ preventDefault() {} })
  check('карта: имя вне шаблона — отказ', 1, notes.filter((n) => /may contain/.test(n)).length)
  const rm = outs.entries[0].el.children[1].children[1].children[0]
  rm.listeners.click[0]({ preventDefault() {} })
  check('карта: выход под ссылкой правила не удаляется', true, notes.some((n) => /Cannot remove a/.test(n)) && 'a' in f.get().outputs)
  const rules = f.fields.find((x) => x.path === 'rules').field
  const down = rules.items[0].el.children[1].children[1].children[1]
  down.listeners.click[0]({ preventDefault() {} })
  check('список правил: «вниз» меняет порядок', [ 'r2', 'r1' ], f.get().rules.map((r) => r.name))
  const filt = autoform.build(FIXTURE, { outputs: { a: { kind: 'direct' }, g: { kind: 'group', members: [ 'a' ] } } },
    { spec: {}, devices: [], notify() {}, mapOptions: { outputs: { filter: (n, v) => v.kind !== 'group' } } })
  check('карта с фильтром: скрытые записи остаются нетронутыми', { kind: 'group', members: [ 'a' ] }, filt.get().outputs.g)
  check('карта с фильтром: показаны только подходящие', [ 'a' ], filt.fields.find((x) => x.path === 'outputs').field.entries.map((e) => e.name))
}

// ---- 6. список строк T() и словарь -----------------------------------------------------------
import { scanStrings, stringsFile } from './lib/strings.mjs'
{
  const list = scanStrings(CORE, FIXTURE)
  if (process.argv.includes('--write-strings')) { writeFileSync(stringsFile(CORE), JSON.stringify(list, null, 1) + '\n'); console.log('strings.json записан: ' + list.length) }
  const cur = existsSync(stringsFile(CORE)) ? JSON.parse(readFileSync(stringsFile(CORE), 'utf8')) : []
  check('strings.json (' + list.length + ' строк) соответствует исходникам: node tests/automatch.mjs --write-strings', list, cur)
  const nonLiteral = scanStrings.nonLiteral(CORE)
  check('первый аргумент T()/TN() — всегда строка в кавычках', [], nonLiteral)
}

// ---- 7. методы rpcd, которые зовёт каркас, существуют --------------------------------------
{
  const api = load('view.splify2.core.api')
  const rpcd = readFileSync(resolve(ROOT, 'files/usr/libexec/rpcd/splify2'), 'utf8')
  const listBlock = rpcd.slice(rpcd.indexOf('\nlist)'), rpcd.indexOf('\ncall)'))
  const acl = JSON.parse(readFileSync(resolve(ROOT, 'luci/root/usr/share/rpcd/acl.d/splify2.json'), 'utf8')).splify2
  const aclAll = [ ...acl.read.ubus.splify2, ...acl.write.ubus.splify2 ]
  const names = Object.keys(api.methods)
  check('методы api.js есть в блоке list) rpcd', [], names.filter((m) => !new RegExp(`json_add_object ${m};|json_add_object ${m}\\n|json_add_object ${m} `).test(listBlock)))
  check('методы api.js есть в ACL', [], names.filter((m) => !aclAll.includes(m)))
  // параметры: у каждого объявлены в rpcd те же поля, что в api.js (values/spec/…)
  const sig = {}
  for (const m of names) {
    const mm = listBlock.match(new RegExp(`json_add_object ${m}\\b([^\\n]*)`))
    sig[m] = [...(mm ? mm[1] : '').matchAll(/json_add_(?:string|int|boolean|array) ([a-z_]+)/g)].map((x) => x[1])
  }
  const bad = names.filter((m) => api.methods[m].some((k) => !sig[m].includes(k) && !(m === 'plugin_settings_set' && k === 'values')))
  check('параметры api.js объявлены в сигнатуре rpcd (кроме объектов произвольной формы)', [], bad)
}

// ---- 8. все файлы каркаса разбираются --------------------------------------------------------
{
  const bad = []
  for (const f of readdirSync(CORE).filter((x) => x.endsWith('.js'))) {
    try { new Function('baseclass', 'L', 'E', '_', readFileSync(resolve(CORE, f), 'utf8').replace(/^'require [^\n]*\n/gm, '')) } catch (e) { bad.push(f + ': ' + e.message) }
  }
  check('все модули view/splify2/core разбираются без ошибок', [], bad)
}

console.log(`\n${total} проверок, провалов: ${fails}`)
process.exit(fails ? 1 : 0)
