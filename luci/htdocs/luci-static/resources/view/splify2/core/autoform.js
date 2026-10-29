'use strict';
'require baseclass';
'require ui';
'require view.splify2.core.i18n as i18n';
'require view.splify2.core.schema as schema';

// Schema -> LuCI form (steer/docs/spec-schema.md, "How a form is built"): one field for every key of the
// schema. Used for the sections of the spec (lan, clients, lists, outputs, DNS, rules) and for the settings of
// plugins and the keys of a plugin kind - the same words, the same code.
//
//   var form = autoform.build(node, value, { spec: spec, devices: [...], schemaRoot: root, platform: 'router' });
//   container.appendChild(form.el);
//   var errors = form.validate();      // [{ path, title, message }]
//   var value = form.get();            // JSON value, empty keys left out, unknown keys kept
//
// An entry with x-variants (an output, a DNS server) first chooses its variant (kind, then protocol for a
// tunnel; or server / group of DNS), then draws the keys of that variant only. The fields of a variant are
// built when it is chosen first. A variant that this build does not have (x-absent) is in the list with its
// reason, not hidden. A kind of a plugin is marked with the plugin.
//
// Not here on purpose: themes, animations, own logic. The widgets are the widgets of LuCI (ui.Textfield,
// ui.Select, ui.Checkbox, ui.DynamicList, ui.Dropdown, ui.Combobox).
//
// Every field is registered with its path (schema.paths() names the same paths): the coverage test
// checks that there is no key without a field.

var T = i18n.T.bind(i18n);

function text(s) { return i18n.T(s); }

function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

function mk(ctx) {
	var form = { fields: [], ctx: ctx };
	ctx.form = form;
	return form;
}

// ---- helpers -------------------------------------------------------------------------

function label(key, node) { return node.title ? text(node.title) : key; }

function descOf(node) {
	var d = node.description ? text(node.description) : '';
	var extra = '';
	if (node['x-path'] === 'etc') extra = T('Path of a file, relative to the spec directory');
	else if (node['x-path'] === 'conf') extra = T('Path of a file, relative to the plugin settings directory');
	else if (node['x-path'] === 'abs') extra = T('Absolute path of a file');
	var items = node.items && node.items['x-path'];
	if (!extra && items === 'etc') extra = T('Path of a file, relative to the spec directory');
	var plug = node['x-plugin'] ? T('Key of the plugin {id}', { id: node['x-plugin'] }) : '';
	var unsup = node['x-unsupported'] ? T('Not supported yet by this core version') + ' (' + text(node['x-unsupported']) + ')' : '';
	return [ d, extra, plug, unsup ].filter(Boolean).join(' ');
}

function row(key, node, control, hint) {
	var d = hint != null ? hint : descOf(node);
	return E('div', { 'class': 'cbi-value', 'data-splify2-key': key }, [
		E('label', { 'class': 'cbi-value-title' }, label(key, node)),
		E('div', { 'class': 'cbi-value-field' }, [ control, d ? E('div', { 'class': 'cbi-value-description' }, d) : '' ])
	]);
}

function errText(e) { return e ? i18n.T(e[0], e[1]) : null; }

function toChoices(pairs, emptyLabel) {
	var c = {}, order = [];
	if (emptyLabel != null) { c[''] = emptyLabel; order.push(''); }
	pairs.forEach(function(p) { c[p[0]] = p[1]; order.push(p[0]); });
	return { choices: c, order: order };
}

function refPairs(ctx, ref) {
	var names = (ctx.refs ? ctx.refs(ref) : []) || [];
	return names.map(function(n) { return [ n, n ]; });
}

// A field: { path, node, el, get(), change(cb), show(bool), validate() }
function baseField(path, node) {
	var f = { path: path, node: node, el: null, listeners: [], hidden: false };
	f.change = function(cb) { f.listeners.push(cb); };
	f.fire = function() { f.listeners.forEach(function(cb) { cb(f); }); };
	f.show = function(b) {
		f.hidden = !b;
		if (f.el && f.el.style) f.el.style.display = b ? '' : 'none';
	};
	f.validate = function() { return []; };
	return f;
}

function hook(widgetEl, field) {
	if (widgetEl && widgetEl.addEventListener)
		widgetEl.addEventListener('widget-change', function() { field.fire(); });
}

// ---- leaf fields ---------------------------------------------------------------------

