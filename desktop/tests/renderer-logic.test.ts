// Стенд чистой логики окна: разбор ReCheck. Запуск: npm test (vitest из ../ui).
import { test } from 'vitest'
import assert from 'node:assert/strict'
import { groupSites, parseEvents, parseMemory } from '../renderer/recheck/state.ts'

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
