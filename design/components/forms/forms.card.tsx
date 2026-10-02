import React from "react";
import { Field } from "./Field";
import { Input } from "./Input";
import { Select } from "./Select";
import { Switch } from "./Switch";
import { Checkbox } from "./Checkbox";
import { Radio } from "./Radio";
import { SegmentedControl } from "./SegmentedControl";
import { Chip } from "./Chip";
import { Slider } from "./Slider";
import { StatusDot } from "../data/StatusDot";

const search = (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M21 21l-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16" /></svg>
);

export function Demo() {
  const [on, setOn] = React.useState(true);
  const [seg, setSeg] = React.useState("all");
  const [who, setWho] = React.useState("all");
  const [picked, setPicked] = React.useState({ youtube: true, telegram: false });
  const [url, setUrl] = React.useState("sub.example.com/s/9f3a1c");
  const [half, setHalf] = React.useState(45);
  const bad = url.length > 0 && !/^https?:\/\//.test(url) && !/^vless:\/\//.test(url);

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="row" style={{ gap: 16, alignItems: "flex-end" }}>
        <Field label="Ссылка на подписку" error={bad ? "Нужна ссылка https:// или vless://" : null} style={{ flex: 1, minWidth: 260 }}>
          <Input mono value={url} invalid={bad} onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Field label="Версия">
          <Select><option>1.1.3 — свежая</option><option>1.1.2</option></Select>
        </Field>
      </div>

      <Input icon={search} placeholder="поиск по каталогу" trailing="142" />

      <div className="row" style={{ gap: 20 }}>
        <SegmentedControl value={seg} onChange={setSeg} items={[{ value: "all", label: "все · 142" }, { value: "used", label: "используются · 6" }]} />
        <div className="row" style={{ gap: 10 }}>
          <Switch checked={on} onChange={() => setOn(!on)} label="Правило включено" />
          <span className="cap">{on ? "включено" : "выключено"}</span>
          <Switch size="lg" checked={!on} onChange={() => setOn(!on)} label="Тот же тумблер для телефона" />
        </div>
      </div>

      <div className="row" style={{ gap: 24, alignItems: "flex-start" }}>
        <div className="col" style={{ gap: 6, flex: 1, minWidth: 250 }}>
          <Checkbox checked={picked.youtube} onChange={() => setPicked((p) => ({ ...p, youtube: !p.youtube }))} label="YouTube" meta="домены и адреса · 41 890" />
          <Checkbox checked={picked.telegram} onChange={() => setPicked((p) => ({ ...p, telegram: !p.telegram }))} label="Telegram" meta="адреса · 3 118" />
        </div>
        <div className="col" style={{ gap: 10, flex: 1, minWidth: 220 }}>
          <Radio checked={who === "all"} onChange={() => setWho("all")} label="Все устройства в сети" />
          <Radio checked={who === "some"} onChange={() => setWho("some")} dot={<StatusDot tone="ok" />} label="vless-nl" meta="Нидерланды" />
        </div>
      </div>

      <Field label="полуспад уровня" hint="через сколько дней вес наблюдения падает вдвое" style={{ maxWidth: 420 }}>
        <Slider value={half} min={7} max={180} step={1} unit="дней" onChange={setHalf} label="полуспад уровня" />
      </Field>

      <div className="row" style={{ gap: 8 }}>
        <Chip onRemove={() => {}}>YouTube</Chip>
        <Chip onRemove={() => {}}>Google</Chip>
        <Chip tone="neutral">work-vpn</Chip>
        <Chip dashed>+ сервис</Chip>
      </div>
    </div>
  );
}
