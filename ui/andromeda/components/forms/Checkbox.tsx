import React from "react";
import type { ReactNode, CSSProperties } from "react";


/** Выбор нескольких из списка: сервисы в правиле, устройства из аренд DHCP. */
export interface CheckboxProps {
  checked?: boolean;
  onChange?: () => void;
  label?: ReactNode;
  /** Правый край строки: количество записей, тип, адрес. */
  meta?: ReactNode;
  children?: ReactNode;
  style?: CSSProperties;
}

export function Checkbox({ checked = false, onChange, label, meta, children, style }: CheckboxProps) {
  return (
    <label
      onClick={onChange}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "var(--an-space-5)",
        padding: "7px 6px",
        borderRadius: "var(--an-radius-inner)",
        font: "var(--an-text-body-sm)",
        cursor: "pointer",
        ...style,
      }}
    >
      <span
        style={{
          height: 17,
          width: 17,
          flex: "0 0 auto",
          borderRadius: 5,
          border: `1.5px solid ${checked ? "var(--an-accent)" : "var(--an-control-line)"}`,
          background: checked ? "var(--an-accent)" : "var(--an-surface-card)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all var(--an-dur-hover) var(--an-ease)",
        }}
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: checked ? 1 : 0, transition: "opacity var(--an-dur-hover) var(--an-ease)" }}>
          <path d="M20 6 9 17l-5-5" />
        </svg>
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label ?? children}</span>
      {meta ? <span style={{ flex: "0 0 auto", font: "var(--an-text-micro)", color: "var(--an-text-muted)" }}>{meta}</span> : null}
    </label>
  );
}
