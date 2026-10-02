import React from "react";
import type { ReactNode, CSSProperties } from "react";


const TONE = { ok: "var(--an-success)", warn: "var(--an-warn)", bad: "var(--an-danger)" };

/** Подтверждение уже случившегося. Уходит сам через ~3,2 с; кнопок внутри не бывает. */
export interface ToastProps {
  tone?: "ok" | "warn" | "bad";
  children?: ReactNode;
  style?: CSSProperties;
}

/** Правый нижний угол; новые сообщения добавляются снизу. */
export interface ToastStackProps {
  children?: ReactNode;
  style?: CSSProperties;
}

export function Toast({ tone = "ok", children, style }: ToastProps) {
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--an-space-5)",
        padding: "12px 16px",
        borderRadius: "var(--an-radius-block)",
        background: "var(--an-surface-inverse)",
        color: "#fff",
        font: "var(--an-text-body-sm)",
        boxShadow: "var(--an-shadow-toast)",
        borderLeft: `3px solid ${TONE[tone]}`,
        animation: "an-enter var(--an-dur-enter) var(--an-ease)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function ToastStack({ children, style }: ToastStackProps) {
  return (
    <div style={{ position: "fixed", right: 24, bottom: 24, zIndex: 70, display: "flex", flexDirection: "column", gap: "var(--an-space-5)", alignItems: "flex-end", ...style }}>
      {children}
    </div>
  );
}
