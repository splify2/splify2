import React from "react";
import type { ReactNode, CSSProperties } from "react";


/** Два-три взаимоисключающих варианта в одну строку: фильтр списка, тема, тип данных. */
export interface SegmentedControlProps {
  items?: Array<{ value: string; label: ReactNode }>;
  value?: string;
  onChange?: (value: string) => void;
  size?: "md" | "sm";
  /** Растянуть на всю ширину родителя: варианты делят её поровну (рельс, телефон). */
  full?: boolean;
  style?: CSSProperties;
}

export function SegmentedControl({ items = [], value, onChange, size = "md", full = false, style }: SegmentedControlProps) {
  const h = size === "sm" ? 30 : 32;
  return (
    <div
      style={{ display: full ? "flex" : "inline-flex", gap: "var(--an-space-2)", padding: "var(--an-space-2)", borderRadius: "var(--an-radius-control)", background: "var(--an-surface-field)", transition: "var(--an-transition-theme)", ...style }}
    >
      {items.map((it) => {
        const on = it.value === value;
        return (
          <button
            key={it.value}
            type="button"
            // фильтр или режим, а не вкладки — вкладки внутри раздела система запрещает
            aria-pressed={on}
            onClick={() => onChange && onChange(it.value)}
            style={{
              height: h,
              padding: full ? "0 8px" : "0 14px",
              flex: full ? 1 : undefined,
              minWidth: 0,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              border: 0,
              borderRadius: "var(--an-radius-inner)",
              background: on ? "var(--an-accent)" : "transparent",
              color: on ? "var(--an-text-on-accent)" : "var(--an-text-secondary)",
              font: "var(--an-text-body-sm)",
              fontWeight: on ? "var(--an-weight-medium)" : "var(--an-weight-regular)",
              cursor: "pointer",
              transition: "all var(--an-dur-control) var(--an-ease)",
              whiteSpace: "nowrap",
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}
