import React from "react";
import { Verdict } from "./Verdict";
import { Callout } from "./Callout";
import { Toast, ToastStack } from "./Toast";
import { Dialog } from "./Dialog";
import { ApplyPill } from "./ApplyPill";
import { Button } from "../core/Button";

export function Demo() {
  const [state, setState] = React.useState<"running" | "broken" | "silent" | "loading">("running");
  const [toasts, setToasts] = React.useState<{ id: number; tone: "ok" | "warn" | "bad"; text: string }[]>([]);
  const [open, setOpen] = React.useState(false);
  const [pill, setPill] = React.useState<"idle" | "busy" | "done">("idle");
  const [changes, setChanges] = React.useState(3);

  const push = (tone: "ok" | "warn" | "bad", text: string) => {
    const id = Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  };

  return (
    <div className="col" style={{ gap: 16, paddingBottom: 64 }}>
      <Verdict state={state} meta="устройств в сети: 9 · время работы 4 ч 12 мин" />
      <div className="row" style={{ gap: 8 }}>
        {(["running", "broken", "silent", "loading"] as const).map((s) => (
          <Button key={s} tone={s === state ? "primary" : "secondary"} size="sm" onClick={() => setState(s)}>{s}</Button>
        ))}
      </div>

      <Callout title="проверок с предупреждением" count={1} verbatim="список domains/telegram.lst старше суток" action="диагностика →" onClick={() => push("warn", "Переход в диагностику")} />

      <div className="row" style={{ gap: 8 }}>
        <Button tone="secondary" size="sm" onClick={() => push("ok", "Изменение сохранено")}>Тост</Button>
        <Button tone="secondary" size="sm" onClick={() => push("warn", "Список «work-vpn»: строк 42, отброшено 3 — формат не подошёл")}>Тост с числами</Button>
        <Button tone="secondary" size="sm" onClick={() => setOpen(true)}>Диалог</Button>
        <Button tone="secondary" size="sm" onClick={() => { setChanges((c) => c + 1); setPill("idle"); }}>+ изменение</Button>
      </div>

      <ToastStack>{toasts.map((t) => <Toast key={t.id} tone={t.tone}>{t.text}</Toast>)}</ToastStack>

      <Dialog
        open={open}
        title="Остановить всё?"
        confirmLabel="Остановить"
        onCancel={() => setOpen(false)}
        onConfirm={() => { setOpen(false); push("bad", "Движок остановлен, автозапуск снят"); }}
      >
        Движок остановится, правила из ядра уйдут. Автозапуск тоже снимется — перезагрузка роутера ничего не вернёт.
      </Dialog>

      <ApplyPill
        changes={changes}
        state={pill}
        onApply={() => {
          setPill("busy");
          setTimeout(() => {
            setPill("done");
            setChanges(0);
            push("ok", "Настройка применена в ядре");
            setTimeout(() => setPill("idle"), 1500);
          }, 1400);
        }}
      />
    </div>
  );
}
