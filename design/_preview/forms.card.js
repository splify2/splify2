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

  // src/components/forms/forms.card.tsx
  var forms_card_exports = {};
  __export(forms_card_exports, {
    Demo: () => Demo
  });
  var import_react = __toESM(require_react_shim(), 1);
  var import_Field = __toESM(require_ds_global(), 1);
  var import_Input = __toESM(require_ds_global(), 1);
  var import_Select = __toESM(require_ds_global(), 1);
  var import_Switch = __toESM(require_ds_global(), 1);
  var import_Checkbox = __toESM(require_ds_global(), 1);
  var import_Radio = __toESM(require_ds_global(), 1);
  var import_SegmentedControl = __toESM(require_ds_global(), 1);
  var import_Chip = __toESM(require_ds_global(), 1);
  var import_Slider = __toESM(require_ds_global(), 1);
  var import_StatusDot = __toESM(require_ds_global(), 1);
  var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
  var search = /* @__PURE__ */ (0, import_jsx_runtime.jsx)("svg", { width: "16", height: "16", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "2", strokeLinecap: "round", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("path", { d: "M21 21l-4.3-4.3M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16" }) });
  function Demo() {
    const [on, setOn] = import_react.default.useState(true);
    const [seg, setSeg] = import_react.default.useState("all");
    const [who, setWho] = import_react.default.useState("all");
    const [picked, setPicked] = import_react.default.useState({ youtube: true, telegram: false });
    const [url, setUrl] = import_react.default.useState("sub.example.com/s/9f3a1c");
    const [half, setHalf] = import_react.default.useState(45);
    const bad = url.length > 0 && !/^https?:\/\//.test(url) && !/^vless:\/\//.test(url);
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "col", style: { gap: 16 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "row", style: { gap: 16, alignItems: "flex-end" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Field.Field, { label: "\u0421\u0441\u044B\u043B\u043A\u0430 \u043D\u0430 \u043F\u043E\u0434\u043F\u0438\u0441\u043A\u0443", error: bad ? "\u041D\u0443\u0436\u043D\u0430 \u0441\u0441\u044B\u043B\u043A\u0430 https:// \u0438\u043B\u0438 vless://" : null, style: { flex: 1, minWidth: 260 }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Input.Input, { mono: true, value: url, invalid: bad, onChange: (e) => setUrl(e.target.value) }) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Field.Field, { label: "\u0412\u0435\u0440\u0441\u0438\u044F", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_Select.Select, { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "1.1.3 \u2014 \u0441\u0432\u0435\u0436\u0430\u044F" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { children: "1.1.2" })
        ] }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Input.Input, { icon: search, placeholder: "\u043F\u043E\u0438\u0441\u043A \u043F\u043E \u043A\u0430\u0442\u0430\u043B\u043E\u0433\u0443", trailing: "142" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "row", style: { gap: 20 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_SegmentedControl.SegmentedControl, { value: seg, onChange: setSeg, items: [{ value: "all", label: "\u0432\u0441\u0435 \xB7 142" }, { value: "used", label: "\u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u044E\u0442\u0441\u044F \xB7 6" }] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "row", style: { gap: 10 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Switch.Switch, { checked: on, onChange: () => setOn(!on), label: "\u041F\u0440\u0430\u0432\u0438\u043B\u043E \u0432\u043A\u043B\u044E\u0447\u0435\u043D\u043E" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "cap", children: on ? "\u0432\u043A\u043B\u044E\u0447\u0435\u043D\u043E" : "\u0432\u044B\u043A\u043B\u044E\u0447\u0435\u043D\u043E" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Switch.Switch, { size: "lg", checked: !on, onChange: () => setOn(!on), label: "\u0422\u043E\u0442 \u0436\u0435 \u0442\u0443\u043C\u0431\u043B\u0435\u0440 \u0434\u043B\u044F \u0442\u0435\u043B\u0435\u0444\u043E\u043D\u0430" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "row", style: { gap: 24, alignItems: "flex-start" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "col", style: { gap: 6, flex: 1, minWidth: 250 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Checkbox.Checkbox, { checked: picked.youtube, onChange: () => setPicked((p) => ({ ...p, youtube: !p.youtube })), label: "YouTube", meta: "\u0434\u043E\u043C\u0435\u043D\u044B \u0438 \u0430\u0434\u0440\u0435\u0441\u0430 \xB7 41 890" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Checkbox.Checkbox, { checked: picked.telegram, onChange: () => setPicked((p) => ({ ...p, telegram: !p.telegram })), label: "Telegram", meta: "\u0430\u0434\u0440\u0435\u0441\u0430 \xB7 3 118" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "col", style: { gap: 10, flex: 1, minWidth: 220 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Radio.Radio, { checked: who === "all", onChange: () => setWho("all"), label: "\u0412\u0441\u0435 \u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u0430 \u0432 \u0441\u0435\u0442\u0438" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Radio.Radio, { checked: who === "some", onChange: () => setWho("some"), dot: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_StatusDot.StatusDot, { tone: "ok" }), label: "vless-nl", meta: "\u041D\u0438\u0434\u0435\u0440\u043B\u0430\u043D\u0434\u044B" })
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Field.Field, { label: "\u043F\u043E\u043B\u0443\u0441\u043F\u0430\u0434 \u0443\u0440\u043E\u0432\u043D\u044F", hint: "\u0447\u0435\u0440\u0435\u0437 \u0441\u043A\u043E\u043B\u044C\u043A\u043E \u0434\u043D\u0435\u0439 \u0432\u0435\u0441 \u043D\u0430\u0431\u043B\u044E\u0434\u0435\u043D\u0438\u044F \u043F\u0430\u0434\u0430\u0435\u0442 \u0432\u0434\u0432\u043E\u0435", style: { maxWidth: 420 }, children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Slider.Slider, { value: half, min: 7, max: 180, step: 1, unit: "\u0434\u043D\u0435\u0439", onChange: setHalf, label: "\u043F\u043E\u043B\u0443\u0441\u043F\u0430\u0434 \u0443\u0440\u043E\u0432\u043D\u044F" }) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "row", style: { gap: 8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Chip.Chip, { onRemove: () => {
        }, children: "YouTube" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Chip.Chip, { onRemove: () => {
        }, children: "Google" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Chip.Chip, { tone: "neutral", children: "work-vpn" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Chip.Chip, { dashed: true, children: "+ \u0441\u0435\u0440\u0432\u0438\u0441" })
      ] })
    ] });
  }
  return __toCommonJS(forms_card_exports);
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