function leafString(key, node, value, path, ctx, required) {
	var f = baseField(path, node);
	var w, kind;
	var ref = schema.refOf(node);
	var v = value == null ? '' : String(value);
	var validate = function(s) {
		var e = errText(schema.check(node, s));
		return e ? e : true;
	};
	if (node.enum) {
		kind = 'select';
		var pairs = schema.enumChoices(node);
		// a value the schema does not know is kept, not replaced
		if (v !== '' && !pairs.some(function(p) { return p[0] === v; })) pairs.push([ v, T('{value} (unknown)', { value: v }) ]);
		var cs = toChoices(pairs, required ? null : T('(default)'));
		if (required && v === '' && pairs.length) v = pairs[0][0];
		w = new ui.Select(v, cs.choices, { sort: cs.order, optional: !required });
	} else if (ref) {
		kind = 'combobox';
		var rp = toChoices(refPairs(ctx, ref), required ? null : '');
		w = new ui.Combobox(v, rp.choices, { sort: rp.order, optional: !required, custom_placeholder: T('or type a name') });
	} else {
		kind = 'text';
		var ex = node['x-example'];
		w = new ui.Textfield(v, {
			password: !!node['x-secret'], optional: true, validate: validate,
			placeholder: node.default != null ? String(node.default) :
				(node.minimum != null && node.maximum != null ? node.minimum + '..' + node.maximum :
					(node['x-path'] ? T('path') : (typeof ex === 'string' || typeof ex === 'number' ? String(ex) : '')))
		});
	}
	f.widget = w;
	f.kind = kind;
	f.el = row(key, node, w.render());
	hook(f.el, f);
	f.raw = function() { return w.getValue(); };
	f.get = function() { return schema.coerce(node, f.raw()); };
	f.set = function(s) { w.setValue(s == null ? '' : String(s)); };
	f.validate = function() {
		var s = f.raw(), out = [];
		if (required && (s === '' || s == null)) out.push({ path: path, title: label(key, node), message: T('This value is required') });
		else { var e = errText(schema.check(node, s)); if (e) out.push({ path: path, title: label(key, node), message: e }); }
		return out;
	};
	return f;
}

function leafBoolean(key, node, value, path, ctx) {
	var f = baseField(path, node);
	var hasDefault = node.default !== undefined;
	var w;
	if (hasDefault) {
		var on = value === undefined ? node.default : value;
		w = new ui.Checkbox(on ? '1' : '0', { value_enabled: '1', value_disabled: '0' });
		f.raw = function() { return w.getValue(); };
		f.get = function() {
			var cur = f.raw() === '1';
			if (value === undefined && cur === !!node.default) return undefined;   // untouched default
			return cur;
		};
	} else {
		var cur = value === undefined ? '' : String(!!value);
		w = new ui.Select(cur, { '': T('(default)'), 'true': T('yes'), 'false': T('no') }, { sort: [ '', 'true', 'false' ], optional: true });
		f.raw = function() { return w.getValue(); };
		f.get = function() { var s = f.raw(); return s === '' ? undefined : s === 'true'; };
	}
	f.widget = w;
	f.kind = hasDefault ? 'checkbox' : 'select';
	f.el = row(key, node, w.render());
	hook(f.el, f);
	return f;
}

function leafArray(key, node, value, path, ctx, required) {
	var f = baseField(path, node);
	var items = node.items || { type: 'string' };
	var vals = (Array.isArray(value) ? value : (value == null ? [] : [ value ])).map(String);
	// x-one-or-list: `to: youtube` was written as one value; one value stays one value
	var scalar = !!node['x-one-or-list'] && value != null && !Array.isArray(value);
	var w, ch = null;
	var ref = schema.refOf(items) || schema.refOf(node);
	if (items.enum) {
		var cs = toChoices(schema.enumChoices(items), null);
		w = new ui.Dropdown(vals, cs.choices, { multiple: true, sort: cs.order, optional: true, display_items: 8, placeholder: T('(default)') });
		f.kind = 'multiselect';
	} else {
		if (ref) { var rp = toChoices(refPairs(ctx, ref), null); ch = rp.choices; }
		var ex = Array.isArray(node['x-example']) ? node['x-example'][0] : undefined;
		w = new ui.DynamicList(vals, ch, {
			optional: true, allowduplicates: !node.uniqueItems && !ref,
			placeholder: items['x-path'] ? T('path') : (typeof ex === 'string' || typeof ex === 'number' ? String(ex) : ''),
			validate: function(s) { var e = errText(schema.check(items, s)); return e ? e : true; }
		});
		f.kind = 'list';
	}
	f.widget = w;
	f.el = row(key, node, w.render());
	hook(f.el, f);
	f.raw = function() { var r = w.getValue(); return Array.isArray(r) ? r : (r ? [ r ] : []); };
	f.get = function() {
		var a = f.raw().filter(function(s) { return s !== ''; }).map(function(s) { return schema.coerce(items, s); });
		if (!a.length) return undefined;
		return scalar && a.length === 1 ? a[0] : a;
	};
	f.validate = function() {
		var out = [], raw = f.raw();
		if (required && !raw.length) out.push({ path: path, title: label(key, node), message: T('This value is required') });
		if (node.minItems != null && raw.length && raw.length < node.minItems)
			out.push({ path: path, title: label(key, node), message: T('At least {min} items are required', { min: node.minItems }) });
		if (node.maxItems != null && raw.length > node.maxItems)
			out.push({ path: path, title: label(key, node), message: T('At most {max} items are allowed', { max: node.maxItems }) });
		raw.forEach(function(s) {
			var e = errText(schema.check(items, s));
			if (e) out.push({ path: path, title: label(key, node), message: s + ': ' + e });
		});
		return out;
	};
	return f;
}

