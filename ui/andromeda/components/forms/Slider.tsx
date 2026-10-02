import React from "react";
import type { CSSProperties } from "react";


/**
 * Ползунок с числом справа — для параметров с границами (полуспад, порог доверия).
 * Число редактируемо точно, ползунок — быстро; вместе они не дают выйти за разумное.
 */
export interface SliderProps {
  value?: number;
  min?: number;
  max?: number;
  step?: number;
  /** Единица после числа: «дней», «σ», «×». */
  unit?: string;
  onChange?: (value: number) => void;
  disabled?: boolean;
  /** Обязателен, когда рядом нет видимой подписи. */
  label?: string;
  style?: CSSProperties;
}

export function Slider({ value = 0, min = 0, max = 100, step = 1, unit = "", onChange, disabled = false, label, style }: SliderProps) {
  const pct = ((value - min) / (max - min || 1)) * 100;
  return (
    <span style={{ display: "flex", alignItems: "center", gap: "var(--an-space-5)", opacity: disabled ? 0.55 : 1, ...style }}>
      <span style={{ position: "relative", flex: 1, height: 20, display: "flex", alignItems: "center" }}>
        <span aria-hidden="true" style={{ position: "absolute", left: 0, right: 0, height: 4, borderRadius: 2, background: "var(--an-surface-field)" }} />
        <span aria-hidden="true" style={{ position: "absolute", left: 0, width: `${pct}%`, height: 4, borderRadius: 2, background: "var(--an-accent)" }} />
        <input
          type="range"
          min={min} max={max} step={step} value={value} disabled={disabled}
          aria-label={label}
          onChange={(e) => onChange && onChange(Number(e.target.value))}
          style={{ position: "relative", width: "100%", margin: 0, height: 20, background: "transparent", appearance: "none", WebkitAppearance: "none", cursor: disabled ? "default" : "pointer", accentColor: "var(--an-accent)" }}
        />
      </span>
      <span style={{ minWidth: 64, textAlign: "right", font: "var(--an-text-body-sm)", color: "var(--an-text)", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
        {Number(value).toLocaleString("ru-RU", { maximumFractionDigits: 2 })}{unit ? ` ${unit}` : ""}
      </span>
    </span>
  );
}
