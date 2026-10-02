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

  // src/components/data/data.card.tsx
  var data_card_exports = {};
  __export(data_card_exports, {
    Demo: () => Demo
  });
  var import_react = __toESM(require_react_shim(), 1);
  var import_StatPair = __toESM(require_ds_global(), 1);
  var import_StatusDot = __toESM(require_ds_global(), 1);
  var import_Meter = __toESM(require_ds_global(), 1);
  var import_ListRow = __toESM(require_ds_global(), 1);
  var import_Skeleton = __toESM(require_ds_global(), 1);
  var import_CodeBlock = __toESM(require_ds_global(), 1);
  var import_IconButton = __toESM(require_ds_global(), 1);
  var import_Switch = __toESM(require_ds_global(), 1);
  var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
  var glyph = (d) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d }) });
  function Demo() {
    const [loading, setLoading] = import_react.default.useState(false);
    const [on, setOn] = import_react.default.useState(true);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "col", style: { gap: 16 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("dl", { style: { display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 12, margin: 0 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_StatPair.StatPair, { label: "\u043F\u0440\u0430\u0432\u0438\u043B \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u043E", value: "4" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_StatPair.StatPair, { label: "\u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432 \u0432 \u0441\u0435\u0442\u0438", value: "9" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_StatPair.StatPair, { label: "\u043E\u0442\u043A\u043B\u0438\u043A \xB7 vless-nl", value: "42 \u043C\u0441", tone: "success" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_StatPair.StatPair, { label: "\u043E\u0441\u0442\u0430\u043B\u043E\u0441\u044C", value: "68,2 \u0413\u0411", meta: "\u0438\u0437 200 \u0413\u0411" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "col", style: { gap: 8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "row", style: { gap: 10, font: "var(--an-text-body-sm)" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { style: { flex: 1 }, children: [
            "YouTube ",
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: "var(--an-text-muted)" }, children: "\u2192 vless-nl" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { style: { color: "var(--an-text-secondary)" }, children: "\u2193 12,4 \u0413\u0411" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Meter.Meter, { value: 74 }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Meter.Meter, { value: 23, height: 8, delay: 70 }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Meter.Meter, { value: 13, height: 8, tone: "off", delay: 140 })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "row", style: { gap: 14 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "row", style: { gap: 7, font: "var(--an-text-body-sm)" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_StatusDot.StatusDot, { tone: "ok", live: true }),
          " \u0436\u0438\u0432\u043E\u0435"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "row", style: { gap: 7, font: "var(--an-text-body-sm)" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_StatusDot.StatusDot, { tone: "warn" }),
          " \u043F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "row", style: { gap: 7, font: "var(--an-text-body-sm)" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_StatusDot.StatusDot, { tone: "bad" }),
          " \u043E\u0442\u043A\u0430\u0437"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "row", style: { gap: 7, font: "var(--an-text-body-sm)" }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_StatusDot.StatusDot, { tone: "off" }),
          " \u043C\u0438\u043C\u043E \u0442\u0443\u043D\u043D\u0435\u043B\u044F"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            type: "button",
            onClick: () => {
              setLoading(true);
              setTimeout(() => setLoading(false), 1600);
            },
            style: { marginLeft: "auto", height: 30, padding: "0 12px", borderRadius: "var(--an-radius-inner)", border: "1px solid var(--an-border)", background: "transparent", color: "var(--an-text-secondary)", font: "var(--an-text-caption)", cursor: "pointer" },
            children: "\u043F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0443"
          }
        )
      ] }),
      loading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Skeleton.Skeleton, { count: 2, height: 62 }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "col", style: { gap: 8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          import_ListRow.ListRow,
          {
            index: 2,
            handle: true,
            title: "YouTube",
            subtitle: "YouTube, Google \xB7 \u0437\u0430\u043F\u0438\u0441\u0435\u0439: 84 312 \u2192 vless-nl \xB7 \u041D\u0438\u0434\u0435\u0440\u043B\u0430\u043D\u0434\u044B",
            actions: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_react.default.Fragment, { children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_IconButton.IconButton, { label: "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C", children: glyph("m18 2 4 4-14 14H4v-4z") }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Switch.Switch, { checked: on, onChange: () => setOn(!on), label: "YouTube" })
            ] })
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_ListRow.ListRow, { index: 4, handle: true, dimmed: true, title: "Discord", subtitle: "Discord \xB7 \u0437\u0430\u043F\u0438\u0441\u0435\u0439: 902 \u2192 vless-nl", actions: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Switch.Switch, { checked: false, onChange: () => {
        }, label: "Discord" }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_CodeBlock.CodeBlock, { maxHeight: 70, children: "www.youtube.com -> 198.18.0.42 (fake-IP)\n\u043F\u0440\u0430\u0432\u0438\u043B\u043E YouTube -> \u0432\u044B\u0445\u043E\u0434 vless-nl (\u043C\u0435\u0442\u043A\u0430 0x100000, \u0442\u0430\u0431\u043B\u0438\u0446\u0430 300)" })
    ] });
  }
  return __toCommonJS(data_card_exports);
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
