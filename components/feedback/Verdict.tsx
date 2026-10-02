import React from "react";
import type { ReactNode, CSSProperties } from "react";

import { StatusDot } from "../data/StatusDot";

const STATE = {
  running: { tone: "ok", live: true, text: "Маршрутизация работает" },
  broken: { tone: "bad", live: false, text: "Есть поломки" },
  silent: { tone: "warn", live: false, text: "Движок не отвечает" },
  loading: { tone: "off", live: true, text: "Загрузка…" },
} as const;

/**
 * Заголовок состояния системы. Текст берётся из закрытого списка четырёх строк —
 * интерфейс не собирает фразу из чисел, поэтому склонять нечего.
 *
 * @startingPoint section="Feedback" subtitle="Вердикт, плашка, тост, диалог" viewport="700x150"
 */
export interface VerdictProps {
  state?: "running" | "broken" | "silent" | "loading";
  /** Счётчики через разделитель: «устройств в сети: 9 · время работы 4 ч 12 мин». */
  meta?: ReactNode;
  style?: CSSProperties;
}


export function Verdict({ state = "running", meta, style }: VerdictProps) {
  const s = STATE[state] ?? STATE.running;
  return (
    <div style={style}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--an-space-5)" }}>
        <StatusDot tone={s.tone} live={s.live} size={11} />
        <h1 style={{ font: "var(--an-text-verdict)", letterSpacing: "var(--an-tracking-verdict)" }}>{s.text}</h1>
      </div>
      {meta ? <p style={{ marginTop: "var(--an-space-3)", font: "var(--an-text-body-sm)", color: "var(--an-text-muted)" }}>{meta}</p> : null}
    </div>
  );
}

export const VERDICT_STATES = Object.keys(STATE) as Array<keyof typeof STATE>;
