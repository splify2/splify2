import React from "react";
import { Rail } from "./Rail";
import { OverviewScreen } from "./OverviewScreen";
import { RulesScreen } from "./RulesScreen";
import { RuleEditorScreen } from "./RuleEditorScreen";
import { OutputsScreen } from "./OutputsScreen";
import { CatalogScreen } from "./CatalogScreen";
import { DiagnosticsScreen } from "./DiagnosticsScreen";
import { ApplyPill } from "../../components/feedback/ApplyPill";
import { Dialog } from "../../components/feedback/Dialog";
import { Toast, ToastStack } from "../../components/feedback/Toast";
import { INITIAL_RULES, SERVICES, snapshot, countChanges } from "./data.js";

const PAGE_META = {
  overview: { eyebrow: "Состояние сети", title: "Обзор", detail: "Трафик, подписка и последние проверки" },
  rules: { eyebrow: "Маршрутизация", title: "Правила", detail: "Порядок правил определяет маршрут" },
  editor: { eyebrow: "Маршрутизация", title: "Редактор правила", detail: "Изменения сохраняются сразу" },
  outputs: { eyebrow: "Подключения", title: "Выходы", detail: "Туннели и параметры их запуска" },
  catalog: { eyebrow: "Готовые наборы", title: "Каталог", detail: "Добавляйте сервисы в правила одним действием" },
  diag: { eyebrow: "Служебное", title: "Диагностика", detail: "Проверки конфигурации и журнала" },
};

export function Console() {
  const [theme, setTheme] = React.useState("light");
  const [view, setView] = React.useState("overview");
  const [editing, setEditing] = React.useState<number | null>(null);
  const [rules, setRules] = React.useState(INITIAL_RULES);
  const [applied, setApplied] = React.useState(() => snapshot(INITIAL_RULES));
  const [pill, setPill] = React.useState<"idle" | "busy" | "done">("idle");
  const [toasts, setToasts] = React.useState<{ id: number; tone: "ok" | "warn" | "bad"; text: string }[]>([]);
  const [stopOpen, setStopOpen] = React.useState(false);
  const [obfs, setObfs] = React.useState({ on: false, host: "", port: "", local: "51820" });
  const [quota, setQuota] = React.useState(true);

  const toast = (tone: "ok" | "warn" | "bad", text: string) => {
    const id = Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
  };

  const patch = (id, p) => setRules((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const move = (i, d) => {
    const j = i + d;
    if (j < 0 || j >= rules.length) return;
    const next = rules.slice();
    const t = next[i]; next[i] = next[j]; next[j] = t;
    setRules(next);
  };

  const addRule = (kind: "rule" | "exception", serviceId?: string) => {
    const id = Date.now();
    const isEx = kind === "exception";
    const rule: any = {
      id,
      name: isEx ? "исключение" : serviceId ? SERVICES.find((s) => s.id === serviceId)?.name ?? "правило" : "правило " + (rules.length + 1),
      services: serviceId ? [serviceId] : [],
      from: [],
      out: isEx ? "direct" : "vless-nl",
      on: true,
    };
    const next = rules.slice();
    if (isEx) {
      const at = next.findIndex((r) => r.out !== "direct");
      next.splice(at < 0 ? next.length : at, 0, rule);
    } else next.push(rule);
    setRules(next);
    setView("rules");
    setEditing(id);
    toast("ok", isEx ? "Исключение создано выше туннельных правил" : "Правило создано");
  };

  const apply = () => {
    setPill("busy");
    setTimeout(() => {
      setPill("done");
      setApplied(snapshot(rules));
      toast("ok", "Настройка применена в ядре");
      setTimeout(() => setPill("idle"), 1500);
    }, 1400);
  };

  const rule = rules.find((r) => r.id === editing) || null;
  const screen = rule ? "editor" : view;
  const page = PAGE_META[screen];

  return (
    <div
      data-theme={theme === "dark" ? "dark" : undefined}
      className="an-root console-root"
      style={{ minHeight: "100vh", display: "grid", gridTemplateColumns: "var(--an-rail-width) minmax(0,1fr)" }}
    >
      <Rail
        view={screen}
        onView={(v) => { setEditing(null); setView(v); }}
        rulesCount={rules.length}
        theme={theme}
        onTheme={setTheme}
        onStop={() => setStopOpen(true)}
      />

      <main className="console-main">
        <header className="console-page-header">
          <div>
            <p className="console-eyebrow">{page.eyebrow}</p>
            <h1>{page.title}</h1>
            <p className="console-page-detail">{page.detail}</p>
          </div>
          <div className="console-connection" aria-label="Ядро работает">
            <span className="console-connection-dot" />
            <span>ядро на связи</span>
          </div>
        </header>
        {screen === "overview" ? (
          <OverviewScreen
            rulesOn={rules.filter((r) => r.on).length}
            onNewRule={() => addRule("rule")}
            onDiag={() => { setEditing(null); setView("diag"); }}
            quota={quota}
          />
        ) : null}

        {screen === "rules" ? (
          <RulesScreen
            rules={rules}
            onEdit={setEditing}
            onToggle={(id) => patch(id, { on: !rules.find((r) => r.id === id)?.on })}
            onMove={move}
            onNewRule={() => addRule("rule")}
            onNewException={() => addRule("exception")}
          />
        ) : null}

        {screen === "editor" && rule ? (
          <RuleEditorScreen
            rule={rule}
            position={rules.findIndex((r) => r.id === rule.id) + 1}
            total={rules.length}
            onPatch={(p) => patch(rule.id, p)}
            onClose={() => setEditing(null)}
            onDelete={() => { setRules((rs) => rs.filter((r) => r.id !== rule.id)); setEditing(null); toast("ok", "Правило удалено"); }}
          />
        ) : null}

        {screen === "outputs" ? (
          <OutputsScreen
            obfs={obfs}
            onObfs={(p) => setObfs((o) => ({ ...o, ...p }))}
            onToast={toast}
            onQuota={() => { setQuota(true); setView("overview"); }}
          />
        ) : null}

        {screen === "catalog" ? <CatalogScreen rules={rules} onUse={(id) => addRule("rule", id)} onToast={toast} /> : null}
        {screen === "diag" ? <DiagnosticsScreen /> : null}
      </main>

      <ApplyPill changes={countChanges(applied, rules)} state={pill} onApply={apply} offset={118} />

      <ToastStack>{toasts.map((t) => <Toast key={t.id} tone={t.tone}>{t.text}</Toast>)}</ToastStack>

      <Dialog
        open={stopOpen}
        title="Остановить всё?"
        confirmLabel="Остановить"
        onCancel={() => setStopOpen(false)}
        onConfirm={() => { setStopOpen(false); toast("bad", "Движок остановлен, автозапуск снят"); }}
      >
        Движок остановится, правила из ядра уйдут. Автозапуск тоже снимется — перезагрузка роутера ничего не вернёт.
      </Dialog>
    </div>
  );
}
