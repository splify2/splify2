import React from "react";
import { Button } from "./Button";
import { IconButton } from "./IconButton";
import { Badge } from "./Badge";
import { Spinner } from "./Spinner";

const glyph = (d) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

export function Demo() {
  const [busy, setBusy] = React.useState(false);
  return (
    <div className="col" style={{ gap: 14 }}>
      <div className="row">
        <Button icon={glyph("M12 5v14M5 12h14")}>Новое правило</Button>
        <Button tone="secondary">Проверить</Button>
        <Button tone="ghost" size="sm">исправно: 11 — показать</Button>
        <Button tone="danger" icon={glyph("M18.4 6.6a9 9 0 1 1-12.8 0M12 2v10")}>Остановить всё</Button>
        <Button disabled>Недоступно</Button>
      </div>
      <div className="row">
        <Button busy={busy} icon={glyph("M21 12a9 9 0 1 1-6.2-8.6")} onClick={() => { setBusy(true); setTimeout(() => setBusy(false), 1600); }}>
          {busy ? "Проверяем…" : "Нажмите: состояние ожидания"}
        </Button>
        <IconButton label="Изменить">{glyph("m18 2 4 4-14 14H4v-4z")}</IconButton>
        <IconButton label="Поднять">{glyph("M12 19V5M5 12l7-7 7 7")}</IconButton>
        <IconButton label="Удалить" tone="danger">{glyph("M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6")}</IconButton>
        <Spinner />
      </div>
      <div className="row">
        <Badge>исключение</Badge>
        <Badge tone="accent">VLESS/Reality</Badge>
        <Badge tone="solid">активно</Badge>
        <Badge tone="success">ответ 42 мс</Badge>
        <Badge tone="warn">ключ не подошёл</Badge>
        <Badge tone="danger">выход упал</Badge>
      </div>
    </div>
  );
}
