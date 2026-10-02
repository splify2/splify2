// Общий слой графиков: ширина контейнера, тона рядов, ось, подсказка по
// наведению. Не компонент — вспомогательный модуль для Lines/Bars/Legend.
import React from "react";
import type { CSSProperties, ReactNode } from "react";

/** Ширина берётся у контейнера: рисуем в пикселях, а не растягиваем viewBox —
 *  иначе подписи осей вытягиваются вместе с графиком. */
export function useWidth(fallback = 640) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [w, setW] = React.useState<number>(fallback);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => { const cw = el.clientWidth; if (cw > 40) setW(cw); };
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    return () => { if (ro) ro.disconnect(); };
  }, []);
  return [ref, w] as const;
}

/** Тона рядов. У системы один акцент: accent — главный ряд, off — второстепенный
 *  (серый), ink — план и уровни, muted — вспомогательный контекст. cat1…cat7 —
 *  категориальная шкала для наборов вроде дней недели, где рядов заведомо семь
 *  и все они равноправны. Токены состояния (success/warn/danger) рядами не бывают. */
export type SeriesTone =
  | "accent" | "soft" | "off" | "ink" | "muted"
  | "cat1" | "cat2" | "cat3" | "cat4" | "cat5" | "cat6" | "cat7";

export const TONE: Record<SeriesTone, string> = {
  accent: "var(--an-accent)",
  soft: "var(--an-accent-soft)",
  off: "var(--an-control-knob-off)",
  ink: "var(--an-text)",
  muted: "var(--an-text-muted)",
  cat1: "var(--an-cat-1)", cat2: "var(--an-cat-2)", cat3: "var(--an-cat-3)",
  cat4: "var(--an-cat-4)", cat5: "var(--an-cat-5)", cat6: "var(--an-cat-6)", cat7: "var(--an-cat-7)",
};

export const toneColor = (t?: SeriesTone) => TONE[t || "accent"] || TONE.accent;

export const nf = (v: number) => Number(v).toLocaleString("ru-RU", { maximumFractionDigits: 1 });

export const FONT: CSSProperties = { fontFamily: "var(--an-font-sans)", fontVariantNumeric: "tabular-nums" };

/** «Красивый» потолок оси: 1, 2, 2.5, 5 × 10^k, не ниже max*1.06. */
export function niceCeil(max: number): number {
  if (!(max > 0)) return 1;
  const raw = max * 1.06;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (m * p >= raw) return m * p;
  }
  return 10 * p;
}

/** Ширина поля под подписи оси Y — по самой длинной подписи. */
export function axisWidth(ticks: number[], format: (v: number) => string): number {
  const longest = ticks.reduce((a, v) => Math.max(a, format(v).length), 0);
  return Math.round(8 + longest * 6.6);
}

/** Через сколько подписей оси X показывать одну: не чаще, чем раз в 44 px. */
export function labelStep(n: number, innerW: number, minGap = 44): number {
  return Math.max(1, Math.ceil(n / Math.max(1, Math.floor(innerW / minGap))));
}

/** Показывать ли подпись категории i: каждая step-я и последняя, но не вплотную к последней. */
export function showLabel(i: number, n: number, step: number): boolean {
  if (i === n - 1) return true;
  return i % step === 0 && n - 1 - i >= step / 2;
}

/** Число делений оси, при котором шаг «круглый» (5 → 5,10,15…, а не 8,3 / 16,7). */
export function niceTickCount(hi: number, preferred = 4): number {
  const ok = (k: number) => { const st = hi / k; const m = st / Math.pow(10, Math.floor(Math.log10(st))); return [1, 2, 2.5, 5].some((x) => Math.abs(m - x) < 1e-6); };
  for (const k of [preferred, 5, 4, 3, 6, 2]) if (ok(k)) return k;
  return preferred;
}

