import { describe, expect, it } from 'vitest'
import { BIN_MS, DAY_MS, FINE_MS, History, peak, segments } from '@/lib/history'

// История скорости: два разрешения, оба ограничены временем; дыры остаются дырами.

describe('история скорости', () => {
    it('мелкий ряд держит десять минут, крупный — сутки с шагом в минуту (среднее по замерам)', () => {
        const h = new History()
        const t0 = 1_800_000_000_000
        for (let i = 0; i < 4; i++) h.push(t0 + i * 5000, 'ch:a', 100 * (i + 1), 0)
        // Четыре замера одной минуты — одна крупная точка, среднее 250.
        const day = h.daySeries('ch:a')
        expect(day).toHaveLength(1)
        expect(day[0].up).toBe(250)
        // Через 11 минут первые замеры ушли из мелкого ряда, но не из суточного.
        h.push(t0 + FINE_MS + 60_000, 'ch:a', 7, 0)
        expect(h.series('ch:a').map((p) => p.up)).toEqual([7])
        expect(h.daySeries('ch:a').length).toBe(2)
        // Через сутки уходят и они.
        h.push(t0 + 2 * DAY_MS, 'ch:a', 9, 0)
        expect(h.daySeries('ch:a').map((p) => p.up)).toEqual([9])
    })

    it('ряды устройств одного выхода суммируются по моменту', () => {
        const h = new History()
        h.push(1000, 'dev:a', 1, 10)
        h.push(1000, 'dev:b', 2, 20)
        h.push(6000, 'dev:a', 3, 30)
        expect(h.series('dev:a', 'dev:b')).toEqual([{ t: 1000, up: 3, down: 30 }, { t: 6000, up: 3, down: 30 }])
        expect(h.series('dev:none')).toEqual([])
    })

    it('суточная история переживает перезагрузку страницы; старше суток отбрасывается', () => {
        const h = new History()
        const now = Date.now()
        h.push(now - 3 * BIN_MS, 'ch:a', 5, 6)
        const dump = { 'ch:a': h.daySeries('ch:a').map((p) => ({ ...p, n: 1 })), 'ch:old': [{ t: now - 2 * DAY_MS, up: 1, down: 1, n: 1 }] }
        const back = new History(dump)
        expect(back.daySeries('ch:a')).toHaveLength(1)
        expect(back.daySeries('ch:old')).toEqual([])
    })

    it('дыра в замерах рвёт линию, а не рисуется нулями', () => {
        const pts = [{ t: 0, up: 1, down: 1 }, { t: 5000, up: 1, down: 1 }, { t: 3_600_000, up: 1, down: 1 }, { t: 3_605_000, up: 1, down: 1 }]
        expect(segments(pts, 15_000)).toHaveLength(2)
        expect(peak(pts)).toBe(1)
    })

    it('ряд без замеров за сутки уходит при сохранении', () => {
        const h = new History()
        const now = Date.now()
        h.push(now - DAY_MS - 5 * BIN_MS, 'ch:gone', 1, 1)
        h.push(now, 'ch:kept', 1, 1)
        h.save(now)
        expect(h.keys()).toEqual(['ch:kept'])
    })
})
