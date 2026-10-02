"use strict";
var __AndromedaCard = (() => {
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

  // src/components/analytics/analytics.card.tsx
  var analytics_card_exports = {};
  __export(analytics_card_exports, {
    Demo: () => Demo
  });
  var import_react = __toESM(require_react_shim(), 1);
  var import_Figure = __toESM(require_ds_global(), 1);
  var import_Delta = __toESM(require_ds_global(), 1);
  var import_PlanMeter = __toESM(require_ds_global(), 1);
  var import_Sparkline = __toESM(require_ds_global(), 1);
  var import_Bars = __toESM(require_ds_global(), 1);
  var import_Lines = __toESM(require_ds_global(), 1);
  var import_Heatmap = __toESM(require_ds_global(), 1);
  var import_Legend = __toESM(require_ds_global(), 1);
  var import_Table = __toESM(require_ds_global(), 1);
  var import_Badge = __toESM(require_ds_global(), 1);
  var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
  var DAYS = ["01", "03", "06", "09", "11", "13", "15", "17", "19", "22", "25", "28", "31"];
  var FACT = [4.3, 4.7, 3.4, 3.5, 4.8, 4.5, 5.6, 4.6, 3.8, 5.8, null, null, null];
  var FORECAST = [null, null, null, null, null, null, null, null, null, 5.8, 4.6, 5.3, 4.9];
  var PREMONTH = [4.9, 4.2, 4.6, 3.9, 5.2, 4.8, 5.4, 4.3, 4, 5, 4.4, 5.1, 4.6];
  var PLAN = DAYS.map(() => 3.5);
  var HOURS = ["09", "10", "11", "12", "13", "14", "15", "16", "17", "18", "19+"];
  var HYPER = [0.09, 0.02, 0.01, 0.1, 0.14, 0.17, 0.15, 0.12, 0.16, 0.19, 0.11];
  var TP = [0.17, 0.15, 0.15, 0.07, 0.09, 0.11, 0.1, 0.08, 0.1, 0.12, 0.06];
  var GHOST = [0.14, 0.21, 0.25, 0.22, 0.27, 0.29, 0.28, 0.26, 0.3, 0.34, 0.22];
  var WD = ["\u043F\u043D", "\u0432\u0442", "\u0441\u0440", "\u0447\u0442", "\u043F\u0442", "\u0441\u0431", "\u0432\u0441"];
  var HEAT = WD.map((_, r) => HOURS.map((_2, c) => +(0.5 + 0.06 * c + (r >= 5 ? 0.35 : 0) + (r * 7 + c * 3) % 5 * 0.03).toFixed(2)));
  var THIN = WD.map((_, r) => HOURS.map((_2, c) => r === 6 && c > 8));
  var PEOPLE = [
    { id: 1, name: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A 01", league: "\u041F\u043B\u0430\u0442\u0438\u043D\u0430", score: 0.41, ug: 3.9, lines: 2.13, hours: 120 },
    { id: 2, name: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A 02", league: "\u0417\u043E\u043B\u043E\u0442\u043E", score: 0.3, ug: 3.5, lines: 1.8, hours: 120 },
    { id: 3, name: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A 03", league: "\u0417\u043E\u043B\u043E\u0442\u043E", score: 0.28, ug: 4.9, lines: 1.64, hours: 110 },
    { id: 4, name: "\u0421\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A 05", league: "\u0421\u0435\u0440\u0435\u0431\u0440\u043E", score: 0.08, ug: 2.6, lines: 1.63, hours: 110 }
  ];
  var f2 = (v) => v.toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var f1 = (v) => v.toLocaleString("ru-RU", { maximumFractionDigits: 1 });
  function Demo() {
    const [sort, setSort] = import_react.default.useState("score");
    const rows = [...PEOPLE].sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0));
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "col", style: { gap: 18 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "row", style: { gap: 28, alignItems: "flex-start" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Figure.Figure, { size: "lg", live: true, label: "\u043E\u0431\u043E\u0440\u043E\u0442 \u0441\u0435\u0433\u043E\u0434\u043D\u044F \xB7 25 \u0430\u0432\u0433\u0443\u0441\u0442\u0430", value: "1,40", unit: "\u043C\u043B\u043D \u20BD", delta: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Delta.Delta, { value: -3.8 }), caption: "\u0437\u0430\u043A\u0440\u044B\u0442\u043E 10 \u0438\u0437 11 \u0440\u0430\u0431\u043E\u0447\u0438\u0445 \u0447\u0430\u0441\u043E\u0432 \xB7 \u043F\u043E \u0447\u0430\u0441\u0430\u043C \u0440\u0430\u0437\u043D\u0435\u0441\u0435\u043D\u043E 0,76 \u043C\u043B\u043D" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", { style: { display: "grid", gridTemplateColumns: "repeat(3, minmax(0,1fr))", gap: 16, margin: 0, flex: 1, minWidth: 320 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Figure.Figure, { label: "\u043F\u043B\u0430\u043D \u043C\u0435\u0441\u044F\u0446\u0430", value: "109,8", unit: "\u043C\u043B\u043D \u20BD" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Figure.Figure, { label: "\u043F\u0440\u043E\u0433\u043D\u043E\u0437 \u043C\u0435\u0441\u044F\u0446\u0430", value: "135,5", unit: "\u043C\u043B\u043D \u20BD", delta: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Delta.Delta, { value: 23.4 }), caption: "\u0438\u043D\u0442\u0435\u0440\u0432\u0430\u043B 120,7\u2014154,4" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Figure.Figure, { label: "\u043E\u0442\u043A\u043B\u0438\u043A \u0438\u0441\u0442\u043E\u0447\u043D\u0438\u043A\u0430", value: "42", unit: "\u043C\u0441", tone: "success" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_PlanMeter.PlanMeter, { fact: 97.2, forecast: 135.5, plan: 109.8, unit: " \u043C\u043B\u043D" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "row", style: { gap: 12 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Delta.Delta, { value: 4.2 }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Delta.Delta, { value: -1.6, format: "pp" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Delta.Delta, { value: 0, neutralBand: 0.1 }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Delta.Delta, { value: -3, higherIsBetter: false }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Delta.Delta, { value: 12500, format: "raw", unit: "\u20BD" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "row", style: { gap: 8, marginLeft: "auto" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "cap", children: "\u0441\u0442\u0440\u043E\u043A\u0438 \u0432 \u0447\u0435\u043A\u0435" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Sparkline.Sparkline, { values: [1.34, 1.33, 1.35, 1.34, 1.32, 1.36, 1.34], reference: 1.45 }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("b", { style: { font: "var(--an-text-heading)" }, children: "1,34" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "col", style: { gap: 8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Legend.Legend, { items: [{ label: "\u0444\u0430\u043A\u0442", kind: "line" }, { label: "\u043F\u0440\u043E\u0433\u043D\u043E\u0437", kind: "line", dashed: true }, { label: "\u043F\u0440\u0435\u043F\u0440\u043E\u0433\u043D\u043E\u0437", kind: "line", tone: "off", dashed: true }, { label: "\u043F\u043B\u0430\u043D", kind: "line", tone: "ink" }] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Lines.Lines, { labels: DAYS, height: 160, bands: [2, 3, 9, 10], reference: 3.5, referenceLabel: "\u043F\u043B\u0430\u043D \u0432 \u0434\u0435\u043D\u044C", series: [
          { label: "\u0444\u0430\u043A\u0442", values: FACT, tone: "accent" },
          { label: "\u043F\u0440\u043E\u0433\u043D\u043E\u0437", values: FORECAST, tone: "accent", dashed: true },
          { label: "\u043F\u0440\u0435\u043F\u0440\u043E\u0433\u043D\u043E\u0437", values: PREMONTH, tone: "off", dashed: true, width: 1.5 }
        ], format: (v) => f1(v), tipFormat: (v) => `${f1(v)} \u043C\u043B\u043D \u20BD` })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "col", style: { gap: 8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Legend.Legend, { items: [{ label: "\u0413\u0438\u043F\u0435\u0440", kind: "bar" }, { label: "\u0422\u041F", kind: "bar", tone: "off" }, { label: "\u043E\u0431\u044B\u0447\u043D\u044B\u0439 \u0442\u0430\u043A\u043E\u0439 \u0434\u0435\u043D\u044C", kind: "bar", dashed: true }] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Bars.Bars, { labels: HOURS, stacked: true, height: 150, totalLabel: "\u043C\u0430\u0433\u0430\u0437\u0438\u043D", series: [{ label: "\u0413\u0438\u043F\u0435\u0440", values: HYPER, tone: "accent" }, { label: "\u0422\u041F", values: TP, tone: "off" }], ghost: GHOST, ghostLabel: "\u043E\u0431\u044B\u0447\u043D\u044B\u0439 \u0442\u0430\u043A\u043E\u0439 \u0434\u0435\u043D\u044C", format: (v) => f2(v) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "col", style: { gap: 8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Legend.Legend, { items: [{ label: "\u0437\u0430\u043A\u0440\u044B\u0442\u043E", kind: "bar" }, { label: "\u0438\u0434\u0451\u0442 \u0441\u0435\u0439\u0447\u0430\u0441", kind: "bar", fill: "half" }, { label: "\u043E\u0436\u0438\u0434\u0430\u043D\u0438\u0435 \u0434\u043E \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F", kind: "bar", fill: "ghost" }, { label: "\u043E\u0431\u044B\u0447\u043D\u044B\u0439 \u0434\u0435\u043D\u044C", kind: "bar", tone: "off", fill: "ghost" }] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Bars.Bars, { labels: HOURS, stacked: true, height: 150, labelSeries: 0, series: [
          { label: "\u0437\u0430\u043A\u0440\u044B\u0442\u043E", values: [0.26, 0.17, 0.16, 0.17, 0.23, 0.28, 0.25, null, null, null, null], tone: "accent" },
          { label: "\u0438\u0434\u0451\u0442 \u0441\u0435\u0439\u0447\u0430\u0441", values: [null, null, null, null, null, null, null, 0.09, null, null, null], tone: "accent", fill: "half" },
          { label: "\u043E\u0436\u0438\u0434\u0430\u043D\u0438\u0435 \u0434\u043E \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u044F", values: [null, null, null, null, null, null, null, 0.11, 0.26, 0.31, 0.17], tone: "accent", fill: "ghost" },
          { label: "\u043E\u0431\u044B\u0447\u043D\u044B\u0439 \u0434\u0435\u043D\u044C", values: GHOST, tone: "off", fill: "ghost", beside: true }
        ], format: (v) => f2(v) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Heatmap.Heatmap, { rows: WD, cols: HOURS, values: HEAT, thin: THIN, cell: 18 }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_Table.Table,
        {
          sortKey: sort,
          onSort: setSort,
          minWidth: 560,
          dense: true,
          rowKey: (r) => r.id,
          caption: "4 \u0438\u0437 11 \xB7 \u043A\u043E\u0440\u043E\u0442\u043A\u0438\u0435 \u0441\u043C\u0435\u043D\u044B \u0441\u043A\u0440\u044B\u0442\u044B",
          columns: [
            { key: "id", title: "#", width: 32, align: "right", sortable: false, render: (r) => rows.indexOf(r) + 1 },
            { key: "name", title: "\u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A", render: (r) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { fontWeight: "var(--an-weight-semibold)" }, children: r.name }) },
            { key: "league", title: "\u043B\u0438\u0433\u0430", sortable: false, render: (r) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Badge.Badge, { tone: r.league === "\u041F\u043B\u0430\u0442\u0438\u043D\u0430" ? "accent" : "neutral", children: r.league.toLowerCase() }) },
            { key: "score", title: "\u0431\u0430\u043B\u043B", align: "right", render: (r) => f2(r.score) },
            { key: "ug", title: "\u0434\u043E\u043B\u044F \u0423\u0413", align: "right", render: (r) => `${f1(r.ug)} %` },
            { key: "lines", title: "\u0441\u0442\u0440\u043E\u043A\u0438", align: "right", render: (r) => f2(r.lines) },
            { key: "hours", title: "\u0447\u0430\u0441\u044B", align: "right" }
          ],
          rows
        }
      )
    ] });
  }
  return __toCommonJS(analytics_card_exports);
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
window.__AndromedaCard=__AndromedaCard;