// ---- objects, maps, arrays of objects ------------------------------------------------------

function buildNode(key, node, value, path, ctx, required) {
	var t = schema.typeOf(node);
	var f;
	if (node.const !== undefined) {
		f = baseField(path, node);
		f.kind = 'const';
		f.el = null;
		f.get = function() { return value; };
	} else if (t === 'union') f = unionField(key, node, value, path, ctx, required);
	else if (schema.isMap(node)) f = mapField(key, node, value, path, ctx);
	else if (t === 'object') f = objectField(key, node, value, path, ctx, false);
	else if (t === 'array') {
		if (schema.isObjectArray(node)) f = arrayObjectField(key, node, value, path, ctx);
		else f = leafArray(key, node, value, path, ctx, required);
	}
	else if (t === 'boolean') f = leafBoolean(key, node, value, path, ctx);
	else f = leafString(key, node, value, path, ctx, required);
	f.key = key;
	if (node['x-unsupported'] && f.get) {
		// drawn, marked, and refused when written: a spec with such a key is not applied
		var inner = f.validate;
		f.validate = function() {
			var out = inner();
			if (f.get() !== undefined) out.push({ path: path, title: label(key, node), message: T('Not supported yet by this core version') });
			return out;
		};
	}
	ctx.form.fields.push({ path: path, node: node, field: f });
	return f;
}

function variantNote(c) {
	var bits = [];
	if (c.description) bits.push(text(c.description));
	if (c.plugin) bits.push(T('Provided by the plugin {id}', { id: c.plugin.id }));
	return bits.join(' ');
}

function choiceLabel(c) {
	if (c.absent) return T('{name} (not available)', { name: c.value });
	if (c.plugin) return T('{name} (plugin {id})', { name: c.value, id: c.plugin.id });
	return c.value;
}

