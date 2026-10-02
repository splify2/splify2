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

  // src/components/navigation/navigation.card.tsx
  var navigation_card_exports = {};
  __export(navigation_card_exports, {
    Demo: () => Demo
  });
  var import_react = __toESM(require_react_shim(), 1);
  var import_NavItem = __toESM(require_ds_global(), 1);
  var import_Breadcrumb = __toESM(require_ds_global(), 1);
  var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
  var glyph = (d) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "18", height: "18", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d }) });
  var ITEMS = [
    { id: "overview", label: "\u041E\u0431\u0437\u043E\u0440", d: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M3 12a9 9 0 0 1 18 0" },
    { id: "rules", label: "\u041F\u0440\u0430\u0432\u0438\u043B\u0430", count: 4, d: "M4 6h6l4 12h6" },
    { id: "outputs", label: "\u0412\u044B\u0445\u043E\u0434\u044B", count: 3, d: "M6 3v12M18 9v12M6 15a6 6 0 0 0 12-6" },
    { id: "catalog", label: "\u041A\u0430\u0442\u0430\u043B\u043E\u0433", d: "M4 4h6v16H4zM14 4h6v16h-6z" },
    { id: "diag", label: "\u0414\u0438\u0430\u0433\u043D\u043E\u0441\u0442\u0438\u043A\u0430", badge: 1, d: "M4 3v7a5 5 0 0 0 10 0V3M9 15v2a4 4 0 0 0 8 0v-1" }
  ];
  function Demo() {
    const [active, setActive] = import_react.default.useState("rules");
    const current = ITEMS.find((i) => i.id === active);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "row", style: { gap: 20, alignItems: "flex-start" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("nav", { style: { width: 236, padding: 10, borderRadius: "var(--an-radius-block)", background: "var(--an-surface-rail)", border: "1px solid var(--an-border)", display: "flex", flexDirection: "column", gap: 2 }, children: ITEMS.map((it) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_NavItem.NavItem, { icon: glyph(it.d), label: it.label, count: it.count, badge: it.badge, active: active === it.id, onClick: () => setActive(it.id) }, it.id)) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "col", style: { flex: 1, minWidth: 260, gap: 14 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Breadcrumb.Breadcrumb, { items: [{ label: "\u041F\u0440\u0430\u0432\u0438\u043B\u0430", onClick: () => setActive("rules") }, { label: "YouTube" }], meta: "\u043C\u0435\u0441\u0442\u043E \u0432 \u043E\u0447\u0435\u0440\u0435\u0434\u0438: 2 \u0438\u0437 4" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { font: "var(--an-text-title)", letterSpacing: "var(--an-tracking-title)" }, children: current?.label }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { style: { font: "var(--an-text-body-sm)", color: "var(--an-text-muted)" }, children: "\u0420\u0430\u0437\u0434\u0435\u043B\u043E\u0432 \u043F\u044F\u0442\u044C-\u0448\u0435\u0441\u0442\u044C. \u0412\u043D\u0443\u0442\u0440\u0438 \u0440\u0430\u0437\u0434\u0435\u043B\u0430 \u0432\u043B\u043E\u0436\u0435\u043D\u043D\u044B\u0445 \u0432\u043A\u043B\u0430\u0434\u043E\u043A \u043D\u0435\u0442: \u0435\u0441\u043B\u0438 \u043F\u043E\u043D\u0430\u0434\u043E\u0431\u0438\u043B\u0438\u0441\u044C \u2014 \u0440\u0430\u0437\u0434\u0435\u043B \u0432\u044B\u0431\u0440\u0430\u043D \u043D\u0435\u0432\u0435\u0440\u043D\u043E." })
      ] })
    ] });
  }
  return __toCommonJS(navigation_card_exports);
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
