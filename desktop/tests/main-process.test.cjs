'use strict'
// Стенд главного процесса приложения: размер окна, адрес для SSH, тексты отказов подключения,
// память роутеров. Запуск: npm test (node --test).
require('./electron-stub.cjs')
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { windowSize, BASE_W, BASE_H } = require('../electron/backend/windowsize.cjs')
const { hostOf } = require('../electron/backend/setup.cjs')
const { networkError, retryText } = require('../electron/router.cjs')
const { Memory } = require('../electron/backend/memory.cjs')
const { Routers } = require('../electron/routers.cjs')
const { BASE_ZOOM } = require('../electron/backend/settings.cjs')

const LG = 1024

test('окно: на любом масштабе страница не уже lg, если экран позволяет', () => {
    for (const zoom of [80, 90, 100, 110, 125, 150]) {
        const f = (zoom / 100) * BASE_ZOOM
        const [w] = windowSize(f, 1920, 1080)
        assert.ok(w / f >= LG, `zoom ${zoom}: ширина страницы ${Math.round(w / f)} px < ${LG}`)
    }
})

test('окно: обычный масштаб — прежние 1120×740', () => {
    assert.deepEqual(windowSize(BASE_ZOOM, 1920, 1080), [BASE_W, BASE_H])
})

test('окно: не больше 85 % маленького экрана, выросшее ради рельса — не больше 95 %', () => {
    assert.deepEqual(windowSize(BASE_ZOOM, 1280, 720), [1088, 612])
    const [w] = windowSize(1.35, 1366, 768)
    assert.equal(w, Math.round(1366 * 0.95))
})

test('SSH: адрес без порта, с портом, URL и IPv6', () => {
    assert.equal(hostOf('192.168.1.1'), '192.168.1.1')
    assert.equal(hostOf('192.168.1.1:8080'), '192.168.1.1')
    assert.equal(hostOf('http://router.lan:8080'), 'router.lan')
    assert.equal(hostOf('https://[fd00::1]:443'), 'fd00::1')
    assert.equal(hostOf('[fd00::1]:80'), 'fd00::1')
    assert.equal(hostOf('fd00::1'), 'fd00::1')
})

test('отказ подключения: причина словами, код остаётся network', () => {
    const e1 = networkError({ cause: { code: 'ENOTFOUND' } })
    assert.equal(e1.code, 'network')
    assert.match(e1.message, /не найден/)
    assert.match(networkError({ cause: { errors: [{ code: 'ECONNREFUSED' }] } }).message, /не принимает/)
    assert.match(networkError({ cause: { message: 'unexpected redirect' } }).message, /перенаправляет/)
    assert.match(networkError({ cause: { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' } }).message, /Сертификат/)
    assert.equal(networkError(new TypeError('fetch failed')).message, 'Роутер не отвечает')
})

test('слишком много паролей: сколько ждать', () => {
    assert.equal(retryText(45), ' Подождите 45 с.')
    assert.equal(retryText(600), ' Подождите 10 мин.')
    assert.equal(retryText(undefined), '')
    assert.equal(retryText(NaN), '')
})

test('память: забыть роутер по его адресу не трогает открытый', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mem-'))
    const m = new Memory(dir)
    m.use('http://a')
    m.set('spec', { a: 1 })
    m.flush()
    m.use('http://b')
    m.set('spec', { b: 1 })
    m.flush()
    m.forget('http://a')
    assert.deepEqual(m.all(), { spec: { b: 1 } })
    m.use('http://a')
    assert.deepEqual(m.all(), {})
    m.use('http://b')
    assert.deepEqual(m.all(), { spec: { b: 1 } })
})

test('роутеры: к «removed» роутер уже забыл адрес — главный процесс берёт его заранее', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'))
    const seed = (id, base) => fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({
        base, hostname: id, device: { id, name: id }, refresh: { plain: 'sr_x' }, access: null, accessExp: 0,
    }))
    seed('a', 'http://a:1')
    seed('b', 'http://b:1')
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify({ active: 'a', order: ['a', 'b'] }))
    const rs = new Routers(dir)
    const seen = []
    rs.on('removed', (id, r) => seen.push([id, r.state.base]))
    rs.list.get('b').forget()
    rs.list.get('b').emit('changed')
    assert.deepEqual(seen, [['b', null]])
    assert.equal(rs.activeId, 'a')
    assert.equal(rs.state.base, 'http://a:1')
})