// The record with variants and plain objects. isEntry: no fieldset around it (it is in a map or a list).
function objectField(key, node, value, path, ctx, isEntry) {
	var f = baseField(path, node);
	var val = isObj(value) ? value : {};
	var platform = ctx.platform;
	var V = schema.variantsOf(node), D = V ? schema.disc(node) : null;
	var kids = [];                 // { layer, key, node, field, required }
	var built = {};                // layers whose fields exist
	var body = E('div', { 'class': 'splify2-object' });
	var sel = { has: null, kind: null, protocol: null };     // selectors
	var selFields = {};
	var reasonEl = E('div', { 'class': 'alert-message warning' });
	reasonEl.style.display = 'none';
	var lastObj = {};

	var addSelector = function(selKey, selPath, lab, w, hintEl) {
		var sf = baseField(selPath, { type: 'string' });
		sf.kind = 'select';
		sf.widget = w;
		sf.el = row(selKey, { title: lab }, w.render(), ' ');
		sf.hint = sf.el.children[1].children[1];
		sf.get = function() { return sf.widget.getValue(); };
		sf.key = selKey;
		ctx.form.fields.push({ path: selPath, node: sf.node, field: sf });
		selFields[selKey] = sf;
		body.appendChild(sf.el);
		hook(sf.el, sf);
		return sf;
	};
	var selHint = function(sf, text0) {
		if (!sf.hint || !sf.hint.children) return;
		sf.hint.textContent = text0 || '';
	};
	var pickable = function(list, cur) {
		if (cur && list.some(function(c) { return c.value === cur; })) return cur;
		var ok = list.filter(function(c) { return !c.absent; });
		return (ok[0] || list[0] || { value: '' }).value;
	};
	var selChoices = function(list, cur) {
		var pairs = list.map(function(c) { return [ c.value, choiceLabel(c) ]; });
		// a value the schema does not know (a kind of a plugin that is not installed) is kept, not replaced
		if (cur && !list.some(function(c) { return c.value === cur; })) pairs.push([ cur, T('{value} (unknown)', { value: cur }) ]);
		return toChoices(pairs, null);
	};

	var drawProtocol = function() {};
	if (V && D) {
		if (D.has) {
			var hl = schema.hasChoices(node);
			var hcur = pickable(hl, schema.variantName(node, val));
			var hc = selChoices(hl, '');
			sel.has = addSelector('variant', path + '.@variant', T('Type'), new ui.Select(hcur, hc.choices, { sort: hc.order, optional: false }));
			sel.hasList = hl;
			sel.has.change(function() { refresh(); f.fire(); });
		} else {
			var kl = schema.kindChoices(node);
			var kcur = pickable(kl, typeof val[D.key] === 'string' ? val[D.key] : '');
			// an unknown kind of the value stays selectable
			if (typeof val[D.key] === 'string' && val[D.key] !== '') kcur = val[D.key];
			var kc = selChoices(kl, typeof val[D.key] === 'string' ? val[D.key] : '');
			sel.kind = addSelector(D.key, path ? path + '.' + D.key : D.key, D.key, new ui.Select(kcur, kc.choices, { sort: kc.order, optional: false }));
			sel.kindList = kl;
			var thenKeys = {};
			Object.keys(D.then || {}).forEach(function(k) { thenKeys[D.then[k]] = 1; });
			Object.keys(thenKeys).forEach(function(pk) {
				var holder = E('div', { 'class': 'splify2-protocol' });
				var pp = path ? path + '.' + pk : pk;
				var pf = baseField(pp, { type: 'string' });
				pf.kind = 'select';
				pf.key = pk;
				pf.el = holder;
				pf.get = function() { return pf.widget ? pf.widget.getValue() : undefined; };
				ctx.form.fields.push({ path: pp, node: pf.node, field: pf });
				selFields[pk] = pf;
				body.appendChild(holder);
				sel.protocol = pf;
				pf.draw = function(kind, cur) {
					holder.innerHTML = '';
					pf.widget = null;
					pf.list = [];
					if (!D.then || D.then[kind] !== pk) { pf.show(false); return; }
					pf.list = schema.protocolChoices(node, kind);
					var pcur = pickable(pf.list, cur);
					if (cur) pcur = cur;
					var pc = selChoices(pf.list, cur || '');
					pf.widget = new ui.Select(pcur, pc.choices, { sort: pc.order, optional: false });
					var r = row(pk, { title: pk }, pf.widget.render(), ' ');
					pf.hint = r.children[1].children[1];
					holder.appendChild(r);
					hook(r, pf);
					pf.show(true);
				};
			});
			drawProtocol = function(cur) {
				Object.keys(thenKeys).forEach(function(pk) { selFields[pk].draw(sel.kind.get(), cur); });
			};
			drawProtocol(typeof val[Object.keys(thenKeys)[0]] === 'string' ? val[Object.keys(thenKeys)[0]] : '');
			sel.kind.change(function() { drawProtocol(''); refresh(); f.fire(); });
			Object.keys(thenKeys).forEach(function(pk) { selFields[pk].change(function() { refresh(); f.fire(); }); });
		}
		body.appendChild(reasonEl);
	}

	// the value of the selectors as the keys of the record
	var selWritten = function() {
		var o = {};
		if (!V || !D) return o;
		if (D.has) return o;
		o[D.key] = sel.kind.get();
		Object.keys(D.then || {}).forEach(function(k) {
			var pf = selFields[D.then[k]];
			if (o[D.key] === k && pf && pf.get() !== undefined && pf.get() !== '') o[D.then[k]] = pf.get();
		});
		return o;
	};
	var variantNow = function() {
		if (!V || !D) return null;
		if (D.has) return sel.has.get();
		return schema.variantName(node, selWritten());
	};
	var variantLabel = function() {
		if (!V || !D) return '';
		if (D.has) return sel.has.get();
		var w = selWritten();
		return w[D.key] ? w[D.key] + (w[D.then && D.then[w[D.key]]] ? ':' + w[D.then[w[D.key]]] : '') : '';
	};

	var addKids = function(layer, seed) {
		if (built[layer]) return;
		built[layer] = true;
		schema.layerProps(node, layer, platform).forEach(function(kv) {
			var k = kv[0], sub = kv[1];
			var p = layer === '' ? (path ? path + '.' + k : k) : path + '.@' + layer + '.' + k;
			var required = schema.requiredOf(node, layer).indexOf(k) >= 0;
			var c = buildNode(k, sub, seed[k], p, ctx, required);
			kids.push({ layer: layer, key: k, node: sub, field: c, required: required });
			if (c.el) body.appendChild(c.el);
			c.change(function() { refresh(); f.fire(); });
		});
	};

	// The keys the conditions of the kids (x-when, x-when-set) read: a refresh of a record without variants
	// reads only them - a key of rules does not make the record read all its hundreds of rules on every keystroke.
	var deps = null, depsN = -1;
	var depKeys = function() {
		if (depsN === kids.length) return deps;
		deps = {}; depsN = kids.length;
		kids.forEach(function(k) {
			var w = k.node['x-when'], ws = k.node['x-when-set'];
			if (w) Object.keys(w).forEach(function(x) { deps[x] = 1; });
			if (ws) ws.forEach(function(x) { deps[x] = 1; });
		});
		return deps;
	};

	// what is written and what the record has by default (for x-when), from the fields of the active layers;
	// light: only the keys the conditions read (obj and eff are not the whole record then)
	var state = function(light) {
		var vn = variantNow();
		var absent = !!(vn && V[vn]['x-absent']);
		var layers = [ '' ];
		if (vn && !absent) layers.push(vn);
		layers.forEach(function(l) {
			if (!built[l]) addKids(l, Object.assign({}, val, lastObj));
		});
		var sw = selWritten();
		var vis = kids.map(function() { return true; });
		var obj = {}, eff = {};
		for (var pass = 0; pass < 4; pass++) {
			obj = Object.assign({}, sw); eff = Object.assign({}, sw);
			var dk = light ? depKeys() : null;
			kids.forEach(function(k, i) {
				if (layers.indexOf(k.layer) < 0 || !vis[i] || k.field.kind === 'const') return;
				if (dk && !dk[k.key]) return;
				var v = k.field.get();
				if (v !== undefined) { obj[k.key] = v; eff[k.key] = v; }
				else if (k.node.default !== undefined) eff[k.key] = k.node.default;
			});
			var nv = kids.map(function(k) { return layers.indexOf(k.layer) >= 0 && schema.visible(k.node, eff, obj); });
			if (nv.join() === vis.join()) break;
			vis = nv;
		}
		return { variant: vn, absent: absent, layers: layers, vis: vis, obj: obj, eff: eff };
	};

	var refresh = function() {
		// lastObj seeds the layer of a variant chosen later: only a record with variants needs all of it
		var st = state(!(V && D));
		if (V && D) lastObj = st.obj;
		kids.forEach(function(k, i) { k.field.show(st.layers.indexOf(k.layer) >= 0 && st.vis[i]); });
		f.layersNow = st.layers;
		f.variant = st.variant;
		if (V && D) {
			var hint = '', reason = '';
			if (D.has) {
				var hc2 = (sel.hasList || []).filter(function(c) { return c.value === st.variant; })[0];
				if (hc2) { hint = variantNote(hc2); reason = hc2.absent || ''; }
				selHint(sel.kind || sel.has, hint);
			} else {
				var kc2 = (sel.kindList || []).filter(function(c) { return c.value === sel.kind.get(); })[0];
				if (kc2) { hint = variantNote(kc2); reason = kc2.absent || ''; }
				selHint(sel.kind, hint);
				if (sel.protocol && sel.protocol.widget) {
					var pc2 = (sel.protocol.list || []).filter(function(c) { return c.value === sel.protocol.get(); })[0];
					selHint(sel.protocol, pc2 ? variantNote(pc2) : '');
					if (pc2 && pc2.absent) reason = pc2.absent;
				}
			}
			reasonEl.textContent = reason ? text(reason) : '';
			reasonEl.style.display = reason ? '' : 'none';
			f.absentReason = reason || null;
		}
	};
	f.refresh = refresh;
	f.kids = kids;
	f.selectors = selFields;
	f.variantLabel = variantLabel;
	f.el = isEntry ? body : E('fieldset', { 'class': 'cbi-section splify2-section' }, [
		key ? E('legend', {}, label(key, node)) : '', body ]);

	f.get = function() {
		var st = state(), out = {};
		var sw = selWritten();
		Object.keys(sw).forEach(function(k) { out[k] = sw[k]; });
		kids.forEach(function(k, i) {
			if (st.layers.indexOf(k.layer) < 0 || !st.vis[i]) return;
			var v = k.field.get();
			if (v !== undefined) out[k.key] = v;
		});
		schema.extraKeys(node, val, st.variant, platform).forEach(function(x) { if (!has(out, x)) out[x] = val[x]; });
		return isEntry ? out : schema.clean(out);
	};
	f.validate = function() {
		var st = state(), out = [];
		if (st.absent) out.push({ path: path, title: V && D && !D.has ? D.key : T('Type'), message: text((V[st.variant] || {})['x-absent'] || '') });
		kids.forEach(function(k, i) {
			if (st.layers.indexOf(k.layer) < 0 || !st.vis[i]) return;
			out = out.concat(k.field.validate());
			var n = schema.needs(k.node, k.key, k.field.get(), st.obj);
			if (n) out.push({ path: k.field.path, title: label(k.key, k.node), message: errText(n) });
		});
		return out;
	};
	refresh();
	return f;
}

