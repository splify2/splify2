// Заглушки LuCI для стенда каркаса: загрузчик модулей `'require …'` и минимальный DOM.
// Модули каркаса — настоящие файлы luci/htdocs/…/view/splify2/core/*.js, они исполняются как есть.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ROOT = resolve(HERE, '../..')
export const RES = resolve(ROOT, 'luci/htdocs/luci-static/resources')

// ---- DOM -----------------------------------------------------------------------------------
export class El {
  constructor(tag, attrs, kids) {
    this.tag = tag
    this.attrs = {}
    this.children = []
    this.style = {}
    this.parentNode = null
    this.listeners = {}
    this._text = ''
    for (const [k, v] of Object.entries(attrs || {})) {
      if (typeof v === 'function') this.addEventListener(k, v)
      else this.attrs[k] = v
    }
    this.append(kids)
  }
  append(kids) {
    if (kids == null || kids === false || kids === '') return
    if (Array.isArray(kids)) { kids.forEach((k) => this.append(k)); return }
    if (typeof kids === 'string' || typeof kids === 'number') { const t = new El('#text'); t._text = String(kids); this.appendChild(t); return }
    this.appendChild(kids)
  }
  appendChild(c) { c.parentNode = this; this.children.push(c); return c }
  removeChild(c) { this.children = this.children.filter((x) => x !== c); c.parentNode = null; return c }
  insertBefore(c, ref) {
    if (c.parentNode) c.parentNode.removeChild(c)
    const i = ref ? this.children.indexOf(ref) : -1
    c.parentNode = this
    if (i < 0) this.children.push(c); else this.children.splice(i, 0, c)
    return c
  }
  remove() { if (this.parentNode) this.parentNode.removeChild(this) }
  setAttribute(k, v) { this.attrs[k] = v }
  getAttribute(k) { return this.attrs[k] }
  addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn) }
  dispatchEvent(ev) {
    for (let n = this; n; n = n.parentNode) {
      ;(n.listeners[ev.type] || []).forEach((fn) => fn(ev))
      if (!ev.bubbles) break
    }
  }
  get textContent() { return this._text || this.children.map((c) => c.textContent).join('') }
  set textContent(v) { this.children = []; this._text = String(v) }
  walk(fn) { fn(this); this.children.forEach((c) => c.walk(fn)) }
  // видна ли ветка: нет display:none у себя и предков
  get shown() { for (let n = this; n; n = n.parentNode) if (n.style && n.style.display === 'none') return false; return true }
}
export const E = (tag, attrs, kids) => {
  if (tag && typeof tag === 'object') return tag
  if (attrs && (Array.isArray(attrs) || typeof attrs === 'string' || attrs instanceof El)) return new El(tag, {}, attrs)
  return new El(tag, attrs, kids)
}

// ---- виджеты ui.* ------------------------------------------------------------------------
class Widget {
  constructor(value, a, b) {
    this.kind = this.constructor.name
    this.value = value
    this.args = [a, b]
  }
  render() {
    this.node = new El('div', { 'data-widget': this.kind })
    this.node.widget = this
    return this.node
  }
  getValue() { return this.value }
  setValue(v) { this.value = v }
  // человек поменял значение
  type(v) {
    this.value = v
    this.node.dispatchEvent({ type: 'widget-change', bubbles: true })
  }
}
export class Textfield extends Widget { constructor(v, o) { super(v, o); this.options = o || {} } }
export class Select extends Widget { constructor(v, c, o) { super(v, c, o); this.choices = c; this.options = o || {} } }
export class Combobox extends Select {}
export class Checkbox extends Widget { constructor(v, o) { super(v, o); this.options = o || {} } }
export class DynamicList extends Widget { constructor(v, c, o) { super(Array.isArray(v) ? v.slice() : [], c, o); this.choices = c; this.options = o || {} } }
export class Dropdown extends Widget { constructor(v, c, o) { super(Array.isArray(v) ? v.slice() : [], c, o); this.choices = c; this.options = o || {} } }
export const ui = { Textfield, Select, Combobox, Checkbox, DynamicList, Dropdown, addNotification() {}, showModal() {}, hideModal() {} }

// ---- загрузчик модулей --------------------------------------------------------------------
export const baseclass = {
  extend: (o) => o,
  singleton: (o) => o,
}
export const view = { extend: (o) => o }

export function makeLoader({ rpcCalls, rpcReplies, extra = {} } = {}) {
  const cache = {}
  const rpc = {
    declare(spec) {
      return (...args) => {
        rpcCalls && rpcCalls.push({ method: spec.method, params: spec.params, args })
        const r = rpcReplies && rpcReplies[spec.method]
        return Promise.resolve(typeof r === 'function' ? r(...args) : r)
      }
    },
  }
  const stubs = { baseclass, ui, rpc, view, ...extra }
  const L = { resource: (p) => '/luci-static/resources/' + p, env: {}, require: (n) => Promise.resolve(load(n)) }
  function load(name) {
    if (name in stubs) return stubs[name]
    if (name in cache) return cache[name]
    const file = resolve(RES, name.split('.').join('/') + '.js')
    const src = readFileSync(file, 'utf8')
    const reqs = [...src.matchAll(/^'require ([A-Za-z0-9_.]+)(?: as ([A-Za-z0-9_]+))?';/gm)]
    const names = reqs.map((m) => m[2] || m[1].split('.').pop())
    const mods = reqs.map((m) => load(m[1]))
    const fn = new Function(...names, 'L', 'E', '_', src)
    return (cache[name] = fn(...mods, L, E, (s) => s))
  }
  return { load, L }
}
