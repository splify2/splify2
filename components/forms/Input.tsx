import React from "react";
import type { InputHTMLAttributes, ReactNode, CSSProperties } from "react";


/**
 * Однострочное поле. Ведущая иконка — для поиска, mono — для адресов и ссылок.
 *
 * @startingPoint section="Forms" subtitle="Поля, поиск, состояние ошибки" viewport="700x150"
 */
export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "style"> {
  icon?: ReactNode;
  /** Счётчик или единица справа внутри рамки. */
  trailing?: ReactNode;
  /** Жёлтая рамка: значение введено, но роутер его не примет. */
  invalid?: boolean;
  mono?: boolean;
  style?: CSSProperties;
}

export function Input({ icon = null, trailing = null, invalid = false, mono = false, style, ...rest }: InputProps) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--an-gap-inline)",
        height: "var(--an-size-control)",
        padding: "0 12px",
        borderRadius: "var(--an-radius-control)",
        border: `1px solid ${invalid ? "var(--an-warn-border)" : "var(--an-border)"}`,
        background: "var(--an-surface-input)",
        transition: "var(--an-transition-hover)",
        ...style,
      }}
    >
      {icon ? <span style={{ display: "inline-flex", color: "var(--an-text-muted)", flex: "0 0 auto" }}>{icon}</span> : null}
      <input
        style={{
          flex: 1,
          minWidth: 0,
          border: 0,
          background: "transparent",
          outline: "none",
          color: "var(--an-text)",
          font: mono ? "var(--an-text-code)" : "var(--an-text-body)",
        }}
        {...rest}
      />
      {trailing ? <span style={{ flex: "0 0 auto", font: "var(--an-text-caption)", color: "var(--an-text-muted)" }}>{trailing}</span> : null}
    </span>
  );
}
