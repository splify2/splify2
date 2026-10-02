import React from "react";
import type { CSSProperties } from "react";


const FMT = {
  pct: (v) => `${Math.abs(v).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} %`,
  pp: (v) => `${Math.abs(v).toLocaleString("ru-RU", { maximumFractionDigits: 2 })} п.п.`,
  raw: (v, unit) => `${Math.abs(v).toLocaleString("ru-RU", { maximumFractionDigits: 1 })}${unit ? ` ${unit}` : ""}`,
};

/**
 * Изменение показателя: стрелка направления и величина без знака.
 * Цвет — оценка («лучше/хуже»), а не направление: падение брака — зелёное.
 *
 * @startingPoint section="Analytics" subtitle="Показатели: крупное число, изменение, план против факта" viewport="700x150"
 */
export interface DeltaProps {
  /** Изменение в единицах `format`: проценты, пункты или сырое значение. */
  value?: number | null;
  format?: "pct" | "pp" | "raw";
  /** Единица для `raw`: «₽», «чел». */
  unit?: string;
  /** false — для показателей, где рост это плохо (доля брака, время ожидания). */
  higherIsBetter?: boolean;
  /** Ширина полосы «без изменений»: внутри неё стрелка → и серый цвет. */
  neutralBand?: number;
  /** Оценка снаружи, когда её даёт не знак, а зона относительно цели. */
  tone?: "neutral" | "success" | "warn" | "danger";
  style?: CSSProperties;
}

export function Delta({ value, format = "pct", unit, higherIsBetter = true, neutralBand = 0, tone: forcedTone, style }: DeltaProps) {
  if (value == null || Number.isNaN(value)) {
    return <span style={{ font: "var(--an-text-caption)", color: "var(--an-text-muted)", ...style }}>—</span>;
  }
  const flat = Math.abs(value) <= neutralBand;
  const good = higherIsBetter ? value > 0 : value < 0;
  // оценку можно задать снаружи — когда «лучше/хуже» решает не знак, а зона
  // относительно цели (в норме / близко / далеко)
  const tone = forcedTone ?? (flat ? "neutral" : good ? "success" : "danger");
  const colors = {
    neutral: { bg: "var(--an-surface-field)", ink: "var(--an-text-secondary)" },
    success: { bg: "var(--an-success-soft)", ink: "var(--an-success-ink)" },
    warn: { bg: "var(--an-warn-soft)", ink: "var(--an-warn-ink)" },
    danger: { bg: "var(--an-danger-soft)", ink: "var(--an-danger-ink)" },
  }[tone];
  const arrow = flat ? "→" : value > 0 ? "↑" : "↓";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--an-space-2)",
        height: 20,
        padding: "0 8px",
        borderRadius: "var(--an-radius-badge)",
        background: colors.bg,
        color: colors.ink,
        font: "var(--an-text-micro)",
        fontWeight: "var(--an-weight-medium)",
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      <span aria-hidden="true">{arrow}</span>
      {(FMT[format] || FMT.raw)(value, unit)}
    </span>
  );
}
