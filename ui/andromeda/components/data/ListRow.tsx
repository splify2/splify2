import React from "react";
import type { HTMLAttributes, ReactNode, CSSProperties } from "react";


/**
 * Строка списка объектов. Номер и ручка появляются, когда порядок значит приоритет.
 *
 * @startingPoint section="Data" subtitle="Строка списка с порядком и действиями" viewport="700x150"
 */
export interface ListRowProps extends Omit<HTMLAttributes<HTMLDivElement>, "style" | "title"> {
  /** Порядковый номер: показывайте только там, где порядок влияет на поведение. */
  index?: number | null;
  handle?: boolean;
  title?: ReactNode;
  subtitle?: ReactNode;
  /** Выключенный объект: 50% прозрачности, но остаётся на месте. */
  dimmed?: boolean;
  actions?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
}

export function ListRow({ index, handle = false, title, subtitle, dimmed = false, actions = null, children, style, ...rest }: ListRowProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--an-space-7)",
        padding: "var(--an-pad-row)",
        borderRadius: "var(--an-radius-block)",
        border: "1px solid var(--an-border)",
        background: "var(--an-surface-card)",
        opacity: dimmed ? 0.5 : 1,
        transition: "opacity var(--an-dur-control) var(--an-ease), border-color var(--an-dur-hover) var(--an-ease), background var(--an-dur-theme) var(--an-ease)",
        ...style,
      }}
      {...rest}
    >
      {handle || index != null ? (
        <span style={{ display: "flex", alignItems: "center", gap: "var(--an-space-4)", color: "var(--an-text-muted)", flex: "0 0 auto" }}>
          {handle ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style={{ cursor: "grab", opacity: 0.55 }}>
              <circle cx="9" cy="6" r="1.6" /><circle cx="9" cy="12" r="1.6" /><circle cx="9" cy="18" r="1.6" />
              <circle cx="15" cy="6" r="1.6" /><circle cx="15" cy="12" r="1.6" /><circle cx="15" cy="18" r="1.6" />
            </svg>
          ) : null}
          {index != null ? <span style={{ font: "var(--an-text-caption)" }}>{index}</span> : null}
        </span>
      ) : null}

      <div style={{ flex: 1, minWidth: 0 }}>
        {title ? <div style={{ font: "var(--an-text-body)", fontWeight: "var(--an-weight-semibold)" }}>{title}</div> : null}
        {subtitle ? <div style={{ marginTop: "var(--an-space-3)", font: "var(--an-text-body-sm)", color: "var(--an-text-secondary)" }}>{subtitle}</div> : null}
        {children}
      </div>

      {actions ? <div style={{ display: "flex", alignItems: "center", gap: "var(--an-space-3)", flex: "0 0 auto" }}>{actions}</div> : null}
    </div>
  );
}
