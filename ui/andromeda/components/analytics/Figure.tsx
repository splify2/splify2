import React from "react";
import type { CSSProperties, ReactNode } from "react";


const SIZE = {
  lg: { font: "var(--an-text-verdict)", fontSize: 40, letterSpacing: "-0.025em", lineHeight: 1 },
  md: { font: "var(--an-text-verdict)", fontSize: 28, letterSpacing: "-0.02em", lineHeight: 1.05 },
  sm: { font: "var(--an-text-heading)", fontSize: 20, lineHeight: 1.1 },
};

/**
 * Крупный показатель: подпись сверху, число с единицей, изменение рядом, пояснение снизу.
 * Старший брат StatPair — для одного-четырёх главных чисел экрана, не для сеток.
 */
export interface FigureProps {
  /** Строчными: «оборот сегодня», «прогноз месяца». */
  label?: ReactNode;
  value: ReactNode;
  /** Единица отдельно от числа: «млн ₽», «чел», «%». */
  unit?: ReactNode;
  /** Обычно `<Delta …/>`. */
  delta?: ReactNode;
  /** Одна строка: к чему относится или откуда взято. */
  caption?: ReactNode;
  /** lg — одно число на экран (40px), md — ряд из трёх-четырёх (28px), sm — в карточке (20px). */
  size?: "lg" | "md" | "sm";
  /** Окраска самого числа токеном состояния: только когда число — это оценка. */
  tone?: "success" | "warn" | "danger";
  /** Пульсирующая точка перед подписью: значение обновляется само. */
  live?: boolean;
  style?: CSSProperties;
}

export function Figure({ label, value, unit, delta = null, caption, size = "md", tone, live = false, style }: FigureProps) {
  const color = tone ? `var(--an-${tone}-ink)` : "var(--an-text)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--an-space-2)", minWidth: 0, ...style }}>
      {label ? (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--an-space-3)", font: "var(--an-text-caption)", color: "var(--an-text-muted)" }}>
          {live ? <span style={{ width: 6, height: 6, borderRadius: "var(--an-radius-dot)", background: "var(--an-success)", animation: "an-pulse var(--an-dur-pulse) ease-in-out infinite" }} /> : null}
          {label}
        </div>
      ) : null}
      <div style={{ display: "flex", alignItems: "baseline", gap: "var(--an-space-4)", flexWrap: "wrap" }}>
        <span style={{ ...SIZE[size], color, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>{value}</span>
        {unit ? <span style={{ font: "var(--an-text-body-sm)", color: "var(--an-text-muted)" }}>{unit}</span> : null}
        {delta}
      </div>
      {caption ? <div style={{ font: "var(--an-text-micro)", color: "var(--an-text-muted)" }}>{caption}</div> : null}
    </div>
  );
}
