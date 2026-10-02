import React from "react";
import type { CSSProperties } from "react";


const TONE = { accent: "var(--an-accent)", ok: "var(--an-success)", warn: "var(--an-warn)", bad: "var(--an-danger)", off: "var(--an-control-knob-off)" };

/** Полоса доли: расход трафика, остаток подписки, вес выхода в общем потоке. */
export interface MeterProps {
  /** Процент 0–100. */
  value?: number;
  tone?: "accent" | "ok" | "warn" | "bad" | "off";
  /** 8 в списках, 10 для главного показателя. */
  height?: number;
  animate?: boolean;
  /** Задержка отрисовки в мс — для лестницы из нескольких полос. */
  delay?: number;
  style?: CSSProperties;
}

export function Meter({ value = 0, tone = "accent", height = 10, animate = true, delay = 0, style }: MeterProps) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <span
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      style={{ display: "block", height, borderRadius: height / 2, background: "var(--an-surface-field)", overflow: "hidden", ...style }}
    >
      <span
        style={{
          display: "block",
          height,
          width: `${pct}%`,
          borderRadius: height / 2,
          background: TONE[tone],
          transformOrigin: "left",
          animation: animate ? `an-bar 900ms var(--an-ease) ${delay}ms both` : undefined,
          transition: "width 400ms var(--an-ease), background var(--an-dur-theme) var(--an-ease)",
        }}
      />
    </span>
  );
}
