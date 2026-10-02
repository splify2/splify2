import React from "react";
import type { CSSProperties } from "react";


/**
 * Тепловая карта строки × столбцы (день недели × час). Одна тональная шкала от акцента —
 * заливка смешивается с цветом пустой клетки, поэтому читается в обеих темах.
 */
export interface HeatmapProps {
  rows?: string[];
  cols?: string[];
  /** values[row][col]; null — нет данных. Обычно индекс к среднему, 1 = обычно. */
  values?: Array<Array<number | null>>;
  /** thin[row][col] = true — клетка на малом числе наблюдений, приглушается. */
  thin?: Array<Array<boolean>> | null;
  format?: (v: number) => string;
  /** Шкала под картой обязательна: без неё цвет не расшифровывается, а наведения на телефоне нет. */
  legend?: boolean;
  cell?: number;
  style?: CSSProperties;
}

export function Heatmap({ rows = [], cols = [], values = [], thin = null, format = (v) => v.toFixed(2), legend = true, cell = 22, style }: HeatmapProps) {
  const flat = values.flat().filter((v) => v != null);
  const max = Math.max(...flat, 1.2);
  const fill = (t) => `color-mix(in oklab, var(--an-accent) ${Math.round(Math.max(0, Math.min(1, t)) * 88)}%, var(--an-surface-field))`;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--an-space-5)", ...style }}>
      <div style={{ display: "grid", gap: 3, gridTemplateColumns: `34px repeat(${cols.length}, minmax(0, 1fr))` }}>
        <span />
        {cols.map((c) => <span key={c} style={{ textAlign: "center", font: "var(--an-text-micro)", color: "var(--an-text-muted)" }}>{c}</span>)}
        {rows.map((r, ri) => (
          <React.Fragment key={r}>
            <span style={{ alignSelf: "center", font: "var(--an-text-caption)", color: "var(--an-text-secondary)" }}>{r}</span>
            {cols.map((_, ci) => {
              const v = values[ri] ? values[ri][ci] : null;
              const isThin = thin && thin[ri] && thin[ri][ci];
              return (
                <span key={ci} title={v == null ? "нет данных" : `${r} ${cols[ci]}: ×${format(v)}`}
                  style={{ height: cell, borderRadius: 3, background: v == null ? "var(--an-surface-field)" : fill(v / max), opacity: isThin ? 0.45 : 1 }} />
              );
            })}
          </React.Fragment>
        ))}
      </div>
      {legend ? (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "var(--an-space-4) var(--an-space-8)", font: "var(--an-text-micro)", color: "var(--an-text-muted)" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            слабее
            <span style={{ display: "inline-flex", gap: 2 }}>{[0.2, 0.4, 0.6, 0.8, 1].map((t) => <span key={t} style={{ width: 18, height: 10, borderRadius: 2, background: fill(t) }} />)}</span>
            сильнее · до ×{format(max)} обычного
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 18, height: 10, borderRadius: 2, background: "var(--an-surface-field)" }} />нет данных</span>
          {thin ? <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><span style={{ width: 18, height: 10, borderRadius: 2, background: fill(1), opacity: 0.45 }} />мало наблюдений</span> : null}
        </div>
      ) : null}
    </div>
  );
}
