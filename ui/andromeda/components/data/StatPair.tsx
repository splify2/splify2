import React from "react";
import type { CSSProperties, ReactNode } from "react";


/**
 * Счётчик: подпись сверху, число снизу. Так число не согласуется с подписью —
 * ни склонений после числительных, ни отдельного перевода фразы.
 *
 * @startingPoint section="Data" subtitle="Счётчики, полосы, точки состояния" viewport="700x150"
 */
export interface StatPairProps {
  /** Строчными: «устройств в сети», «правил включено». */
  label: ReactNode;
  value: ReactNode;
  meta?: ReactNode;
  /** Имя токена состояния без префикса: success | warn | danger. */
  tone?: "success" | "warn" | "danger";
  align?: "left" | "right";
  style?: CSSProperties;
}

export function StatPair({ label, value, meta, tone, align = "left", style }: StatPairProps) {
  return (
    <div style={{ textAlign: align, ...style }}>
      <dt style={{ font: "var(--an-text-caption)", color: "var(--an-text-muted)" }}>{label}</dt>
      <dd style={{ marginTop: "var(--an-space-1)", font: "var(--an-text-heading)", fontSize: 18, color: tone ? `var(--an-${tone})` : "var(--an-text)", whiteSpace: "nowrap" }}>{value}</dd>
      {meta ? <div style={{ font: "var(--an-text-micro)", color: "var(--an-text-muted)" }}>{meta}</div> : null}
    </div>
  );
}
