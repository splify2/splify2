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
  const w = canon(want), g = canon(got)
  if (w === g) { console.log(`${what.padEnd(88)} ok`); return }
  fails++
  console.log(`${what.padEnd(88)} ПРОВАЛ\n    ожидалось: ${w.slice(0, 700)}\n    получено:  ${g.slice(0, 1500)}`)
}

const CORE = resolve(RES, 'view/splify2/core')
// Настоящий вывод `steer spec-schema --json` (ядро 2.0.5, роутер, без модулей): tests/fixtures/spec-schema.json.
// Запасная схема пакета — его точная копия.
const FIXTURE = JSON.parse(readFileSync(resolve(ROOT, 'tests/fixtures/spec-schema.json'), 'utf8'))
const BUNDLED = readFileSync(resolve(ROOT, 'files/usr/share/splify2/spec-schema.json'), 'utf8')
// Вид, которого в сборке без модулей нет, и вид плагина — в сборке с модулями и плагином схема их имеет.
// Тут они собраны из настоящей схемы: vless получает ключи, плагин warpbox — вид `warp` и ключ с x-plugin.
const EXT = JSON.parse(JSON.stringify(FIXTURE))
{
  const o = EXT.properties.outputs.additionalProperties, V = o['x-variants']
  const common = V.interface.properties
  V['tunnel:vless'] = {
    type: 'object', description: 'Туннель VLESS по подписке.', 'x-spec': { kind: 'tunnel', protocol: 'vless' },
    'x-example': { kind: 'tunnel', protocol: 'vless', subscription: 's1' }, required: ['kind', 'protocol', 'subscription'], additionalProperties: false,
    properties: {
      kind: { type: 'string', const: 'tunnel' }, protocol: { type: 'string', const: 'vless' },
      on_fail: common.on_fail, ipv6: common.ipv6,
      subscription: { type: 'string', description: 'Подписка.', 'x-example': 's1' },
      transport: { type: 'string', enum: ['tcp', 'ws', 'grpc'], default: 'tcp', 'x-example': 'ws' },
      path: { type: 'string', 'x-when': { transport: ['ws', 'grpc'] }, 'x-example': '/p' },
      exclude: { type: 'array', items: { type: 'string', pattern: '^[A-Z]{2}$' }, 'x-one-or-list': true, 'x-example': ['NL'] },
    },
  }
  V.warp = JSON.parse(JSON.stringify(V.warp))
  V.warp['x-plugin'] = { id: 'warpbox', version: '1.0.0' }
  V.warp.properties.countries['x-plugin'] = 'warpbox'
  V.vendor = {
    type: 'object', description: 'Вид плагина.', 'x-spec': { kind: 'vendor' }, 'x-plugin': { id: 'acme', version: '0.1.0' },
    'x-example': { kind: 'vendor', token: 't' }, required: ['kind', 'token'], additionalProperties: false,
    properties: {
      kind: { type: 'string', const: 'vendor' },
      token: { type: 'string', 'x-secret': true, 'x-plugin': 'acme', 'x-example': 't' },
      via: { type: 'string', 'x-ref': { section: 'outputs', also: ['direct'] }, 'x-plugin': 'acme', 'x-example': 'direct' },
      conf: { type: 'string', 'x-path': 'conf', 'x-plugin': 'acme', 'x-example': 'a.conf' },
    },
  }
  o.properties.kind.enum.push('vendor')
  EXT['x-plugins'] = [ { id: 'warpbox', version: '1.0.0', enabled: true, kinds: ['warp'] }, { id: 'acme', version: '0.1.0', enabled: true, kinds: ['vendor'] } ]
}

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

// ---- 2. схема пакета и покрытие ключей полями -----------------------------------------------
const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
const clone = (x) => JSON.parse(JSON.stringify(x))
const build = (root, spec, extra = {}) => autoform.build(root, spec, { spec, devices: [ 'br-lan' ], notify() {}, schemaRoot: root, ...extra })
check('запасная схема пакета — точная копия вывода ядра (tests/fixtures)', true, BUNDLED === readFileSync(resolve(ROOT, 'tests/fixtures/spec-schema.json'), 'utf8'))
check('корневые разделы схемы — как в спеке v2 (без settings)', [ 'version', 'lan', 'clients', 'lists', 'outputs', 'dns', 'rules' ], Object.keys(FIXTURE.properties))
check('схема не знает слов придуманного формата (x-map, x-kinds, x-name-pattern)', [], ['x-map', 'x-kinds', 'x-name-pattern'].filter((w) => JSON.stringify(FIXTURE).includes('"' + w + '"')))

function sample(node) {
  const t = schema.typeOf(node)
  if (t === 'boolean') return node.default === true ? false : true
  if (node['x-example'] !== undefined && (t !== 'object' || Object.keys(node['x-example']).length)) return node['x-example']
  if (node.const !== undefined) return node.const
  if (node.enum) return node.enum[0]
  if (t === 'array') return [ sample(node.items || { type: 'string' }) ]
  if (t === 'integer' || t === 'number') return node.minimum != null ? node.minimum : 1
  return 'x'
}
const isLeaf = (n) => { const t = schema.typeOf(n); return t !== 'object' && !schema.isMap(n) && !schema.isObjectArray(n) }

