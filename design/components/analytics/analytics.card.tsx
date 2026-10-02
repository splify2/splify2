import React from "react";
import { Figure } from "./Figure";
import { Delta } from "./Delta";
import { PlanMeter } from "./PlanMeter";
import { Sparkline } from "./Sparkline";
import { Bars } from "./Bars";
import { Lines } from "./Lines";
import { Heatmap } from "./Heatmap";
import { Legend } from "./Legend";
import { Table } from "./Table";
import { Badge } from "../core/Badge";

// Данные — обезличенный срез реальной панели (август): цифры настоящие по форме.
const DAYS = ["01", "03", "06", "09", "11", "13", "15", "17", "19", "22", "25", "28", "31"];
const FACT = [4.3, 4.7, 3.4, 3.5, 4.8, 4.5, 5.6, 4.6, 3.8, 5.8, null, null, null];
const FORECAST = [null, null, null, null, null, null, null, null, null, 5.8, 4.6, 5.3, 4.9];
const PREMONTH = [4.9, 4.2, 4.6, 3.9, 5.2, 4.8, 5.4, 4.3, 4.0, 5.0, 4.4, 5.1, 4.6];
const PLAN = DAYS.map(() => 3.5);
const HOURS = ["09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19+"];
const HYPER = [0.09, 0.02, 0.01, 0.10, 0.14, 0.17, 0.15, 0.12, 0.16, 0.19, 0.11];
const TP = [0.17, 0.15, 0.15, 0.07, 0.09, 0.11, 0.10, 0.08, 0.10, 0.12, 0.06];
const GHOST = [0.14, 0.21, 0.25, 0.22, 0.27, 0.29, 0.28, 0.26, 0.30, 0.34, 0.22];
const WD = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
const HEAT = WD.map((_, r) => HOURS.map((_, c) => +(0.5 + 0.06 * c + (r >= 5 ? 0.35 : 0) + ((r * 7 + c * 3) % 5) * 0.03).toFixed(2)));
const THIN = WD.map((_, r) => HOURS.map((_, c) => r === 6 && c > 8));
const PEOPLE = [
  { id: 1, name: "Сотрудник 01", league: "Платина", score: 0.41, ug: 3.9, lines: 2.13, hours: 120 },
  { id: 2, name: "Сотрудник 02", league: "Золото", score: 0.30, ug: 3.5, lines: 1.80, hours: 120 },
  { id: 3, name: "Сотрудник 03", league: "Золото", score: 0.28, ug: 4.9, lines: 1.64, hours: 110 },
  { id: 4, name: "Сотрудник 05", league: "Серебро", score: 0.08, ug: 2.6, lines: 1.63, hours: 110 },
];
const f2 = (v) => v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const f1 = (v) => v.toLocaleString("ru-RU", { maximumFractionDigits: 1 });

