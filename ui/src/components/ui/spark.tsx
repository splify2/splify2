import { type Point, peak, segments } from '@/lib/history'

import { S } from '@/copy'
/** Графики скорости: спарклайн у выхода и правила, суточный график на экране «Запросы».
 *
 *  Две линии — скачивание (цвет акцента) и отдача (приглушённая). Масштаб у каждого ряда свой:
 *  форма важнее абсолютных чисел, а числа стоят рядом. Нет двух точек или трафика ни в одной —
 *  нет и элемента: прямая линия из одной точки была бы неправдой. Там, где замеров не было
 *  (страница закрыта), линия рвётся. Цвета — токены панели. */

function paths(points: readonly Point[], gapMs: number, w: number, h: number, t0: number, span: number, max: number, pick: (p: Point) => number) {
    return segments(points, gapMs).filter((s) => s.length > 1).map((s) =>
        s.map((p) => `${(((p.t - t0) / span) * (w - 2) + 1).toFixed(1)},${(h - 1 - (pick(p) / max) * (h - 2)).toFixed(1)}`).join(' '))
}

export function Spark({ points, width = 72, height = 18, label }: { points: readonly Point[]; width?: number; height?: number; label?: string }) {
    if (points.length < 2) return null
    const max = peak(points)
    if (!(max > 0)) return null
    const t0 = points[0].t
    const span = Math.max(1, points[points.length - 1].t - t0)
    /* Дыра — вдвое дольше обычного шага опроса и больше: при пяти секундах это пятнадцать. */
    const gap = 15_000
    return (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label ?? S.stats.sparkMetka} className="shrink-0">
            {paths(points, gap, width, height, t0, span, max, (p) => p.up).map((d, i) => (
                <polyline key={'u' + i} points={d} fill="none" stroke="var(--sp-muted-foreground)" strokeWidth="1" strokeLinejoin="round" opacity="0.7" />
            ))}
            {paths(points, gap, width, height, t0, span, max, (p) => p.down).map((d, i) => (
                <polyline key={'d' + i} points={d} fill="none" stroke="var(--sp-primary)" strokeWidth="1.5" strokeLinejoin="round" />
            ))}
        </svg>
    )
}

/** Суточный график: ось — последние 24 часа до `now`, высота — до пика ряда (он подписан). */
export function DayChart({ points, now, dayMs, binMs, peakText, label }: {
    points: readonly Point[]; now: number; dayMs: number; binMs: number; peakText: (max: number) => string; label: string
}) {
    const W = 600
    const H = 64
    const max = peak(points)
    const t0 = now - dayMs
    const down = paths(points, binMs * 3, W, H, t0, dayMs, max || 1, (p) => p.down)
    const up = paths(points, binMs * 3, W, H, t0, dayMs, max || 1, (p) => p.up)
    return (
        <div className="space-y-1">
            <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className="h-16 w-full rounded-md bg-muted/40">
                {up.map((d, i) => <polyline key={'u' + i} points={d} fill="none" stroke="var(--sp-muted-foreground)" strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.7" />)}
                {down.map((d, i) => <polyline key={'d' + i} points={d} fill="none" stroke="var(--sp-primary)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />)}
            </svg>
            <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>{S.stats.sutokNazad}</span>
                <span>{max > 0 ? peakText(max) : S.stats.trafikaNe}</span>
                <span>{S.stats.seychas}</span>
            </div>
        </div>
    )
}
