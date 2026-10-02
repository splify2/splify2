import React from "react";
import type { HTMLAttributes, ReactNode, CSSProperties } from "react";


const TONE = {
  warn: { border: "var(--an-warn-border)", bg: "var(--an-warn-soft)", ink: "var(--an-warn-ink)" },
  danger: { border: "var(--an-danger-border)", bg: "var(--an-danger-soft)", ink: "var(--an-danger-ink)" },
  info: { border: "var(--an-border)", bg: "var(--an-surface-field)", ink: "var(--an-text-secondary)" },
};

/** Плашка находки: счётчик в шапке, дословный текст проверки внутри. */
export interface CalloutProps extends Omit<HTMLAttributes<HTMLDivElement>, "style" | "title"> {
  tone?: "warn" | "danger" | "info";
  /** Подпись счётчика без числа: «проверок с предупреждением». */
  title?: ReactNode;
  /** Число ставится через двоеточие — без согласования с подписью. */
  count?: number | null;
  /** Текст проверки ОТ ДВИЖКА, как есть: diag.checks[].what. Не переписывать. */
  verbatim?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
}

export function Callout({ tone = "warn", count, title, verbatim, action, children, style, ...rest }: CalloutProps) {
  const t = TONE[tone];
  const clickable = Boolean(rest.onClick);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "var(--an-space-4)",
        padding: "var(--an-pad-block)",
        borderRadius: "var(--an-radius-block)",
        border: `1px solid ${t.border}`,
        background: t.bg,
        cursor: clickable ? "pointer" : "default",
        textAlign: "left",
        transition: "filter var(--an-dur-hover) var(--an-ease)",
        ...style,
      }}
      {...rest}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--an-space-3)", font: "var(--an-text-caption)", color: t.ink }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
        </svg>
        {count != null ? `${title}: ${count}` : title}
        {action ? <span style={{ marginLeft: "auto", opacity: 0.85 }}>{action}</span> : null}
      </div>
      {verbatim ? <div style={{ font: "var(--an-text-body)", color: "var(--an-text)" }}>{verbatim}</div> : null}
      {children}
    </div>
  );
}