// Положить в пустую спеку значение по пути поля (+ ключи вида и условия видимости соседей); вернуть лист.
// Для пути-селектора (kind, protocol, @variant) листа нет: спека — одна запись нужного вида.
function place(root, path) {
  const segs = path.split('.'), spec = { version: 2 }
  let cur = spec, node = root, parent = null, sel = false
  node = { ...root }
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i], last = i === segs.length - 1
    if (s === '*') { node = schema.mapNode(node); cur.e1 = {}; cur = cur.e1; continue }
    if (s === '[]') { node = node.items; const o = {}; cur.push(o); cur = o; continue }
    if (s === '@variant') { sel = true; break }
    if (s.startsWith('@')) {
      const name = s.slice(1), V = node['x-variants'], d = node['x-discriminator']
      Object.assign(cur, clone(V[name]['x-spec'] || {}))
      if (d && d.has && name === d.yes) cur[d.has] = sample(V[name].properties[d.has])
      parent = node; node = V[name]; continue
    }
    if (schema.selectorKeys(node).includes(s)) {   // kind / protocol
      sel = true
      break
    }
    const sub = (node.properties || {})[s]
    if (!sub) throw new Error('нет ключа ' + s + ' в ' + path)
    // условия: соседи, чьи значения нужны (рекурсивно: prefix -> ipv6)
    const need = (n) => {
      for (const [k, vals] of Object.entries(n['x-when'] || {})) { if (cur[k] === undefined) cur[k] = vals[0]; if (node.properties[k]) need(node.properties[k]) }
      for (const k of n['x-when-set'] || []) { if (cur[k] === undefined) cur[k] = sample(node.properties[k]); if (node.properties[k]) need(node.properties[k]) }
    }
    need(sub)
    if (last) { cur[s] = sample(sub); return { spec, leaf: sub, holder: cur, key: s, defining: !!(parent && parent['x-discriminator'] && parent['x-discriminator'].has === s) } }
    if (schema.typeOf(sub) === 'array' && schema.isObjectArray(sub)) { cur[s] = []; cur = cur[s]; node = sub; continue }
    cur[s] = {}; cur = cur[s]; node = sub
  }
  if (sel) {
    // запись нужного вида: для kind/protocol — первый вид, для has — пустая
    if (segs[segs.length - 1] === 'protocol') Object.assign(cur, { kind: 'tunnel' })
    return { spec, leaf: null, holder: cur, key: null }
  }
  throw new Error('нет листа: ' + path)
}

for (const [name, root] of [ ['настоящая схема ядра', FIXTURE], ['схема с модулями и плагинами', EXT] ]) {
  const paths = schema.paths(root, '')
  check(name + ': ключей в схеме не меньше 100', true, paths.length >= 100)
  const missing = [], extra = []
  for (const p of paths) {
    let r
    try { r = place(root, p) } catch (e) { missing.push(p + ': ' + e.message); continue }
    const f = build(root, r.spec)
    if (!f.fields.some((x) => x.path === p)) missing.push(p)
  }
  check(name + ': на каждый ключ каждого варианта есть поле (' + paths.length + ')', [], missing)
  // поле без ключа: каждый путь формы — ключ схемы, запись карты или списка
  const all = new Set(paths)
  const spec = { clients: { a: {} }, lists: { a: {} }, outputs: { a: { kind: 'direct' }, g: { kind: 'group', members: ['a'] }, i: { kind: 'interface', device: 'wg0' } },
    dns: { upstreams: { a: { url: 'udp://1.1.1.1' }, b: { servers: ['a'] } } }, rules: [ { to: 'x', out: 'a', dns: { url: 'udp://1.1.1.1' } } ] }
  const f = build(root, spec)
  const stray = f.fields.map((x) => x.path).filter((p) => p && !all.has(p) && !/\.\*$|\.\[\]$/.test(p))
  check(name + ': поля без ключа в схеме нет', [], stray)
  // круг «значение -> форма -> значение» без потерь по каждому листу
  const rt = [], fill = []
  let nLeaf = 0
  for (const p of paths) {
    let r; try { r = place(root, p) } catch { continue }
    if (!r.leaf || !isLeaf(r.leaf)) continue
    nLeaf++
    const f1 = build(root, r.spec)
    if (canon(f1.get()) !== canon(r.spec)) rt.push(p + ': ' + JSON.stringify(r.spec) + ' -> ' + JSON.stringify(f1.get()))
    // заполнить поле руками в записи без этого ключа (ключ, которым запись становится группой, и union — отдельно, в разделе вариантов)
    if (r.defining || schema.typeOf(r.leaf) === 'union') continue
    const r2 = place(root, p); delete r2.holder[r2.key]
    const f2 = build(root, r2.spec)
    const field = f2.fields.filter((x) => x.path === p).pop()?.field
    if (!field || !field.widget || field.kind === 'const') { fill.push(p + ': нет поля'); continue }
    const want = sample(r.leaf), w = field.widget
    if (w.constructor.name === 'Checkbox') w.type(want ? '1' : '0')
    else if (Array.isArray(want)) w.type(want.map(String))
    else w.type(String(want))
    if (canon(f2.get()) !== canon(r.spec)) fill.push(p + ': ' + JSON.stringify(f2.get()) + ' != ' + JSON.stringify(r.spec))
  }
  check(name + ': круг «значение -> форма -> значение» без потерь по каждому ключу (' + nLeaf + ')', [], rt)
  check(name + ': заполнить поле -> прочитать: значение попадает в спеку (каждый ключ)', [], fill)
  check(name + ': x-example каждого варианта выхода — запись без потерь', [], Object.entries(root.properties.outputs.additionalProperties['x-variants']).filter(([, v]) => v['x-example'] && !v['x-absent'])
    .filter(([n, v]) => { const spec = { outputs: { e1: clone(v['x-example']) } }; return canon(build(root, spec).get().outputs) !== canon(spec.outputs) }).map(([n]) => n))
}

