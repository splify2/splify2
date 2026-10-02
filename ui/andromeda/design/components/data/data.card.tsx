import React from "react";
import { StatPair } from "./StatPair";
import { StatusDot } from "./StatusDot";
import { Meter } from "./Meter";
import { ListRow } from "./ListRow";
import { Skeleton } from "./Skeleton";
import { CodeBlock } from "./CodeBlock";
import { IconButton } from "../core/IconButton";
import { Switch } from "../forms/Switch";

const glyph = (d) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

export function Demo() {
  const [loading, setLoading] = React.useState(false);
  const [on, setOn] = React.useState(true);
  return (
    <div className="col" style={{ gap: 16 }}>
      <dl style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12, margin: 0 }}>
        <StatPair label="правил включено" value="4" />
        <StatPair label="устройств в сети" value="9" />
        <StatPair label="отклик · vless-nl" value="42 мс" tone="success" />
        <StatPair label="осталось" value="68,2 ГБ" meta="из 200 ГБ" />
      </dl>

      <div className="col" style={{ gap: 8 }}>
        <div className="row" style={{ gap: 10, font: "var(--an-text-body-sm)" }}>
          <span style={{ flex: 1 }}>YouTube <span style={{ color: "var(--an-text-muted)" }}>→ vless-nl</span></span>
          <span style={{ color: "var(--an-text-secondary)" }}>↓ 12,4 ГБ</span>
        </div>
        <Meter value={74} />
        <Meter value={23} height={8} delay={70} />
        <Meter value={13} height={8} tone="off" delay={140} />
      </div>

      <div className="row" style={{ gap: 14 }}>
        <span className="row" style={{ gap: 7, font: "var(--an-text-body-sm)" }}><StatusDot tone="ok" live /> живое</span>
        <span className="row" style={{ gap: 7, font: "var(--an-text-body-sm)" }}><StatusDot tone="warn" /> предупреждение</span>
        <span className="row" style={{ gap: 7, font: "var(--an-text-body-sm)" }}><StatusDot tone="bad" /> отказ</span>
        <span className="row" style={{ gap: 7, font: "var(--an-text-body-sm)" }}><StatusDot tone="off" /> мимо туннеля</span>
        <button
          type="button"
          onClick={() => { setLoading(true); setTimeout(() => setLoading(false), 1600); }}
          style={{ marginLeft: "auto", height: 30, padding: "0 12px", borderRadius: "var(--an-radius-inner)", border: "1px solid var(--an-border)", background: "transparent", color: "var(--an-text-secondary)", font: "var(--an-text-caption)", cursor: "pointer" }}
        >
          показать загрузку
        </button>
      </div>

      {loading ? (
        <Skeleton count={2} height={62} />
      ) : (
        <div className="col" style={{ gap: 8 }}>
          <ListRow
            index={2}
            handle
            title="YouTube"
            subtitle="YouTube, Google · записей: 84 312 → vless-nl · Нидерланды"
            actions={<React.Fragment><IconButton label="Изменить">{glyph("m18 2 4 4-14 14H4v-4z")}</IconButton><Switch checked={on} onChange={() => setOn(!on)} label="YouTube" /></React.Fragment>}
          />
          <ListRow index={4} handle dimmed title="Discord" subtitle="Discord · записей: 902 → vless-nl" actions={<Switch checked={false} onChange={() => {}} label="Discord" />} />
        </div>
      )}

      <CodeBlock maxHeight={70}>{"www.youtube.com -> 198.18.0.42 (fake-IP)\nправило YouTube -> выход vless-nl (метка 0x100000, таблица 300)"}</CodeBlock>
    </div>
  );
}
