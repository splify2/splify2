import React from "react";
import { Card } from "../../components/core/Card";
import { Button } from "../../components/core/Button";
import { Input } from "../../components/forms/Input";
import { Checkbox } from "../../components/forms/Checkbox";
import { Radio } from "../../components/forms/Radio";
import { Field } from "../../components/forms/Field";
import { StatusDot } from "../../components/data/StatusDot";
import { Breadcrumb } from "../../components/navigation/Breadcrumb";
import { Icon } from "./Icon";
import { SERVICES, LEASES, num, outMeta } from "./data.js";

const OUTS = ["vless-nl", "wg0", "direct"];
const isMac = (x) => /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(x);
const isIp4 = (x) => /^(\d{1,3}\.){3}\d{1,3}$/.test(x) && x.split(".").every((p) => +p < 256);
const isCidr4 = (x) => /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(x) && +x.split("/")[1] <= 32 && isIp4(x.split("/")[0]);

export function RuleEditorScreen({ rule, position, total, onPatch, onClose, onDelete }) {
  const [query, setQuery] = React.useState("");
  const q = query.trim().toLowerCase();
  const shown = SERVICES.filter((s) => !q || s.name.toLowerCase().includes(q));
  const picked = rule.services;
  const totalEntries = picked.reduce((n, id) => n + (SERVICES.find((s) => s.id === id) || { count: 0 }).count, 0);

  const manual = rule.from.filter((x) => !LEASES.some((l) => l.mac === x));
  const macs = rule.from.filter((x) => x.includes(":")).length;
  const mixed = macs > 0 && macs !== rule.from.length;
  const bad = rule.from.filter((x) => (x.includes(":") ? !isMac(x) : !isIp4(x) && !isCidr4(x)));
  const fromError = mixed
    ? "Здесь и адреса, и MAC — движок такое правило отвергнет."
    : bad.length
      ? "Не адрес и не MAC: " + bad.join(", ")
      : "";

  return (
    <div className="console-screen" style={{ display: "flex", flexDirection: "column", gap: "var(--an-gap-block)", animation: "an-enter var(--an-dur-enter) var(--an-ease)" }}>
      <Breadcrumb items={[{ label: "Правила", onClick: onClose }, { label: rule.name }]} meta={"место в очереди: " + position + " из " + total} />

      <Card>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--an-space-9)" }}>
          <Input
            value={rule.name}
            onChange={(e) => onPatch({ name: e.target.value })}
            style={{ height: 46, font: "var(--an-text-heading)" }}
          />

          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--an-gap-block)", alignItems: "stretch" }}>
            <Block title="Что" meta={"записей: " + num(totalEntries)} grow={2} min={320}>
              <Input icon={<Icon name="search" />} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="поиск по каталогу" style={{ height: 34 }} />
              <div style={{ marginTop: "var(--an-space-4)", maxHeight: 210, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", gap: 2 }}>
                {shown.map((s) => {
                  const on = picked.includes(s.id);
                  return (
                    <Checkbox
                      key={s.id}
                      checked={on}
                      onChange={() => onPatch({ services: on ? picked.filter((x) => x !== s.id) : [...picked, s.id] })}
                      label={s.name}
                      meta={s.kind + " · " + num(s.count)}
                    />
                  );
                })}
              </div>
            </Block>

            <Block title="Кому" grow={1} min={240}>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--an-space-5)" }}>
                <Radio checked={rule.from.length === 0} onChange={() => onPatch({ from: [] })} label="Все устройства в сети" />
                <Radio checked={rule.from.length > 0} onChange={() => rule.from.length === 0 && onPatch({ from: [LEASES[0].mac] })} label="Только выбранные" />
                {rule.from.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "var(--an-space-4)" }}>
                    <div style={{ border: "1px solid var(--an-border)", borderRadius: "var(--an-radius-inner)", overflow: "hidden" }}>
                      {LEASES.map((l) => {
                        const on = rule.from.includes(l.mac);
                        return (
                          <Checkbox
                            key={l.mac}
                            checked={on}
                            onChange={() => onPatch({ from: on ? rule.from.filter((x) => x !== l.mac) : [...rule.from, l.mac] })}
                            label={l.name}
                            meta={<span style={{ fontFamily: "var(--an-font-mono)" }}>{l.mac}</span>}
                            style={{ borderRadius: 0 }}
                          />
                        );
                      })}
                    </div>
                    <Field hint="Либо адреса и подсети, либо MAC — вместе в одном правиле нельзя." error={fromError || null}>
                      <Input
                        mono
                        value={manual.join(", ")}
                        onChange={(e) => {
                          const list = e.target.value.split(",").map((x) => x.trim()).filter(Boolean);
                          onPatch({ from: [...rule.from.filter((x) => LEASES.some((l) => l.mac === x)), ...list] });
                        }}
                        placeholder="192.168.1.50, 192.168.1.0/24"
                        invalid={Boolean(fromError)}
                        style={{ height: 34 }}
                      />
                    </Field>
                  </div>
                ) : null}
              </div>
            </Block>

            <Block title="Куда" grow={1} min={250}>
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--an-space-5)" }}>
                {OUTS.map((name) => {
                  const m = outMeta(name);
                  return <Radio key={name} checked={rule.out === name} onChange={() => onPatch({ out: name })} dot={<StatusDot tone={m.tone} />} label={m.label} meta={m.kind} />;
                })}
              </div>
              {rule.out === "direct" ? (
                <p style={{ marginTop: "var(--an-space-6)", font: "var(--an-text-caption)", color: "var(--an-text-secondary)", lineHeight: 1.5 }}>
                  Это исключение: работает, пока правило стоит выше туннельных.
                </p>
              ) : null}
            </Block>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "var(--an-space-6)", flexWrap: "wrap", borderTop: "1px solid var(--an-border-soft)", paddingTop: "var(--an-space-7)" }}>
            <span style={{ font: "var(--an-text-body-sm)", color: "var(--an-text-secondary)" }}>
              Режим доменов: <b>fake-IP</b> — точнее, но на домен нужен элемент набора.
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: "var(--an-space-4)" }}>
              <Button tone="danger" onClick={onDelete}>Удалить правило</Button>
              <Button onClick={onClose}>Готово</Button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Block({ title, meta, grow, min, children }: { title: any; meta?: any; grow?: number; min?: number; children?: React.ReactNode }) {
  return (
    <div style={{ flex: grow + " 1 " + min + "px", minWidth: 0, border: "1px solid var(--an-border)", borderRadius: "var(--an-radius-block)", padding: "var(--an-pad-block)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--an-space-4)" }}>
        <div style={{ font: "var(--an-text-caption)", color: "var(--an-text-muted)", textTransform: "uppercase", letterSpacing: "var(--an-tracking-caps)" }}>{title}</div>
        {meta ? <div style={{ font: "var(--an-text-caption)", color: "var(--an-text-muted)" }}>{meta}</div> : null}
      </div>
      <div style={{ marginTop: "var(--an-space-5)" }}>{children}</div>
    </div>
  );
}
