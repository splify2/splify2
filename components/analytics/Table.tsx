import React from "react";
import type { CSSProperties, ReactNode } from "react";


export interface TableColumn<T = any> {
  key: string;
  title: ReactNode;
  align?: "left" | "right";
  width?: number | string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  nowrap?: boolean;
}

/**
 * Таблица чисел: рейтинг, помесячные итоги, цели. Числа — вправо и табличными цифрами,
 * заголовок — капсом 11px, строки разделены мягкой линией, сортировка по клику на заголовок.
 *
 * @startingPoint section="Analytics" subtitle="Таблица чисел с сортировкой" viewport="700x150"
 */
export interface TableProps<T = any> {
  columns?: TableColumn<T>[];
  rows?: T[];
  rowKey?: (row: T, index: number) => string | number;
  sortKey?: string | null;
  onSort?: (key: string) => void;
  dense?: boolean;
  caption?: ReactNode;
  /** Ниже этой ширины таблица не сжимается, а прокручивается — иначе столбцы давятся до букв. */
  minWidth?: number;
  style?: CSSProperties;
}

export function Table({ columns = [], rows = [], rowKey = (r, i) => i, sortKey = null, onSort, dense = false, caption, minWidth, style }: TableProps) {
  const [scrolls, setScrolls] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setScrolls(el.scrollWidth - el.clientWidth > 4);
    measure();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    if (ro) ro.observe(el);
    return () => { if (ro) ro.disconnect(); };
  }, [rows.length, columns.length]);
  const padY = dense ? 6 : 10;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--an-space-4)", ...style }}>
      <div ref={ref} style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", minWidth, borderCollapse: "collapse", font: "var(--an-text-body-sm)", color: "var(--an-text)" }}>
          <thead>
            <tr>
              {columns.map((c) => {
                const sortable = Boolean(onSort && c.sortable !== false);
                const active = sortKey === c.key;
                return (
                  <th key={c.key} style={{ width: c.width, textAlign: c.align || "left", padding: `0 8px ${padY}px`, borderBottom: "1px solid var(--an-border)", font: "var(--an-text-micro)", letterSpacing: "var(--an-tracking-caps)", textTransform: "uppercase", color: active ? "var(--an-accent)" : "var(--an-text-muted)", fontWeight: "var(--an-weight-medium)", cursor: sortable ? "pointer" : "default", userSelect: "none", whiteSpace: "nowrap" }}
                    onClick={sortable ? () => onSort?.(c.key) : undefined} aria-sort={active ? "descending" : undefined}>
                    {c.title}{active ? " ↓" : ""}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={rowKey(r, i)} style={{ transition: "background var(--an-dur-hover) var(--an-ease)" }}>
                {columns.map((c) => (
                  <td key={c.key} style={{ padding: `${padY}px 8px`, textAlign: c.align || "left", borderBottom: "1px solid var(--an-border-soft)", fontVariantNumeric: c.align === "right" ? "tabular-nums" : undefined, whiteSpace: c.nowrap ? "nowrap" : undefined }}>
                    {c.render ? c.render(r) : r[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {scrolls ? <div style={{ font: "var(--an-text-micro)", color: "var(--an-text-muted)" }}>таблица шире экрана — правые столбцы прокручиваются вбок</div> : null}
      {caption ? <div style={{ font: "var(--an-text-caption)", color: "var(--an-text-muted)" }}>{caption}</div> : null}
    </div>
  );
}
