import React from "react";
import type { CSSProperties } from "react";
import { useWidth, useHover, toneColor, nf, FONT, niceCeil, axisWidth, labelStep, showLabel, niceTickCount, pathOf, Tooltip } from "./chart-core";
import type { SeriesTone, TipRow } from "./chart-core";

export interface LineSeries {
  /** Имя ряда — в подсказке по наведению. */
  label?: string;
  values: Array<number | null>;
  tone?: SeriesTone;
  /** Пунктир — всё прогнозное; факт всегда сплошной. */
  dashed?: boolean;
  width?: number;
  /** Точки на каждом значении (по умолчанию — только «где сейчас» у главного ряда). */
  points?: boolean;
  /** Индексы точек, нарисованных полыми: значение есть, но ему доверяют меньше. */
  hollow?: number[];
  /** Подписи значений над точками этого ряда (когда точек не больше 14). */
  valueLabels?: boolean;
}

/**
 * Линии по времени: факт и прогноз одного показателя, несколько рядов одного масштаба.
 * Одна ось Y от нуля; пунктир кодирует прогноз, чернила — план. Наведение показывает
 * все ряды в этой точке.
 */
export interface LinesProps {
  series?: LineSeries[];
  labels?: string[];
  height?: number;
  /** Формат оси Y и подписей значений. */
  format?: (v: number) => string;
  /** Формат чисел в подсказке (по умолчанию — `format`). */
  tipFormat?: (v: number) => string;
  yTicks?: number;
  /** Точка на последнем значении сплошных рядов: «где сейчас». */
  markLast?: boolean;
  /** Плавная монотонная кривая между точками (не создаёт ложных горбов). */
  smooth?: boolean;
  /** Индексы категорий с подложкой: выходные, праздники. */
  bands?: number[];
  /** Горизонтальный уровень чернилами: план, цель. */
  reference?: number | null;
  /** Подпись уровня у правого края. */
  referenceLabel?: string;
  /** Подсказка по наведению. */
  tooltip?: boolean;
  style?: CSSProperties;
}

export function Lines({ series = [], labels = [], height = 220, format = nf, tipFormat, yTicks = 4, markLast = true, smooth = true, bands = [], reference = null, referenceLabel, tooltip = true, style }: LinesProps) {
  const [ref, width] = useWidth();
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const hi = niceCeil(Math.max(...all, reference || 0, 0));
  const nT = niceTickCount(hi, yTicks);
  const ticks = Array.from({ length: nT + 1 }).map((_, k) => (hi * k) / nT);
  const padL = axisWidth(ticks, format), padR = 10, padT = 14, padB = 22;
  const innerW = Math.max(10, width - padL - padR), innerH = height - padT - padB;
  const n = Math.max(labels.length, 2);
  const x = React.useCallback((i: number) => padL + (i / (n - 1)) * innerW, [padL, n, innerW]);
  const y = (v: number) => padT + innerH - (v / hi) * innerH;
  const step = labelStep(labels.length, innerW);
  const slot = innerW / (n - 1);
  const { idx, svgRef, onMove, onLeave } = useHover(labels.length, x);
  const tf = tipFormat || format;

  const tipRows: TipRow[] = idx == null ? [] : series.map((s) => ({
    label: s.label || "", kind: "line" as const, tone: s.tone, dashed: s.dashed,
    value: s.values[idx] == null ? "" : tf(s.values[idx] as number),
  }));

  return (
    <div ref={ref} style={{ width: "100%", position: "relative", ...style }}>
    <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} width={width} height={height} style={{ display: "block", overflow: "visible", touchAction: "pan-y" }} role="img"
         onPointerMove={tooltip ? onMove : undefined} onPointerDown={tooltip ? onMove : undefined} onPointerLeave={tooltip ? onLeave : undefined}>
      {bands.map((i) => (
        <rect key={`b${i}`} x={x(i) - slot / 2} y={padT} width={slot} height={innerH} fill="var(--an-text)" opacity="0.04" />
      ))}
      {ticks.map((v, k) => (
        <g key={k}>
          <line x1={padL} x2={width - padR} y1={y(v)} y2={y(v)} stroke="var(--an-border-soft)" strokeDasharray="3 3" />
          <text x={padL - 8} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--an-text-muted)" style={FONT}>{format(v)}</text>
        </g>
      ))}
      {reference != null ? (
        <g>
          <line x1={padL} x2={width - padR} y1={y(reference)} y2={y(reference)} stroke="var(--an-text)" strokeWidth="1.2" strokeDasharray="4 3" opacity="0.7" />
          {referenceLabel ? <text x={width - padR} y={y(reference) - 4} textAnchor="end" fontSize="10" fill="var(--an-text-secondary)" style={FONT}>{referenceLabel}</text> : null}
        </g>
      ) : null}
      {labels.map((lab, i) => showLabel(i, labels.length, step) ? (
        <text key={i} x={x(i)} y={height - 6} textAnchor={i === labels.length - 1 && step > 1 ? "end" : i === 0 && step > 1 ? "start" : "middle"} fontSize="11" fill="var(--an-text-muted)" style={FONT}>{lab}</text>
      ) : null)}
      {idx != null && tooltip ? <line x1={x(idx)} x2={x(idx)} y1={padT} y2={padT + innerH} stroke="var(--an-text-muted)" strokeWidth="1" opacity="0.5" /> : null}
      {series.map((s, k) => {
        const color = toneColor(s.tone);
        const lastIdx = s.values.reduce<number>((a, v, i) => (v != null ? i : a), -1);
        const pts = s.values.map((v, i) => (v == null ? null : [x(i), y(v)] as [number, number]));
        const showValues = s.valueLabels && labels.length <= 14;
        const hollow = new Set(s.hollow || []);
        return (
          <g key={k}>
            <path d={pathOf(pts, smooth)} fill="none" stroke={color} strokeWidth={s.width || 2} strokeDasharray={s.dashed ? "5 4" : undefined} strokeLinejoin="round" strokeLinecap="round" />
            {pts.map((p, i) => {
              if (!p) return null;
              const isHollow = hollow.has(i);
              const show = s.points || isHollow || (markLast && i === lastIdx && !s.dashed && (s.tone || "accent") === "accent");
              if (!show) return null;
              return isHollow
                ? <circle key={i} cx={p[0]} cy={p[1]} r="3.5" fill="var(--an-surface-card)" stroke={color} strokeWidth="1.6" strokeDasharray="2 1.5" />
                : <circle key={i} cx={p[0]} cy={p[1]} r={i === lastIdx && markLast ? 3 : 2.2} fill={color} stroke="var(--an-surface-card)" strokeWidth={i === lastIdx ? 2 : 0} />;
            })}
            {showValues ? pts.map((p, i) => p ? (
              <text key={`v${i}`} x={p[0]} y={p[1] - 8} textAnchor="middle" fontSize="10" fill="var(--an-text-secondary)" style={FONT}>{format(s.values[i] as number)}</text>
            ) : null) : null}
            {idx != null && tooltip && pts[idx] ? <circle cx={pts[idx]![0]} cy={pts[idx]![1]} r="3.5" fill={color} stroke="var(--an-surface-card)" strokeWidth="1.5" /> : null}
          </g>
        );
      })}
    </svg>
    {idx != null && tooltip ? <Tooltip title={labels[idx]} rows={tipRows} x={x(idx)} width={width} top={padT} /> : null}
    </div>
  );
}
