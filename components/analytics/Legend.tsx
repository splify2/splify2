import React from "react";
import type { CSSProperties, ReactNode } from "react";


import { TONE as SERIES_TONE } from "./chart-core";
import type { SeriesTone } from "./chart-core";

const TONE = {
  ...SERIES_TONE,
  // Тоны состояния — только для оценочных зон («выше цели / ниже — разобрать»),
  // где цвет и есть оценка. Рядам данных они по-прежнему запрещены.
  success: "var(--an-success)",
  warn: "var(--an-warn)",
  danger: "var(--an-danger)",
};

function Swatch({ kind = "bar", tone = "accent", dashed = false, fill = "solid" }: { kind?: string; tone?: string; dashed?: boolean; fill?: "solid" | "half" | "ghost" }) {
  const color = TONE[tone] || TONE.accent;
  if (kind === "line") {
    return (
      <svg width="18" height="10" viewBox="0 0 18 10" aria-hidden="true">
        <line x1="1" y1="5" x2="17" y2="5" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "3 3" : undefined} strokeLinecap="round" />
      </svg>
    );
  }
  if (kind === "tick") return <span style={{ display: "inline-block", width: 2, height: 12, background: color, borderRadius: 1 }} />;
  if (kind === "dot") return <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "var(--an-radius-dot)", background: color }} />;
  return (
    <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, boxSizing: "border-box",
      background: dashed ? "var(--an-accent-soft)" : fill === "ghost" ? "transparent" : color,
      opacity: fill === "half" ? 0.5 : 1,
      border: dashed ? "1px dashed var(--an-accent-line)" : fill === "ghost" ? `1px dashed ${color}` : "none" }} />
  );
}

export interface LegendItem {
  label: ReactNode;
  /** Ряды графиков красятся не состояниями: accent — главный, off — второстепенный, ink — план/уровень.
   *  success/warn/danger допустимы только для оценочных зон («выше цели», «ниже — разобрать»). */
  tone?: SeriesTone | "success" | "warn" | "danger";
  /** Форма образца повторяет марку на графике. */
  kind?: "bar" | "line" | "tick" | "dot";
  dashed?: boolean;
  /** Плотность заливки столбика — как у ряда на Bars: half — идущий час, ghost — ожидание. */
  fill?: "solid" | "half" | "ghost";
}

/** Легенда графика: образец повторяет марку (столбик, линия, засечка), а не абстрактный квадрат. */
export interface LegendProps {
  items?: LegendItem[];
  style?: CSSProperties;
}

export function Legend({ items = [], style }: LegendProps) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--an-space-4) var(--an-space-8)", font: "var(--an-text-caption)", color: "var(--an-text-secondary)", ...style }}>
      {items.map((it, i) => (
        <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "var(--an-space-3)" }}>
          <Swatch kind={it.kind} tone={it.tone} dashed={it.dashed} fill={it.fill} />
          {it.label}
        </span>
      ))}
    </div>
  );
}