// ---- 3. условия видимости -------------------------------------------------------------------
{
  const shown = (f, path) => { const x = f.fields.filter((y) => y.path === path).pop(); return !!x && x.field.el.shown !== false && !x.field.hidden }
  let f = build(FIXTURE, { outputs: { g: { kind: 'group', members: [ 'a' ], pick: 'latency' } } })
  check('x-when: группа pick:latency показывает tolerance', true, shown(f, 'outputs.*.@group.tolerance'))
  check('x-when: группа pick:latency прячет weights и by', [ false, false ], [ shown(f, 'outputs.*.@group.weights'), shown(f, 'outputs.*.@group.by') ])
  f = build(FIXTURE, { outputs: { g: { kind: 'group', members: [ 'a' ], pick: 'balance' } } })
  check('x-when: группа pick:balance показывает weights и by, прячет tolerance', [ true, true, false ], [ shown(f, 'outputs.*.@group.weights'), shown(f, 'outputs.*.@group.by'), shown(f, 'outputs.*.@group.tolerance') ])
  f = build(FIXTURE, { outputs: { g: { kind: 'group', members: [ 'a' ] } } })
  check('x-when: без pick (умолчание order) tolerance спрятан', false, shown(f, 'outputs.*.@group.tolerance'))
  f = build(FIXTURE, { outputs: { i: { kind: 'interface', device: 'wg0' } } })
  check('x-when: prefix виден только при ipv6: routed', [ false ], [ shown(f, 'outputs.*.@interface.prefix') ])
  f = build(FIXTURE, { outputs: { i: { kind: 'interface', device: 'wg0', ipv6: 'routed' } } })
  check('x-when: ipv6: routed показывает prefix', true, shown(f, 'outputs.*.@interface.prefix'))
  f = build(FIXTURE, { outputs: { i: { kind: 'interface', device: 'wg0' } } })
  check('x-when-set: over спрятан, пока нет obfs', false, shown(f, 'outputs.*.@interface.over'))
  f = build(FIXTURE, { outputs: { i: { kind: 'interface', device: 'wg0', obfs: { server: '1.2.3.4:1', listen: '127.0.0.1:2' }, over: 'x' } } })
  check('x-when-set: с obfs over виден', true, shown(f, 'outputs.*.@interface.over'))
  check('x-when-set: over, записанный при obfs, не теряется', 'x', f.get().outputs.i.over)
  // x-needs: scope: device без for — отказ разбора, форма говорит это заранее
  f = build(FIXTURE, { rules: [ { to: 'a', out: 'b', scope: 'device' } ] })
  check('x-needs: scope: device без for — ошибка у ключа', true, f.validate().some((e) => e.path === 'rules.[].scope' && /for/.test(e.message)))
  f = build(FIXTURE, { rules: [ { to: 'a', out: 'b', scope: 'device', for: 'kids' } ] })
  check('x-needs: scope: device с for — без ошибки', [], f.validate())
  f = build(FIXTURE, { rules: [ { to: 'a', out: 'b', scope: 'global' } ] })
  check('x-needs: scope: global for не требует', [], f.validate())
  // x-platform / x-unsupported
  f = build(FIXTURE, { clients: { a: { addr: '10.0.0.1' } } })
  check('x-platform: ключи телефона (uid, self, app) на роутере не рисуются', [ false, false, false ], [ 'uid', 'self', 'app' ].map((k) => f.fields.some((x) => x.path === 'clients.*.' + k)))
  f = build(FIXTURE, { clients: { a: { addr: '10.0.0.1' } } }, { platform: 'phone' })
  check('x-platform: на телефоне они есть', [ true, true, true ], [ 'uid', 'self', 'app' ].map((k) => f.fields.some((x) => x.path === 'clients.*.' + k)))
  check('x-platform: ключ телефона в спеке роутера сохраняется, не теряется', { addr: '10.0.0.1', uid: [ 10123 ] }, build(FIXTURE, { clients: { a: { addr: '10.0.0.1', uid: [ 10123 ] } } }).get().clients.a)
  f = build(FIXTURE, { lists: { a: { domains: [ 'x.example' ] } } })
  check('x-unsupported: ключ нарисован с пометкой', true, f.fields.find((x) => x.path === 'lists.*.domains').field.el.textContent.includes('Not supported yet'))
  check('x-unsupported: записанный ключ — ошибка проверки', true, f.validate().some((e) => e.path === 'lists.*.domains'))
  check('x-unsupported: пустой ключ ошибки не даёт', [], build(FIXTURE, { lists: { a: { srs: [ 'a.srs' ] } } }).validate())
  // x-one-or-list: одно значение остаётся одним
  const one = { rules: [ { to: 'youtube', out: 'a', for: 'kids' } ] }
  check('x-one-or-list: to: youtube остаётся строкой, не списком', one, (({ version, ...r }) => r)(build(FIXTURE, clone(one)).get()))
  check('x-one-or-list: список из двух остаётся списком', [ 'a', 'b' ], build(FIXTURE, { rules: [ { to: [ 'a', 'b' ], out: 'a' } ] }).get().rules[0].to)
  // x-ref: имена из спеки и слова also
  const s2 = { outputs: { a: { kind: 'direct' }, b: { kind: 'block' } }, lists: { l: {} }, clients: { c: {} }, dns: { upstreams: { u: { url: 'udp://1.1.1.1' } } }, rules: [ { to: 'l', out: 'a' } ] }
  f = build(FIXTURE, s2)
  const ch = (p) => Object.keys(f.fields.find((x) => x.path === p).field.widget.choices || {}).filter(Boolean)
  check('x-ref outputs: выбор из выходов спеки', [ 'a', 'b' ], ch('rules.[].out'))
  check('x-ref lists + also: all и имена списков', [ 'all', 'l' ], ch('rules.[].to'))
  check('x-ref clients + also: lan и имена клиентов', [ 'lan', 'c' ], ch('rules.[].for'))
  check('x-ref dns.upstreams: имена серверов', [ 'u' ], ch('dns.upstream'))
  check('x-ref с also у выхода сервера DNS: direct и выходы', [ 'direct', 'a', 'b' ], ch('dns.upstreams.*.@server.out'))
  check('usedBy: выход, названный правилом', [ 'rules[0].out' ], autoform.usedBy({ spec: s2, schemaRoot: FIXTURE }, 'outputs', 'a'))
  check('usedBy: kind: direct и on_fail: direct не ссылки', [], autoform.usedBy({ schemaRoot: FIXTURE, spec: { outputs: { direct: { kind: 'direct' }, x: { kind: 'group', members: [ 'q' ], on_fail: 'direct' } } } }, 'outputs', 'direct'))
  check('usedBy: members группы и out сервера DNS — ссылки', [ 'outputs.g.members[0]', 'dns.upstreams.u.out' ].sort(), autoform.usedBy({ schemaRoot: FIXTURE, spec: { outputs: { w: { kind: 'direct' }, g: { kind: 'group', members: [ 'w' ] } }, dns: { upstreams: { u: { url: 'udp://1.1.1.1', out: 'w' } } } } }, 'outputs', 'w').sort())
  check('usedBy: сервер DNS под ссылкой правила (строка и имя в группе)', [ 'dns.upstreams.g.servers[0]', 'rules[0].dns' ], autoform.usedBy({ schemaRoot: FIXTURE, spec: { dns: { upstreams: { u: { url: 'udp://1.1.1.1' }, g: { servers: [ 'u' ] } } }, rules: [ { to: 'a', out: 'b', dns: 'u' } ] } }, 'dns.upstreams', 'u'))
}

