// Стенд чистой логики окна: раздел WarpBox и разбор ReCheck. Запуск: npm test (vitest из ../ui).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { countItems, freeName, infoErrorText, num, patchExtra, tunnelCount } from '../renderer/warpbox/model.ts'
import { groupSites, parseEvents, parseMemory } from '../renderer/recheck/state.ts'

const spec = (extra?: Record<string, unknown>) => ({
    channels: [],
    outputs: { warp: { name: 'warp', kind: 'warp', ...(extra ? { extra } : {}) } },
}) as never

test('WarpBox: число туннелей — 1 по умолчанию, строка из рукописной спеки читается', () => {
    assert.equal(tunnelCount(undefined), 1)
    assert.equal(tunnelCount(3), 3)
    assert.equal(tunnelCount('3'), 3)
    assert.equal(tunnelCount('x'), 1)
    assert.equal(tunnelCount(0), 1)
    assert.equal(tunnelCount(2.9), 2)
    assert.equal(num('', 7), 7)
})

test('WarpBox: правка одного ключа не стирает остальные, значение undefined убирает ключ', () => {
    const a = patchExtra(spec({ count: 3, pick: 'order', ipv6: 'off' }), 'warp', { count: undefined })!
    assert.deepEqual((a.outputs.warp as { extra: object }).extra, { pick: 'order', ipv6: 'off' })
    const b = patchExtra(a, 'warp', { transport: 'masque' })!
    assert.deepEqual((b.outputs.warp as { extra: object }).extra, { pick: 'order', ipv6: 'off', transport: 'masque' })
})

test('WarpBox: два правки подряд складываются, если вторая идёт от результата первой', () => {
    let s = spec()
    s = patchExtra(s, 'warp', { count: 4 })!
    s = patchExtra(s, 'warp', { countries: ['NL'] })!
    assert.deepEqual((s.outputs.warp as { extra: object }).extra, { count: 4, countries: ['NL'] })
})

test('WarpBox: удалённого выхода правка не воскрешает', () => {
    assert.equal(patchExtra(spec(), 'gone', { count: 2 }), null)
})

test('WarpBox: кнопки числа туннелей показывают и число больше пяти', () => {
    assert.deepEqual(countItems(3).map((i) => i.value), ['1', '2', '3', '4', '5'])
    assert.deepEqual(countItems(8).map((i) => i.value), ['1', '2', '3', '4', '5', '8'])
})

test('WarpBox: имя нового выхода — первое свободное', () => {
    assert.equal(freeName({}), 'warp')
    assert.equal(freeName({ warp: 1 }), 'warp2')
    assert.equal(freeName({ warp: 1, warp2: 1 }), 'warp3')
})

test('WarpBox: старый шлюз — понятный текст', () => {
    assert.match(infoErrorText({ code: 'no_route', message: 'Нет такого адреса' }), /обновите splify2/)
    assert.equal(infoErrorText({ code: 'network', message: 'Роутер не отвечает' }), 'Роутер не отвечает')
})

test('ReCheck: пустая и чужая память не ломают разбор', () => {
    assert.deepEqual(parseMemory(''), { saved: 0, sites: [], families: [] })
    assert.deepEqual(parseMemory('что-то другое\n1 2 3'), { saved: 0, sites: [], families: [] })
})

test('ReCheck: события — новые первыми, повторы подряд одной строкой', () => {
    const rows = parseEvents([
        '10:00:01 event=probe-start host=a.example ip=1.1.1.1 port=443',
        '10:00:02 event=probe-start host=a.example ip=1.1.1.1 port=443',
        '10:00:03 event=confirmed host=a.example ip=1.1.1.1 port=443',
        '10:00:04 event=неизвестное host=a.example ip=1.1.1.1 port=443',
    ].join('\n'))
    assert.equal(rows.length, 2)
    assert.equal(rows[0].text, 'обход подтверждён')
    assert.equal(rows[1].times, 2)
    assert.deepEqual(groupSites([]), [])
})
