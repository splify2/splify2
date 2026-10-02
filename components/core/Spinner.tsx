import React from "react";
import type { CSSProperties } from "react";


/** Кольцо ожидания. Появляется только там, где ответа ждут дольше ~300 мс. */
export interface SpinnerProps {
  size?: number;
  label?: string;
  style?: CSSProperties;
}

export function Spinner({ size = 16, label = "Ожидание", style }: SpinnerProps) {
  return (
    <span
      role="status"
      aria-label={label}
      style={{
        display: "inline-block",
        width: size,
        height: size,
        borderRadius: "var(--an-radius-dot)",
        border: "2px solid var(--an-control-off-border)",
        borderTopColor: "var(--an-accent)",
        animation: "an-spin 1s linear infinite",
        ...style,
      }}
    />
  );
}