// ---- 4. варианты -----------------------------------------------------------------------------
{
  const fld = (f, path) => f.fields.filter((y) => y.path === path).pop()?.field
  const shown = (f, path) => { const x = fld(f, path); return !!x && x.el.shown !== false && !x.hidden }
  const choices = (f, path) => Object.entries(fld(f, path).widget.choices)
  // выбор вида: kind, затем protocol у туннеля; ключи чужих видов не показываются
  let f = build(EXT, { outputs: { t: { kind: 'tunnel', protocol: 'vless', subscription: 's' } } })
  check('вид tunnel: после kind выбирается protocol', true, !!fld(f, 'outputs.*.protocol') && fld(f, 'outputs.*.protocol').get() === 'vless')
  check('вид tunnel:vless: ключи варианта показаны', [ true, true ], [ shown(f, 'outputs.*.@tunnel:vless.transport'), shown(f, 'outputs.*.@tunnel:vless.subscription') ])
  check('вид tunnel:vless: x-when transport -> path скрыт при tcp', false, shown(f, 'outputs.*.@tunnel:vless.path'))
  check('вид tunnel:vless: ключи группы и интерфейса не строятся', [ false, false ], [ !!fld(f, 'outputs.*.@group.members'), !!fld(f, 'outputs.*.@interface.device') ])
  check('вид tunnel:vless: пишется kind и protocol и ключи варианта', { t: { kind: 'tunnel', protocol: 'vless', subscription: 's' } }, f.get().outputs)
  // смена вида человеком: ключи нового вида появляются, прежнего — скрыты, общие значения переходят
  f = build(FIXTURE, { outputs: { a: { kind: 'group', members: [ 'x' ], on_fail: 'direct' } } })
  fld(f, 'outputs.*.kind').widget.type('block')
  check('смена вида group -> block: ключи block показаны, members скрыт', [ true, false ], [ shown(f, 'outputs.*.@block.on_fail'), shown(f, 'outputs.*.@group.members') ])
  check('смена вида: общий on_fail перешёл, ключи группы не пишутся', { a: { kind: 'block', on_fail: 'direct' } }, f.get().outputs)
  fld(f, 'outputs.*.kind').widget.type('interface')
  check('смена вида на interface: обязательный device — ошибка', true, f.validate().some((e) => e.path === 'outputs.*.@interface.device'))
  // новый выход начинается с ключей первого доступного вида
  f = build(FIXTURE, {})
  const outs = fld(f, 'outputs')
  outs.nameInput.setValue('n1'); outs.addButton.listeners.click[0]({ preventDefault() {} })
  check('карта: новый выход — kind первого доступного вида', { n1: { kind: 'direct' } }, f.get().outputs)
  // вид, которого нет: показан с причиной, не спрятан
  f = build(FIXTURE, { outputs: { t: { kind: 'tunnel', protocol: 'vless', subscription: 's1', transport: 'ws' } } })
  const pc = choices(f, 'outputs.*.protocol')
  check('x-absent: протокол vless в списке и помечен', true, pc.some(([v, l]) => v === 'vless' && /not available/.test(l)))
  check('x-absent: все протоколы tunnel в списке', [ 'vless', 'hysteria2', 'trojan', 'shadowsocks', 'socks', 'http', 'vmess' ], pc.map(([v]) => v))
  const entry = f.fields.find((x) => x.path === 'outputs.*' && x.field.absentReason).field
  check('x-absent: причина из схемы показана на форме', true, entry.el.textContent.includes('steer-vless'))
  check('x-absent: показ причины не прячет селекторы', true, shown(f, 'outputs.*.protocol') && shown(f, 'outputs.*.kind'))
  check('x-absent: ключи записи не теряются (форма не может их нарисовать)', { t: { kind: 'tunnel', protocol: 'vless', subscription: 's1', transport: 'ws' } }, f.get().outputs)
  check('x-absent: проверка отказывает с причиной', true, f.validate().some((e) => /steer-vless/.test(e.message)))
  f = build(FIXTURE, { outputs: { x: { kind: 'xsteer' } } })
  check('x-absent у вида без протокола: вид помечен в списке kind', true, choices(f, 'outputs.*.kind').some(([v, l]) => v === 'xsteer' && /not available/.test(l)))
  f = build(FIXTURE, { outputs: { a: { kind: 'direct' } } })
  fld(f, 'outputs.*.kind').widget.type('xsteer')
  check('x-absent: выбор недоступного вида показывает причину', true, f.fields.find((x) => x.path === 'outputs.*').field.absentReason.includes('steer-xsteer'))
  fld(f, 'outputs.*.kind').widget.type('block')
  check('x-absent: другой вид — причина убрана', null, f.fields.find((x) => x.path === 'outputs.*').field.absentReason)
  // вид плагина помечен плагином
  f = build(EXT, { outputs: { a: { kind: 'direct' } } })
  const kc = choices(f, 'outputs.*.kind')
  check('вид плагина: warp помечен плагином warpbox, vendor — acme', [ true, true ], [ kc.some(([v, l]) => v === 'warp' && /plugin warpbox/.test(l)), kc.some(([v, l]) => v === 'vendor' && /plugin acme/.test(l)) ])
  check('вид плагина: вид ядра не помечен', true, kc.some(([v, l]) => v === 'block' && l === 'block'))
  f = build(EXT, { outputs: { a: { kind: 'vendor', token: 't' } } })
  check('вид плагина: x-secret у ключа плагина — поле пароля', true, fld(f, 'outputs.*.@vendor.token').widget.options.password)
  check('вид плагина: ключ с x-plugin подписан плагином', true, fld(f, 'outputs.*.@vendor.token').el.textContent.includes('acme'))
  check('вид плагина: x-path conf — подсказка про каталог настроек', true, fld(f, 'outputs.*.@vendor.conf').el.textContent.includes('settings directory'))
  check('вид плагина: x-ref в ключе плагина — выбор среди выходов и direct', [ 'direct', 'a' ], Object.keys(fld(f, 'outputs.*.@vendor.via').widget.choices).filter(Boolean))
  check('вид плагина: запись пишется и читается', { a: { kind: 'vendor', token: 't' } }, f.get().outputs)
  check('вид плагина без плагина (неизвестный kind): вид остаётся, ключи целы', { z: { kind: 'zzz', secret_key: 'abc' } }, build(FIXTURE, { outputs: { z: { kind: 'zzz', secret_key: 'abc' } } }).get().outputs)
  f = build(FIXTURE, { outputs: { z: { kind: 'zzz' } } })
  check('неизвестный вид выхода остаётся в списке видов, а не заменяется первым', 'zzz', fld(f, 'outputs.*.kind').get())
  // DNS: вариант по наличию servers
  f = build(FIXTURE, { dns: { upstreams: { s: { url: 'tls://x' }, g: { servers: [ 's' ], mode: 'race' } } } })
  const ents = fld(f, 'dns.upstreams').entries
  check('dns: запись с servers — группа, без — сервер', [ 'server', 'group' ], ents.map((e) => e.field.variant))
  check('dns: сервер и группа читаются без потерь', { s: { url: 'tls://x' }, g: { servers: [ 's' ], mode: 'race' } }, f.get().dns.upstreams)
  fld(f, 'dns.upstreams.*.@variant')
  const sel = ents[0].field.selectors.variant
  sel.widget.type('group')
  check('dns: смена сервера на группу прячет url и показывает servers', [ true, true ], [ ents[0].field.kids.filter((k) => k.key === 'url')[0].field.hidden, !ents[0].field.kids.filter((k) => k.key === 'servers')[0].field.hidden ])
  check('dns: у новой группы без servers проверка отказывает', true, f.validate().some((e) => /servers/.test(e.path)))
  // dns правила: имя или запись
  const ru = { rules: [ { to: 'a', out: 'b', dns: 'u' }, { to: 'a', out: 'b', dns: { url: 'tls://x', fragment: true } } ] }
  check('rules[].dns: имя и запись читаются без потерь', ru.rules, build(FIXTURE, clone(ru)).get().rules)
  f = build(FIXTURE, { rules: [ { to: 'a', out: 'b' } ] })
  check('rules[].dns: пустой остаётся без ключа', { to: 'a', out: 'b' }, f.get().rules[0])
  // обязательные, границы, шаблоны
  f = build(FIXTURE, { outputs: { g: { kind: 'group' } } })
  check('валидация: у группы нужен members', true, f.validate().some((e) => e.path === 'outputs.*.@group.members'))
  f = build(EXT, { outputs: { t: { kind: 'tunnel', protocol: 'vless', subscription: 's', exclude: [ 'ru' ] } } })
  check('валидация: шаблон кода страны', true, f.validate().some((e) => e.path === 'outputs.*.@tunnel:vless.exclude'))
  f = build(FIXTURE, { dns: { cache: 1000000 } })
  check('валидация: число вне границ', true, f.validate().some((e) => e.path === 'dns.cache'))
  f = build(FIXTURE, { dns: { cache_ttl: { min: 5 } } })
  check('вложенный объект dns.cache_ttl: ключ и круг', { version: 2, dns: { cache_ttl: { min: 5 } } }, f.get())
  // неизвестное сохраняется
  const spec = { version: 2, future: { a: 1 }, outputs: { d: { kind: 'direct', extra: [ 1 ] } }, dns: { newkey: 1, cache: 5 } }
  f = build(FIXTURE, spec)
  check('неизвестные ключи записи и вложенного объекта сохраняются', { d: { kind: 'direct', extra: [ 1 ] } }, f.get().outputs)
  check('неизвестный ключ вложенного объекта (dns.newkey) сохраняется', { newkey: 1, cache: 5 }, f.get().dns)
  // секрет и путь (схема настроек плагина — тот же модуль)
  const sec = autoform.build({ type: 'object', properties: { token: { type: 'string', 'x-secret': true }, file: { type: 'string', 'x-path': 'conf' }, node: { type: 'string', 'x-ref': 'outputs' } } }, {}, { spec: { outputs: { q: {} } } })
  check('x-secret даёт поле пароля', true, sec.fields.find((x) => x.path === 'token').field.widget.options.password)
  check('x-path даёт подсказку про путь', true, sec.fields.find((x) => x.path === 'file').field.el.textContent.includes('settings directory'))
  check('x-ref строкой (схема плагина) — выбор среди выходов', [ 'q' ], Object.keys(sec.fields.find((x) => x.path === 'node').field.widget.choices).filter(Boolean))
}

