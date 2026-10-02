import React from "react";
import { Card } from "../../components/core/Card";
import { Button } from "../../components/core/Button";
import { Badge } from "../../components/core/Badge";
import { Input } from "../../components/forms/Input";
import { Field } from "../../components/forms/Field";
import { Select } from "../../components/forms/Select";
import { Checkbox } from "../../components/forms/Checkbox";
import { Radio } from "../../components/forms/Radio";
import { StatusDot } from "../../components/data/StatusDot";
import { Icon } from "./Icon";
import { NODES } from "./data.js";

export function OutputsScreen({ obfs, onObfs, onToast, onQuota }) {
  const [url, setUrl] = React.useState("https://sub.example.com/s/9f3a1c");
  const [busy, setBusy] = React.useState(false);
  const [node, setNode] = React.useState(-1);
  const [states, setStates] = React.useState({});
  const subBad = url.trim().length > 0 && !/^https?:\/\//.test(url.trim()) && !/^vless:\/\//.test(url.trim());
  const running = Object.values(states).some((s) => s === "queued" || s === "running");

  const probeAll = () => {
    if (running) { setStates({}); return; }
    const queued = {};
    NODES.forEach((n) => { queued[n.i] = "queued"; });
    setStates(queued);
    NODES.forEach((n, k) => {
      setTimeout(() => setStates((s) => ({ ...s, [n.i]: "running" })), 200 + k * 380);
      setTimeout(() => setStates((s) => ({ ...s, [n.i]: "done" })), 700 + k * 380);
    });
  };

  const isIp = (v) => /^(\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split(".").every((p) => +p < 256);
  const obfsError = !obfs.on ? "" : !obfs.host ? "" : !isIp(obfs.host) ? "Нужен адрес, а не имя: движок не разрешает имена." : "";

  return (
    <div className="console-screen" style={{ display: "flex", flexDirection: "column", gap: "var(--an-gap-block)", animation: "an-enter var(--an-dur-enter) var(--an-ease)" }}>
      <div className="console-toolbar">
        <div className="console-toolbar-note">Правило указывает на имя выхода, не на устройство.</div>
        <div style={{ display: "flex", gap: "var(--an-space-4)" }}>
          <Button tone="secondary" size="sm" onClick={() => onToast("warn", "Свободных туннельных устройств нет — поднимите туннель")}>+ Туннель</Button>
          <Button tone="secondary" size="sm" onClick={() => onToast("warn", "Свободных туннельных устройств нет — поднимите туннель")}>+ VLESS</Button>
        </div>
      </div>

      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--an-space-6)", flexWrap: "wrap" }}>
          <StatusDot tone="ok" size={9} />
          <span style={{ font: "var(--an-text-heading)", fontSize: 16 }}>vless-nl</span>
          <Badge tone="accent">VLESS/Reality</Badge>
          <span style={{ font: "var(--an-text-body-sm)", color: "var(--an-text-muted)" }}>Нидерланды · steer0 · метка 0x100000, таблица 300</span>
          <span style={{ marginLeft: "auto", font: "var(--an-text-body-sm)", color: "var(--an-success)" }}>42 мс</span>
        </div>

        <div style={{ marginTop: "var(--an-space-8)", border: "1px solid var(--an-border)", borderRadius: "var(--an-radius-block)", padding: "var(--an-pad-block)", display: "flex", flexDirection: "column", gap: "var(--an-space-5)" }}>
          <div style={{ font: "var(--an-text-caption)", color: "var(--an-text-muted)", textTransform: "uppercase", letterSpacing: "var(--an-tracking-caps)" }}>Подписка</div>
          <div style={{ display: "flex", gap: "var(--an-space-5)", flexWrap: "wrap", alignItems: "flex-end" }}>
            <Field label="Ссылка на подписку или vless://" error={subBad ? "Нужна ссылка https:// либо одна или несколько ссылок vless:// через пробел. Смешивать нельзя." : null} style={{ flex: 1, minWidth: 300 }}>
              <Input mono value={url} invalid={subBad} onChange={(e) => setUrl(e.target.value)} style={{ height: 36 }} />
            </Field>
            <Button
              tone="secondary"
              busy={busy}
              icon={<Icon name={busy ? "spinner" : "refresh"} />}
              onClick={() => { if (busy || subBad) return; setBusy(true); setTimeout(() => { setBusy(false); onToast("ok", "Подписка загружена: 4 812 байт, узлов пригодно: 6"); }, 1200); }}
            >
              {busy ? "Скачиваем…" : "Обновить"}
            </Button>
          </div>
          <div style={{ font: "var(--an-text-caption)", color: "var(--an-text-muted)" }}>
            Файл на роутере: 4 812 байт, обновлён 22.08.2026, 14:10 · узлов пригодно: 6, пропущено: 3 — транспорт tls без reality
          </div>
          <div style={{ font: "var(--an-text-caption)", color: "var(--an-text-muted)" }}>
            Идентификатор роутера для панели: <span style={{ fontFamily: "var(--an-font-mono)", userSelect: "all" }}>a4f1-9c33-71b0</span>
          </div>
          <button
            type="button"
            onClick={onQuota}
            style={{ alignSelf: "flex-start", background: "none", border: 0, padding: 0, cursor: "pointer", font: "var(--an-text-caption)", color: "var(--an-accent)", borderBottom: "1px dotted var(--an-accent)" }}
          >
            Остаток трафика — на обзоре
          </button>

          <div style={{ borderTop: "1px solid var(--an-border-soft)", paddingTop: "var(--an-space-5)", display: "flex", alignItems: "center", gap: "var(--an-space-5)" }}>
            <span style={{ font: "var(--an-text-caption)", color: "var(--an-text-muted)" }}>узлов: {NODES.length}</span>
            <Button tone="secondary" size="sm" onClick={probeAll} style={{ marginLeft: "auto" }}>{running ? "Остановить" : "Проверить все"}</Button>
          </div>

          <Radio checked={node < 0} onChange={() => setNode(-1)} label={<b>Первый рабочий</b>} meta="движок выберет сам при подъёме" />
          {NODES.map((n) => {
            const s = states[n.i];
            const good = s === "done" && !n.why;
            const bad = s === "done" && Boolean(n.why);
            return (
              <div key={n.i} style={{ display: "flex", alignItems: "center", gap: "var(--an-space-5)" }}>
                <Radio checked={node === n.i} onChange={() => setNode(n.i)} label={n.name} style={{ flex: "0 1 auto" }} />
                <Badge>{n.tag}</Badge>
                <Badge tone={bad ? "danger" : good ? "success" : "neutral"}>
                  {s === "queued" ? "в очереди" : s === "running" ? "идёт проверка" : s === "done" ? (n.why || "ответ " + n.ms + " мс") : "не проверялся"}
                </Badge>
              </div>
            );
          })}
          <p style={{ font: "var(--an-text-micro)", color: "var(--an-text-muted)" }}>
            Ответ — время до первого байта через туннель, не пинг: ICMP через туннель не ходит.
          </p>
        </div>
      </Card>

      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--an-space-6)", flexWrap: "wrap" }}>
          <StatusDot tone="ok" size={9} />
          <span style={{ font: "var(--an-text-heading)", fontSize: 16 }}>wg0</span>
          <span style={{ font: "var(--an-text-body-sm)", color: "var(--an-text-muted)" }}>свой WireGuard · NAT есть</span>
          <span style={{ marginLeft: "auto", font: "var(--an-text-body-sm)", color: "var(--an-success)" }}>61 мс</span>
        </div>

        <div style={{ marginTop: "var(--an-space-8)", border: "1px solid var(--an-border)", borderRadius: "var(--an-radius-block)", padding: "var(--an-pad-block)" }}>
          <Checkbox
            checked={obfs.on}
            onChange={() => onObfs({ on: !obfs.on })}
            label={
              <span style={{ display: "inline-flex", alignItems: "center", gap: "var(--an-space-4)" }}>
                WireGuard поверх TCP
                {obfs.on ? <Badge tone="accent">обфускация включена</Badge> : null}
              </span>
            }
          />
          <p style={{ marginTop: "var(--an-space-3)", font: "var(--an-text-caption)", color: "var(--an-text-muted)", lineHeight: 1.5 }}>
            Нужно там, где режут UDP. На другой стороне должен работать <code>steer obfs-server</code> или phantun.
          </p>
          {obfs.on ? (
            <div style={{ marginTop: "var(--an-space-6)", display: "flex", gap: "var(--an-space-6)", flexWrap: "wrap", alignItems: "flex-end" }}>
              <Field label="Сервер обфускации" error={obfsError || null}>
                <Input value={obfs.host} onChange={(e) => onObfs({ host: e.target.value })} placeholder="203.0.113.10" invalid={Boolean(obfsError)} style={{ width: 180, height: 34 }} />
              </Field>
              <Field label="Порт">
                <Input value={obfs.port} onChange={(e) => onObfs({ port: e.target.value })} placeholder="4567" style={{ width: 100, height: 34 }} />
              </Field>
              <Field label="Локальный порт" hint={"Endpoint пира: 127.0.0.1:" + (obfs.local || "51820") + " · MTU 1428"}>
                <Input value={obfs.local} onChange={(e) => onObfs({ local: e.target.value })} style={{ width: 130, height: 34 }} />
              </Field>
            </div>
          ) : null}
        </div>
      </Card>

      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--an-space-6)", flexWrap: "wrap" }}>
          <StatusDot tone="off" size={9} />
          <span style={{ font: "var(--an-text-heading)", fontSize: 16 }}>напрямую</span>
          <span style={{ font: "var(--an-text-body-sm)", color: "var(--an-text-muted)" }}>без устройства</span>
          <span style={{ marginLeft: "auto", font: "var(--an-text-body-sm)", color: "var(--an-text-muted)" }}>правил: 1</span>
        </div>
        <div style={{ marginTop: "var(--an-space-6)", display: "flex", gap: "var(--an-space-6)", flexWrap: "wrap", alignItems: "flex-end" }}>
          <Field label="Если всё упало">
            <Select size="sm"><option>Остановить трафик</option><option>Пустить напрямую</option></Select>
          </Field>
        </div>
      </Card>
    </div>
  );
}