function summaryOf(name, ef) {
	var l = ef && ef.variantLabel ? ef.variantLabel() : '';
	return name + (l ? ' · ' + l : '');
}

function nameBytes(s) {
	try { return unescape(encodeURIComponent(s)).length; } catch (e) { return s.length; }
}

// Map of named entries (outputs, lists, clients, DNS upstreams).
//   opts.filter(name, value) - which entries this form shows; the rest is kept untouched
//   opts.newValue(name)      - value of a new entry (by default: the keys of the first variant, or {})
function mapField(key, node, value, path, ctx) {
	var f = baseField(path, node);
	var entryNode = schema.mapNode(node);
	var opts = (ctx.mapOptions && ctx.mapOptions[path]) || {};
	var val = isObj(value) ? value : {};
	var entries = [];
	var hidden = {};
	var list = E('div', { 'class': 'splify2-entries' });
	var xn = node['x-name'] || {};
	var namePat = null;
	try { if (xn.pattern) namePat = new RegExp(xn.pattern); } catch (e) { /* pattern the browser cannot read */ }

	var addEntry = function(name, v, open) {
		var ef = objectField('', entryNode, v, path + '.*', ctx, true);
		ctx.form.fields.push({ path: path + '.*', node: entryNode, field: ef });
		var sum = E('summary', {}, summaryOf(name, ef));
		var rm = E('button', { 'class': 'cbi-button cbi-button-remove', type: 'button', click: function(ev) {
			ev.preventDefault();
			var used = ctx.usedBy ? ctx.usedBy(path, name) : [];
			if (used.length) { ctx.notify(T('Cannot remove {name}: it is used by {used}', { name: name, used: used.slice(0, 5).join(', ') })); return; }
			entries.splice(entries.indexOf(ent), 1);
			wrap.remove ? wrap.remove() : wrap.parentNode.removeChild(wrap);
			f.fire();
		} }, T('Remove'));
		var wrap = E('details', { 'class': 'splify2-entry', 'data-name': name }, [ sum, E('div', { 'class': 'splify2-entry-body' }, [ ef.el, E('div', { 'class': 'cbi-page-actions' }, [ rm ]) ]) ]);
		if (open) wrap.setAttribute('open', '');
		var ent = { name: name, field: ef, el: wrap };
		entries.push(ent);
		list.appendChild(wrap);
		ef.change(function() {
			sum.textContent = summaryOf(name, ef);
			f.fire();
		});
	};
	Object.keys(val).forEach(function(n) {
		if (opts.filter && !opts.filter(n, val[n])) hidden[n] = val[n];
		else addEntry(n, val[n], false);
	});

	var nameIn = new ui.Textfield('', { optional: true, placeholder: T('name'), maxlength: xn.maxLength || 255 });
	var nameEl = nameIn.render();
	var add = E('button', { 'class': 'cbi-button cbi-button-add', type: 'button', click: function(ev) {
		ev.preventDefault();
		var n = String(nameIn.getValue() || '').trim();
		if (!n) { ctx.notify(T('Enter a name first')); return; }
		if ((namePat && !namePat.test(n)) || (xn.maxLength && nameBytes(n) > xn.maxLength)) {
			ctx.notify(T('The name may contain letters, digits, _ - . and is up to {max} bytes long', { max: xn.maxLength || 31 })); return; }
		if ((xn.reserved || []).indexOf(n) >= 0) { ctx.notify(T('The name {name} is reserved', { name: n })); return; }
		if (entries.some(function(e) { return e.name === n; }) || has(hidden, n)) { ctx.notify(T('The name {name} is already taken', { name: n })); return; }
		addEntry(n, opts.newValue ? opts.newValue(n) : schema.newEntry(entryNode), true);
		nameIn.setValue('');
		f.fire();
	} }, T('Add'));
	f.entries = entries;
	f.addNamed = function(n, v) { addEntry(n, v, true); };
	f.nameInput = nameIn;
	f.addButton = add;
	f.el = E('fieldset', { 'class': 'cbi-section splify2-section', 'data-splify2-key': key }, [
		node.title ? E('legend', {}, label(key, node)) : '',
		node.description ? E('div', { 'class': 'cbi-section-descr' }, text(node.description)) : '',
		list,
		E('div', { 'class': 'cbi-section-create' }, [ nameEl, add ])
	]);
	f.get = function() {
		var out = {};
		entries.forEach(function(e) { out[e.name] = e.field.get(); });
		Object.keys(hidden).forEach(function(n) { out[n] = hidden[n]; });
		return Object.keys(out).length ? out : undefined;
	};
	f.validate = function() {
		var out = [];
		entries.forEach(function(e) {
			e.field.validate().forEach(function(x) { x.title = e.name + ': ' + x.title; out.push(x); });
		});
		return out;
	};
	return f;
}