// ---- 5. карты и списки: добавить, убрать, порядок, имена -------------------------------------
{
  const spec = { outputs: { a: { kind: 'direct' } }, rules: [ { name: 'r1', to: 'x', out: 'a' }, { name: 'r2', to: 'x', out: 'a' } ] }
  const notes = []
  const f = build(FIXTURE, spec, { notify: (s) => notes.push(s) })
  const outs = f.fields.find((x) => x.path === 'outputs').field
  outs.nameInput.setValue('b'); outs.addButton.listeners.click[0]({ preventDefault() {} })
  check('карта: добавленный выход попадает в значение', { kind: 'direct' }, f.get().outputs.b)
  outs.nameInput.setValue('b'); outs.addButton.listeners.click[0]({ preventDefault() {} })
  check('карта: повтор имени — отказ с сообщением', 1, notes.filter((n) => /already taken/.test(n)).length)
  outs.nameInput.setValue('bad name!'); outs.addButton.listeners.click[0]({ preventDefault() {} })
  check('карта: имя вне x-name.pattern — отказ', 1, notes.filter((n) => /may contain/.test(n)).length)
  outs.nameInput.setValue('x'.repeat(32)); outs.addButton.listeners.click[0]({ preventDefault() {} })
  check('карта: имя длиннее x-name.maxLength — отказ', 2, notes.filter((n) => /may contain/.test(n)).length)
  check('карта: предел длины имени берётся из схемы', 31, outs.nameInput.options.maxlength)
  const cl = build(FIXTURE, {}, { notify: (s) => notes.push(s) }).fields.find((x) => x.path === 'clients').field
  cl.nameInput.setValue('lan'); cl.addButton.listeners.click[0]({ preventDefault() {} })
  check('карта: имя из x-name.reserved (клиент lan) — отказ', 1, notes.filter((n) => /reserved/.test(n)).length)
  const rm = outs.entries[0].el.children[1].children[1].children[0]
  rm.listeners.click[0]({ preventDefault() {} })
  check('карта: выход под ссылкой правила не удаляется', true, notes.some((n) => /Cannot remove a/.test(n)) && 'a' in f.get().outputs)
  const rules = f.fields.find((x) => x.path === 'rules').field
  const down = rules.items[0].el.children[1].children[1].children[1]
  down.listeners.click[0]({ preventDefault() {} })
  check('список правил: «вниз» меняет порядок', [ 'r2', 'r1' ], f.get().rules.map((r) => r.name))
  const filt = build(FIXTURE, { outputs: { a: { kind: 'direct' }, g: { kind: 'group', members: [ 'a' ] } } },
    { mapOptions: { outputs: { filter: (n, v) => v.kind !== 'group' } } })
  check('карта с фильтром: скрытые записи остаются нетронутыми', { kind: 'group', members: [ 'a' ] }, filt.get().outputs.g)
  check('карта с фильтром: показаны только подходящие', [ 'a' ], filt.fields.find((x) => x.path === 'outputs').field.entries.map((e) => e.name))
  check('карта: сводка записи — имя и вид', 'a · direct', build(FIXTURE, { outputs: { a: { kind: 'direct' } } }).fields.find((x) => x.path === 'outputs').field.entries[0].el.children[0].textContent)
  check('карта: сводка туннеля — kind:protocol', 't · tunnel:vless', build(EXT, { outputs: { t: { kind: 'tunnel', protocol: 'vless', subscription: 's' } } }).fields.find((x) => x.path === 'outputs').field.entries[0].el.children[0].textContent)
}

