import React from "react";
import { Card } from "../../components/core/Card";
import { Button } from "../../components/core/Button";
import { Verdict } from "../../components/feedback/Verdict";
import { Callout } from "../../components/feedback/Callout";
import { StatPair } from "../../components/data/StatPair";
import { Meter } from "../../components/data/Meter";
import { CodeBlock } from "../../components/data/CodeBlock";
import { Input } from "../../components/forms/Input";
import { Icon } from "./Icon";

const FLOWS = [
  { name: "YouTube", out: "vless-nl", down: "12,4 ГБ", up: "1,8 ГБ", now: "4,2 Мбит/с", pct: 74, tone: "accent" },
  { name: "Telegram", out: "wg0", down: "412,7 МБ", up: "96,3 МБ", now: "—", pct: 23, tone: "accent" },
  { name: "Spotify", out: "напрямую", down: "238,4 МБ", up: "12,1 МБ", now: "—", pct: 13, tone: "off" },
] as const;

export function OverviewScreen({ rulesOn, onNewRule, onDiag, quota = true }) {
  const [query, setQuery] = React.useState("youtube.com");
  const [asking, setAsking] = React.useState(false);
  const [answer, setAnswer] = React.useState("");

  const ask = () => {
    if (asking) return;
    setAsking(true);
    setTimeout(() => {
      setAsking(false);
      setAnswer(
        (query || "youtube.com").trim() + " -> 198.18.0.42 (fake-IP)\n" +
        "правило YouTube -> выход vless-nl (метка 0x100000, таблица 300)\n" +
        "ответ от резолвера steer, 3 мс"
      );
    }, 1000);
  };

  return (
    <div className="console-screen" style={{ display: "flex", flexDirection: "column", gap: "var(--an-gap-section)", animation: "an-enter var(--an-dur-enter) var(--an-ease)" }}>
      <div className="overview-hero">
        <div className="overview-hero-verdict">
          <Verdict state="running" meta={"устройств в сети: 9 · время работы 4 ч 12 мин"} />
          <div className="overview-hero-caption">
            <span className="console-connection-dot" />
            Последняя синхронизация с ядром — только что
          </div>
        </div>
        <div className="overview-hero-actions">
          <span>Маршруты применяются без перезапуска</span>
          <Button icon={<Icon name="plus" />} onClick={onNewRule}>Новое правило</Button>
        </div>
      </div>

      <Callout title="проверок с предупреждением" count={1} verbatim="список domains/telegram.lst старше суток" action={<span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>диагностика <Icon name="arrowRight" size={14} /></span>} onClick={onDiag} />

      <div className="overview-content-grid">
        <Card heading="Куда идёт трафик" meta="с загрузки роутера">
          <div style={{ marginTop: "var(--an-space-8)", display: "flex", flexDirection: "column", gap: "var(--an-space-7)" }}>
            {FLOWS.map((f, i) => (
              <div key={f.name}>
                <div style={{ display: "flex", alignItems: "baseline", gap: "var(--an-space-5)", font: "var(--an-text-body-sm)" }}>
                  <span style={{ flex: 1, minWidth: 0 }}>{f.name} <span style={{ color: "var(--an-text-muted)" }}>→ {f.out}</span></span>
                  <span style={{ color: "var(--an-text-secondary)" }}>↓ {f.down}</span>
                  <span style={{ color: "var(--an-text-muted)" }}>↑ {f.up}</span>
                  <span style={{ width: 96, textAlign: "right", color: f.now === "—" ? "var(--an-text-muted)" : "var(--an-text-secondary)" }}>{f.now}</span>
                </div>
                <Meter value={f.pct} tone={f.tone} height={8} delay={i * 70} style={{ marginTop: "var(--an-space-3)" }} />
              </div>
            ))}
          </div>

          <div style={{ marginTop: "var(--an-space-9)", paddingTop: "var(--an-space-8)", borderTop: "1px solid var(--an-border-soft)", display: "flex", gap: "var(--an-space-6)", flexWrap: "wrap" }}>
            <Input
              icon={<Icon name="search" />}
              mono
              value={query}
              onChange={(e) => { setQuery(e.target.value); setAnswer(""); }}
              placeholder="куда пойдёт домен?"
              style={{ flex: 1, minWidth: 240 }}
            />
            <Button busy={asking} icon={<Icon name={asking ? "spinner" : "search"} />} onClick={ask}>{asking ? "Спрашиваем…" : "Проверить"}</Button>
          </div>
          {answer ? <CodeBlock style={{ marginTop: "var(--an-space-6)" }} maxHeight={90}>{answer}</CodeBlock> : null}
        </Card>

        {quota ? (
          <Card heading="Подписка" meta="обновлено 12 мин назад">
            <div style={{ marginTop: "var(--an-space-8)" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "var(--an-space-4)" }}>
                <span style={{ font: "var(--an-text-verdict)", fontSize: 30, letterSpacing: "-0.025em", color: "var(--an-success)", whiteSpace: "nowrap" }}>68,2 ГБ</span>
                <span style={{ font: "var(--an-text-body-sm)", color: "var(--an-text-muted)" }}>из 200 ГБ осталось</span>
              </div>
              <Meter value={66} tone="ok" style={{ marginTop: "var(--an-space-6)" }} />
              <div style={{ marginTop: "var(--an-space-4)", display: "flex", justifyContent: "space-between", font: "var(--an-text-caption)", color: "var(--an-text-muted)" }}>
                <span>израсходовано 131,8 ГБ</span>
                <span>сброс 12 сентября</span>
              </div>
              <dl style={{ marginTop: "var(--an-space-9)", display: "flex", flexDirection: "column", gap: "var(--an-space-5)", font: "var(--an-text-body-sm)" }}>
                {[["до конца периода", "15 дней", null], ["в среднем в сутки", "8,8 ГБ", null], ["хватит при таком темпе", "на 7 дней", "var(--an-warn-ink)"]].map(([k, v, c]) => (
                  <div key={k} style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--an-space-5)" }}>
                    <dt style={{ color: "var(--an-text-muted)" }}>{k}</dt>
                    <dd style={{ margin: 0, whiteSpace: "nowrap", color: c || "var(--an-text)" }}>{v}</dd>
                  </div>
                ))}
              </dl>
              <p style={{ marginTop: "var(--an-space-7)", padding: "10px 12px", borderRadius: "var(--an-radius-control)", background: "var(--an-warn-soft)", color: "var(--an-warn-ink)", font: "var(--an-text-caption)", lineHeight: 1.5 }}>
                При нынешнем темпе трафик кончится раньше сброса. Когда он кончится, узел перестанет подниматься: выход упадёт, а правила останутся на месте.
              </p>
            </div>
          </Card>
        ) : (
          <Card heading="Подписка" meta="панель не сообщает остаток">
            <p style={{ marginTop: "var(--an-space-8)", font: "var(--an-text-body-sm)", color: "var(--an-text-muted)", lineHeight: 1.55 }}>
              Остаток берётся из заголовка ответа подписки. Его отдают не все панели, а вставленные руками ссылки vless:// не несут вовсе.
            </p>
          </Card>
        )}
      </div>

      <dl className="overview-stats">
        <StatPair label="правил включено" value={rulesOn} />
        <StatPair label="устройств в сети" value="9" />
        <StatPair label="отклик · vless-nl" value="42 мс" tone="success" />
        <StatPair label="сейчас через туннели" value="4,2 Мбит/с" meta="↑ 512 кбит/с" />
      </dl>
    </div>
  );
}
