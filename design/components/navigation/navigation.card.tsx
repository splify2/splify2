import React from "react";
import { NavItem } from "./NavItem";
import { Breadcrumb } from "./Breadcrumb";

const glyph = (d) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

const ITEMS = [
  { id: "overview", label: "Обзор", d: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M3 12a9 9 0 0 1 18 0" },
  { id: "rules", label: "Правила", count: 4, d: "M4 6h6l4 12h6" },
  { id: "outputs", label: "Выходы", count: 3, d: "M6 3v12M18 9v12M6 15a6 6 0 0 0 12-6" },
  { id: "catalog", label: "Каталог", d: "M4 4h6v16H4zM14 4h6v16h-6z" },
  { id: "diag", label: "Диагностика", badge: 1, d: "M4 3v7a5 5 0 0 0 10 0V3M9 15v2a4 4 0 0 0 8 0v-1" },
];

export function Demo() {
  const [active, setActive] = React.useState("rules");
  const current = ITEMS.find((i) => i.id === active);
  return (
    <div className="row" style={{ gap: 20, alignItems: "flex-start" }}>
      <nav style={{ width: 236, padding: 10, borderRadius: "var(--an-radius-block)", background: "var(--an-surface-rail)", border: "1px solid var(--an-border)", display: "flex", flexDirection: "column", gap: 2 }}>
        {ITEMS.map((it) => (
          <NavItem key={it.id} icon={glyph(it.d)} label={it.label} count={it.count} badge={it.badge} active={active === it.id} onClick={() => setActive(it.id)} />
        ))}
      </nav>
      <div className="col" style={{ flex: 1, minWidth: 260, gap: 14 }}>
        <Breadcrumb items={[{ label: "Правила", onClick: () => setActive("rules") }, { label: "YouTube" }]} meta="место в очереди: 2 из 4" />
        <div style={{ font: "var(--an-text-title)", letterSpacing: "var(--an-tracking-title)" }}>{current?.label}</div>
        <p style={{ font: "var(--an-text-body-sm)", color: "var(--an-text-muted)" }}>
          Разделов пять-шесть. Внутри раздела вложенных вкладок нет: если понадобились — раздел выбран неверно.
        </p>
      </div>
    </div>
  );
}