// ---- 5b. вкладки каркаса по схеме ---------------------------------------------------------------
{
  const mk2 = (root) => { const l = makeLoader({ rpcCalls: [], rpcReplies: {} }); const st = l.load('view.splify2.core.store'); st.schema = root; return { st, sections: l.load('view.splify2.core.sections') } }
  let m = mk2(FIXTURE)
  check('вкладки: разделы схемы по порядку, без version и без settings', [ 'lan', 'clients', 'lists', 'outputs', 'dns', 'rules' ], m.sections.defs().map((d) => d.id))
  check('вкладки: «Other keys» нет, пока схема целиком покрыта', null, m.sections.otherDef())
  const future = clone(FIXTURE); future.properties.future = { type: 'object', properties: { a: { type: 'string' } } }
  m = mk2(future)
  check('вкладки: «Other keys» — только то, что ни одна вкладка не покрыла', [ 'future' ], m.sections.otherDef().keys)
  check('вкладки: форма «Other keys» рисует ключ нового ядра', true, !!build(m.sections.nodeOf(m.sections.otherDef()), { future: { a: 'x' } }).fields.find((x) => x.path === 'future.a'))
  const noLan = clone(FIXTURE); delete noLan.properties.lan
  check('вкладки: нет раздела в схеме — нет вкладки', [ 'clients', 'lists', 'outputs', 'dns', 'rules' ], mk2(noLan).sections.defs().map((d) => d.id))
  const html = readFileSync(resolve(CORE, 'main.js'), 'utf8')
  check('prefs каркаса (язык, главная страница) остаются отдельной вкладкой «Settings»', true, /id: 'settings'/.test(html))
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
  notes.length = 0
  const pl = L2.load('view.splify2.core.plugins').render(host)
  await tick(); await tick()
  check('старое ядро: плагины сказали, что нужно и что стоит', 'Plugins need steer 2.1 or newer. Installed: 2.0.5.', find(pl, (n) => n.attrs && n.attrs['class'] === 'alert-message warning').textContent)
  check('старое ядро: слов «нет такой команды» нет', false, /команды|steer help/.test(pl.textContent))
  check('старое ядро: отказ каталога не повторяет отказ списка вторым сообщением', [], notes.filter((n) => n.kind === 'danger'))
  click(find(pl, (n) => n.tag === 'button' && n.textContent === 'Update the core')); await tick()
  check('старое ядро: кнопка предлагает свежий выпуск (не предварительный)', 'Update steer to 2.1.0?', modals.at(-1).title)
  click(find(modals.at(-1).el, (n) => n.tag === 'button' && n.textContent === 'Update the core')); await tick()
  check('старое ядро: обновление зовёт steer_install с этой версией', [ '2.1.0' ], (rc.find((c) => c.method === 'steer_install') || { args: [] }).args.slice(0, 1))
  // Вкладка плагинов: название и описание на языке человека (names из plugins_list), иначе слова манифеста.
  rc.length = 0
  rr.plugins_list = { ok: true, host_api: '1.0.0', repos: [ { name: 'splify2', official: true } ],
    names: { backup: { name: 'Settings archive', description: 'Export the router settings to a file' } },
    plugins: [
      { id: 'backup', name: 'Архив настроек', description: 'Выгрузка настроек в файл', version: '1.0.0', state: 'enabled', repo: 'splify2' },
      { id: 'solo', name: 'Один', description: 'Слова манифеста', version: '1.0.0', state: 'enabled', repo: 'splify2' },
    ] }
  rr.plugins_search = { ok: true, plugins: [] }
  const pl2 = L2.load('view.splify2.core.plugins').render(host)
  await tick(); await tick()
  const row = (id) => find(pl2, (n) => n.attrs && n.attrs['data-plugin'] === id)
  check('плагины: язык человека уходит в plugins_list', true, rc.some((c) => c.method === 'plugins_list' && c.args[0] === 'en'))
  check('плагины: название и описание из словаря плагина', [ true, false ], [ /Settings archive/.test(row('backup').textContent) && /Export the router settings/.test(row('backup').textContent), /Архив/.test(row('backup').textContent) ])
  check('плагины: у плагина без словаря — слова манифеста', true, /Один/.test(row('solo').textContent) && /Слова манифеста/.test(row('solo').textContent))
  // Remove недоступна, пока от плагина зависят другие: причина названа (used_by ядра, иначе requires.plugins списка).
  rr.plugins_list = { ok: true, host_api: '1.0.0', repos: [], plugins: [
    { id: 'net1', version: '1.0.0', state: 'enabled', type: 'library', used_by: [ 'vless', 'hysteria2' ] },
    { id: 'vless', version: '1.0.0', state: 'enabled', used_by: [], requires: { plugins: { net1: '^1.0' } } },
    { id: 'lib2', version: '1.0.0', state: 'enabled' },
    { id: 'user2', version: '1.0.0', state: 'enabled', requires: { plugins: { lib2: '^1.0' } } },
  ] }
  const pl3 = L2.load('view.splify2.core.plugins').render(host)
  await tick(); await tick()
  const rm = (id) => find(row3(id), (n) => n.tag === 'button' && n.textContent === 'Remove')
  const row3 = (id) => find(pl3, (n) => n.attrs && n.attrs['data-plugin'] === id)
  const why = (id) => (find(row3(id), (n) => n.attrs && n.attrs['data-needed'] === id) || { textContent: '' }).textContent
  check('Remove: у net1 кнопка недоступна, причина названа', [ 'disabled', 'Required by: vless, hysteria2' ], [ rm('net1').attrs.disabled, why('net1') ])
  check('Remove: причина и в подсказке кнопки', 'Required by: vless, hysteria2', rm('net1').attrs.title)
  check('Remove: плагин, которого никто не требует, снимается', [ undefined, '' ], [ rm('vless').attrs.disabled, why('vless') ])
  check('Remove: used_by нет в ответе — зависимые считаются по requires.plugins списка', [ 'disabled', 'Required by: user2' ], [ rm('lib2').attrs.disabled, why('lib2') ])
  // запасная схема: одна строка на странице разделов
  check('запасная схема названа одной строкой', true, /follow the package/.test(readFileSync(resolve(CORE, 'sections.js'), 'utf8')))
}

