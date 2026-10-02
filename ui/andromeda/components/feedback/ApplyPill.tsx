import React from "react";
import type { CSSProperties } from "react";


/**
 * Плавающая кнопка отложенного применения.
 *
 * КОНТРАКТ: changes — разница между текущей настройкой и ПРИМЕНЁННЫМ снимком,
 * а не число нажатий. Вернули тумблер в исходное — пилюля обязана исчезнуть.
 */
export interface ApplyPillProps {
  changes?: number;
  state?: "idle" | "busy" | "done";
  onApply?: () => void;
  /** Сдвиг центра, когда слева есть рельс: половина его ширины. */
  offset?: number;
  style?: CSSProperties;
}

export function ApplyPill({ changes = 0, state = "idle", onApply, offset = 0, style }: ApplyPillProps) {
  if (changes <= 0 && state === "idle") return null;
  const bg = state === "done" ? "var(--an-success)" : state === "busy" ? "var(--an-text-muted)" : "var(--an-accent)";
  const label = state === "done" ? "Применено" : state === "busy" ? "Применяем…" : "Применить";
  return (
    <div style={{ position: "fixed", bottom: 26, left: `calc(50% + ${offset}px)`, transform: "translateX(-50%)", zIndex: 60, animation: "an-enter var(--an-dur-enter) var(--an-ease)", ...style }}>
      <button
        type="button"
        onClick={state === "idle" ? onApply : undefined}
        style={{
          display: "flex",
          height: 46,
          alignItems: "center",
          gap: "var(--an-space-5)",
          padding: "0 24px",
          borderRadius: "var(--an-radius-pill)",
          border: 0,
          background: bg,
          color: "#fff",
          font: "var(--an-text-body)",
          fontWeight: "var(--an-weight-medium)",
          cursor: state === "idle" ? "pointer" : "default",
          boxShadow: "var(--an-shadow-float)",
          transition: "background var(--an-dur-theme) var(--an-ease), transform var(--an-dur-hover) var(--an-ease)",
        }}
      >
        <span style={{ display: "inline-flex", width: 17, height: 17, alignItems: "center", justifyContent: "center", animation: state === "busy" ? "an-spin 1s linear infinite" : undefined }}>
          {state === "busy" ? (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M21 12a9 9 0 1 1-6.2-8.6" /></svg>
          ) : (
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          )}
        </span>
        {label}
        {state === "idle" ? (
          <span style={{ display: "flex", height: 23, minWidth: 23, alignItems: "center", justifyContent: "center", borderRadius: "var(--an-radius-pill)", background: "rgba(255,255,255,.26)", padding: "0 7px", font: "var(--an-text-caption)", fontWeight: "var(--an-weight-semibold)", animation: "an-pop 300ms var(--an-ease)" }}>{changes}</span>
        ) : null}
      </button>
    </div>
  );
}
