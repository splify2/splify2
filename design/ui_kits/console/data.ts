export const SERVICES = [
  { id: "youtube", name: "YouTube", kind: "домены и адреса", count: 41890 },
  { id: "google", name: "Google", kind: "домены и адреса", count: 42422 },
  { id: "telegram", name: "Telegram", kind: "адреса", count: 3118 },
  { id: "discord", name: "Discord", kind: "домены", count: 902 },
  { id: "spotify", name: "Spotify", kind: "домены и адреса", count: 1204 },
  { id: "cloudflare", name: "Cloudflare", kind: "адреса", count: 2640 },
  { id: "netflix", name: "Netflix", kind: "домены и адреса", count: 8402 },
  { id: "adult", name: "18+", kind: "домены", count: 12908 },
];

export const LEASES = [
  { mac: "a4:83:e7:11:20:5c", name: "iPhone Кати" },
  { mac: "5c:cf:7f:8a:3d:91", name: "ТВ в зале" },
  { mac: "dc:a6:32:04:77:1e", name: "Ноутбук" },
];

export const NODES = [
  { i: 0, name: "Amsterdam #3", tag: "reality/vision", ms: 42 },
  { i: 1, name: "Amsterdam #1", tag: "reality", ms: 58 },
  { i: 2, name: "Frankfurt #2", tag: "reality/vision", ms: 71 },
  { i: 3, name: "Helsinki #1", tag: "reality", ms: 0, why: "ключ не подошёл" },
];

export const INITIAL_RULES = [
  { id: 1, name: "Spotify мимо VPN", services: ["spotify"], from: [], out: "direct", on: true },
  { id: 2, name: "YouTube", services: ["youtube", "google"], from: [], out: "vless-nl", on: true },
  { id: 3, name: "Telegram", services: ["telegram"], from: ["a4:83:e7:11:20:5c", "5c:cf:7f:8a:3d:91"], out: "wg0", on: true },
  { id: 4, name: "Discord", services: ["discord"], from: [], out: "vless-nl", on: false },
];

export const num = (n) => n.toLocaleString("ru-RU");

export function outMeta(out) {
  if (out === "direct") return { label: "напрямую", kind: "без туннеля", tone: "off" as const };
  if (out === "wg0") return { label: "wg0", kind: "свой WireGuard", tone: "ok" as const };
  return { label: "vless-nl", kind: "Нидерланды", tone: "ok" as const };
}

export function describe(rule) {
  const list = rule.services.map((id) => SERVICES.find((s) => s.id === id)).filter(Boolean);
  if (!list.length) return "сервис не выбран";
  const total = list.reduce((n, s) => n + s.count, 0);
  const names = list.length <= 2 ? list.map((s) => s.name).join(", ") : list[0].name + " и ещё " + (list.length - 1);
  return names + " · записей: " + num(total);
}

/** Снимок применённой настройки — по нему считается счётчик изменений. */
export function snapshot(rules) {
  return rules.map((r) => ({
    id: r.id, name: r.name, out: r.out, on: r.on,
    services: [...r.services].sort().join(","),
    from: [...r.from].sort().join(","),
  }));
}

/** Разница с применённым снимком, а НЕ число нажатий. */
export function countChanges(applied: any[] | null, rules: any[]) {
  if (!applied) return 0;
  const cur = snapshot(rules);
  const byId = new Map(applied.map((r) => [r.id, r]));
  let n = 0;
  for (const r of cur) {
    const a = byId.get(r.id);
    if (!a) { n += 1; continue; }
    if (a.name !== r.name || a.out !== r.out || a.on !== r.on || a.services !== r.services || a.from !== r.from) n += 1;
    byId.delete(r.id);
  }
  n += byId.size;
  const orderChanged = cur.map((r) => r.id).join(",") !== applied.map((r) => r.id).join(",");
  if (orderChanged && n === 0) n = 1;
  return n;
}
