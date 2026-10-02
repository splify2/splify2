import React from "react";
import type { ReactNode, CSSProperties } from "react";


/** Выбор одного из немногих. Может нести StatusDot — например состояние выхода. */
export interface RadioProps {
  checked?: boolean;
  onChange?: () => void;
  label?: ReactNode;
  meta?: ReactNode;
  /** Слот под StatusDot между кружком и подписью. */
  dot?: ReactNode;
  style?: CSSProperties;
}

export function Radio({ checked = false, onChange, label, meta, dot = null, style }: RadioProps) {
  return (
    <label
      onClick={onChange}
      style={{ display: "flex", alignItems: "center", gap: "var(--an-space-5)", font: "var(--an-text-body-sm)", cursor: "pointer", ...style }}
    >
      <span
        style={{
          height: 17,
          width: 17,
          flex: "0 0 auto",
          borderRadius: "var(--an-radius-dot)",
          border: `1.5px solid ${checked ? "var(--an-accent)" : "var(--an-control-line)"}`,
          background: checked ? "var(--an-accent)" : "var(--an-surface-card)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all var(--an-dur-control) var(--an-ease)",
        }}
      >
        <span
          style={{
            height: 7,
            width: 7,
            borderRadius: "var(--an-radius-dot)",
            background: "#fff",
            transform: `scale(${checked ? 1 : 0})`,
            transition: "transform var(--an-dur-control) var(--an-ease)",
          }}
        />
      </span>
      {dot}
      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
      {meta ? <span style={{ flex: "0 0 auto", font: "var(--an-text-micro)", color: "var(--an-text-muted)" }}>{meta}</span> : null}
    </label>
  );
}
