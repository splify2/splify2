import React from "react";
import type { CSSProperties } from "react";


/**
 * Включатель объекта. Меняет состояние сразу — без «Сохранить» рядом.
 *
 * @startingPoint section="Forms" subtitle="Тумблеры, радио, чекбоксы, сегменты" viewport="700x150"
 */
export interface SwitchProps {
  checked?: boolean;
  onChange?: () => void;
  /** Обязателен, когда рядом нет видимой подписи. */
  label?: string;
  /** lg — для телефона: 48×28 при зоне нажатия 44px. */
  size?: "md" | "lg";
  disabled?: boolean;
  style?: CSSProperties;
}

export function Switch({ checked = false, onChange, label, size = "md", disabled = false, style }: SwitchProps) {
  const w = size === "lg" ? 48 : 42;
  const h = size === "lg" ? 28 : 24;
  const knob = h - 6;
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      style={{
        height: h,
        width: w,
        padding: 0,
        display: "flex",
        alignItems: "center",
        borderRadius: "var(--an-radius-pill)",
        border: `1px solid ${checked ? "var(--an-accent)" : "var(--an-control-off-border)"}`,
        background: checked ? "var(--an-accent)" : "var(--an-control-off)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.5 : 1,
        transition: "background var(--an-dur-control) var(--an-ease), border-color var(--an-dur-control) var(--an-ease)",
        ...style,
      }}
    >
      <span
        style={{
          display: "block",
          height: knob,
          width: knob,
          borderRadius: "var(--an-radius-dot)",
          background: checked ? "#fff" : "var(--an-control-knob-off)",
          transform: `translateX(${checked ? w - knob - 4 : 2}px)`,
          transition: "transform var(--an-dur-control) var(--an-ease)",
        }}
      />
    </button>
  );
}
