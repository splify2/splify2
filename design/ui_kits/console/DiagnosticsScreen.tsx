import React from "react";
import { Card } from "../../components/core/Card";
import { Button } from "../../components/core/Button";
import { CodeBlock } from "../../components/data/CodeBlock";

const OK_CHECKS = [
  "таблица inet steer загружена в ядро",
  "резолвер отвечает на 127.0.0.1:5353",
  "NAT найден для устройства steer0",
  "метки и таблицы совпадают с реестром",
];

export function DiagnosticsScreen() {
  const [open, setOpen] = React.useState(false);
  return (
    <div className="console-screen" style={{ display: "flex", flexDirection: "column", gap: "var(--an-gap-block)", animation: "an-enter var(--an-dur-enter) var(--an-ease)" }}>

      <Card heading="проверок с предупреждением: 1">
        <div style={{ marginTop: "var(--an-space-6)", font: "var(--an-text-body)" }}>список domains/telegram.lst старше суток</div>
        <div style={{ font: "var(--an-text-caption)", color: "var(--an-text-muted)" }}>последняя удачная загрузка: 21 ч назад</div>

        <div style={{ marginTop: "var(--an-space-7)" }}>
          <Button tone="ghost" size="sm" onClick={() => setOpen(!open)} style={{ padding: 0 }}>
            {open ? "скрыть исправное" : "исправно: 11 — показать"}
          </Button>
          <div style={{ overflow: "hidden", maxHeight: open ? 160 : 0, opacity: open ? 1 : 0, transition: "max-height var(--an-dur-collapse) var(--an-ease), opacity var(--an-dur-enter) var(--an-ease)" }}>
            <ul className="an-plain" style={{ marginTop: "var(--an-space-5)", display: "flex", flexDirection: "column", gap: "var(--an-space-4)", font: "var(--an-text-body-sm)", color: "var(--an-text-secondary)" }}>
              {OK_CHECKS.map((c) => (
                <li key={c} style={{ display: "flex", gap: "var(--an-space-4)" }}>
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--an-success)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "0 0 auto" }}><path d="M20 6 9 17l-5-5" /></svg>
                  {c}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      <Card heading="Логи steer" meta="дословно">
        <CodeBlock style={{ marginTop: "var(--an-space-6)" }}>
{`info  steer[info] spec compiled: 4 channels, 3 outputs
info  steer[info] resolver up on 127.0.0.1:5353, fake-IP pool 198.18.0.0/15
warn  steer[warn] list domains/telegram.lst older than 24h
info  steer[info] output vless-nl up: dev steer0, mark 0x100000, table 300
info  steer[info] output wg0 up: dev wg0, mark 0x100001, table 301`}
        </CodeBlock>
      </Card>
    </div>
  );
}
