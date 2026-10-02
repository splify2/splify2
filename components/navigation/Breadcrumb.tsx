import React from "react";
import type { ReactNode, CSSProperties } from "react";


/** Путь внутри раздела: список → объект. Глубже двух уровней в Andromeda не бывает. */
export interface BreadcrumbProps {
  items?: Array<{ label: ReactNode; onClick?: () => void }>;
  /** Правый край: место в очереди, состояние сохранения. */
  meta?: ReactNode;
  style?: CSSProperties;
}

export function Breadcrumb({ items = [], meta, style }: BreadcrumbProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "var(--an-space-5)", font: "var(--an-text-body-sm)", color: "var(--an-text-muted)", ...style }}>
      {items.map((it, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <span aria-hidden="true">/</span> : null}
          {it.onClick ? (
            <button type="button" onClick={it.onClick} style={{ display: "inline-flex", alignItems: "center", gap: "var(--an-space-3)", background: "none", border: 0, padding: 0, font: "inherit", color: "inherit", cursor: "pointer" }}>
              {i === 0 ? (
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7" /></svg>
              ) : null}
              {it.label}
            </button>
          ) : (
            <span style={{ color: "var(--an-text)", fontWeight: "var(--an-weight-medium)" }}>{it.label}</span>
          )}
        </React.Fragment>
      ))}
      {meta ? <span style={{ marginLeft: "auto", font: "var(--an-text-caption)" }}>{meta}</span> : null}
    </div>
  );
}