// Ordered array of objects (rules).
function arrayObjectField(key, node, value, path, ctx) {
	var f = baseField(path, node);
	var itemNode = node.items;
	var items = [];
	var list = E('div', { 'class': 'splify2-entries' });
	// ctx.lazy: an item is built when it is opened (or validated); a closed one gives its data as it came, so a
	// spec of hundreds of rules opens at once. Its fields enter ctx.form.fields when it is built.
	var valueOf = function(it) { return it.ef ? it.ef.get() : JSON.parse(JSON.stringify(it.value)); };
	var title = function(it, i) {
		var cur = valueOf(it);
		it.sum.textContent = '#' + (i + 1) + (cur && cur.name ? ' · ' + cur.name : '');
	};
	var renumber = function() { items.forEach(title); };
	var addItem = function(v, open) {
		var sum = E('summary', {}, '');
		var slot = E('div', {});
		var it = { sum: sum, ef: null, value: isObj(v) ? v : {} };
		var ensure = function() {
			if (it.ef) return it.ef;
			var ef = it.ef = objectField('', itemNode, it.value, path + '.[]', ctx, true);
			ctx.form.fields.push({ path: path + '.[]', node: itemNode, field: ef });
			slot.appendChild(ef.el);
			// an edit inside one item renames only it: the others keep their numbers and names
			ef.change(function() { title(it, items.indexOf(it)); f.fire(); });
			return ef;
		};
		Object.defineProperty(it, 'field', { get: ensure, enumerable: true });
		var move = function(d) { return function(ev) {
			ev.preventDefault();
			var i = items.indexOf(it), j = i + d;
			if (j < 0 || j >= items.length) return;
			items.splice(i, 1); items.splice(j, 0, it);
			list.removeChild(wrap);
			list.insertBefore(wrap, list.children[j] || null);
			renumber(); f.fire();
		}; };
		var rm = E('button', { 'class': 'cbi-button cbi-button-remove', type: 'button', click: function(ev) {
			ev.preventDefault();
			items.splice(items.indexOf(it), 1);
			list.removeChild(wrap);
			renumber(); f.fire();
		} }, T('Remove'));
		var wrap = E('details', { 'class': 'splify2-entry' }, [ sum, E('div', { 'class': 'splify2-entry-body' }, [ slot,
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', { 'class': 'cbi-button', type: 'button', click: move(-1) }, T('Up')),
				E('button', { 'class': 'cbi-button', type: 'button', click: move(1) }, T('Down')), rm ]) ]) ]);
		if (open) wrap.setAttribute('open', '');
		it.el = wrap;
		it.built = function() { return !!it.ef; };
		items.push(it);
		list.appendChild(wrap);
		if (open || !ctx.lazy) ensure();
		else wrap.addEventListener('toggle', ensure);
	};
	(Array.isArray(value) ? value : []).forEach(function(v) { addItem(v, false); });
	renumber();
	var add = E('button', { 'class': 'cbi-button cbi-button-add', type: 'button', click: function(ev) {
		ev.preventDefault(); addItem({}, true); renumber(); f.fire();
	} }, T('Add'));
	f.items = items;
	f.addButton = add;
	f.addItem = function(v) { addItem(v, true); renumber(); };
	f.el = E('fieldset', { 'class': 'cbi-section splify2-section', 'data-splify2-key': key }, [
		node.title ? E('legend', {}, label(key, node)) : '',
		node.description ? E('div', { 'class': 'cbi-section-descr' }, text(node.description)) : '',
		list, E('div', { 'class': 'cbi-section-create' }, [ add ]) ]);
	f.get = function() {
		var a = items.map(valueOf);
		return a.length ? a : undefined;
	};
	f.validate = function() {
		var out = [];
		items.forEach(function(it, i) {
			it.field.validate().forEach(function(x) { x.title = '#' + (i + 1) + ': ' + x.title; out.push(x); });
		});
		return out;
	};
	return f;
}