// ---- 10. отзывчивость каркаса: параллельная загрузка, кэш схемы, вкладки не теряют правок, без двойной отправки ----
{
  const tick = () => new Promise((r) => setTimeout(r, 0))
  const find = (el, pred) => { let hit = null; el.walk((n) => { if (!hit && pred(n)) hit = n }); return hit }
  const click = (el) => el.listeners.click[0]({ preventDefault() {}, currentTarget: el })
  globalThis.window = { location: { hash: '#plugins', pathname: '/cgi-bin/luci/admin/services/splify2', search: '' } }
  globalThis.history = { replaceState(a, b, url) { window.location.hash = url.slice(url.indexOf('#')) } }
  // ответы, которые приходят, когда стенд скажет: так видно, что делается до их прихода
  const later = () => { let res; const p = new Promise((r) => { res = r }); return { p, res } }
  const schemaWait = later(), notes = []
  const ui3 = { ...ui, addNotification: (t, el, kind) => notes.push({ text: el.textContent, kind }), showModal() {}, hideModal() {} }
  const rc = [], rr = {
    prefs_get: { ok: true, lang: 'en', interface: 'basic' }, i18n_get: { ok: true, dicts: [] },
    spec_get: { version: 2, rev: 'r1', outputs: { direct: { kind: 'direct' } } },
    spec_schema: () => schemaWait.p,
    devices: { ok: true, devices: [] }, applied_get: { version: 2, rev: 'r1', outputs: { direct: { kind: 'direct' } } },
    plugins_list: { ok: true, repos: [ { name: 'splify2', official: true } ], plugins: [ { id: 'backup', version: '1.0.0', state: 'disabled', repo: 'splify2' } ] },
    plugins_search: { ok: true, plugins: [ { id: 'backup', version: '1.0.0', repo: 'splify2' } ] },
    plugin_enable: { ok: true },
    spec_set: { ok: true, rev: 'r2' },
    engine: { ok: true, present: true, running: true }, diag: { ok: true, checks: [] },
  }
  const L3 = makeLoader({ rpcCalls: rc, rpcReplies: rr, extra: { ui: ui3 } })
  const main = L3.load('view.splify2.core.main')
  const store = L3.load('view.splify2.core.store')
  const v = Object.create(main)
  await v.load()
  check('загрузка: словарь и спека спрашиваются сразу, не друг за другом', [ true, true ], [ rc.some((c) => c.method === 'spec_get'), rc.some((c) => c.method === 'spec_schema') ])
  const page = v.render()
  await tick(); await tick()
  const pane = page.children.at(-1)
  check('Plugins открыта, пока схема ядра ещё не пришла: список и каталог уже на экране', [ true, true ],
    [ !!find(pane, (n) => n.attrs && n.attrs['data-plugin'] === 'backup'), !!find(pane, (n) => n.attrs && n.attrs['data-catalog'] === 'backup') ])
  const listAt = rc.findIndex((c) => c.method === 'plugins_list'), catAt = rc.findIndex((c) => c.method === 'plugins_search')
  check('список плагинов и каталог спрошены вместе (каталог не ждёт ответа списка)', true, listAt >= 0 && catAt >= 0)
  check('prefs_get спрошен один раз (ссылка на Andromeda берёт ответ словаря)', 1, rc.filter((c) => c.method === 'prefs_get').length)
  const menu = page.children.at(-2)
  check('вкладок разделов нет, пока схемы нет', false, menu.children.some((li) => li.attrs['data-tab'] === 'outputs'))
  schemaWait.res({ ok: true, source: 'core', schema: FIXTURE })
  await tick(); await tick()
  check('схема пришла — вкладки разделов встали перед Spec', [ 'overview', 'lan', 'clients', 'lists', 'outputs', 'dns', 'rules', 'spec', 'plugins', 'settings' ].filter((x) => menu.children.some((li) => li.attrs['data-tab'] === x)),
    menu.children.map((li) => li.attrs['data-tab']))
  check('открытая вкладка Plugins не перерисована приходом схемы', true, !!find(pane, (n) => n.attrs && n.attrs['data-plugin'] === 'backup'))
  const tab = (id) => click(find(menu, (n) => n.tag === 'a' && n.attrs.href === '#' + id))
  // повторное открытие Plugins ничего не спрашивает заново
  const n0 = rc.filter((c) => c.method === 'plugins_list').length
  tab('settings'); await tick(); tab('plugins'); await tick()
  check('Plugins открыта второй раз: список и каталог не спрашиваются заново', n0, rc.filter((c) => c.method === 'plugins_list').length)
  // правка в разделе переживает переход на другую вкладку
  tab('outputs'); await tick()
  const outEl = pane.children[0]
  const form = outEl.splify2Form()
  const mf = form.field('outputs')
  mf.addNamed('vpn', { kind: 'direct' })
  mf.fire()
  tab('plugins'); await tick(); tab('outputs'); await tick()
  check('правка раздела не теряется при переходе на другую вкладку', true, 'vpn' in (pane.children[0].splify2Form().get().outputs || {}))
  // двойное нажатие Save: одна запись
  rc.length = 0
  const save = find(pane, (n) => n.tag === 'button' && n.textContent === 'Save')
  click(save); click(save)
  check('Save нажата дважды подряд: spec_set ушёл один раз', 1, rc.filter((c) => c.method === 'spec_set').length)
  check('пока запись идёт, кнопка недоступна', 'disabled', save.attrs.disabled)
  await tick(); await tick()
  check('запись закончилась — кнопка снова доступна', undefined, save.attrs.disabled)
  // схема ядра: одна на страницу; плагин включён — спрашивается снова
  const sc = () => rc.filter((c) => c.method === 'spec_schema').length
  rc.length = 0
  await store.load()
  check('store.load второй раз: схема ядра не спрашивается снова', 0, sc())
  tab('plugins'); await tick()
  const en = find(pane, (n) => n.tag === 'button' && n.textContent === 'Enable')
  click(en); click(en); await tick(); await tick()
  check('Enable нажата дважды: plugin_enable ушёл один раз', 1, rc.filter((c) => c.method === 'plugin_enable').length)
  check('после действия с плагином каталог не спрашивается заново, список — да', [ 0, 1 ], [ rc.filter((c) => c.method === 'plugins_search').length, rc.filter((c) => c.method === 'plugins_list').length ])
  tab('rules'); await tick(); await tick(); await tick()
  check('плагин включён — при открытии формы схема ядра спрошена заново', 1, sc())
  check('правленая вкладка outputs сохранила форму после смены схемы', true, !!find(menu, (n) => n.attrs && n.attrs['data-tab'] === 'outputs'))
  // большая спека: правка одного правила не перечитывает остальные
  const N = 400
  const rules = Array.from({ length: N }, (_, i) => ({ name: 'r' + i, domain: [ 'd' + i + '.example' ], out: 'direct' }))
  const rf = build(FIXTURE, { version: 2, outputs: { direct: { kind: 'direct' } }, rules }, {}).field('rules')
  let gets = 0
  rf.items.forEach((it) => { const g = it.field.get; it.field.get = function() { gets++; return g.apply(this, arguments) } })
  const leaf = rf.items[7].field.kids.find((k) => k.key === 'name').field
  const t0 = performance.now()
  for (let i = 0; i < 20; i++) { leaf.widget ? leaf.widget.type('x' + i) : leaf.fire() }
  const dt = (performance.now() - t0) / 20
  check('правка одного из ' + N + ' правил читает только его (а не все)', true, gets <= 20 * 2)
  console.log(`    замер: правка поля правила при ${N} правилах — ${dt.toFixed(2)} мс на нажатие, чтений правил: ${gets}`)
  check('номер и имя правки видны в заголовке правила', '#8 · x19', rf.items[7].sum.textContent)
  // ленивые правила (вкладки разделов): собираются при раскрытии, свёрнутые отдают данные как есть
  {
    const M = 1000
    const rl = Array.from({ length: M }, (_, i) => ({ name: 'r' + i, domain: [ 'd' + i + '.example' ], out: 'direct' }))
    const sp = { version: 2, outputs: { direct: { kind: 'direct' } }, rules: rl }
    const t0 = performance.now(); build(FIXTURE, sp, {}); const eager = performance.now() - t0
    const t1 = performance.now(); const lf = build(FIXTURE, sp, { lazy: true }); const lazy = performance.now() - t1
    console.log(`    замер: форма из ${M} правил — сразу все ${eager.toFixed(0)} мс, лениво ${lazy.toFixed(0)} мс`)
    const lr = lf.field('rules')
    check('ленивые правила: ни одно не собрано до раскрытия', 0, lr.items.filter((it) => it.built()).length)
    check('ленивые правила: заголовки из данных', '#3 · r2', lr.items[2].sum.textContent)
    check('ленивые правила: get свёрнутых — данные как пришли', rl, lf.get().rules)
    lr.items[5].el.dispatchEvent({ type: 'toggle' })
    check('раскрытие собирает только это правило', [ true, 1 ], [ lr.items[5].built(), lr.items.filter((it) => it.built()).length ])
    lr.addItem({}); 
    check('новое правило собрано сразу (оно раскрыто)', true, lr.items.at(-1).built())
    const bad = build(FIXTURE, { version: 2, outputs: { direct: { kind: 'direct' } }, rules: [ { name: 'ok', domain: [ 'a.b' ], out: 'direct' }, { name: 'bad', domain: [ 'a.b' ] } ] }, { lazy: true })
    const plain = build(FIXTURE, { version: 2, outputs: { direct: { kind: 'direct' } }, rules: [ { name: 'ok', domain: [ 'a.b' ], out: 'direct' }, { name: 'bad', domain: [ 'a.b' ] } ] }, {})
    check('проверка ловит ошибку в свёрнутом правиле так же, как в собранном', [ true, plain.validate().map((e) => e.title) ], [ bad.validate().length > 0, bad.validate().map((e) => e.title) ])
  }
}

console.log(`\n${total} проверок, провалов: ${fails}`)
process.exit(fails ? 1 : 0)
