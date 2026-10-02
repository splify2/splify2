import React from "react";
import type { ReactNode } from "react";


/** Подтверждение необратимого действия. Текст обязан назвать последствие, а не переспросить. */
export interface DialogProps {
  open?: boolean;
  tone?: "danger" | "accent";
  title?: ReactNode;
  children?: ReactNode;
  /** Глагол действия, не «ОК». */
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onCancel?: () => void;
}

export function Dialog({ open = false, tone = "danger", title, children, confirmLabel = "Продолжить", cancelLabel = "Отмена", onConfirm, onCancel }: DialogProps) {
  if (!open) return null;
  const ink = tone === "danger" ? "var(--an-danger)" : "var(--an-accent)";
  return (
    <div
      onClick={onCancel}
      style={{ position: "fixed", inset: 0, zIndex: 80, background: "var(--an-scrim)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, animation: "an-fade 200ms var(--an-ease)" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 440,
          maxWidth: "100%",
          padding: "var(--an-pad-card)",
          borderRadius: "var(--an-radius-card)",
          background: "var(--an-surface-card)",
          color: "var(--an-text)",
          boxShadow: "var(--an-shadow-dialog)",
          animation: "an-dialog-in var(--an-dur-enter) var(--an-ease)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "var(--an-space-5)" }}>
          <span style={{ height: 34, width: 34, borderRadius: "var(--an-radius-control)", background: tone === "danger" ? "var(--an-danger-soft)" : "var(--an-accent-soft)", color: ink, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M12 9v4M12 17h.01M10.3 3.9 2.4 18a2 2 0 0 0 1.7 3h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
            </svg>
          </span>
          <h2 style={{ font: "var(--an-text-heading)", fontSize: 17 }}>{title}</h2>
        </div>
        <div style={{ marginTop: "var(--an-space-6)", font: "var(--an-text-body-sm)", lineHeight: 1.55, color: "var(--an-text-secondary)" }}>{children}</div>
        <div style={{ marginTop: "var(--an-space-9)", display: "flex", justifyContent: "flex-end", gap: "var(--an-space-5)" }}>
          <button type="button" onClick={onCancel} style={{ height: 38, padding: "0 16px", borderRadius: "var(--an-radius-control)", border: "1px solid var(--an-border)", background: "transparent", color: "var(--an-text)", font: "var(--an-text-body-sm)", cursor: "pointer" }}>{cancelLabel}</button>
          <button type="button" onClick={onConfirm} style={{ height: 38, padding: "0 18px", borderRadius: "var(--an-radius-control)", border: 0, background: ink, color: "#fff", font: "var(--an-text-body-sm)", fontWeight: "var(--an-weight-medium)", cursor: "pointer" }}>{confirmLabel}</button>
        </div>
      </div>
    </div>
  );
}
