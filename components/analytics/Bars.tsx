import React from "react";
import type { CSSProperties } from "react";
import { useWidth, useHover, toneColor, nf, FONT, niceCeil, axisWidth, labelStep, showLabel, niceTickCount, pathOf, Tooltip } from "./chart-core";
import type { SeriesTone, TipRow } from "./chart-core";

export interface BarSeries {
  /** Имя ряда — в подсказке по наведению. */
  label?: string;
  values: Array<number | null>;
  /** accent — главный ряд, off — второстепенный, soft — заливка ожидания. */
  tone?: SeriesTone;
  /** Плотность заливки: half — незавершённая часть (идущий час), ghost — ожидание пунктирным контуром.
   *  Один показатель в трёх состояниях — один цвет, различает их плотность. */
  fill?: "solid" | "half" | "ghost";
  /** В стопке — рисовать этот ряд отдельным столбцом рядом со стопкой (эталон рядом с фактом). */
  beside?: boolean;
}

export interface BarLine {
  label?: string;
  values: Array<number | null>;
  tone?: SeriesTone;
  dashed?: boolean;
  width?: number;
  /** Точки на значениях. */
  points?: boolean;
}

/**
 * Столбцы по категориям (дни, часы, месяцы). Группами или стопкой, с линиями того же
 * масштаба поверх. Одна ось; значения подписаны прямо на столбцах, когда их не больше 14,
 * иначе — ось слева и подсказка по наведению.
 */
export interface BarsProps {
  series?: BarSeries[];
  labels?: string[];
  stacked?: boolean;
  height?: number;
  /** auto — подписи значений при ≤14 категориях; all / none — принудительно. */
  valueLabels?: "auto" | "all" | "none";
  /** Какой ряд подписывать (индекс в `series`); по умолчанию — итог стопки или максимум группы. */
  labelSeries?: number;
  format?: (v: number) => string;
  /** Формат чисел в подсказке (по умолчанию — `format`). */
  tipFormat?: (v: number) => string;
  /** Ось Y слева: auto — когда подписи значений не показаны. */
  axis?: "auto" | "show" | "hide";
  /** Пунктирный контур ожидания за каждым столбцом (например, «обычный такой день»). */
  ghost?: Array<number | null> | null;
  ghostLabel?: string;
  /** Горизонтальный уровень чернилами: план, цель. */
  reference?: number | null;
  referenceLabel?: string;
  /** Линии того же масштаба поверх столбцов: эталон, прогноз источника. */
  lines?: BarLine[];
  /** Индексы категорий с подложкой: выходные. */
  bands?: number[];
  /** Итоговая строка в подсказке у стопки. */
  totalLabel?: string;
  tooltip?: boolean;
  style?: CSSProperties;
}