export function Demo() {
  const [sort, setSort] = React.useState("score");
  const rows = [...PEOPLE].sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0));
  return (
    <div className="col" style={{ gap: 18 }}>
      <div className="row" style={{ gap: 28, alignItems: "flex-start" }}>
        <Figure size="lg" live label="оборот сегодня · 25 августа" value="1,40" unit="млн ₽" delta={<Delta value={-3.8} />} caption="закрыто 10 из 11 рабочих часов · по часам разнесено 0,76 млн" />
        <dl style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 16, margin: 0, flex: 1, minWidth: 320 }}>
          <Figure label="план месяца" value="109,8" unit="млн ₽" />
          <Figure label="прогноз месяца" value="135,5" unit="млн ₽" delta={<Delta value={23.4} />} caption="интервал 120,7—154,4" />
          <Figure label="отклик источника" value="42" unit="мс" tone="success" />
        </dl>
      </div>

      <PlanMeter fact={97.2} forecast={135.5} plan={109.8} unit=" млн" />

      <div className="row" style={{ gap: 12 }}>
        <Delta value={4.2} /><Delta value={-1.6} format="pp" /><Delta value={0} neutralBand={0.1} /><Delta value={-3} higherIsBetter={false} /><Delta value={12500} format="raw" unit="₽" />
        <span className="row" style={{ gap: 8, marginLeft: "auto" }}>
          <span className="cap">строки в чеке</span><Sparkline values={[1.34, 1.33, 1.35, 1.34, 1.32, 1.36, 1.34]} reference={1.45} /><b style={{ font: "var(--an-text-heading)" }}>1,34</b>
        </span>
      </div>

      <div className="col" style={{ gap: 8 }}>
        <Legend items={[{ label: "факт", kind: "line" }, { label: "прогноз", kind: "line", dashed: true }, { label: "препрогноз", kind: "line", tone: "off", dashed: true }, { label: "план", kind: "line", tone: "ink" }]} />
        <Lines labels={DAYS} height={160} bands={[2, 3, 9, 10]} reference={3.5} referenceLabel="план в день" series={[
          { label: "факт", values: FACT, tone: "accent" },
          { label: "прогноз", values: FORECAST, tone: "accent", dashed: true },
          { label: "препрогноз", values: PREMONTH, tone: "off", dashed: true, width: 1.5 },
        ]} format={(v) => f1(v)} tipFormat={(v) => `${f1(v)} млн ₽`} />
      </div>

      <div className="col" style={{ gap: 8 }}>
        <Legend items={[{ label: "Гипер", kind: "bar" }, { label: "ТП", kind: "bar", tone: "off" }, { label: "обычный такой день", kind: "bar", dashed: true }]} />
        <Bars labels={HOURS} stacked height={150} totalLabel="магазин" series={[{ label: "Гипер", values: HYPER, tone: "accent" }, { label: "ТП", values: TP, tone: "off" }]} ghost={GHOST} ghostLabel="обычный такой день" format={(v) => f2(v)} />
      </div>

      <div className="col" style={{ gap: 8 }}>
        <Legend items={[{ label: "закрыто", kind: "bar" }, { label: "идёт сейчас", kind: "bar", fill: "half" }, { label: "ожидание до закрытия", kind: "bar", fill: "ghost" }, { label: "обычный день", kind: "bar", tone: "off", fill: "ghost" }]} />
        <Bars labels={HOURS} stacked height={150} labelSeries={0} series={[
          { label: "закрыто", values: [0.26, 0.17, 0.16, 0.17, 0.23, 0.28, 0.25, null, null, null, null], tone: "accent" },
          { label: "идёт сейчас", values: [null, null, null, null, null, null, null, 0.09, null, null, null], tone: "accent", fill: "half" },
          { label: "ожидание до закрытия", values: [null, null, null, null, null, null, null, 0.11, 0.26, 0.31, 0.17], tone: "accent", fill: "ghost" },
          { label: "обычный день", values: GHOST, tone: "off", fill: "ghost", beside: true },
        ]} format={(v) => f2(v)} />
      </div>

      <Heatmap rows={WD} cols={HOURS} values={HEAT} thin={THIN} cell={18} />

      <Table sortKey={sort} onSort={setSort} minWidth={560} dense rowKey={(r) => r.id}
        caption="4 из 11 · короткие смены скрыты"
        columns={[
          { key: "id", title: "#", width: 32, align: "right", sortable: false, render: (r) => rows.indexOf(r) + 1 },
          { key: "name", title: "сотрудник", render: (r) => <span style={{ fontWeight: "var(--an-weight-semibold)" }}>{r.name}</span> },
          { key: "league", title: "лига", sortable: false, render: (r) => <Badge tone={r.league === "Платина" ? "accent" : "neutral"}>{r.league.toLowerCase()}</Badge> },
          { key: "score", title: "балл", align: "right", render: (r) => f2(r.score) },
          { key: "ug", title: "доля УГ", align: "right", render: (r) => `${f1(r.ug)} %` },
          { key: "lines", title: "строки", align: "right", render: (r) => f2(r.lines) },
          { key: "hours", title: "часы", align: "right" },
        ]}
        rows={rows} />
    </div>
  );
}
