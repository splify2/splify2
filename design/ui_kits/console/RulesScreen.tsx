import React from "react";
import { Button } from "../../components/core/Button";
import { Badge } from "../../components/core/Badge";
import { IconButton } from "../../components/core/IconButton";
import { Switch } from "../../components/forms/Switch";
import { ListRow } from "../../components/data/ListRow";
import { StatusDot } from "../../components/data/StatusDot";
import { Icon } from "./Icon";
import { describe, outMeta } from "./data.js";

export function RulesScreen({ rules, onEdit, onToggle, onMove, onNewRule, onNewException }) {
  return (
    <div className="console-screen" style={{ display: "flex", flexDirection: "column", gap: "var(--an-gap-block)", animation: "an-enter var(--an-dur-enter) var(--an-ease)" }}>
      <div className="console-toolbar">
        <div className="console-toolbar-note">Сверху вниз — побеждает первое совпадение.</div>
        <div style={{ display: "flex", gap: "var(--an-space-4)" }}>
          <Button tone="secondary" onClick={onNewException}>Исключение</Button>
          <Button icon={<Icon name="plus" />} onClick={onNewRule}>Новое правило</Button>
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "var(--an-gap-row)" }}>
        {rules.map((rule, i) => {
          const m = outMeta(rule.out);
          const isException = rule.out === "direct";
          return (
            <ListRow
              key={rule.id}
              index={i + 1}
              handle
              dimmed={!rule.on}
              title={
                <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--an-space-4)", flexWrap: "wrap" }}>
                  {rule.name}
                  {isException ? <Badge>исключение</Badge> : null}
                </span>
              }
              actions={
                <React.Fragment>
                  <IconButton label="Поднять приоритет" disabled={i === 0} onClick={() => onMove(i, -1)}><Icon name="up" /></IconButton>
                  <IconButton label="Опустить приоритет" disabled={i === rules.length - 1} onClick={() => onMove(i, 1)}><Icon name="down" /></IconButton>
                  <IconButton label={"Изменить " + rule.name} onClick={() => onEdit(rule.id)}><Icon name="pencil" /></IconButton>
                  <Switch checked={rule.on} onChange={() => onToggle(rule.id)} label={rule.name} />
                </React.Fragment>
              }
            >
              <div style={{ marginTop: "var(--an-space-3)", display: "flex", alignItems: "center", gap: "var(--an-space-4)", flexWrap: "wrap", font: "var(--an-text-body-sm)", color: "var(--an-text-secondary)" }}>
                <Cell>{describe(rule)}</Cell>
                <span style={{ color: "var(--an-text-muted)" }}>для</span>
                <Cell>{rule.from.length ? "устройств: " + rule.from.length : "всех устройств"}</Cell>
                <Icon name="arrowRight" size={15} style={{ color: "var(--an-text-muted)" }} />
                <Cell tone={isException ? "neutral" : "accent"}>
                  <StatusDot tone={m.tone} size={7} /> {m.label} · {m.kind}
                </Cell>
              </div>
            </ListRow>
          );
        })}
      </div>
    </div>
  );
}

function Cell({ tone = "neutral", children }) {
  const accent = tone === "accent";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--an-space-3)",
        height: 24,
        padding: "0 9px",
        borderRadius: "var(--an-radius-inner)",
        border: "1px solid " + (accent ? "var(--an-accent-line)" : "var(--an-border)"),
        background: accent ? "var(--an-accent-soft)" : "var(--an-surface-field)",
        color: accent ? "var(--an-accent)" : "inherit",
        fontWeight: accent ? "var(--an-weight-medium)" : "var(--an-weight-regular)",
        whiteSpace: "nowrap",
      }}
    >
      {children}
    </span>
  );
}
