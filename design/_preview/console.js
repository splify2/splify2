"use strict";
var __AndromedaConsole = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJS = (cb, mod) => function __require() {
    try {
      return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
    } catch (e) {
      throw mod = 0, e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // shim:react-shim
  var require_react_shim = __commonJS({
    "shim:react-shim"(exports, module) {
      module.exports = window.React;
    }
  });

  // shim:ds-global
  var require_ds_global = __commonJS({
    "shim:ds-global"(exports, module) {
      module.exports = window.Andromeda;
    }
  });

  // node_modules/react/cjs/react-jsx-runtime.production.min.js
  var require_react_jsx_runtime_production_min = __commonJS({
    "node_modules/react/cjs/react-jsx-runtime.production.min.js"(exports) {
      "use strict";
      var f = require_react_shim();
      var k = /* @__PURE__ */ Symbol.for("react.element");
      var l = /* @__PURE__ */ Symbol.for("react.fragment");
      var m = Object.prototype.hasOwnProperty;
      var n = f.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner;
      var p = { key: true, ref: true, __self: true, __source: true };
      function q(c, a, g) {
        var b, d = {}, e = null, h = null;
        void 0 !== g && (e = "" + g);
        void 0 !== a.key && (e = "" + a.key);
        void 0 !== a.ref && (h = a.ref);
        for (b in a) m.call(a, b) && !p.hasOwnProperty(b) && (d[b] = a[b]);
        if (c && c.defaultProps) for (b in a = c.defaultProps, a) void 0 === d[b] && (d[b] = a[b]);
        return { $$typeof: k, type: c, key: e, ref: h, props: d, _owner: n.current };
      }
      exports.Fragment = l;
      exports.jsx = q;
      exports.jsxs = q;
    }
  });

  // node_modules/react/jsx-runtime.js
  var require_jsx_runtime = __commonJS({
    "node_modules/react/jsx-runtime.js"(exports, module) {
      "use strict";
      if (true) {
        module.exports = require_react_jsx_runtime_production_min();
      } else {
        module.exports = null;
      }
    }
  });

  // src/ui_kits/console/Console.tsx
  var Console_exports = {};
  __export(Console_exports, {
    Console: () => Console
  });
  var import_react7 = __toESM(require_react_shim(), 1);

  // src/ui_kits/console/Rail.tsx
  var import_NavItem = __toESM(require_ds_global(), 1);
  var import_Button = __toESM(require_ds_global(), 1);
  var import_SegmentedControl = __toESM(require_ds_global(), 1);

  // src/ui_kits/console/Icon.tsx
  var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
  var PATHS = {
    gauge: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M3 12a9 9 0 0 1 18 0",
    route: "M4 6h6l4 12h6",
    outputs: "M6 3v12M18 9v12M6 15a6 6 0 0 0 12-6",
    catalog: "M4 4h6v16H4zM14 4h6v16h-6z",
    diag: "M4 3v7a5 5 0 0 0 10 0V3M9 15v2a4 4 0 0 0 8 0v-1",
    system: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V22a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 20.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 2 15H2a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 3.8 7L3.7 7a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 9 2.6V2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 22 9h.1a2 2 0 1 1 0 4H22a1.7 1.7 0 0 0-1.6 1z",
    plus: "M12 5v14M5 12h14",
    pencil: "m18 2 4 4-14 14H4v-4z",
    up: "M12 19V5M5 12l7-7 7 7",
    down: "M12 5v14M5 12l7 7 7-7",
    trash: "M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6",
    search: "M21 21l-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16",
    power: "M18.4 6.6a9 9 0 1 1-12.8 0M12 2v10",
    arrowRight: "M5 12h14M12 5l7 7-7 7",
    refresh: "M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6",
    spinner: "M21 12a9 9 0 1 1-6.2-8.6",
    sun: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
    moon: "M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z",
    download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"
  };
  function Icon({ name, size = 16, style }) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", style, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: PATHS[name] || PATHS.gauge }) });
  }

  // src/ui_kits/console/Rail.tsx
  var import_jsx_runtime2 = __toESM(require_jsx_runtime(), 1);
  var SECTIONS = [
    { id: "overview", label: "\u041E\u0431\u0437\u043E\u0440", icon: "gauge" },
    { id: "rules", label: "\u041F\u0440\u0430\u0432\u0438\u043B\u0430", icon: "route" },
    { id: "outputs", label: "\u0412\u044B\u0445\u043E\u0434\u044B", icon: "outputs" },
    { id: "catalog", label: "\u041A\u0430\u0442\u0430\u043B\u043E\u0433", icon: "catalog" },
    { id: "diag", label: "\u0414\u0438\u0430\u0433\u043D\u043E\u0441\u0442\u0438\u043A\u0430", icon: "diag" }
  ];
  function Rail({ view, onView, rulesCount, theme, onTheme, onStop }) {
    return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
      "aside",
      {
        style: {
          width: "var(--an-rail-width)",
          background: "var(--an-surface-rail)",
          borderRight: "1px solid var(--an-border)",
          padding: "18px 14px",
          display: "flex",
          flexDirection: "column",
          gap: "var(--an-gap-section)",
          transition: "var(--an-transition-theme)"
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "var(--an-space-5)", padding: "0 6px" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("img", { src: "../../assets/logo-andromeda.svg", alt: "", style: { width: 32, height: 32, borderRadius: 9 } }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { lineHeight: 1.15 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { font: "var(--an-text-heading)" }, children: "splify2" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { font: "var(--an-text-micro)", color: "var(--an-text-muted)" }, children: "26.9 Andromeda" })
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("nav", { style: { display: "flex", flexDirection: "column", gap: 2 }, children: SECTIONS.map((s) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            import_NavItem.NavItem,
            {
              icon: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: s.icon, size: 18 }),
              label: s.label,
              count: s.id === "rules" ? rulesCount : s.id === "outputs" ? 3 : null,
              badge: s.id === "diag" ? 1 : null,
              active: view === s.id || view === "editor" && s.id === "rules",
              onClick: () => onView(s.id)
            },
            s.id
          )) }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { marginTop: "auto", display: "flex", flexDirection: "column", gap: "var(--an-space-5)" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              import_SegmentedControl.SegmentedControl,
              {
                value: theme,
                onChange: onTheme,
                size: "sm",
                style: { display: "flex" },
                items: [
                  { value: "light", label: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 6 }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: "sun", size: 14 }),
                    " \u0421\u0432\u0435\u0442\u043B\u0430\u044F"
                  ] }) },
                  { value: "dark", label: /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 6 }, children: [
                    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: "moon", size: 14 }),
                    " \u0422\u0451\u043C\u043D\u0430\u044F"
                  ] }) }
                ]
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { border: "1px solid var(--an-border)", borderRadius: "var(--an-radius-control)", padding: 11 }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { font: "var(--an-text-caption)", color: "var(--an-text-muted)" }, children: "\u0434\u0432\u0438\u0436\u043E\u043A" }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { font: "var(--an-text-body-sm)", marginTop: 2 }, children: "steer 1.1.2 \xB7 extended" })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_Button.Button, { tone: "danger", full: true, icon: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(Icon, { name: "power" }), onClick: onStop, children: "\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0432\u0441\u0451" })
          ] })
        ]
      }
    );
  }

  // src/ui_kits/console/OverviewScreen.tsx
  var import_react = __toESM(require_react_shim(), 1);
  var import_Card = __toESM(require_ds_global(), 1);
  var import_Button2 = __toESM(require_ds_global(), 1);
  var import_Verdict = __toESM(require_ds_global(), 1);
  var import_Callout = __toESM(require_ds_global(), 1);
  var import_StatPair = __toESM(require_ds_global(), 1);
  var import_Meter = __toESM(require_ds_global(), 1);
  var import_CodeBlock = __toESM(require_ds_global(), 1);
  var import_Input = __toESM(require_ds_global(), 1);
  var import_jsx_runtime3 = __toESM(require_jsx_runtime(), 1);
  var FLOWS = [
    { name: "YouTube", out: "vless-nl", down: "12,4 \u0413\u0411", up: "1,8 \u0413\u0411", now: "4,2 \u041C\u0431\u0438\u0442/\u0441", pct: 74, tone: "accent" },
    { name: "Telegram", out: "wg0", down: "412,7 \u041C\u0411", up: "96,3 \u041C\u0411", now: "\u2014", pct: 23, tone: "accent" },
    { name: "Spotify", out: "\u043D\u0430\u043F\u0440\u044F\u043C\u0443\u044E", down: "238,4 \u041C\u0411", up: "12,1 \u041C\u0411", now: "\u2014", pct: 13, tone: "off" }
  ];
  function OverviewScreen({ rulesOn, onNewRule, onDiag, quota = true }) {
    const [query, setQuery] = import_react.default.useState("youtube.com");
    const [asking, setAsking] = import_react.default.useState(false);
    const [answer, setAnswer] = import_react.default.useState("");
    const ask = () => {
      if (asking) return;
      setAsking(true);
      setTimeout(() => {
        setAsking(false);
        setAnswer(
          (query || "youtube.com").trim() + " -> 198.18.0.42 (fake-IP)\n\u043F\u0440\u0430\u0432\u0438\u043B\u043E YouTube -> \u0432\u044B\u0445\u043E\u0434 vless-nl (\u043C\u0435\u0442\u043A\u0430 0x100000, \u0442\u0430\u0431\u043B\u0438\u0446\u0430 300)\n\u043E\u0442\u0432\u0435\u0442 \u043E\u0442 \u0440\u0435\u0437\u043E\u043B\u0432\u0435\u0440\u0430 steer, 3 \u043C\u0441"
        );
      }, 1e3);
    };
    return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: "var(--an-gap-section)", animation: "an-enter var(--an-dur-enter) var(--an-ease)" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "flex-start", gap: "var(--an-space-8)", flexWrap: "wrap" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_Verdict.Verdict, { state: "running", meta: "\u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432 \u0432 \u0441\u0435\u0442\u0438: 9 \xB7 \u0432\u0440\u0435\u043C\u044F \u0440\u0430\u0431\u043E\u0442\u044B 4 \u0447 12 \u043C\u0438\u043D", style: { flex: 1, minWidth: 280 } }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_Button2.Button, { icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { name: "plus" }), onClick: onNewRule, children: "\u041D\u043E\u0432\u043E\u0435 \u043F\u0440\u0430\u0432\u0438\u043B\u043E" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_Callout.Callout, { title: "\u043F\u0440\u043E\u0432\u0435\u0440\u043E\u043A \u0441 \u043F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435\u043C", count: 1, verbatim: "\u0441\u043F\u0438\u0441\u043E\u043A domains/telegram.lst \u0441\u0442\u0430\u0440\u0448\u0435 \u0441\u0443\u0442\u043E\u043A", action: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: 5 }, children: [
        "\u0434\u0438\u0430\u0433\u043D\u043E\u0441\u0442\u0438\u043A\u0430 ",
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { name: "arrowRight", size: 14 })
      ] }), onClick: onDiag }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "grid", gridTemplateColumns: "minmax(0,1.5fr) minmax(0,1fr)", gap: "var(--an-gap-block)", alignItems: "start" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)(import_Card.Card, { heading: "\u041A\u0443\u0434\u0430 \u0438\u0434\u0451\u0442 \u0442\u0440\u0430\u0444\u0438\u043A", meta: "\u0441 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438 \u0440\u043E\u0443\u0442\u0435\u0440\u0430", children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("div", { style: { marginTop: "var(--an-space-8)", display: "flex", flexDirection: "column", gap: "var(--an-space-7)" }, children: FLOWS.map((f, i) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "baseline", gap: "var(--an-space-5)", font: "var(--an-text-body-sm)" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: { flex: 1, minWidth: 0 }, children: [
                f.name,
                " ",
                /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: { color: "var(--an-text-muted)" }, children: [
                  "\u2192 ",
                  f.out
                ] })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: { color: "var(--an-text-secondary)" }, children: [
                "\u2193 ",
                f.down
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("span", { style: { color: "var(--an-text-muted)" }, children: [
                "\u2191 ",
                f.up
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { width: 96, textAlign: "right", color: f.now === "\u2014" ? "var(--an-text-muted)" : "var(--an-text-secondary)" }, children: f.now })
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_Meter.Meter, { value: f.pct, tone: f.tone, height: 8, delay: i * 70, style: { marginTop: "var(--an-space-3)" } })
          ] }, f.name)) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { marginTop: "var(--an-space-9)", paddingTop: "var(--an-space-8)", borderTop: "1px solid var(--an-border-soft)", display: "flex", gap: "var(--an-space-6)", flexWrap: "wrap" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(
              import_Input.Input,
              {
                icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { name: "search" }),
                mono: true,
                value: query,
                onChange: (e) => {
                  setQuery(e.target.value);
                  setAnswer("");
                },
                placeholder: "\u043A\u0443\u0434\u0430 \u043F\u043E\u0439\u0434\u0451\u0442 \u0434\u043E\u043C\u0435\u043D?",
                style: { flex: 1, minWidth: 240 }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_Button2.Button, { busy: asking, icon: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(Icon, { name: asking ? "spinner" : "search" }), onClick: ask, children: asking ? "\u0421\u043F\u0440\u0430\u0448\u0438\u0432\u0430\u0435\u043C\u2026" : "\u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C" })
          ] }),
          answer ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_CodeBlock.CodeBlock, { style: { marginTop: "var(--an-space-6)" }, maxHeight: 90, children: answer }) : null
        ] }),
        quota ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_Card.Card, { heading: "\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430", meta: "\u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u043E 12 \u043C\u0438\u043D \u043D\u0430\u0437\u0430\u0434", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { marginTop: "var(--an-space-8)" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "baseline", gap: "var(--an-space-4)" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { font: "var(--an-text-verdict)", fontSize: 30, letterSpacing: "-0.025em", color: "var(--an-success)", whiteSpace: "nowrap" }, children: "68,2 \u0413\u0411" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { style: { font: "var(--an-text-body-sm)", color: "var(--an-text-muted)" }, children: "\u0438\u0437 200 \u0413\u0411 \u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_Meter.Meter, { value: 66, tone: "ok", style: { marginTop: "var(--an-space-6)" } }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { marginTop: "var(--an-space-4)", display: "flex", justifyContent: "space-between", font: "var(--an-text-caption)", color: "var(--an-text-muted)" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u0438\u0437\u0440\u0430\u0441\u0445\u043E\u0434\u043E\u0432\u0430\u043D\u043E 131,8 \u0413\u0411" }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { children: "\u0441\u0431\u0440\u043E\u0441 12 \u0441\u0435\u043D\u0442\u044F\u0431\u0440\u044F" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dl", { style: { marginTop: "var(--an-space-9)", display: "flex", flexDirection: "column", gap: "var(--an-space-5)", font: "var(--an-text-body-sm)" }, children: [["\u0434\u043E \u043A\u043E\u043D\u0446\u0430 \u043F\u0435\u0440\u0438\u043E\u0434\u0430", "15 \u0434\u043D\u0435\u0439", null], ["\u0432 \u0441\u0440\u0435\u0434\u043D\u0435\u043C \u0432 \u0441\u0443\u0442\u043A\u0438", "8,8 \u0413\u0411", null], ["\u0445\u0432\u0430\u0442\u0438\u0442 \u043F\u0440\u0438 \u0442\u0430\u043A\u043E\u043C \u0442\u0435\u043C\u043F\u0435", "\u043D\u0430 7 \u0434\u043D\u0435\u0439", "var(--an-warn-ink)"]].map(([k, v, c]) => /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { style: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--an-space-5)" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dt", { style: { color: "var(--an-text-muted)" }, children: k }),
            /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("dd", { style: { margin: 0, whiteSpace: "nowrap", color: c || "var(--an-text)" }, children: v })
          ] }, k)) }),
          /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: { marginTop: "var(--an-space-7)", padding: "10px 12px", borderRadius: "var(--an-radius-control)", background: "var(--an-warn-soft)", color: "var(--an-warn-ink)", font: "var(--an-text-caption)", lineHeight: 1.5 }, children: "\u041F\u0440\u0438 \u043D\u044B\u043D\u0435\u0448\u043D\u0435\u043C \u0442\u0435\u043C\u043F\u0435 \u0442\u0440\u0430\u0444\u0438\u043A \u043A\u043E\u043D\u0447\u0438\u0442\u0441\u044F \u0440\u0430\u043D\u044C\u0448\u0435 \u0441\u0431\u0440\u043E\u0441\u0430. \u041A\u043E\u0433\u0434\u0430 \u043E\u043D \u043A\u043E\u043D\u0447\u0438\u0442\u0441\u044F, \u0443\u0437\u0435\u043B \u043F\u0435\u0440\u0435\u0441\u0442\u0430\u043D\u0435\u0442 \u043F\u043E\u0434\u043D\u0438\u043C\u0430\u0442\u044C\u0441\u044F: \u0432\u044B\u0445\u043E\u0434 \u0443\u043F\u0430\u0434\u0451\u0442, \u0430 \u043F\u0440\u0430\u0432\u0438\u043B\u0430 \u043E\u0441\u0442\u0430\u043D\u0443\u0442\u0441\u044F \u043D\u0430 \u043C\u0435\u0441\u0442\u0435." })
        ] }) }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_Card.Card, { heading: "\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430", meta: "\u043F\u0430\u043D\u0435\u043B\u044C \u043D\u0435 \u0441\u043E\u043E\u0431\u0449\u0430\u0435\u0442 \u043E\u0441\u0442\u0430\u0442\u043E\u043A", children: /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("p", { style: { marginTop: "var(--an-space-8)", font: "var(--an-text-body-sm)", color: "var(--an-text-muted)", lineHeight: 1.55 }, children: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A \u0431\u0435\u0440\u0451\u0442\u0441\u044F \u0438\u0437 \u0437\u0430\u0433\u043E\u043B\u043E\u0432\u043A\u0430 \u043E\u0442\u0432\u0435\u0442\u0430 \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0438. \u0415\u0433\u043E \u043E\u0442\u0434\u0430\u044E\u0442 \u043D\u0435 \u0432\u0441\u0435 \u043F\u0430\u043D\u0435\u043B\u0438, \u0430 \u0432\u0441\u0442\u0430\u0432\u043B\u0435\u043D\u043D\u044B\u0435 \u0440\u0443\u043A\u0430\u043C\u0438 \u0441\u0441\u044B\u043B\u043A\u0438 vless:// \u043D\u0435 \u043D\u0435\u0441\u0443\u0442 \u0432\u043E\u0432\u0441\u0435." }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("dl", { style: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: "var(--an-gap-block)", margin: 0 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_StatPair.StatPair, { label: "\u043F\u0440\u0430\u0432\u0438\u043B \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u043E", value: rulesOn }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_StatPair.StatPair, { label: "\u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432 \u0432 \u0441\u0435\u0442\u0438", value: "9" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_StatPair.StatPair, { label: "\u043E\u0442\u043A\u043B\u0438\u043A \xB7 vless-nl", value: "42 \u043C\u0441", tone: "success" }),
        /* @__PURE__ */ (0, import_jsx_runtime3.jsx)(import_StatPair.StatPair, { label: "\u0441\u0435\u0439\u0447\u0430\u0441 \u0447\u0435\u0440\u0435\u0437 \u0442\u0443\u043D\u043D\u0435\u043B\u0438", value: "4,2 \u041C\u0431\u0438\u0442/\u0441", meta: "\u2191 512 \u043A\u0431\u0438\u0442/\u0441" })
      ] })
    ] });
  }

  // src/ui_kits/console/RulesScreen.tsx
  var import_react2 = __toESM(require_react_shim(), 1);
  var import_Button3 = __toESM(require_ds_global(), 1);
  var import_Badge = __toESM(require_ds_global(), 1);
  var import_IconButton = __toESM(require_ds_global(), 1);
  var import_Switch = __toESM(require_ds_global(), 1);
  var import_ListRow = __toESM(require_ds_global(), 1);
  var import_StatusDot = __toESM(require_ds_global(), 1);

  // src/ui_kits/console/data.ts
  var SERVICES = [
    { id: "youtube", name: "YouTube", kind: "\u0434\u043E\u043C\u0435\u043D\u044B \u0438 \u0430\u0434\u0440\u0435\u0441\u0430", count: 41890 },
    { id: "google", name: "Google", kind: "\u0434\u043E\u043C\u0435\u043D\u044B \u0438 \u0430\u0434\u0440\u0435\u0441\u0430", count: 42422 },
    { id: "telegram", name: "Telegram", kind: "\u0430\u0434\u0440\u0435\u0441\u0430", count: 3118 },
    { id: "discord", name: "Discord", kind: "\u0434\u043E\u043C\u0435\u043D\u044B", count: 902 },
    { id: "spotify", name: "Spotify", kind: "\u0434\u043E\u043C\u0435\u043D\u044B \u0438 \u0430\u0434\u0440\u0435\u0441\u0430", count: 1204 },
    { id: "cloudflare", name: "Cloudflare", kind: "\u0430\u0434\u0440\u0435\u0441\u0430", count: 2640 },
    { id: "netflix", name: "Netflix", kind: "\u0434\u043E\u043C\u0435\u043D\u044B \u0438 \u0430\u0434\u0440\u0435\u0441\u0430", count: 8402 },
    { id: "adult", name: "18+", kind: "\u0434\u043E\u043C\u0435\u043D\u044B", count: 12908 }
  ];
  var LEASES = [
    { mac: "a4:83:e7:11:20:5c", name: "iPhone \u041A\u0430\u0442\u0438" },
    { mac: "5c:cf:7f:8a:3d:91", name: "\u0422\u0412 \u0432 \u0437\u0430\u043B\u0435" },
    { mac: "dc:a6:32:04:77:1e", name: "\u041D\u043E\u0443\u0442\u0431\u0443\u043A" }
  ];
  var NODES = [
    { i: 0, name: "Amsterdam #3", tag: "reality/vision", ms: 42 },
    { i: 1, name: "Amsterdam #1", tag: "reality", ms: 58 },
    { i: 2, name: "Frankfurt #2", tag: "reality/vision", ms: 71 },
    { i: 3, name: "Helsinki #1", tag: "reality", ms: 0, why: "\u043A\u043B\u044E\u0447 \u043D\u0435 \u043F\u043E\u0434\u043E\u0448\u0451\u043B" }
  ];
  var INITIAL_RULES = [
    { id: 1, name: "Spotify \u043C\u0438\u043C\u043E VPN", services: ["spotify"], from: [], out: "direct", on: true },
    { id: 2, name: "YouTube", services: ["youtube", "google"], from: [], out: "vless-nl", on: true },
    { id: 3, name: "Telegram", services: ["telegram"], from: ["a4:83:e7:11:20:5c", "5c:cf:7f:8a:3d:91"], out: "wg0", on: true },
    { id: 4, name: "Discord", services: ["discord"], from: [], out: "vless-nl", on: false }
  ];
  var num = (n) => n.toLocaleString("ru-RU");
  function outMeta(out) {
    if (out === "direct") return { label: "\u043D\u0430\u043F\u0440\u044F\u043C\u0443\u044E", kind: "\u0431\u0435\u0437 \u0442\u0443\u043D\u043D\u0435\u043B\u044F", tone: "off" };
    if (out === "wg0") return { label: "wg0", kind: "\u0441\u0432\u043E\u0439 WireGuard", tone: "ok" };
    return { label: "vless-nl", kind: "\u041D\u0438\u0434\u0435\u0440\u043B\u0430\u043D\u0434\u044B", tone: "ok" };
  }
  function describe(rule) {
    const list = rule.services.map((id) => SERVICES.find((s) => s.id === id)).filter(Boolean);
    if (!list.length) return "\u0441\u0435\u0440\u0432\u0438\u0441 \u043D\u0435 \u0432\u044B\u0431\u0440\u0430\u043D";
    const total = list.reduce((n, s) => n + s.count, 0);
    const names = list.length <= 2 ? list.map((s) => s.name).join(", ") : list[0].name + " \u0438 \u0435\u0449\u0451 " + (list.length - 1);
    return names + " \xB7 \u0437\u0430\u043F\u0438\u0441\u0435\u0439: " + num(total);
  }
  function snapshot(rules) {
    return rules.map((r) => ({
      id: r.id,
      name: r.name,
      out: r.out,
      on: r.on,
      services: [...r.services].sort().join(","),
      from: [...r.from].sort().join(",")
    }));
  }
  function countChanges(applied, rules) {
    if (!applied) return 0;
    const cur = snapshot(rules);
    const byId = new Map(applied.map((r) => [r.id, r]));
    let n = 0;
    for (const r of cur) {
      const a = byId.get(r.id);
      if (!a) {
        n += 1;
        continue;
      }
      if (a.name !== r.name || a.out !== r.out || a.on !== r.on || a.services !== r.services || a.from !== r.from) n += 1;
      byId.delete(r.id);
    }
    n += byId.size;
    const orderChanged = cur.map((r) => r.id).join(",") !== applied.map((r) => r.id).join(",");
    if (orderChanged && n === 0) n = 1;
    return n;
  }

  // src/ui_kits/console/RulesScreen.tsx
  var import_jsx_runtime4 = __toESM(require_jsx_runtime(), 1);
  function RulesScreen({ rules, onEdit, onToggle, onMove, onNewRule, onNewException }) {
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: "var(--an-gap-block)", animation: "an-enter var(--an-dur-enter) var(--an-ease)" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { display: "flex", alignItems: "flex-start", gap: "var(--an-space-8)", flexWrap: "wrap" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { flex: 1, minWidth: 240 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("h1", { style: { font: "var(--an-text-title)", letterSpacing: "var(--an-tracking-title)" }, children: "\u041F\u0440\u0430\u0432\u0438\u043B\u0430" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("p", { style: { marginTop: "var(--an-space-3)", font: "var(--an-text-body-sm)", color: "var(--an-text-muted)" }, children: "\u0421\u0432\u0435\u0440\u0445\u0443 \u0432\u043D\u0438\u0437 \u2014 \u043F\u043E\u0431\u0435\u0436\u0434\u0430\u0435\u0442 \u043F\u0435\u0440\u0432\u043E\u0435 \u0441\u043E\u0432\u043F\u0430\u0434\u0435\u043D\u0438\u0435." })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { display: "flex", gap: "var(--an-space-4)" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_Button3.Button, { tone: "secondary", onClick: onNewException, children: "\u0418\u0441\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435" }),
          /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_Button3.Button, { icon: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Icon, { name: "plus" }), onClick: onNewRule, children: "\u041D\u043E\u0432\u043E\u0435 \u043F\u0440\u0430\u0432\u0438\u043B\u043E" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("div", { style: { display: "flex", flexDirection: "column", gap: "var(--an-gap-row)" }, children: rules.map((rule, i) => {
        const m = outMeta(rule.out);
        const isException = rule.out === "direct";
        return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
          import_ListRow.ListRow,
          {
            index: i + 1,
            handle: true,
            dimmed: !rule.on,
            title: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: "var(--an-space-4)", flexWrap: "wrap" }, children: [
              rule.name,
              isException ? /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_Badge.Badge, { children: "\u0438\u0441\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435" }) : null
            ] }),
            actions: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(import_react2.default.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_IconButton.IconButton, { label: "\u041F\u043E\u0434\u043D\u044F\u0442\u044C \u043F\u0440\u0438\u043E\u0440\u0438\u0442\u0435\u0442", disabled: i === 0, onClick: () => onMove(i, -1), children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Icon, { name: "up" }) }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_IconButton.IconButton, { label: "\u041E\u043F\u0443\u0441\u0442\u0438\u0442\u044C \u043F\u0440\u0438\u043E\u0440\u0438\u0442\u0435\u0442", disabled: i === rules.length - 1, onClick: () => onMove(i, 1), children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Icon, { name: "down" }) }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_IconButton.IconButton, { label: "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C " + rule.name, onClick: () => onEdit(rule.id), children: /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Icon, { name: "pencil" }) }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_Switch.Switch, { checked: rule.on, onChange: () => onToggle(rule.id), label: rule.name })
            ] }),
            children: /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)("div", { style: { marginTop: "var(--an-space-3)", display: "flex", alignItems: "center", gap: "var(--an-space-4)", flexWrap: "wrap", font: "var(--an-text-body-sm)", color: "var(--an-text-secondary)" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Cell, { children: describe(rule) }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)("span", { style: { color: "var(--an-text-muted)" }, children: "\u0434\u043B\u044F" }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Cell, { children: rule.from.length ? "\u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432: " + rule.from.length : "\u0432\u0441\u0435\u0445 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432" }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(Icon, { name: "arrowRight", size: 15, style: { color: "var(--an-text-muted)" } }),
              /* @__PURE__ */ (0, import_jsx_runtime4.jsxs)(Cell, { tone: isException ? "neutral" : "accent", children: [
                /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(import_StatusDot.StatusDot, { tone: m.tone, size: 7 }),
                " ",
                m.label,
                " \xB7 ",
                m.kind
              ] })
            ] })
          },
          rule.id
        );
      }) })
    ] });
  }
  function Cell({ tone = "neutral", children }) {
    const accent = tone === "accent";
    return /* @__PURE__ */ (0, import_jsx_runtime4.jsx)(
      "span",
      {
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: "var(--an-space-3)",
          height: 24,
          padding: "0 9px",
          borderRadius: "var(--an-radius-inner)",
          border: "1px solid " + (accent ? "var(--an-accent-line)" : "var(--an-border)"),
          background: accent ? "var(--an-accent-soft)" : "var(--an-surface-field)",
          color: accent ? "var(--an-accent)" : "inherit",
          fontWeight: accent ? "var(--an-weight-medium)" : "var(--an-weight-regular)",
          whiteSpace: "nowrap"
        },
        children
      }
    );
  }

  // src/ui_kits/console/RuleEditorScreen.tsx
  var import_react3 = __toESM(require_react_shim(), 1);
  var import_Card2 = __toESM(require_ds_global(), 1);
  var import_Button4 = __toESM(require_ds_global(), 1);
  var import_Input2 = __toESM(require_ds_global(), 1);
  var import_Checkbox = __toESM(require_ds_global(), 1);
  var import_Radio = __toESM(require_ds_global(), 1);
  var import_Field = __toESM(require_ds_global(), 1);
  var import_StatusDot2 = __toESM(require_ds_global(), 1);
  var import_Breadcrumb = __toESM(require_ds_global(), 1);
  var import_jsx_runtime5 = __toESM(require_jsx_runtime(), 1);
  var OUTS = ["vless-nl", "wg0", "direct"];
  var isMac = (x) => /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i.test(x);
  var isIp4 = (x) => /^(\d{1,3}\.){3}\d{1,3}$/.test(x) && x.split(".").every((p) => +p < 256);
  var isCidr4 = (x) => /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/.test(x) && +x.split("/")[1] <= 32 && isIp4(x.split("/")[0]);
  function RuleEditorScreen({ rule, position, total, onPatch, onClose, onDelete }) {
    const [query, setQuery] = import_react3.default.useState("");
    const q = query.trim().toLowerCase();
    const shown = SERVICES.filter((s) => !q || s.name.toLowerCase().includes(q));
    const picked = rule.services;
    const totalEntries = picked.reduce((n, id) => n + (SERVICES.find((s) => s.id === id) || { count: 0 }).count, 0);
    const manual = rule.from.filter((x) => !LEASES.some((l) => l.mac === x));
    const macs = rule.from.filter((x) => x.includes(":")).length;
    const mixed = macs > 0 && macs !== rule.from.length;
    const bad = rule.from.filter((x) => x.includes(":") ? !isMac(x) : !isIp4(x) && !isCidr4(x));
    const fromError = mixed ? "\u0417\u0434\u0435\u0441\u044C \u0438 \u0430\u0434\u0440\u0435\u0441\u0430, \u0438 MAC \u2014 \u0434\u0432\u0438\u0436\u043E\u043A \u0442\u0430\u043A\u043E\u0435 \u043F\u0440\u0430\u0432\u0438\u043B\u043E \u043E\u0442\u0432\u0435\u0440\u0433\u043D\u0435\u0442." : bad.length ? "\u041D\u0435 \u0430\u0434\u0440\u0435\u0441 \u0438 \u043D\u0435 MAC: " + bad.join(", ") : "";
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: "var(--an-gap-block)", animation: "an-enter var(--an-dur-enter) var(--an-ease)" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_Breadcrumb.Breadcrumb, { items: [{ label: "\u041F\u0440\u0430\u0432\u0438\u043B\u0430", onClick: onClose }, { label: rule.name }], meta: "\u043C\u0435\u0441\u0442\u043E \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438: " + position + " \u0438\u0437 " + total }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_Card2.Card, { children: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: "var(--an-space-9)" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
          import_Input2.Input,
          {
            value: rule.name,
            onChange: (e) => onPatch({ name: e.target.value }),
            style: { height: 46, font: "var(--an-text-heading)" }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { display: "flex", flexWrap: "wrap", gap: "var(--an-gap-block)", alignItems: "stretch" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(Block, { title: "\u0427\u0442\u043E", meta: "\u0437\u0430\u043F\u0438\u0441\u0435\u0439: " + num(totalEntries), grow: 2, min: 320, children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_Input2.Input, { icon: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Icon, { name: "search" }), value: query, onChange: (e) => setQuery(e.target.value), placeholder: "\u043F\u043E\u0438\u0441\u043A \u043F\u043E \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0443", style: { height: 34 } }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { marginTop: "var(--an-space-4)", maxHeight: 210, overflowY: "auto", overflowX: "hidden", display: "flex", flexDirection: "column", gap: 2 }, children: shown.map((s) => {
              const on = picked.includes(s.id);
              return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                import_Checkbox.Checkbox,
                {
                  checked: on,
                  onChange: () => onPatch({ services: on ? picked.filter((x) => x !== s.id) : [...picked, s.id] }),
                  label: s.name,
                  meta: s.kind + " \xB7 " + num(s.count)
                },
                s.id
              );
            }) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(Block, { title: "\u041A\u043E\u043C\u0443", grow: 1, min: 240, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: "var(--an-space-5)" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_Radio.Radio, { checked: rule.from.length === 0, onChange: () => onPatch({ from: [] }), label: "\u0412\u0441\u0435 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430 \u0432 \u0441\u0435\u0442\u0438" }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_Radio.Radio, { checked: rule.from.length > 0, onChange: () => rule.from.length === 0 && onPatch({ from: [LEASES[0].mac] }), label: "\u0422\u043E\u043B\u044C\u043A\u043E \u0432\u044B\u0431\u0440\u0430\u043D\u043D\u044B\u0435" }),
            rule.from.length > 0 ? /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: "var(--an-space-4)" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { border: "1px solid var(--an-border)", borderRadius: "var(--an-radius-inner)", overflow: "hidden" }, children: LEASES.map((l) => {
                const on = rule.from.includes(l.mac);
                return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                  import_Checkbox.Checkbox,
                  {
                    checked: on,
                    onChange: () => onPatch({ from: on ? rule.from.filter((x) => x !== l.mac) : [...rule.from, l.mac] }),
                    label: l.name,
                    meta: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("span", { style: { fontFamily: "var(--an-font-mono)" }, children: l.mac }),
                    style: { borderRadius: 0 }
                  },
                  l.mac
                );
              }) }),
              /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_Field.Field, { hint: "\u041B\u0438\u0431\u043E \u0430\u0434\u0440\u0435\u0441\u0430 \u0438 \u043F\u043E\u0434\u0441\u0435\u0442\u0438, \u043B\u0438\u0431\u043E MAC \u2014 \u0432\u043C\u0435\u0441\u0442\u0435 \u0432 \u043E\u0434\u043D\u043E\u043C \u043F\u0440\u0430\u0432\u0438\u043B\u0435 \u043D\u0435\u043B\u044C\u0437\u044F.", error: fromError || null, children: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(
                import_Input2.Input,
                {
                  mono: true,
                  value: manual.join(", "),
                  onChange: (e) => {
                    const list = e.target.value.split(",").map((x) => x.trim()).filter(Boolean);
                    onPatch({ from: [...rule.from.filter((x) => LEASES.some((l) => l.mac === x)), ...list] });
                  },
                  placeholder: "192.168.1.50, 192.168.1.0/24",
                  invalid: Boolean(fromError),
                  style: { height: 34 }
                }
              ) })
            ] }) : null
          ] }) }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)(Block, { title: "\u041A\u0443\u0434\u0430", grow: 1, min: 250, children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { display: "flex", flexDirection: "column", gap: "var(--an-space-5)" }, children: OUTS.map((name) => {
              const m = outMeta(name);
              return /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_Radio.Radio, { checked: rule.out === name, onChange: () => onPatch({ out: name }), dot: /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_StatusDot2.StatusDot, { tone: m.tone }), label: m.label, meta: m.kind }, name);
            }) }),
            rule.out === "direct" ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("p", { style: { marginTop: "var(--an-space-6)", font: "var(--an-text-caption)", color: "var(--an-text-secondary)", lineHeight: 1.5 }, children: "\u042D\u0442\u043E \u0438\u0441\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435: \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442, \u043F\u043E\u043A\u0430 \u043F\u0440\u0430\u0432\u0438\u043B\u043E \u0441\u0442\u043E\u0438\u0442 \u0432\u044B\u0448\u0435 \u0442\u0443\u043D\u043D\u0435\u043B\u044C\u043D\u044B\u0445." }) : null
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "var(--an-space-6)", flexWrap: "wrap", borderTop: "1px solid var(--an-border-soft)", paddingTop: "var(--an-space-7)" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("span", { style: { font: "var(--an-text-body-sm)", color: "var(--an-text-secondary)" }, children: [
            "\u0420\u0435\u0436\u0438\u043C \u0434\u043E\u043C\u0435\u043D\u043E\u0432: ",
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("b", { children: "fake-IP" }),
            " \u2014 \u0442\u043E\u0447\u043D\u0435\u0435, \u043D\u043E \u043D\u0430 \u0434\u043E\u043C\u0435\u043D \u043D\u0443\u0436\u0435\u043D \u044D\u043B\u0435\u043C\u0435\u043D\u0442 \u043D\u0430\u0431\u043E\u0440\u0430."
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { marginLeft: "auto", display: "flex", gap: "var(--an-space-4)" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_Button4.Button, { tone: "danger", onClick: onDelete, children: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u043F\u0440\u0430\u0432\u0438\u043B\u043E" }),
            /* @__PURE__ */ (0, import_jsx_runtime5.jsx)(import_Button4.Button, { onClick: onClose, children: "\u0413\u043E\u0442\u043E\u0432\u043E" })
          ] })
        ] })
      ] }) })
    ] });
  }
  function Block({ title, meta, grow, min, children }) {
    return /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { flex: grow + " 1 " + min + "px", minWidth: 0, border: "1px solid var(--an-border)", borderRadius: "var(--an-radius-block)", padding: "var(--an-pad-block)" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime5.jsxs)("div", { style: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "var(--an-space-4)" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { font: "var(--an-text-caption)", color: "var(--an-text-muted)", textTransform: "uppercase", letterSpacing: "var(--an-tracking-caps)" }, children: title }),
        meta ? /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { font: "var(--an-text-caption)", color: "var(--an-text-muted)" }, children: meta }) : null
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime5.jsx)("div", { style: { marginTop: "var(--an-space-5)" }, children })
    ] });
  }

  // src/ui_kits/console/OutputsScreen.tsx
  var import_react4 = __toESM(require_react_shim(), 1);
  var import_Card3 = __toESM(require_ds_global(), 1);
  var import_Button5 = __toESM(require_ds_global(), 1);
  var import_Badge2 = __toESM(require_ds_global(), 1);
  var import_Input3 = __toESM(require_ds_global(), 1);
  var import_Field2 = __toESM(require_ds_global(), 1);
  var import_Select = __toESM(require_ds_global(), 1);
  var import_Checkbox2 = __toESM(require_ds_global(), 1);
  var import_Radio2 = __toESM(require_ds_global(), 1);
  var import_StatusDot3 = __toESM(require_ds_global(), 1);
  var import_jsx_runtime6 = __toESM(require_jsx_runtime(), 1);
  function OutputsScreen({ obfs, onObfs, onToast, onQuota }) {
    const [url, setUrl] = import_react4.default.useState("https://sub.example.com/s/9f3a1c");
    const [busy, setBusy] = import_react4.default.useState(false);
    const [node, setNode] = import_react4.default.useState(-1);
    const [states, setStates] = import_react4.default.useState({});
    const subBad = url.trim().length > 0 && !/^https?:\/\//.test(url.trim()) && !/^vless:\/\//.test(url.trim());
    const running = Object.values(states).some((s) => s === "queued" || s === "running");
    const probeAll = () => {
      if (running) {
        setStates({});
        return;
      }
      const queued = {};
      NODES.forEach((n) => {
        queued[n.i] = "queued";
      });
      setStates(queued);
      NODES.forEach((n, k) => {
        setTimeout(() => setStates((s) => ({ ...s, [n.i]: "running" })), 200 + k * 380);
        setTimeout(() => setStates((s) => ({ ...s, [n.i]: "done" })), 700 + k * 380);
      });
    };
    const isIp = (v) => /^(\d{1,3}\.){3}\d{1,3}$/.test(v) && v.split(".").every((p) => +p < 256);
    const obfsError = !obfs.on ? "" : !obfs.host ? "" : !isIp(obfs.host) ? "\u041D\u0443\u0436\u0435\u043D \u0430\u0434\u0440\u0435\u0441, \u0430 \u043D\u0435 \u0438\u043C\u044F: \u0434\u0432\u0438\u0436\u043E\u043A \u043D\u0435 \u0440\u0430\u0437\u0440\u0435\u0448\u0430\u0435\u0442 \u0438\u043C\u0435\u043D\u0430." : "";
    return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: "var(--an-gap-block)", animation: "an-enter var(--an-dur-enter) var(--an-ease)" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", alignItems: "flex-start", gap: "var(--an-space-8)", flexWrap: "wrap" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { flex: 1, minWidth: 240 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("h1", { style: { font: "var(--an-text-title)", letterSpacing: "var(--an-tracking-title)" }, children: "\u0412\u044B\u0445\u043E\u0434\u044B" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { style: { marginTop: "var(--an-space-3)", font: "var(--an-text-body-sm)", color: "var(--an-text-muted)" }, children: "\u041F\u0440\u0430\u0432\u0438\u043B\u043E \u0443\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442 \u043D\u0430 \u0438\u043C\u044F \u0432\u044B\u0445\u043E\u0434\u0430, \u043D\u0435 \u043D\u0430 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u043E." })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", gap: "var(--an-space-4)" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_Button5.Button, { tone: "secondary", size: "sm", onClick: () => onToast("warn", "\u0421\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0445 \u0442\u0443\u043D\u043D\u0435\u043B\u044C\u043D\u044B\u0445 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432 \u043D\u0435\u0442 \u2014 \u043F\u043E\u0434\u043D\u0438\u043C\u0438\u0442\u0435 \u0442\u0443\u043D\u043D\u0435\u043B\u044C"), children: "+ \u0422\u0443\u043D\u043D\u0435\u043B\u044C" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_Button5.Button, { tone: "secondary", size: "sm", onClick: () => onToast("warn", "\u0421\u0432\u043E\u0431\u043E\u0434\u043D\u044B\u0445 \u0442\u0443\u043D\u043D\u0435\u043B\u044C\u043D\u044B\u0445 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432 \u043D\u0435\u0442 \u2014 \u043F\u043E\u0434\u043D\u0438\u043C\u0438\u0442\u0435 \u0442\u0443\u043D\u043D\u0435\u043B\u044C"), children: "+ VLESS" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_Card3.Card, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "var(--an-space-6)", flexWrap: "wrap" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_StatusDot3.StatusDot, { tone: "ok", size: 9 }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { font: "var(--an-text-heading)", fontSize: 16 }, children: "vless-nl" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_Badge2.Badge, { tone: "accent", children: "VLESS/Reality" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { font: "var(--an-text-body-sm)", color: "var(--an-text-muted)" }, children: "\u041D\u0438\u0434\u0435\u0440\u043B\u0430\u043D\u0434\u044B \xB7 steer0 \xB7 \u043C\u0435\u0442\u043A\u0430 0x100000, \u0442\u0430\u0431\u043B\u0438\u0446\u0430 300" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { marginLeft: "auto", font: "var(--an-text-body-sm)", color: "var(--an-success)" }, children: "42 \u043C\u0441" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { marginTop: "var(--an-space-8)", border: "1px solid var(--an-border)", borderRadius: "var(--an-radius-block)", padding: "var(--an-pad-block)", display: "flex", flexDirection: "column", gap: "var(--an-space-5)" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { font: "var(--an-text-caption)", color: "var(--an-text-muted)", textTransform: "uppercase", letterSpacing: "var(--an-tracking-caps)" }, children: "\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", gap: "var(--an-space-5)", flexWrap: "wrap", alignItems: "flex-end" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_Field2.Field, { label: "\u0421\u0441\u044B\u043B\u043A\u0430 \u043D\u0430 \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0443 \u0438\u043B\u0438 vless://", error: subBad ? "\u041D\u0443\u0436\u043D\u0430 \u0441\u0441\u044B\u043B\u043A\u0430 https:// \u043B\u0438\u0431\u043E \u043E\u0434\u043D\u0430 \u0438\u043B\u0438 \u043D\u0435\u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0441\u0441\u044B\u043B\u043E\u043A vless:// \u0447\u0435\u0440\u0435\u0437 \u043F\u0440\u043E\u0431\u0435\u043B. \u0421\u043C\u0435\u0448\u0438\u0432\u0430\u0442\u044C \u043D\u0435\u043B\u044C\u0437\u044F." : null, style: { flex: 1, minWidth: 300 }, children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_Input3.Input, { mono: true, value: url, invalid: subBad, onChange: (e) => setUrl(e.target.value), style: { height: 36 } }) }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
              import_Button5.Button,
              {
                tone: "secondary",
                busy,
                icon: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(Icon, { name: busy ? "spinner" : "refresh" }),
                onClick: () => {
                  if (busy || subBad) return;
                  setBusy(true);
                  setTimeout(() => {
                    setBusy(false);
                    onToast("ok", "\u041F\u043E\u0434\u043F\u0438\u0441\u043A\u0430 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u0430: 4 812 \u0431\u0430\u0439\u0442, \u0443\u0437\u043B\u043E\u0432 \u043F\u0440\u0438\u0433\u043E\u0434\u043D\u043E: 6");
                  }, 1200);
                },
                children: busy ? "\u0421\u043A\u0430\u0447\u0438\u0432\u0430\u0435\u043C\u2026" : "\u041E\u0431\u043D\u043E\u0432\u0438\u0442\u044C"
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { font: "var(--an-text-caption)", color: "var(--an-text-muted)" }, children: "\u0424\u0430\u0439\u043B \u043D\u0430 \u0440\u043E\u0443\u0442\u0435\u0440\u0435: 4 812 \u0431\u0430\u0439\u0442, \u043E\u0431\u043D\u043E\u0432\u043B\u0451\u043D 22.08.2026, 14:10 \xB7 \u0443\u0437\u043B\u043E\u0432 \u043F\u0440\u0438\u0433\u043E\u0434\u043D\u043E: 6, \u043F\u0440\u043E\u043F\u0443\u0449\u0435\u043D\u043E: 3 \u2014 \u0442\u0440\u0430\u043D\u0441\u043F\u043E\u0440\u0442 tls \u0431\u0435\u0437 reality" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { font: "var(--an-text-caption)", color: "var(--an-text-muted)" }, children: [
            "\u0418\u0434\u0435\u043D\u0442\u0438\u0444\u0438\u043A\u0430\u0442\u043E\u0440 \u0440\u043E\u0443\u0442\u0435\u0440\u0430 \u0434\u043B\u044F \u043F\u0430\u043D\u0435\u043B\u0438: ",
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { fontFamily: "var(--an-font-mono)", userSelect: "all" }, children: "a4f1-9c33-71b0" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            "button",
            {
              type: "button",
              onClick: onQuota,
              style: { alignSelf: "flex-start", background: "none", border: 0, padding: 0, cursor: "pointer", font: "var(--an-text-caption)", color: "var(--an-accent)", borderBottom: "1px dotted var(--an-accent)" },
              children: "\u041E\u0441\u0442\u0430\u0442\u043E\u043A \u0442\u0440\u0430\u0444\u0438\u043A\u0430 \u2014 \u043D\u0430 \u043E\u0431\u0437\u043E\u0440\u0435"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { borderTop: "1px solid var(--an-border-soft)", paddingTop: "var(--an-space-5)", display: "flex", alignItems: "center", gap: "var(--an-space-5)" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { style: { font: "var(--an-text-caption)", color: "var(--an-text-muted)" }, children: [
              "\u0443\u0437\u043B\u043E\u0432: ",
              NODES.length
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_Button5.Button, { tone: "secondary", size: "sm", onClick: probeAll, style: { marginLeft: "auto" }, children: running ? "\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C" : "\u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C \u0432\u0441\u0435" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_Radio2.Radio, { checked: node < 0, onChange: () => setNode(-1), label: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("b", { children: "\u041F\u0435\u0440\u0432\u044B\u0439 \u0440\u0430\u0431\u043E\u0447\u0438\u0439" }), meta: "\u0434\u0432\u0438\u0436\u043E\u043A \u0432\u044B\u0431\u0435\u0440\u0435\u0442 \u0441\u0430\u043C \u043F\u0440\u0438 \u043F\u043E\u0434\u044A\u0451\u043C\u0435" }),
          NODES.map((n) => {
            const s = states[n.i];
            const good = s === "done" && !n.why;
            const bad = s === "done" && Boolean(n.why);
            return /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "var(--an-space-5)" }, children: [
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_Radio2.Radio, { checked: node === n.i, onChange: () => setNode(n.i), label: n.name, style: { flex: "0 1 auto" } }),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_Badge2.Badge, { children: n.tag }),
              /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_Badge2.Badge, { tone: bad ? "danger" : good ? "success" : "neutral", children: s === "queued" ? "\u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438" : s === "running" ? "\u0438\u0434\u0451\u0442 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430" : s === "done" ? n.why || "\u043E\u0442\u0432\u0435\u0442 " + n.ms + " \u043C\u0441" : "\u043D\u0435 \u043F\u0440\u043E\u0432\u0435\u0440\u044F\u043B\u0441\u044F" })
            ] }, n.i);
          }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("p", { style: { font: "var(--an-text-micro)", color: "var(--an-text-muted)" }, children: "\u041E\u0442\u0432\u0435\u0442 \u2014 \u0432\u0440\u0435\u043C\u044F \u0434\u043E \u043F\u0435\u0440\u0432\u043E\u0433\u043E \u0431\u0430\u0439\u0442\u0430 \u0447\u0435\u0440\u0435\u0437 \u0442\u0443\u043D\u043D\u0435\u043B\u044C, \u043D\u0435 \u043F\u0438\u043D\u0433: ICMP \u0447\u0435\u0440\u0435\u0437 \u0442\u0443\u043D\u043D\u0435\u043B\u044C \u043D\u0435 \u0445\u043E\u0434\u0438\u0442." })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_Card3.Card, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "var(--an-space-6)", flexWrap: "wrap" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_StatusDot3.StatusDot, { tone: "ok", size: 9 }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { font: "var(--an-text-heading)", fontSize: 16 }, children: "wg0" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { font: "var(--an-text-body-sm)", color: "var(--an-text-muted)" }, children: "\u0441\u0432\u043E\u0439 WireGuard \xB7 NAT \u0435\u0441\u0442\u044C" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { marginLeft: "auto", font: "var(--an-text-body-sm)", color: "var(--an-success)" }, children: "61 \u043C\u0441" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { marginTop: "var(--an-space-8)", border: "1px solid var(--an-border)", borderRadius: "var(--an-radius-block)", padding: "var(--an-pad-block)" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(
            import_Checkbox2.Checkbox,
            {
              checked: obfs.on,
              onChange: () => onObfs({ on: !obfs.on }),
              label: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("span", { style: { display: "inline-flex", alignItems: "center", gap: "var(--an-space-4)" }, children: [
                "WireGuard \u043F\u043E\u0432\u0435\u0440\u0445 TCP",
                obfs.on ? /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_Badge2.Badge, { tone: "accent", children: "\u043E\u0431\u0444\u0443\u0441\u043A\u0430\u0446\u0438\u044F \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u0430" }) : null
              ] })
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("p", { style: { marginTop: "var(--an-space-3)", font: "var(--an-text-caption)", color: "var(--an-text-muted)", lineHeight: 1.5 }, children: [
            "\u041D\u0443\u0436\u043D\u043E \u0442\u0430\u043C, \u0433\u0434\u0435 \u0440\u0435\u0436\u0443\u0442 UDP. \u041D\u0430 \u0434\u0440\u0443\u0433\u043E\u0439 \u0441\u0442\u043E\u0440\u043E\u043D\u0435 \u0434\u043E\u043B\u0436\u0435\u043D \u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C ",
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("code", { children: "steer obfs-server" }),
            " \u0438\u043B\u0438 phantun."
          ] }),
          obfs.on ? /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { marginTop: "var(--an-space-6)", display: "flex", gap: "var(--an-space-6)", flexWrap: "wrap", alignItems: "flex-end" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_Field2.Field, { label: "\u0421\u0435\u0440\u0432\u0435\u0440 \u043E\u0431\u0444\u0443\u0441\u043A\u0430\u0446\u0438\u0438", error: obfsError || null, children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_Input3.Input, { value: obfs.host, onChange: (e) => onObfs({ host: e.target.value }), placeholder: "203.0.113.10", invalid: Boolean(obfsError), style: { width: 180, height: 34 } }) }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_Field2.Field, { label: "\u041F\u043E\u0440\u0442", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_Input3.Input, { value: obfs.port, onChange: (e) => onObfs({ port: e.target.value }), placeholder: "4567", style: { width: 100, height: 34 } }) }),
            /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_Field2.Field, { label: "\u041B\u043E\u043A\u0430\u043B\u044C\u043D\u044B\u0439 \u043F\u043E\u0440\u0442", hint: "Endpoint \u043F\u0438\u0440\u0430: 127.0.0.1:" + (obfs.local || "51820") + " \xB7 MTU 1428", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_Input3.Input, { value: obfs.local, onChange: (e) => onObfs({ local: e.target.value }), style: { width: 130, height: 34 } }) })
          ] }) : null
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_Card3.Card, { children: [
        /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "var(--an-space-6)", flexWrap: "wrap" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_StatusDot3.StatusDot, { tone: "off", size: 9 }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { font: "var(--an-text-heading)", fontSize: 16 }, children: "\u043D\u0430\u043F\u0440\u044F\u043C\u0443\u044E" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { font: "var(--an-text-body-sm)", color: "var(--an-text-muted)" }, children: "\u0431\u0435\u0437 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("span", { style: { marginLeft: "auto", font: "var(--an-text-body-sm)", color: "var(--an-text-muted)" }, children: "\u043F\u0440\u0430\u0432\u0438\u043B: 1" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("div", { style: { marginTop: "var(--an-space-6)", display: "flex", gap: "var(--an-space-6)", flexWrap: "wrap", alignItems: "flex-end" }, children: /* @__PURE__ */ (0, import_jsx_runtime6.jsx)(import_Field2.Field, { label: "\u0415\u0441\u043B\u0438 \u0432\u0441\u0451 \u0443\u043F\u0430\u043B\u043E", children: /* @__PURE__ */ (0, import_jsx_runtime6.jsxs)(import_Select.Select, { size: "sm", children: [
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { children: "\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0442\u0440\u0430\u0444\u0438\u043A" }),
          /* @__PURE__ */ (0, import_jsx_runtime6.jsx)("option", { children: "\u041F\u0443\u0441\u0442\u0438\u0442\u044C \u043D\u0430\u043F\u0440\u044F\u043C\u0443\u044E" })
        ] }) }) })
      ] })
    ] });
  }

  // src/ui_kits/console/CatalogScreen.tsx
  var import_react5 = __toESM(require_react_shim(), 1);
  var import_Card4 = __toESM(require_ds_global(), 1);
  var import_Button6 = __toESM(require_ds_global(), 1);
  var import_Input4 = __toESM(require_ds_global(), 1);
  var import_Field3 = __toESM(require_ds_global(), 1);
  var import_Textarea = __toESM(require_ds_global(), 1);
  var import_SegmentedControl2 = __toESM(require_ds_global(), 1);
  var import_IconButton2 = __toESM(require_ds_global(), 1);
  var import_jsx_runtime7 = __toESM(require_jsx_runtime(), 1);
  function CatalogScreen({ rules, onUse, onToast }) {
    const [query, setQuery] = import_react5.default.useState("");
    const [seg, setSeg] = import_react5.default.useState("all");
    const [open, setOpen] = import_react5.default.useState(false);
    const [name, setName] = import_react5.default.useState("");
    const [kind, setKind] = import_react5.default.useState("domains");
    const [text, setText] = import_react5.default.useState("");
    const [mine, setMine] = import_react5.default.useState([{ id: "work-vpn", name: "work-vpn", kind: "\u0434\u043E\u043C\u0435\u043D\u044B", count: 42 }]);
    const q = query.trim().toLowerCase();
    const usedBy = (id) => rules.filter((r) => r.services.includes(id)).map((r) => r.name);
    const rows = SERVICES.filter((s) => !q || s.name.toLowerCase().includes(q)).filter((s) => seg === "used" ? usedBy(s.id).length > 0 : true);
    const nameBad = name.length > 0 && !/^[A-Za-z0-9_-]+$/.test(name);
    const save = () => {
      if (!/^[A-Za-z0-9_-]+$/.test(name)) {
        onToast("warn", "\u0418\u043C\u044F \u0441\u043F\u0438\u0441\u043A\u0430: \u043B\u0430\u0442\u0438\u043D\u0438\u0446\u0430, \u0446\u0438\u0444\u0440\u044B, \u0434\u0435\u0444\u0438\u0441 \u0438 \u043F\u043E\u0434\u0447\u0451\u0440\u043A\u0438\u0432\u0430\u043D\u0438\u0435");
        return;
      }
      const lines = text.split("\n").map((x) => x.trim()).filter(Boolean);
      if (!lines.length) {
        onToast("warn", "\u0421\u043F\u0438\u0441\u043E\u043A \u043F\u0443\u0441\u0442");
        return;
      }
      const dropped = lines.filter((x) => /\s/.test(x)).length;
      setMine((m) => [...m, { id: name, name, kind: kind === "domains" ? "\u0434\u043E\u043C\u0435\u043D\u044B" : "\u043F\u043E\u0434\u0441\u0435\u0442\u0438", count: lines.length - dropped }]);
      onToast(dropped ? "warn" : "ok", dropped ? "\u0421\u043F\u0438\u0441\u043E\u043A \xAB" + name + "\xBB: \u0441\u0442\u0440\u043E\u043A " + (lines.length - dropped) + ", \u043E\u0442\u0431\u0440\u043E\u0448\u0435\u043D\u043E " + dropped + " \u2014 \u0444\u043E\u0440\u043C\u0430\u0442 \u043D\u0435 \u043F\u043E\u0434\u043E\u0448\u0451\u043B" : "\u0421\u043F\u0438\u0441\u043E\u043A \xAB" + name + "\xBB: \u0441\u0442\u0440\u043E\u043A " + lines.length);
      setName("");
      setText("");
    };
    return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: "var(--an-gap-block)", animation: "an-enter var(--an-dur-enter) var(--an-ease)" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("h1", { style: { font: "var(--an-text-title)", letterSpacing: "var(--an-tracking-title)" }, children: "\u041A\u0430\u0442\u0430\u043B\u043E\u0433" }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("p", { style: { marginTop: "var(--an-space-3)", font: "var(--an-text-body-sm)", color: "var(--an-text-muted)" }, children: "\u0417\u0430\u043F\u0438\u0441\u044C \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442, \u043A\u043E\u0433\u0434\u0430 \u043D\u0430 \u043D\u0435\u0451 \u0443\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442 \u043F\u0440\u0430\u0432\u0438\u043B\u043E. \u0421\u043F\u0438\u0441\u043A\u0438 \u043E\u0431\u043D\u043E\u0432\u043B\u044F\u044E\u0442\u0441\u044F \u0441\u0430\u043C\u0438." })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "var(--an-space-5)", flexWrap: "wrap" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_Input4.Input, { icon: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "search" }), value: query, onChange: (e) => setQuery(e.target.value), placeholder: "\u043F\u043E\u0438\u0441\u043A \u043F\u043E \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0443", style: { flex: 1, minWidth: 260, background: "var(--an-surface-card)" } }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(
          import_SegmentedControl2.SegmentedControl,
          {
            value: seg,
            onChange: setSeg,
            items: [
              { value: "all", label: "\u0432\u0441\u0435 \xB7 " + SERVICES.length },
              { value: "used", label: "\u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u044E\u0442\u0441\u044F \xB7 " + SERVICES.filter((s) => usedBy(s.id).length > 0).length }
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_Button6.Button, { tone: "secondary", icon: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "plus" }), onClick: () => setOpen(!open), children: "\u0421\u0432\u043E\u0439 \u0441\u043F\u0438\u0441\u043E\u043A" })
      ] }),
      open ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_Card4.Card, { heading: "\u0421\u0432\u043E\u0438 \u0441\u043F\u0438\u0441\u043A\u0438", meta: "\u0441\u043A\u0430\u0447\u0438\u0432\u0430\u044E\u0442\u0441\u044F \u043E\u0434\u0438\u043D \u0440\u0430\u0437", children: /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { marginTop: "var(--an-space-6)", display: "flex", flexDirection: "column", gap: "var(--an-space-5)" }, children: [
        mine.map((l) => /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "var(--an-space-5)", padding: "8px 10px", borderRadius: "var(--an-radius-inner)", background: "var(--an-surface-field)", font: "var(--an-text-body-sm)" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: { flex: 1, minWidth: 0 }, children: [
            l.name,
            " ",
            /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("span", { style: { font: "var(--an-text-caption)", color: "var(--an-text-muted)" }, children: [
              l.kind,
              " \xB7 \u0437\u0430\u043F\u0438\u0441\u0435\u0439 ",
              l.count
            ] })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_IconButton2.IconButton, { label: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C " + l.name, onClick: () => {
            setMine((m) => m.filter((x) => x.id !== l.id));
            onToast("ok", "\u0421\u043F\u0438\u0441\u043E\u043A \xAB" + l.name + "\xBB \u0443\u0434\u0430\u043B\u0451\u043D");
          }, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "trash" }) })
        ] }, l.id)),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { display: "flex", gap: "var(--an-space-5)", flexWrap: "wrap", alignItems: "flex-end" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_Field3.Field, { label: "\u0418\u043C\u044F \u0441\u043F\u0438\u0441\u043A\u0430", error: nameBad ? "\u0442\u043E\u043B\u044C\u043A\u043E \u043B\u0430\u0442\u0438\u043D\u0438\u0446\u0430, \u0446\u0438\u0444\u0440\u044B, \u0434\u0435\u0444\u0438\u0441 \u0438 \u043F\u043E\u0434\u0447\u0451\u0440\u043A\u0438\u0432\u0430\u043D\u0438\u0435" : null, style: { flex: 1, minWidth: 200 }, children: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_Input4.Input, { value: name, onChange: (e) => setName(e.target.value), invalid: nameBad, placeholder: "work-vpn", style: { height: 36 } }) }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_SegmentedControl2.SegmentedControl, { value: kind, onChange: setKind, size: "sm", items: [{ value: "domains", label: "\u0434\u043E\u043C\u0435\u043D\u044B" }, { value: "prefixes", label: "\u043F\u043E\u0434\u0441\u0435\u0442\u0438" }] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_Textarea.Textarea, { value: text, onChange: (e) => setText(e.target.value), placeholder: kind === "domains" ? "example.org\nsub.example.net" : "10.0.0.0/8\n192.0.2.1" }),
        /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { display: "flex", gap: "var(--an-space-5)", flexWrap: "wrap", alignItems: "center" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_Button6.Button, { icon: /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(Icon, { name: "plus" }), onClick: save, children: "\u0421\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C" }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_Button6.Button, { tone: "secondary", onClick: () => onToast("warn", "\u0421\u043A\u0430\u0447\u0438\u0432\u0430\u0435\u0442\u0441\u044F \u043E\u0434\u0438\u043D \u0440\u0430\u0437: \u0440\u0430\u0441\u043F\u0438\u0441\u0430\u043D\u0438\u0435 \u0435\u0441\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u0443 \u0441\u043F\u0438\u0441\u043A\u043E\u0432 \u0438\u0437\u0434\u0430\u0442\u0435\u043B\u044F"), children: "\u0421\u043A\u0430\u0447\u0430\u0442\u044C \u043F\u043E \u0441\u0441\u044B\u043B\u043A\u0435" })
        ] })
      ] }) }) : null,
      /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_Card4.Card, { style: { padding: 0, overflow: "hidden" }, children: rows.map((s, i) => {
        const by = usedBy(s.id);
        return /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "var(--an-space-7)", padding: "13px 18px", borderBottom: i === rows.length - 1 ? "0" : "1px solid var(--an-border-soft)" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime7.jsxs)("div", { style: { flex: 1, minWidth: 0 }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { font: "var(--an-text-body)", fontWeight: "var(--an-weight-medium)" }, children: s.name }),
            /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { marginTop: 3, font: "var(--an-text-caption)", color: "var(--an-text-muted)" }, children: s.kind })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { width: 110, textAlign: "right", font: "var(--an-text-body-sm)", color: "var(--an-text-secondary)" }, children: num(s.count) }),
          /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("div", { style: { width: 180, textAlign: "right", font: "var(--an-text-body-sm)" }, children: by.length ? /* @__PURE__ */ (0, import_jsx_runtime7.jsx)("span", { style: { color: "var(--an-accent)" }, children: by.join(", ") }) : /* @__PURE__ */ (0, import_jsx_runtime7.jsx)(import_Button6.Button, { tone: "ghost", size: "sm", onClick: () => onUse(s.id), children: "\u0412 \u043F\u0440\u0430\u0432\u0438\u043B\u043E" }) })
        ] }, s.id);
      }) })
    ] });
  }

  // src/ui_kits/console/DiagnosticsScreen.tsx
  var import_react6 = __toESM(require_react_shim(), 1);
  var import_Card5 = __toESM(require_ds_global(), 1);
  var import_Button7 = __toESM(require_ds_global(), 1);
  var import_CodeBlock2 = __toESM(require_ds_global(), 1);
  var import_jsx_runtime8 = __toESM(require_jsx_runtime(), 1);
  var OK_CHECKS = [
    "\u0442\u0430\u0431\u043B\u0438\u0446\u0430 inet steer \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D\u0430 \u0432 \u044F\u0434\u0440\u043E",
    "\u0440\u0435\u0437\u043E\u043B\u0432\u0435\u0440 \u043E\u0442\u0432\u0435\u0447\u0430\u0435\u0442 \u043D\u0430 127.0.0.1:5353",
    "NAT \u043D\u0430\u0439\u0434\u0435\u043D \u0434\u043B\u044F \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430 steer0",
    "\u043C\u0435\u0442\u043A\u0438 \u0438 \u0442\u0430\u0431\u043B\u0438\u0446\u044B \u0441\u043E\u0432\u043F\u0430\u0434\u0430\u044E\u0442 \u0441 \u0440\u0435\u0435\u0441\u0442\u0440\u043E\u043C"
  ];
  function DiagnosticsScreen() {
    const [open, setOpen] = import_react6.default.useState(false);
    return /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: "var(--an-gap-block)", animation: "an-enter var(--an-dur-enter) var(--an-ease)" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("h1", { style: { font: "var(--an-text-title)", letterSpacing: "var(--an-tracking-title)" }, children: "\u0414\u0438\u0430\u0433\u043D\u043E\u0441\u0442\u0438\u043A\u0430" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("p", { style: { marginTop: "var(--an-space-3)", font: "var(--an-text-body-sm)", color: "var(--an-text-muted)" }, children: "\u041F\u0440\u043E\u0432\u0435\u0440\u043A\u0438 \u0438\u0434\u0443\u0442 \u043F\u043E \u044F\u0434\u0440\u0443 \u0438 \u0436\u0438\u0432\u044B\u043C \u043F\u0440\u043E\u0446\u0435\u0441\u0441\u0430\u043C, \u043D\u0435 \u043F\u043E \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0435." })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)(import_Card5.Card, { heading: "\u043F\u0440\u043E\u0432\u0435\u0440\u043E\u043A \u0441 \u043F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435\u043C: 1", children: [
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { marginTop: "var(--an-space-6)", font: "var(--an-text-body)" }, children: "\u0441\u043F\u0438\u0441\u043E\u043A domains/telegram.lst \u0441\u0442\u0430\u0440\u0448\u0435 \u0441\u0443\u0442\u043E\u043A" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { font: "var(--an-text-caption)", color: "var(--an-text-muted)" }, children: "\u043F\u043E\u0441\u043B\u0435\u0434\u043D\u044F\u044F \u0443\u0434\u0430\u0447\u043D\u0430\u044F \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0430: 21 \u0447 \u043D\u0430\u0437\u0430\u0434" }),
        /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("div", { style: { marginTop: "var(--an-space-7)" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_Button7.Button, { tone: "ghost", size: "sm", onClick: () => setOpen(!open), style: { padding: 0 }, children: open ? "\u0441\u043A\u0440\u044B\u0442\u044C \u0438\u0441\u043F\u0440\u0430\u0432\u043D\u043E\u0435" : "\u0438\u0441\u043F\u0440\u0430\u0432\u043D\u043E: 11 \u2014 \u043F\u043E\u043A\u0430\u0437\u0430\u0442\u044C" }),
          /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("div", { style: { overflow: "hidden", maxHeight: open ? 160 : 0, opacity: open ? 1 : 0, transition: "max-height var(--an-dur-collapse) var(--an-ease), opacity var(--an-dur-enter) var(--an-ease)" }, children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("ul", { className: "an-plain", style: { marginTop: "var(--an-space-5)", display: "flex", flexDirection: "column", gap: "var(--an-space-4)", font: "var(--an-text-body-sm)", color: "var(--an-text-secondary)" }, children: OK_CHECKS.map((c) => /* @__PURE__ */ (0, import_jsx_runtime8.jsxs)("li", { style: { display: "flex", gap: "var(--an-space-4)" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("svg", { width: "15", height: "15", viewBox: "0 0 24 24", fill: "none", stroke: "var(--an-success)", strokeWidth: "2.5", strokeLinecap: "round", strokeLinejoin: "round", style: { flex: "0 0 auto" }, children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)("path", { d: "M20 6 9 17l-5-5" }) }),
            c
          ] }, c)) }) })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_Card5.Card, { heading: "\u041B\u043E\u0433\u0438 steer", meta: "\u0434\u043E\u0441\u043B\u043E\u0432\u043D\u043E", children: /* @__PURE__ */ (0, import_jsx_runtime8.jsx)(import_CodeBlock2.CodeBlock, { style: { marginTop: "var(--an-space-6)" }, children: `info  steer[info] spec compiled: 4 channels, 3 outputs
info  steer[info] resolver up on 127.0.0.1:5353, fake-IP pool 198.18.0.0/15
warn  steer[warn] list domains/telegram.lst older than 24h
info  steer[info] output vless-nl up: dev steer0, mark 0x100000, table 300
info  steer[info] output wg0 up: dev wg0, mark 0x100001, table 301` }) })
    ] });
  }

  // src/ui_kits/console/Console.tsx
  var import_ApplyPill = __toESM(require_ds_global(), 1);
  var import_Dialog = __toESM(require_ds_global(), 1);
  var import_Toast = __toESM(require_ds_global(), 1);
  var import_jsx_runtime9 = __toESM(require_jsx_runtime(), 1);
  function Console() {
    const [theme, setTheme] = import_react7.default.useState("light");
    const [view, setView] = import_react7.default.useState("overview");
    const [editing, setEditing] = import_react7.default.useState(null);
    const [rules, setRules] = import_react7.default.useState(INITIAL_RULES);
    const [applied, setApplied] = import_react7.default.useState(() => snapshot(INITIAL_RULES));
    const [pill, setPill] = import_react7.default.useState("idle");
    const [toasts, setToasts] = import_react7.default.useState([]);
    const [stopOpen, setStopOpen] = import_react7.default.useState(false);
    const [obfs, setObfs] = import_react7.default.useState({ on: false, host: "", port: "", local: "51820" });
    const [quota, setQuota] = import_react7.default.useState(true);
    const toast = (tone, text) => {
      const id = Math.random();
      setToasts((t) => [...t, { id, tone, text }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
    };
    const patch = (id, p) => setRules((rs) => rs.map((r) => r.id === id ? { ...r, ...p } : r));
    const move = (i, d) => {
      const j = i + d;
      if (j < 0 || j >= rules.length) return;
      const next = rules.slice();
      const t = next[i];
      next[i] = next[j];
      next[j] = t;
      setRules(next);
    };
    const addRule = (kind, serviceId) => {
      const id = Date.now();
      const isEx = kind === "exception";
      const rule2 = {
        id,
        name: isEx ? "\u0438\u0441\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435" : serviceId ? SERVICES.find((s) => s.id === serviceId)?.name ?? "\u043F\u0440\u0430\u0432\u0438\u043B\u043E" : "\u043F\u0440\u0430\u0432\u0438\u043B\u043E " + (rules.length + 1),
        services: serviceId ? [serviceId] : [],
        from: [],
        out: isEx ? "direct" : "vless-nl",
        on: true
      };
      const next = rules.slice();
      if (isEx) {
        const at = next.findIndex((r) => r.out !== "direct");
        next.splice(at < 0 ? next.length : at, 0, rule2);
      } else next.push(rule2);
      setRules(next);
      setView("rules");
      setEditing(id);
      toast("ok", isEx ? "\u0418\u0441\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u0441\u043E\u0437\u0434\u0430\u043D\u043E \u0432\u044B\u0448\u0435 \u0442\u0443\u043D\u043D\u0435\u043B\u044C\u043D\u044B\u0445 \u043F\u0440\u0430\u0432\u0438\u043B" : "\u041F\u0440\u0430\u0432\u0438\u043B\u043E \u0441\u043E\u0437\u0434\u0430\u043D\u043E");
    };
    const apply = () => {
      setPill("busy");
      setTimeout(() => {
        setPill("done");
        setApplied(snapshot(rules));
        toast("ok", "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430 \u043F\u0440\u0438\u043C\u0435\u043D\u0435\u043D\u0430 \u0432 \u044F\u0434\u0440\u0435");
        setTimeout(() => setPill("idle"), 1500);
      }, 1400);
    };
    const rule = rules.find((r) => r.id === editing) || null;
    const screen = rule ? "editor" : view;
    return /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)(
      "div",
      {
        "data-theme": theme === "dark" ? "dark" : void 0,
        className: "an-root",
        style: { minHeight: "100vh", display: "grid", gridTemplateColumns: "var(--an-rail-width) minmax(0,1fr)" },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
            Rail,
            {
              view: screen,
              onView: (v) => {
                setEditing(null);
                setView(v);
              },
              rulesCount: rules.length,
              theme,
              onTheme: setTheme,
              onStop: () => setStopOpen(true)
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsxs)("main", { style: { minWidth: 0, padding: "24px 28px 96px" }, children: [
            screen === "overview" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
              OverviewScreen,
              {
                rulesOn: rules.filter((r) => r.on).length,
                onNewRule: () => addRule("rule"),
                onDiag: () => {
                  setEditing(null);
                  setView("diag");
                },
                quota
              }
            ) : null,
            screen === "rules" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
              RulesScreen,
              {
                rules,
                onEdit: setEditing,
                onToggle: (id) => patch(id, { on: !rules.find((r) => r.id === id)?.on }),
                onMove: move,
                onNewRule: () => addRule("rule"),
                onNewException: () => addRule("exception")
              }
            ) : null,
            screen === "editor" && rule ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
              RuleEditorScreen,
              {
                rule,
                position: rules.findIndex((r) => r.id === rule.id) + 1,
                total: rules.length,
                onPatch: (p) => patch(rule.id, p),
                onClose: () => setEditing(null),
                onDelete: () => {
                  setRules((rs) => rs.filter((r) => r.id !== rule.id));
                  setEditing(null);
                  toast("ok", "\u041F\u0440\u0430\u0432\u0438\u043B\u043E \u0443\u0434\u0430\u043B\u0435\u043D\u043E");
                }
              }
            ) : null,
            screen === "outputs" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
              OutputsScreen,
              {
                obfs,
                onObfs: (p) => setObfs((o) => ({ ...o, ...p })),
                onToast: toast,
                onQuota: () => {
                  setQuota(true);
                  setView("overview");
                }
              }
            ) : null,
            screen === "catalog" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(CatalogScreen, { rules, onUse: (id) => addRule("rule", id), onToast: toast }) : null,
            screen === "diag" ? /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(DiagnosticsScreen, {}) : null
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_ApplyPill.ApplyPill, { changes: countChanges(applied, rules), state: pill, onApply: apply, offset: 118 }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_Toast.ToastStack, { children: toasts.map((t) => /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(import_Toast.Toast, { tone: t.tone, children: t.text }, t.id)) }),
          /* @__PURE__ */ (0, import_jsx_runtime9.jsx)(
            import_Dialog.Dialog,
            {
              open: stopOpen,
              title: "\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0432\u0441\u0451?",
              confirmLabel: "\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C",
              onCancel: () => setStopOpen(false),
              onConfirm: () => {
                setStopOpen(false);
                toast("bad", "\u0414\u0432\u0438\u0436\u043E\u043A \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D, \u0430\u0432\u0442\u043E\u0437\u0430\u043F\u0443\u0441\u043A \u0441\u043D\u044F\u0442");
              },
              children: "\u0414\u0432\u0438\u0436\u043E\u043A \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u0441\u044F, \u043F\u0440\u0430\u0432\u0438\u043B\u0430 \u0438\u0437 \u044F\u0434\u0440\u0430 \u0443\u0439\u0434\u0443\u0442. \u0410\u0432\u0442\u043E\u0437\u0430\u043F\u0443\u0441\u043A \u0442\u043E\u0436\u0435 \u0441\u043D\u0438\u043C\u0435\u0442\u0441\u044F \u2014 \u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u0440\u043E\u0443\u0442\u0435\u0440\u0430 \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u0432\u0435\u0440\u043D\u0451\u0442."
            }
          )
        ]
      }
    );
  }
  return __toCommonJS(Console_exports);
})();
/*! Bundled license information:

react/cjs/react-jsx-runtime.production.min.js:
  (**
   * @license React
   * react-jsx-runtime.production.min.js
   *
   * Copyright (c) Facebook, Inc. and its affiliates.
   *
   * This source code is licensed under the MIT license found in the
   * LICENSE file in the root directory of this source tree.
   *)
*/
window.__AndromedaConsole=__AndromedaConsole;