export function Bars({ series = [], labels = [], stacked = false, height = 180, valueLabels = "auto", labelSeries, format = nf, tipFormat, axis = "auto", ghost = null, ghostLabel = "ожидание", reference = null, referenceLabel, lines = [], bands = [], totalLabel = "итого", tooltip = true, style }: BarsProps) {
  const [ref, width] = useWidth();
  const n = labels.length;
  const stackSeries = stacked ? series.filter((s) => !s.beside) : [];
  const groupSeries = stacked ? series.filter((s) => s.beside) : series;
  const totals = labels.map((_, i) => {
    const st = stackSeries.reduce((a, s) => a + (s.values[i] || 0), 0);
    return Math.max(st, ...groupSeries.map((s) => s.values[i] || 0), 0);
  });
  const lineMax = Math.max(0, ...lines.flatMap((l) => l.values.filter((v): v is number => v != null)));
  const ghostMax = ghost ? Math.max(0, ...ghost.filter((g): g is number => g != null)) : 0;
  const showLabels = valueLabels === "all" || (valueLabels === "auto" && n <= 14);
  const showAxis = axis === "show" || (axis === "auto" && !showLabels);
  const top = niceCeil(Math.max(...totals, ghostMax, lineMax, reference || 0));
  const nT = niceTickCount(top, 4);
  const ticks = Array.from({ length: nT + 1 }).map((_, k) => (top * k) / nT);
  const padL = showAxis ? axisWidth(ticks, format) : 4, padR = 4, padT = 18, padB = 22;
  const innerW = Math.max(10, width - padL - padR), innerH = height - padT - padB;
  const slot = innerW / Math.max(n, 1);
  const groupW = slot * 0.72;
  const hasStack = stacked && stackSeries.length > 0;
  const columns = (hasStack ? 1 : 0) + groupSeries.length;
  const barW = groupW / Math.max(columns, 1);
  const gap = columns > 1 ? 2 : 0;
  const y = (v: number) => padT + innerH - (v / top) * innerH;
  const xc = React.useCallback((i: number) => padL + slot * i + slot / 2, [padL, slot]);
  const step = labelStep(n, innerW, 40);
  const { idx, svgRef, onMove, onLeave } = useHover(n, xc);
  const tf = tipFormat || format;

  // Какой столбец подписывать и где: по умолчанию — итог стопки / максимум группы над группой.
  const labelAt = (i: number, gx: number): { v: number; x: number } | null => {
    if (labelSeries != null) {
      const s = series[labelSeries];
      const v = s?.values[i];
      if (s == null || v == null || v <= 0) return null;
      const inStack = hasStack && !s.beside;
      const c = inStack ? 0 : (hasStack ? 1 : 0) + groupSeries.indexOf(s);
      const stackTotal = inStack ? stackSeries.reduce((a, t) => a + (t.values[i] || 0), 0) : v;
      return { v: inStack ? stackTotal : v, x: gx + barW * c + (c > 0 ? gap : 0) + (barW - gap) / 2 };
    }
    return totals[i] > 0 ? { v: totals[i], x: gx + groupW / 2 } : null;
  };

  const tipRows: TipRow[] = [];
  if (idx != null) {
    for (const s of series) tipRows.push({ label: s.label || "", kind: "bar", tone: s.tone, fill: s.fill, value: s.values[idx] == null ? "" : tf(s.values[idx] as number) });
    if (stackSeries.length > 1) {
      const st = stackSeries.reduce((a, s) => a + (s.values[idx] || 0), 0);
      tipRows.push({ label: totalLabel, value: st > 0 ? tf(st) : "", total: true });
    }
    if (ghost && ghost[idx] != null) tipRows.push({ label: ghostLabel, kind: "bar", fill: "ghost", value: tf(ghost[idx] as number) });
    for (const l of lines) tipRows.push({ label: l.label || "", kind: "line", tone: l.tone, dashed: l.dashed, value: l.values[idx] == null ? "" : tf(l.values[idx] as number) });
  }

  const rectStyle = (i: number, x: number): CSSProperties => ({ transformOrigin: `${x}px ${padT + innerH}px`, animation: `an-bar-up 600ms var(--an-ease) ${Math.min(i, 30) * 25}ms both` });
  const barFill = (s: BarSeries) => toneColor(s.tone);
  const barOpacity = (s: BarSeries) => (s.fill === "half" ? 0.5 : s.fill === "ghost" ? 0.14 : 1);

  return (
    <div ref={ref} style={{ width: "100%", position: "relative", ...style }}>
    <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ display: "block", overflow: "visible", touchAction: "pan-y" }} role="img"
         onPointerMove={tooltip ? onMove : undefined} onPointerDown={tooltip ? onMove : undefined} onPointerLeave={tooltip ? onLeave : undefined}>
      {bands.map((i) => <rect key={`b${i}`} x={padL + slot * i} y={padT} width={slot} height={innerH} fill="var(--an-text)" opacity="0.04" />)}
      {idx != null && tooltip ? <rect x={padL + slot * idx} y={padT} width={slot} height={innerH} fill="var(--an-text)" opacity="0.05" /> : null}
      {ticks.map((v, k) => (
        <g key={k}>
          <line x1={padL} x2={width - padR} y1={y(v)} y2={y(v)} stroke="var(--an-border-soft)" strokeDasharray="3 3" />
          {showAxis ? <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--an-text-muted)" style={FONT}>{format(v)}</text> : null}
        </g>
      ))}
      {labels.map((lab, i) => {
        const gx = padL + slot * i + (slot - groupW) / 2;
        let acc = 0;
        const g = ghost ? ghost[i] : null;
        const lab2 = showLabels ? labelAt(i, gx) : null;
        return (
          <g key={i}>
            {g != null ? (
              <rect x={gx} y={y(g)} width={groupW} height={Math.max(0, innerH - (y(g) - padT))} rx="4" fill="none" stroke="var(--an-accent-line)" strokeDasharray="3 3" />
            ) : null}
            {hasStack ? stackSeries.map((s, k) => {
              const v = s.values[i] || 0;
              if (v <= 0) return null;
              const w = barW - gap;
              const yy = y(acc + v), h = Math.max(0, y(acc) - yy - (acc > 0 ? 1 : 0));
              acc += v;
              const isTop = !stackSeries.slice(k + 1).some((t) => (t.values[i] || 0) > 0);
              return <rect key={k} data-bar={s.label || k} x={gx} y={yy} width={w} height={h} rx={isTop ? 4 : 0}
                fill={barFill(s)} fillOpacity={barOpacity(s)}
                stroke={s.fill === "ghost" ? toneColor(s.tone) : undefined} strokeOpacity={0.6} strokeDasharray={s.fill === "ghost" ? "3 3" : undefined}
                style={rectStyle(i, gx)} />;
            }) : null}
            {groupSeries.map((s, k) => {
              const v = s.values[i] || 0;
              if (v <= 0) return null;
              const c = (hasStack ? 1 : 0) + k;
              const x = gx + barW * c + (c > 0 ? gap : 0);
              return <rect key={`g${k}`} data-bar={s.label || k} x={x} y={y(v)} width={barW - gap} height={Math.max(0, innerH - (y(v) - padT))} rx="4"
                fill={barFill(s)} fillOpacity={s.fill === "half" ? 0.5 : s.fill === "ghost" ? 0.3 : 1}
                stroke={s.fill === "ghost" ? toneColor(s.tone) : undefined} strokeOpacity={0.75}
                style={rectStyle(i, x)} />;
            })}
            {lab2 ? (
              <text x={lab2.x} y={y(labelSeries != null ? lab2.v : Math.max(totals[i], g || 0)) - 5} textAnchor="middle" fontSize="11" fill="var(--an-text-secondary)" style={FONT}>{format(lab2.v)}</text>
            ) : null}
            {showLabel(i, n, step) ? <text x={gx + groupW / 2} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--an-text-muted)" style={FONT}>{lab}</text> : null}
          </g>
        );
      })}
      {reference != null ? (
        <g>
          <line x1={padL} x2={width - padR} y1={y(reference)} y2={y(reference)} stroke="var(--an-text)" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" />
          {referenceLabel ? <text x={width - padR} y={y(reference) - 4} textAnchor="end" fontSize="10" fill="var(--an-text-secondary)" style={FONT}>{referenceLabel}</text> : null}
        </g>
      ) : null}
      {lines.map((l, k) => {
        const color = toneColor(l.tone);
        const pts = l.values.map((v, i) => (v == null ? null : [xc(i), y(v)] as [number, number]));
        return (
          <g key={`l${k}`}>
            <path d={pathOf(pts, true)} fill="none" stroke={color} strokeWidth={l.width || 1.8} strokeDasharray={l.dashed ? "5 4" : undefined} strokeLinejoin="round" strokeLinecap="round" />
            {l.points ? pts.map((p, i) => p ? <circle key={i} cx={p[0]} cy={p[1]} r="2.4" fill={color} /> : null) : null}
          </g>
        );
      })}
    </svg>
    {idx != null && tooltip ? <Tooltip title={labels[idx]} rows={tipRows} x={xc(idx)} width={width} top={padT} /> : null}
    </div>
  );
}
