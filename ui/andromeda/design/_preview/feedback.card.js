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

  // src/components/feedback/feedback.card.tsx
  var feedback_card_exports = {};
  __export(feedback_card_exports, {
    Demo: () => Demo
  });
  var import_react = __toESM(require_react_shim(), 1);
  var import_Verdict = __toESM(require_ds_global(), 1);
  var import_Callout = __toESM(require_ds_global(), 1);
  var import_Toast = __toESM(require_ds_global(), 1);
  var import_Dialog = __toESM(require_ds_global(), 1);
  var import_ApplyPill = __toESM(require_ds_global(), 1);
  var import_Button = __toESM(require_ds_global(), 1);
  var import_jsx_runtime = __toESM(require_jsx_runtime(), 1);
  function Demo() {
    const [state, setState] = import_react.default.useState("running");
    const [toasts, setToasts] = import_react.default.useState([]);
    const [open, setOpen] = import_react.default.useState(false);
    const [pill, setPill] = import_react.default.useState("idle");
    const [changes, setChanges] = import_react.default.useState(3);
    const push = (tone, text) => {
      const id = Math.random();
      setToasts((t) => [...t, { id, tone, text }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200);
    };
    return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "col", style: { gap: 16, paddingBottom: 64 }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Verdict.Verdict, { state, meta: "\u0443\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432 \u0432 \u0441\u0435\u0442\u0438: 9 \xB7 \u0432\u0440\u0435\u043C\u044F \u0440\u0430\u0431\u043E\u0442\u044B 4 \u0447 12 \u043C\u0438\u043D" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "row", style: { gap: 8 }, children: ["running", "broken", "silent", "loading"].map((s) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Button.Button, { tone: s === state ? "primary" : "secondary", size: "sm", onClick: () => setState(s), children: s }, s)) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Callout.Callout, { title: "\u043F\u0440\u043E\u0432\u0435\u0440\u043E\u043A \u0441 \u043F\u0440\u0435\u0434\u0443\u043F\u0440\u0435\u0436\u0434\u0435\u043D\u0438\u0435\u043C", count: 1, verbatim: "\u0441\u043F\u0438\u0441\u043E\u043A domains/telegram.lst \u0441\u0442\u0430\u0440\u0448\u0435 \u0441\u0443\u0442\u043E\u043A", action: "\u0434\u0438\u0430\u0433\u043D\u043E\u0441\u0442\u0438\u043A\u0430 \u2192", onClick: () => push("warn", "\u041F\u0435\u0440\u0435\u0445\u043E\u0434 \u0432 \u0434\u0438\u0430\u0433\u043D\u043E\u0441\u0442\u0438\u043A\u0443") }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "row", style: { gap: 8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Button.Button, { tone: "secondary", size: "sm", onClick: () => push("ok", "\u0418\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E"), children: "\u0422\u043E\u0441\u0442" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Button.Button, { tone: "secondary", size: "sm", onClick: () => push("warn", "\u0421\u043F\u0438\u0441\u043E\u043A \xABwork-vpn\xBB: \u0441\u0442\u0440\u043E\u043A 42, \u043E\u0442\u0431\u0440\u043E\u0448\u0435\u043D\u043E 3 \u2014 \u0444\u043E\u0440\u043C\u0430\u0442 \u043D\u0435 \u043F\u043E\u0434\u043E\u0448\u0451\u043B"), children: "\u0422\u043E\u0441\u0442 \u0441 \u0447\u0438\u0441\u043B\u0430\u043C\u0438" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Button.Button, { tone: "secondary", size: "sm", onClick: () => setOpen(true), children: "\u0414\u0438\u0430\u043B\u043E\u0433" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Button.Button, { tone: "secondary", size: "sm", onClick: () => {
          setChanges((c) => c + 1);
          setPill("idle");
        }, children: "+ \u0438\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u0435" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Toast.ToastStack, { children: toasts.map((t) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_Toast.Toast, { tone: t.tone, children: t.text }, t.id)) }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_Dialog.Dialog,
        {
          open,
          title: "\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C \u0432\u0441\u0451?",
          confirmLabel: "\u041E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u044C",
          onCancel: () => setOpen(false),
          onConfirm: () => {
            setOpen(false);
            push("bad", "\u0414\u0432\u0438\u0436\u043E\u043A \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D, \u0430\u0432\u0442\u043E\u0437\u0430\u043F\u0443\u0441\u043A \u0441\u043D\u044F\u0442");
          },
          children: "\u0414\u0432\u0438\u0436\u043E\u043A \u043E\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u0442\u0441\u044F, \u043F\u0440\u0430\u0432\u0438\u043B\u0430 \u0438\u0437 \u044F\u0434\u0440\u0430 \u0443\u0439\u0434\u0443\u0442. \u0410\u0432\u0442\u043E\u0437\u0430\u043F\u0443\u0441\u043A \u0442\u043E\u0436\u0435 \u0441\u043D\u0438\u043C\u0435\u0442\u0441\u044F \u2014 \u043F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0430 \u0440\u043E\u0443\u0442\u0435\u0440\u0430 \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u0432\u0435\u0440\u043D\u0451\u0442."
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        import_ApplyPill.ApplyPill,
        {
          changes,
          state: pill,
          onApply: () => {
            setPill("busy");
            setTimeout(() => {
              setPill("done");
              setChanges(0);
              push("ok", "\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430 \u043F\u0440\u0438\u043C\u0435\u043D\u0435\u043D\u0430 \u0432 \u044F\u0434\u0440\u0435");
              setTimeout(() => setPill("idle"), 1500);
            }, 1400);
          }
        }
      )
    ] });
  }
  return __toCommonJS(feedback_card_exports);
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