// A string (name from x-ref) or an object (a variant written inline) - the `dns` key of a rule.
function unionField(key, node, value, path, ctx, required) {
	var f = baseField(path, node);
	var strNode = { type: 'string', title: node.title, description: node.description, 'x-ref': node['x-ref'] };
	var objNode = Object.assign({}, node, { type: 'object', title: undefined, description: undefined });
	var sv = typeof value === 'string' ? value : undefined;
	var ov = isObj(value) ? value : undefined;
	var sf = leafString(key, strNode, sv, path, ctx, false);
	var of = objectField('', objNode, ov, path, ctx, true);
	var det = E('details', { 'class': 'splify2-entry' }, [ E('summary', {}, T('Inline definition')), of.el ]);
	if (ov) det.setAttribute('open', '');
	f.el = E('div', { 'class': 'cbi-value-wrap' }, [ sf.el, det ]);
	hook(f.el, f);
	sf.change(function() { f.fire(); }); of.change(function() { f.fire(); });
	// the inline record counts when something is written in it besides the choice of its variant
	var inline = function() {
		var o = of.get() || {};
		var written = Object.keys(o).filter(function(k) { return !(of.selectors && of.selectors[k]); });
		return written.length ? o : undefined;
	};
	f.get = function() {
		var o = inline();
		return o ? o : sf.get();
	};
	f.validate = function() { return inline() ? of.validate() : sf.validate(); };
	return f;
}

