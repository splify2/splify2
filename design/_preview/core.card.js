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

  // src/components/core/core.card.tsx
  var core_card_exports = {};
  __export(core_card_exports, {
    Demo: () => Demo
  });
  var import_react = __toESM(require_react_shim(), 1);
  var import_Button = __toESM(require_ds_global(), 1);
  var import_IconButton = __toESM(require_ds_global(), 1);
  var import_Badge = __toESM(require_ds_global(), 1);
  var import_Spinner = __toESM(require_ds_global(), 1);
  var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
  var glyph = (d) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d }) });
  function Demo() {
    const [busy, setBusy] = import_react.default.useState(false);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "col", style: { gap: 14 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Button.Button, { icon: glyph("M12 5v14M5 12h14"), children: "\u041D\u043E\u0432\u043E\u0435 \u043F\u0440\u0430\u0432\u0438\u043B\u043E" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Button.Button, { tone: "secondary", children: "\u041F\u0440\u043E\u0432\u0435\u0440\u0438\u0442\u044C" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Button.Button, { tone: "ghost", size: "sm", children: "\u0438\u0441\u043F\u0440\u0430\u0432\u043D\u043E: 11 \u2014 \u043F\u043E\u043A\u0430\u0437\u0430\u0442\u044C" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Button.Button, { tone: "danger", icon: glyph("M18.4 6.6a9 9 0 1 1-12.8 0M12 2v10"), children: "\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0432\u0441\u0451" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Button.Button, { disabled: true, children: "\u041D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Button.Button, { busy, icon: glyph("M21 12a9 9 0 1 1-6.2-8.6"), onClick: () => {
          setBusy(true);
          setTimeout(() => setBusy(false), 1600);
        }, children: busy ? "\u041F\u0440\u043E\u0432\u0435\u0440\u044F\u0435\u043C\u2026" : "\u041D\u0430\u0436\u043C\u0438\u0442\u0435: \u0441\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u043E\u0436\u0438\u0434\u0430\u043D\u0438\u044F" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_IconButton.IconButton, { label: "\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C", children: glyph("m18 2 4 4-14 14H4v-4z") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_IconButton.IconButton, { label: "\u041F\u043E\u0434\u043D\u044F\u0442\u044C", children: glyph("M12 19V5M5 12l7-7 7 7") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_IconButton.IconButton, { label: "\u0423\u0434\u0430\u043B\u0438\u0442\u044C", tone: "danger", children: glyph("M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6") }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Spinner.Spinner, {})
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Badge.Badge, { children: "\u0438\u0441\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Badge.Badge, { tone: "accent", children: "VLESS/Reality" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Badge.Badge, { tone: "solid", children: "\u0430\u043A\u0442\u0438\u0432\u043D\u043E" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Badge.Badge, { tone: "success", children: "\u043E\u0442\u0432\u0435\u0442 42 \u043C\u0441" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Badge.Badge, { tone: "warn", children: "\u043A\u043B\u044E\u0447 \u043D\u0435 \u043F\u043E\u0434\u043E\u0448\u0451\u043B" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Badge.Badge, { tone: "danger", children: "\u0432\u044B\u0445\u043E\u0434 \u0443\u043F\u0430\u043B" })
      ] })
    ] });
  }
  return __toCommonJS(core_card_exports);
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
