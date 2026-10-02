import React from "react";
import { Card } from "../../components/core/Card";
import { Button } from "../../components/core/Button";
import { Input } from "../../components/forms/Input";
import { Field } from "../../components/forms/Field";
import { Textarea } from "../../components/forms/Textarea";
import { SegmentedControl } from "../../components/forms/SegmentedControl";
import { IconButton } from "../../components/core/IconButton";
import { Icon } from "./Icon";
import { SERVICES, num } from "./data.js";

export function CatalogScreen({ rules, onUse, onToast }) {
  const [query, setQuery] = React.useState("");
  const [seg, setSeg] = React.useState("all");
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [kind, setKind] = React.useState("domains");
  const [text, setText] = React.useState("");
  const [mine, setMine] = React.useState([{ id: "work-vpn", name: "work-vpn", kind: "домены", count: 42 }]);

  const q = query.trim().toLowerCase();
  const usedBy = (id) => rules.filter((r) => r.services.includes(id)).map((r) => r.name);
  const rows = SERVICES
    .filter((s) => !q || s.name.toLowerCase().includes(q))
    .filter((s) => (seg === "used" ? usedBy(s.id).length > 0 : true));

  const nameBad = name.length > 0 && !/^[A-Za-z0-9_-]+$/.test(name);

  const save = () => {
    if (!/^[A-Za-z0-9_-]+$/.test(name)) { onToast("warn", "Имя списка: латиница, цифры, дефис и подчёркивание"); return; }
    const lines = text.split("\n").map((x) => x.trim()).filter(Boolean);
    if (!lines.length) { onToast("warn", "Список пуст"); return; }
    const dropped = lines.filter((x) => /\s/.test(x)).length;
    setMine((m) => [...m, { id: name, name, kind: kind === "domains" ? "домены" : "подсети", count: lines.length - dropped }]);
    onToast(dropped ? "warn" : "ok", dropped
      ? "Список «" + name + "»: строк " + (lines.length - dropped) + ", отброшено " + dropped + " — формат не подошёл"
      : "Список «" + name + "»: строк " + lines.length);
    setName(""); setText("");
  };

  return (
    <div className="console-screen" style={{ display: "flex", flexDirection: "column", gap: "var(--an-gap-block)", animation: "an-enter var(--an-dur-enter) var(--an-ease)" }}>

      <div style={{ display: "flex", alignItems: "center", gap: "var(--an-space-5)", flexWrap: "wrap" }}>
        <Input icon={<Icon name="search" />} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="поиск по каталогу" style={{ flex: 1, minWidth: 260, background: "var(--an-surface-card)" }} />
        <SegmentedControl
          value={seg}
          onChange={setSeg}
          items={[
            { value: "all", label: "все · " + SERVICES.length },
            { value: "used", label: "используются · " + SERVICES.filter((s) => usedBy(s.id).length > 0).length },
          ]}
        />
        <Button tone="secondary" icon={<Icon name="plus" />} onClick={() => setOpen(!open)}>Свой список</Button>
      </div>

      {open ? (
        <Card heading="Свои списки" meta="скачиваются один раз">
          <div style={{ marginTop: "var(--an-space-6)", display: "flex", flexDirection: "column", gap: "var(--an-space-5)" }}>
            {mine.map((l) => (
              <div key={l.id} style={{ display: "flex", alignItems: "center", gap: "var(--an-space-5)", padding: "8px 10px", borderRadius: "var(--an-radius-inner)", background: "var(--an-surface-field)", font: "var(--an-text-body-sm)" }}>
                <span style={{ flex: 1, minWidth: 0 }}>{l.name} <span style={{ font: "var(--an-text-caption)", color: "var(--an-text-muted)" }}>{l.kind} · записей {l.count}</span></span>
                <IconButton label={"Удалить " + l.name} onClick={() => { setMine((m) => m.filter((x) => x.id !== l.id)); onToast("ok", "Список «" + l.name + "» удалён"); }}><Icon name="trash" /></IconButton>
              </div>
            ))}
            <div style={{ display: "flex", gap: "var(--an-space-5)", flexWrap: "wrap", alignItems: "flex-end" }}>
              <Field label="Имя списка" error={nameBad ? "только латиница, цифры, дефис и подчёркивание" : null} style={{ flex: 1, minWidth: 200 }}>
                <Input value={name} onChange={(e) => setName(e.target.value)} invalid={nameBad} placeholder="work-vpn" style={{ height: 36 }} />
              </Field>
              <SegmentedControl value={kind} onChange={setKind} size="sm" items={[{ value: "domains", label: "домены" }, { value: "prefixes", label: "подсети" }]} />
            </div>
            <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={kind === "domains" ? "example.org\nsub.example.net" : "10.0.0.0/8\n192.0.2.1"} />
            <div style={{ display: "flex", gap: "var(--an-space-5)", flexWrap: "wrap", alignItems: "center" }}>
              <Button icon={<Icon name="plus" />} onClick={save}>Сохранить</Button>
              <Button tone="secondary" onClick={() => onToast("warn", "Скачивается один раз: расписание есть только у списков издателя")}>Скачать по ссылке</Button>
            </div>
          </div>
        </Card>
      ) : null}

      <Card style={{ padding: 0, overflow: "hidden" }}>
        {rows.map((s, i) => {
          const by = usedBy(s.id);
          return (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "var(--an-space-7)", padding: "13px 18px", borderBottom: i === rows.length - 1 ? "0" : "1px solid var(--an-border-soft)" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "var(--an-text-body)", fontWeight: "var(--an-weight-medium)" }}>{s.name}</div>
                <div style={{ marginTop: 3, font: "var(--an-text-caption)", color: "var(--an-text-muted)" }}>{s.kind}</div>
              </div>
              <div style={{ width: 110, textAlign: "right", font: "var(--an-text-body-sm)", color: "var(--an-text-secondary)" }}>{num(s.count)}</div>
              <div style={{ width: 180, textAlign: "right", font: "var(--an-text-body-sm)" }}>
                {by.length ? (
                  <span style={{ color: "var(--an-accent)" }}>{by.join(", ")}</span>
                ) : (
                  <Button tone="ghost" size="sm" onClick={() => onUse(s.id)}>В правило</Button>
                )}
              </div>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
