import { describe, expect, it } from 'vitest'
import { groupFamilies, groupSites, parseEvents, parseMemory } from '../../desktop/renderer/recheck/state'

/* Память движка ReCheck (DPI7, src/state.c его репозитория): строка на адрес и строки «F» —
 * семейства. Числа выдуманы, раскладка полей — настоящая. */
const z18 = Array(18).fill(0).join(' ')
const MEMORY = [
    'DPI7 1791907160549',
    // разрез + ложный TLS, подтверждён; запасной рецепт пуст, исходов нет
    `1791907176030 1 4 6 443 1 0 203.0.113.7 video.example 7 2 0 1 0 0 0 2 1 1 1 0 ${z18} 1792511358309 0 0 0`,
    // тот же сайт другим адресом: ложный хост, пробно
    `0 0 4 6 443 1 0 203.0.113.8 video.example 4 1 3 1 1 1 0 ${z18} 1791982208630 1 1 0 1 0 0 0 1 4397617069901650606 1 1 1 7`,
    // QUIC: ложный QUIC
    `0 0 4 17 443 1 1 198.51.100.4 cdn.example 101 1 4 1 0 0 0 ${z18} 1791988762631 102 1 6 1 0 0 0 0`,
    // без обхода (адрес без имени)
    `0 0 4 17 3478 1 3 192.0.2.10 - 0 0 ${z18} 1791988000000 0 0 2 1 1 1 0 0 2 2 1 1 0`,
    'F 1792511358309 4 6 0 443 1 example 1 0 2 1 1 1 0 0 0 11509711593027232052',
    'F 1791910300523 4 6 5 443 1 chat.example 1 0 4 1 3 1 1 1 0 832778790066295428',
    'обрывок',
].join('\n')

describe('память ReCheck', () => {
    it('разбирает адреса и семейства', () => {
        const m = parseMemory(MEMORY)
        expect(m.saved).toBe(1791907160549)
        expect(m.sites).toHaveLength(4)
        expect(m.sites[0]).toMatchObject({ host: 'video.example', ip: '203.0.113.7', transport: 'TCP', confirmed: true, mods: ['Разрез', 'Ложный TLS'], until: 1792511358309 })
        expect(m.sites[2]).toMatchObject({ transport: 'QUIC', mods: ['Ложный QUIC'] })
        expect(m.sites[3]).toMatchObject({ host: '', transport: 'STUN', mods: [] })
        expect(m.families).toEqual([
            { suffix: 'example', transport: 'TCP', confirmed: true, mods: ['Перестановка'], members: 1, until: 1792511358309 },
            { suffix: 'chat.example', transport: 'TCP', confirmed: false, mods: ['Ложный хост'], members: 1, until: 1791910300523 },
        ])
    })

    it('не своё — пусто', () => {
        expect(parseMemory('DPI6 1\n1 2 3')).toEqual({ saved: 0, sites: [], families: [] })
    })

    it('сводит адреса одного сайта', () => {
        const rows = groupSites(parseMemory(MEMORY).sites)
        expect(rows[0]).toMatchObject({ host: 'video.example', ips: ['203.0.113.7', '203.0.113.8'], confirmed: true, mods: ['Разрез', 'Ложный TLS', 'Ложный хост'] })
        expect(rows[rows.length - 1].mods).toEqual([])
    })

    it('семейство одно: подтверждённое вместо пробного', () => {
        const f = groupFamilies([
            { suffix: 'example', transport: 'TCP', confirmed: false, mods: ['Разрез'], members: 1, until: 1 },
            { suffix: 'example', transport: 'TCP', confirmed: true, mods: ['Перестановка'], members: 2, until: 2 },
            { suffix: 'a.example', transport: 'TCP', confirmed: false, mods: ['Разрез'], members: 1, until: 1 },
        ])
        expect(f.map((x) => [x.suffix, x.confirmed])).toEqual([['example', true], ['a.example', false]])
    })

    it('события: новые первыми, повторы одной строкой, непереведённые скрыты', () => {
        const ev = parseEvents([
            '15:58:47 event=direct-failed ms=1 host=video.example ip=203.0.113.7 port=443 recipe=0',
            '15:58:48 event=probe-start ms=2 host=video.example ip=203.0.113.7 port=443 recipe=1',
            '15:58:48 event=probe-start ms=2 host=video.example ip=203.0.113.7 port=443 recipe=2',
            '15:58:49 event=tls-family-evidence ms=3 host=video.example ip=203.0.113.7 port=443 recipe=2',
            '15:58:50 event=switch-provisional ms=4 host=video.example ip=203.0.113.7 port=443 recipe=2',
        ].join('\n'))
        expect(ev.map((e) => [e.time, e.text, e.times])).toEqual([
            ['15:58:50', 'обход найден', 1],
            ['15:58:48', 'подбор обхода', 2],
            ['15:58:47', 'напрямую не открывается', 1],
        ])
    })
})