return baseclass.extend({
	// Build the form of a schema node for a value. ctx:
	//   spec        the spec, for x-ref choices
	//   schemaRoot  the schema of the whole spec, for "used by" checks (default: the node)
	//   platform    router | phone (default: x-platform of the node, or router)
	//   devices     network devices, for x-ref: devices
	//   notify(s)   show a message to the person
	//   mapOptions  { 'outputs': { filter, newValue } } by path
	build: function(node, value, ctx0) {
		var ctx = Object.assign({ notify: function() {} }, ctx0 || {});
		if (!ctx.platform) ctx.platform = schema.platformOf(node);
		if (!ctx.schemaRoot) ctx.schemaRoot = node;
		if (!ctx.refs) ctx.refs = function(ref) { return autoformRefs(ctx, ref); };
		if (!ctx.usedBy) ctx.usedBy = function(path, name) { return autoformUsedBy(ctx, path, name); };
		var form = mk(ctx);
		var root = buildNode('', node, value, '', ctx, false);
		root.form = form;
		form.el = root.el;
		form.root = root;
		form.get = function() { return root.get(); };
		form.validate = function() { return root.validate(); };
		form.field = function(path) {
			for (var i = 0; i < form.fields.length; i++) if (form.fields[i].path === path) return form.fields[i].field;
			return null;
		};
		return form;
	},

	refs: autoformRefs,
	usedBy: autoformUsedBy
});

// Names for x-ref {section, also}: the entries of the section in the spec, and the words of `also`.
function autoformRefs(ctx, ref) {
	var spec = ctx.spec || {};
	if (typeof ref === 'string') ref = { section: ref, also: [] };
	var names;
	if (ref.section === 'devices') {
		names = (ctx.devices || []).slice();
		((spec.lan && spec.lan.devices) || []).forEach(function(d) { if (names.indexOf(d) < 0) names.push(d); });
	} else {
		var parts = ref.section.split('.'), cur = spec;
		for (var i = 0; i < parts.length && cur; i++) cur = cur[parts[i]];
		names = isObj(cur) ? Object.keys(cur) : [];
	}
	(ref.also || []).slice().reverse().forEach(function(w) { if (names.indexOf(w) < 0) names.unshift(w); });
	return names;
}

// Where the spec names `name` (a key of the map at `path`): [ 'rules[2].out', ... ]. The entry itself is not counted.
function autoformUsedBy(ctx, path, name) {
	return schema.usedBy(ctx.schemaRoot, ctx.spec || {}, path, name);
}
