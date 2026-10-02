import React from "react";
import type { ButtonHTMLAttributes, ReactNode, CSSProperties } from "react";


/** Квадратная кнопка-глиф для действий внутри строки списка. */
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> {
  /** Обязательно: уходит в aria-label и title. */
  label: string;
  tone?: "muted" | "danger";
  disabled?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
}

export function IconButton({ label, disabled = false, tone = "muted", children, style, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      title={label}
      style={{
        height: "var(--an-size-icon-button)",
        width: "var(--an-size-icon-button)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: 0,
        borderRadius: "var(--an-radius-inner)",
        background: "transparent",
        color: tone === "danger" ? "var(--an-danger)" : "var(--an-text-muted)",
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "default" : "pointer",
        transition: "var(--an-transition-hover)",
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}