/** Монотонный кубический сплайн (Fritsch–Carlson): не создаёт ложных горбов между точками. */
export function pathOf(points: Array<[number, number] | null>, smooth: boolean): string {
  const runs: Array<Array<[number, number]>> = [];
  let cur: Array<[number, number]> = [];
  for (const p of points) {
    if (p == null) { if (cur.length) runs.push(cur); cur = []; continue; }
    cur.push(p);
  }
  if (cur.length) runs.push(cur);
  let d = "";
  for (const run of runs) {
    if (run.length === 1) { d += ` M ${run[0][0].toFixed(1)} ${run[0][1].toFixed(1)}`; continue; }
    if (!smooth) {
      run.forEach((p, i) => { d += `${i ? " L" : " M"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`; });
      continue;
    }
    const n = run.length;
    const dx: number[] = [], dy: number[] = [], m: number[] = [];
    for (let i = 0; i < n - 1; i++) { dx.push(run[i + 1][0] - run[i][0]); dy.push(run[i + 1][1] - run[i][1]); m.push(dy[i] / (dx[i] || 1)); }
    const t: number[] = [m[0]];
    for (let i = 1; i < n - 1; i++) {
      if (m[i - 1] * m[i] <= 0) t.push(0);
      else { const w1 = 2 * dx[i] + dx[i - 1], w2 = dx[i] + 2 * dx[i - 1]; t.push((w1 + w2) / (w1 / m[i - 1] + w2 / m[i])); }
    }
    t.push(m[n - 2]);
    d += ` M ${run[0][0].toFixed(1)} ${run[0][1].toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const h = dx[i] / 3;
      d += ` C ${(run[i][0] + h).toFixed(1)} ${(run[i][1] + t[i] * h).toFixed(1)}, ${(run[i + 1][0] - h).toFixed(1)} ${(run[i + 1][1] - t[i + 1] * h).toFixed(1)}, ${run[i + 1][0].toFixed(1)} ${run[i + 1][1].toFixed(1)}`;
    }
  }
  return d.trim();
}

/** Одна строка подсказки: образец, имя, значение. */
export interface TipRow {
  label: ReactNode;
  value: string;
  tone?: SeriesTone;
  dashed?: boolean;
  /** bar — квадратик; line — чёрточка. */
  kind?: "bar" | "line";
  /** Плотность заливки образца: half — идущий час, ghost — ожидание. */
  fill?: "solid" | "half" | "ghost";
  /** Итоговая строка: отделяется линией, набрана жирнее. */
  total?: boolean;
}

/** Наведение по индексу категории: ближайшая колонка к курсору. */
export function useHover(n: number, xOf: (i: number) => number) {
  const [idx, setIdx] = React.useState<number | null>(null);
  const svgRef = React.useRef<SVGSVGElement>(null);
  const onMove = React.useCallback((e: React.PointerEvent) => {
    const el = svgRef.current;
    if (!el || n === 0) return;
    const rect = el.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0, dist = Infinity;
    for (let i = 0; i < n; i++) { const d = Math.abs(xOf(i) - px); if (d < dist) { dist = d; best = i; } }
    setIdx(best);
  }, [n, xOf]);
  const onLeave = React.useCallback(() => setIdx(null), []);
  return { idx, svgRef, onMove, onLeave };
}

const swatchStyle = (r: TipRow): CSSProperties => {
  const c = toneColor(r.tone);
  if (r.kind === "line") return { width: 14, height: 0, borderTop: `2px ${r.dashed ? "dashed" : "solid"} ${c}`, flex: "none" };
  if (r.fill === "ghost") return { width: 10, height: 10, borderRadius: 3, border: `1px dashed ${c}`, background: "transparent", boxSizing: "border-box", flex: "none" };
  return { width: 10, height: 10, borderRadius: 3, background: c, opacity: r.fill === "half" ? 0.5 : 1, flex: "none" };
};

/** Подсказка рядом с курсором. Позиционируется относительно контейнера графика:
 *  справа от колонки, а у правого края — слева. */
export function Tooltip({ title, rows, x, width, top }: { title: ReactNode; rows: TipRow[]; x: number; width: number; top: number }) {
  const shown = rows.filter((r) => r.value !== "");
  if (!shown.length) return null;
  const flip = x > width * 0.62;
  const style: CSSProperties = {
    position: "absolute", top, pointerEvents: "none", zIndex: 3,
    ...(flip ? { right: Math.max(0, width - x + 10) } : { left: x + 10 }),
    minWidth: 128, maxWidth: 260,
    background: "var(--an-surface-card)", border: "1px solid var(--an-border)",
    borderRadius: "var(--an-radius-inner)", boxShadow: "var(--an-shadow-float)",
    padding: "6px 10px", font: "var(--an-text-micro)", color: "var(--an-text-secondary)",
    animation: "an-fade var(--an-dur-hover) var(--an-ease) both",
  };
  return React.createElement("div", { role: "status", style },
    React.createElement("div", { style: { color: "var(--an-text)", fontWeight: "var(--an-weight-semibold)", marginBottom: 4 } }, title),
    ...shown.map((r, i) => React.createElement("div", {
      key: i,
      style: {
        display: "flex", alignItems: "center", gap: 6, lineHeight: 1.6,
        ...(r.total ? { borderTop: "1px solid var(--an-border-soft)", marginTop: 3, paddingTop: 3, color: "var(--an-text)", fontWeight: "var(--an-weight-semibold)" } : {}),
      },
    },
      r.total ? React.createElement("span", { style: { width: 14, flex: "none" } }) : React.createElement("span", { style: swatchStyle(r) }),
      React.createElement("span", { style: { flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, r.label),
      React.createElement("span", { style: { ...FONT, color: "var(--an-text)", whiteSpace: "nowrap" } }, r.value),
    )),
  );
}
