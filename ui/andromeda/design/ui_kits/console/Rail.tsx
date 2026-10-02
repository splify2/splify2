import React from "react";
import { NavItem } from "../../components/navigation/NavItem";
import { Button } from "../../components/core/Button";
import { SegmentedControl } from "../../components/forms/SegmentedControl";
import { Icon } from "./Icon";

const SECTIONS = [
  { id: "overview", label: "Обзор", icon: "gauge" },
  { id: "rules", label: "Правила", icon: "route" },
  { id: "outputs", label: "Выходы", icon: "outputs" },
  { id: "catalog", label: "Каталог", icon: "catalog" },
  { id: "diag", label: "Диагностика", icon: "diag" },
];

export function Rail({ view, onView, rulesCount, theme, onTheme, onStop }) {
  return (
    <aside
      className="console-rail"
      style={{
        width: "var(--an-rail-width)",
        background: "var(--an-surface-rail)",
        borderRight: "1px solid var(--an-border)",
        padding: "18px 14px",
        display: "flex",
        flexDirection: "column",
        gap: "var(--an-gap-section)",
        transition: "var(--an-transition-theme)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "var(--an-space-5)", padding: "0 6px" }}>
        <img src="../../assets/logo-andromeda.svg" alt="" style={{ width: 36, height: 36, borderRadius: 10 }} />
        <div style={{ lineHeight: 1.15 }}>
          <div style={{ font: "var(--an-text-heading)" }}>splify2</div>
          <div style={{ font: "var(--an-text-micro)", color: "var(--an-text-muted)" }}>управление маршрутизацией</div>
        </div>
      </div>

      <nav style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {SECTIONS.map((s) => (
          <NavItem
            key={s.id}
            icon={<Icon name={s.icon} size={18} />}
            label={s.label}
            count={s.id === "rules" ? rulesCount : s.id === "outputs" ? 3 : null}
            badge={s.id === "diag" ? 1 : null}
            active={view === s.id || (view === "editor" && s.id === "rules")}
            onClick={() => onView(s.id)}
          />
        ))}
      </nav>

      <div style={{ marginTop: "auto", display: "flex", flexDirection: "column", gap: "var(--an-space-5)" }}>
        <SegmentedControl
          value={theme}
          onChange={onTheme}
          size="sm"
          style={{ display: "flex" }}
          items={[
            { value: "light", label: <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="sun" size={14} /> Светлая</span> },
            { value: "dark", label: <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}><Icon name="moon" size={14} /> Тёмная</span> },
          ]}
        />
        <div style={{ border: "1px solid var(--an-border)", borderRadius: "var(--an-radius-control)", padding: 11, background: "var(--an-surface-card)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, font: "var(--an-text-caption)", color: "var(--an-text-muted)" }}>
            <span className="console-connection-dot" /> движок
          </div>
          <div style={{ font: "var(--an-text-body-sm)", marginTop: 4 }}>steer 1.1.2 · extended</div>
        </div>
        <Button tone="danger" full icon={<Icon name="power" />} onClick={onStop}>Остановить всё</Button>
      </div>
    </aside>
  );
}
