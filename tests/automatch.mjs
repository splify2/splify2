// Стенд каркаса splify2 на классическом LuCI JS: автоформа «схема -> поля», словарь T(), покрытие ключей
// схемы полями и круг «заполнить поле -> прочитать» для КАЖДОГО ключа фикстуры схемы ядра.
// Модули — настоящие файлы luci/htdocs/…/view/splify2/core, LuCI заменён заглушками (tests/lib/luci-stub.mjs).
// Запуск: node tests/automatch.mjs [--write-strings]   (sh tests/automatch.sh ищет подходящий node)
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { ROOT, RES, makeLoader, E, ui } from './lib/luci-stub.mjs'

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
    const mm = listBlock.match(new RegExp(`json_add_object ${m}\\b([\\s\\S]*?json_close_object)`))
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

// ---- 9. сырой редактор: YAML туда и обратно, ошибка разбора; вкладка плагинов на старом ядре ----------
{
  const tick = () => new Promise((r) => setTimeout(r, 0))
  const find = (el, pred) => { let hit = null; el.walk((n) => { if (!hit && pred(n)) hit = n }); return hit }
  const click = (el) => el.listeners.click[0]({ preventDefault() {} })
  const YAML = 'version: 2\n# comment of the core\noutputs:\n  direct:\n    kind: direct\n'
  const notes = [], modals = []
  const ui2 = { ...ui, addNotification: (t, el, kind) => notes.push({ text: el.textContent, kind }),
    showModal: (title, kids) => modals.push({ title, el: E('div', {}, kids) }), hideModal() {} }
  const rc = [], rr = {
    spec_get: { version: 2, rev: 'r1', outputs: { direct: { kind: 'direct' } } },
    spec_schema: { ok: true, source: 'core', schema: FIXTURE },
    devices: { ok: true, devices: [] }, applied_get: null,
    spec_yaml: { ok: true, yaml: YAML, rev: 'r1' },
    spec_check: (a) => a.includes('BAD') ? { ok: false, error: 'ошибка YAML: did not find expected key', line: 5, col: 3 } : { ok: true },
    spec_set: (a, rev) => rev === 'old' ? { ok: false, conflict: true, rev: 'r2', error: 'changed' } : { ok: true, rev: 'r3' },
  }
  const L2 = makeLoader({ rpcCalls: rc, rpcReplies: rr, extra: { ui: ui2 } })
  const raw = L2.load('view.splify2.core.raw')
  const store = L2.load('view.splify2.core.store')
  await store.load()
  let refreshed = 0
  const host = { refresh() { refreshed++ } }
  const el = raw.render(host)
  await tick()
  const area = find(el, (n) => n.tag === 'textarea')
  const btn = (name) => find(el, (n) => n.tag === 'button' && n.textContent === name)
  const res = () => find(el, (n) => n.attrs && n.attrs['class'] === 'cbi-section').children[3].children.at(-1).textContent
  check('редактор показывает YAML ядра (spec_yaml), а не JSON', YAML, area.value)
  check('подпись редактора без слова JSON и без технических пояснений', 'The spec in YAML. Edit it, then press Check or Save.', find(el, (n) => n.tag === 'p').textContent)
  check('в словаре каркаса нет строк про JSON', [], JSON.parse(readFileSync(stringsFile(CORE), 'utf8')).filter((x) => /JSON/.test(x) && !/JSON Schema/.test(x)))
  rc.length = 0
  click(btn('Check')); await tick()
  check('Check шлёт YAML как есть', [ 'spec_check', YAML ], [ rc[0].method, rc[0].args[0] ])
  check('Check: ядро приняло', 'The core accepts the spec.', res())
  area.value = 'version: 2\noutputs: [BAD\n'
  rc.length = 0
  click(btn('Check')); await tick()
  check('ошибка разбора: строка и колонка и слова ядра', 'Line 5, column 3: ошибка YAML: did not find expected key', res())
  rc.length = 0
  area.value = YAML + '  extra: 1\n'
  click(btn('Save')); await tick(); await tick()
  const set = rc.find((c) => c.method === 'spec_set')
  check('Save шлёт YAML и ревизию, с которой текст прочитан', [ YAML + '  extra: 1\n', 'r1' ], set && set.args)
  check('после Save спека и редактор перечитаны', [ true, true, true ], [ rc.some((c) => c.method === 'spec_get'), rc.some((c) => c.method === 'spec_yaml'), refreshed > 0 ])
  check('после Save сказано, что делать дальше', 'Saved. Press Apply to put the changes into effect.', res())
  area.value = 'version: 2\noutputs: [BAD\n'
  rr.spec_set = () => ({ ok: false, error: 'ошибка YAML: x', line: 2, col: 1 })
  click(btn('Save')); await tick()
  check('Save: ошибка разбора со строкой и колонкой', 'Line 2, column 1: ошибка YAML: x', res())
  rr.spec_set = () => ({ ok: false, conflict: true, rev: 'r9', error: 'changed' })
  click(btn('Save')); await tick()
  check('Save: спека на роутере изменилась — отдельное сообщение', true, /changed on the router/.test(res()))

  // Плагины на ядре без менеджера: состояние и действие, а не слова отказа ядра.
  rc.length = 0
  rr.plugins_list = { ok: false, error: 'ядро 2.0.5 не умеет плагины — нужно 2.1 или новее', code: 'core_too_old', installed: '2.0.5', need: '2.1' }
  rr.steer_versions = { ok: true, versions: [ '2.1.1-pre', '2.1.0', '2.0.5' ], prerelease: '2.1.1-pre' }
  rr.steer_install = { ok: true }
  const pl = L2.load('view.splify2.core.plugins').render(host)
  await tick(); await tick()
  check('старое ядро: плагины сказали, что нужно и что стоит', 'Plugins need steer 2.1 or newer. Installed: 2.0.5.', find(pl, (n) => n.attrs && n.attrs['class'] === 'alert-message warning').textContent)
  check('старое ядро: слов «нет такой команды» нет', false, /команды|steer help/.test(pl.textContent))
  check('старое ядро: после отказа каталог не запрашивался', false, rc.some((c) => c.method === 'plugins_search'))
  click(find(pl, (n) => n.tag === 'button' && n.textContent === 'Update the core')); await tick()
  check('старое ядро: кнопка предлагает свежий выпуск (не предварительный)', 'Update steer to 2.1.0?', modals.at(-1).title)
  click(find(modals.at(-1).el, (n) => n.tag === 'button' && n.textContent === 'Update the core')); await tick()
  check('старое ядро: обновление зовёт steer_install с этой версией', [ '2.1.0' ], (rc.find((c) => c.method === 'steer_install') || { args: [] }).args.slice(0, 1))
  // запасная схема: одна строка на странице разделов
  check('запасная схема названа одной строкой', true, /follow the package/.test(readFileSync(resolve(CORE, 'sections.js'), 'utf8')))
}

console.log(`\n${total} проверок, провалов: ${fails}`)
process.exit(fails ? 1 : 0)
