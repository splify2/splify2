import React from "react";
import type { LabelHTMLAttributes, ReactNode, CSSProperties } from "react";


/** Обёртка поля: подпись сверху, подсказка или ошибка снизу. Ошибка вытесняет подсказку. */
export interface FieldProps extends Omit<LabelHTMLAttributes<HTMLLabelElement>, "style"> {
  label?: ReactNode;
  /** Пишите только то, без чего можно сделать неверное действие. */
  hint?: ReactNode;
  error?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
}

export function Field({ label, hint, error, children, style, ...rest }: FieldProps) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "var(--an-space-2)", font: "var(--an-text-caption)", ...style }} {...rest}>
      {label ? <span style={{ color: "var(--an-text)" }}>{label}</span> : null}
      {children}
      {error ? (
        <span style={{ color: "var(--an-danger)" }}>{error}</span>
      ) : hint ? (
        <span style={{ color: "var(--an-text-muted)", lineHeight: 1.5 }}>{hint}</span>
      ) : null}
    </label>
  );
}
