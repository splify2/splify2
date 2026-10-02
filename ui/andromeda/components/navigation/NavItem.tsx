import React from "react";
import type { ReactNode, CSSProperties } from "react";


/**
 * Пункт рельса разделов. count — сколько объектов внутри, badge — сколько требует внимания.
 *
 * @startingPoint section="Navigation" subtitle="Рельс разделов, крошки" viewport="700x150"
 */
export interface NavItemProps {
  icon?: ReactNode;
  label?: ReactNode;
  count?: number | null;
  /** Жёлтый счётчик: столько находок ждёт в разделе. Вытесняет count. */
  badge?: number | null;
  active?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}

export function NavItem({ icon, label, count, badge, active = false, onClick, style }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--an-space-5)",
        width: "100%",
        padding: "10px 12px",
        border: 0,
        borderRadius: "var(--an-radius-inner)",
        textAlign: "left",
        font: "var(--an-text-body)",
        fontWeight: active ? "var(--an-weight-medium)" : "var(--an-weight-regular)",
        background: active ? "var(--an-accent-soft)" : "transparent",
        color: active ? "var(--an-accent)" : "var(--an-text-secondary)",
        cursor: "pointer",
        transition: "background var(--an-dur-control) var(--an-ease), color var(--an-dur-control) var(--an-ease)",
        ...style,
      }}
    >
      {icon ? <span style={{ display: "inline-flex", width: 18, height: 18, flex: "0 0 auto" }}>{icon}</span> : null}
      {label}
      {badge ? (
        <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", justifyContent: "center", height: 18, minWidth: 18, padding: "0 5px", borderRadius: 9, background: "var(--an-warn-soft)", color: "var(--an-warn-ink)", font: "var(--an-text-micro)", fontWeight: "var(--an-weight-semibold)" }}>{badge}</span>
      ) : count != null ? (
        <span style={{ marginLeft: "auto", font: "var(--an-text-micro)", color: "var(--an-text-muted)" }}>{count}</span>
      ) : null}
    </button>
  );
}
