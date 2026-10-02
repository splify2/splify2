import React from "react";
import type { CSSProperties } from "react";


/**
 * Микрографик тенденции без осей: форма ряда рядом с числом.
 * Показывает направление, а не значения — их читают из числа рядом.
 *
 * @startingPoint section="Analytics" subtitle="Графики: спарклайн, столбцы, линии, тепловая карта, легенда" viewport="700x150"
 */
export interface SparklineProps {
  /** Ряд по порядку; null — пропуск. */
  values?: Array<number | null>;
  width?: number;
  height?: number;
  /** accent — главный ряд; off — второстепенный; ink — нейтральный. */
  tone?: "accent" | "off" | "ink";
  /** Горизонтальная пунктирная линия уровня: цель, план. */
  reference?: number | null;
  style?: CSSProperties;
}

export function Sparkline({ values = [], width = 96, height = 28, tone = "accent", reference = null, style }: SparklineProps) {
  const pts = values.filter((v) => v != null);
  if (pts.length < 2) return <span style={{ display: "inline-block", width, height, ...style }} />;
  const all = reference != null ? [...pts, reference] : pts;
  const lo = Math.min(...all), hi = Math.max(...all);
  const span = hi - lo || 1;
  const x = (i) => (i / (values.length - 1)) * (width - 2) + 1;
  const y = (v) => height - 2 - ((v - lo) / span) * (height - 4);
  const d = values.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean).join(" L ");
  const stroke = tone === "off" ? "var(--an-control-knob-off)" : tone === "ink" ? "var(--an-text-secondary)" : "var(--an-accent)";
  const last = values.length - 1;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ display: "block", overflow: "visible", ...style }} aria-hidden="true">
      {reference != null ? <line x1="1" x2={width - 1} y1={y(reference)} y2={y(reference)} stroke="var(--an-text)" strokeWidth="1" strokeDasharray="2 3" opacity="0.6" /> : null}
      <path d={`M ${d}`} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      {values[last] != null ? <circle cx={x(last)} cy={y(values[last])} r="2.4" fill={stroke} /> : null}
    </svg>
  );
}
