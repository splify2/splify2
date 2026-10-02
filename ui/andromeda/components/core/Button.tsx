import React from "react";
import type { ButtonHTMLAttributes, ReactNode, CSSProperties } from "react";


const TONE = {
  primary: { background: "var(--an-accent)", color: "var(--an-text-on-accent)", border: "1px solid transparent" },
  secondary: { background: "var(--an-surface-card)", color: "var(--an-text)", border: "1px solid var(--an-border)" },
  ghost: { background: "transparent", color: "var(--an-text-secondary)", border: "1px solid transparent" },
  danger: { background: "transparent", color: "var(--an-danger)", border: "1px solid var(--an-danger-border)" },
};

const SIZE = {
  md: { height: "var(--an-size-control)", padding: "0 18px", font: "var(--an-text-body-sm)" },
  sm: { height: "var(--an-size-control-sm)", padding: "0 12px", font: "var(--an-text-caption)" },
};

/**
 * Andromeda action button.
 *
 * @startingPoint section="Core" subtitle="Действия: основное, второстепенное, призрачное, опасное" viewport="700x150"
 */
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "style"> {
  /** primary — одно на экран; secondary — рядом с ним; ghost — в плотных рядах; danger — снос. */
  tone?: "primary" | "secondary" | "ghost" | "danger";
  size?: "md" | "sm";
  /** Крутит иконку и блокирует повторное нажатие, пока роутер отвечает. */
  busy?: boolean;
  disabled?: boolean;
  /** 16×16 глиф из спрайта или lucide. */
  icon?: ReactNode;
  full?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
}

export function Button({
  tone = "primary",
  size = "md",
  busy = false,
  disabled = false,
  icon = null,
  full = false,
  children,
  style,
  ...rest
}: ButtonProps) {
  const off = disabled || busy;
  return (
    <button
      type="button"
      disabled={off}
      aria-busy={busy || undefined}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--an-gap-inline)",
        width: full ? "100%" : undefined,
        borderRadius: "var(--an-radius-control)",
        fontWeight: tone === "primary" ? "var(--an-weight-medium)" : "var(--an-weight-regular)",
        cursor: off ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
        transition: "var(--an-transition-hover)",
        whiteSpace: "nowrap",
        ...SIZE[size],
        ...TONE[tone],
        ...style,
      }}
      {...rest}
    >
      {icon ? (
        <span
          style={{
            display: "inline-flex",
            width: 16,
            height: 16,
            alignItems: "center",
            justifyContent: "center",
            animation: busy ? "an-spin 1s linear infinite" : undefined,
          }}
        >
          {icon}
        </span>
      ) : null}
      {children}
    </button>
  );
}
