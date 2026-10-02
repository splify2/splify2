import React from "react";
import type { CSSProperties } from "react";


const TONE = { ok: "var(--an-success)", warn: "var(--an-warn)", bad: "var(--an-danger)", off: "var(--an-text-muted)" };

/** Точка состояния. Единственный элемент, чей цвет НЕ зависит от акцента темы. */
export interface StatusDotProps {
  tone?: "ok" | "warn" | "bad" | "off";
  /** 8 в строках, 11 рядом с вердиктом. */
  size?: number;
  /** Пульс: значение живое, читается прямо сейчас. */
  live?: boolean;
  label?: string;
  style?: CSSProperties;
}

export function StatusDot({ tone = "ok", size = 8, live = false, label, style }: StatusDotProps) {
  return (
    <span
      role={label ? "img" : undefined}
      aria-label={label}
      style={{
        display: "inline-block",
        flex: "0 0 auto",
        height: size,
        width: size,
        borderRadius: "var(--an-radius-dot)",
        background: TONE[tone],
        animation: live ? "an-pulse var(--an-dur-pulse) ease-in-out infinite" : undefined,
        ...style,
      }}
    />
  );
}
