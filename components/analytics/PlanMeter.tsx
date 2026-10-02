import React from "react";
import type { CSSProperties } from "react";


const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString("ru-RU", { maximumFractionDigits: 1 }));

/**
 * Одна полоса на три величины: факт (заливка), прогноз (пунктирная надстройка), план (засечка).
 * Отвечает на «где мы, куда идём и где должны быть» без трёх отдельных чисел.
 */
export interface PlanMeterProps {
  fact?: number;
  forecast?: number | null;
  plan?: number | null;
  /** Единица для подписей: « млн», « чел». */
  unit?: string;
  /** 10 для главного показателя, 8 в списках. */
  height?: number;
  /** Строка легенды под полосой с числами и разницей прогноз/план. */
  labels?: boolean;
  animate?: boolean;
  style?: CSSProperties;
}

export function PlanMeter({ fact = 0, forecast = null, plan = null, unit = "", height = 10, labels = true, animate = true, style }: PlanMeterProps) {
  const top = Math.max(fact, forecast || 0, plan || 0) * 1.06 || 1;
  const pct = (v) => `${Math.max(0, Math.min(100, (v / top) * 100))}%`;
  const fc = forecast ?? 0, pl = plan ?? 0;
  const ahead = plan != null && forecast != null ? fc >= pl : null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--an-space-3)", ...style }}>
      <div style={{ position: "relative", height, borderRadius: height / 2, background: "var(--an-surface-field)", overflow: "visible" }}>
        {forecast != null ? (
          <span style={{ position: "absolute", left: 0, top: 0, height, width: pct(forecast), borderRadius: height / 2, background: "var(--an-accent-soft)", border: "1px dashed var(--an-accent-line)", boxSizing: "border-box" }} />
        ) : null}
        <span
          style={{
            position: "absolute", left: 0, top: 0, height, width: pct(fact), borderRadius: height / 2,
            background: "var(--an-accent)", transformOrigin: "left",
            animation: animate ? "an-bar 900ms var(--an-ease) both" : undefined,
          }}
        />
        {plan != null ? (
          <span aria-hidden="true" style={{ position: "absolute", left: pct(plan), top: -3, width: 2, height: height + 6, marginLeft: -1, background: "var(--an-text)", borderRadius: 1 }} />
        ) : null}
      </div>
      {labels ? (
        <div style={{ display: "flex", gap: "var(--an-space-7)", flexWrap: "wrap", font: "var(--an-text-caption)", color: "var(--an-text-muted)", fontVariantNumeric: "tabular-nums" }}>
          <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "var(--an-accent)", verticalAlign: "-1px", marginRight: 6 }} />факт <b style={{ color: "var(--an-text)", fontWeight: "var(--an-weight-semibold)" }}>{fmt(fact)}{unit}</b></span>
          {forecast != null ? <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: "var(--an-accent-soft)", border: "1px dashed var(--an-accent-line)", boxSizing: "border-box", verticalAlign: "-1px", marginRight: 6 }} />прогноз <b style={{ color: "var(--an-text)", fontWeight: "var(--an-weight-semibold)" }}>{fmt(forecast)}{unit}</b></span> : null}
          {plan != null ? <span><span style={{ display: "inline-block", width: 2, height: 11, background: "var(--an-text)", verticalAlign: "-2px", marginRight: 8 }} />план <b style={{ color: "var(--an-text)", fontWeight: "var(--an-weight-semibold)" }}>{fmt(plan)}{unit}</b></span> : null}
          {ahead != null ? <span style={{ marginLeft: "auto", color: ahead ? "var(--an-success-ink)" : "var(--an-danger-ink)" }}>прогноз {ahead ? "выше" : "ниже"} плана на {fmt(Math.abs(fc - pl))}{unit}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
