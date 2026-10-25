'use strict';
'require baseclass';
'require ui';
'require view.splify2.core.i18n as i18n';
'require view.splify2.core.schema as schema';

// JSON Schema -> LuCI form (SPLIFY2_PLATFORM.md, 4.2 and 4.4): one field for every key of the schema.
// Used for the sections of the spec (outputs, rules, DNS...) and for the settings of plugins.
//
//   var form = autoform.build(node, value, { spec: spec, devices: [...] });
//   container.appendChild(form.el);
//   var errors = form.validate();      // [{ path, title, message }]
//   var value = form.get();            // JSON value, empty keys left out, unknown keys kept
//
// Not here on purpose: themes, animations, own logic. The widgets are the widgets of LuCI (ui.Textfield,
// ui.Select, ui.Checkbox, ui.DynamicList, ui.Dropdown, ui.Combobox).
//
// Every field is registered with its path (schema.paths() names the same paths): the coverage test
// checks that there is no key without a field.

var T = i18n.T.bind(i18n);

function text(s) { return i18n.T(s); }

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
	return [ d, extra ].filter(Boolean).join(' ');
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
	var refName = node['x-ref'];
	var v = value == null ? '' : String(value);
	var validate = function(s) {
		var e = errText(schema.check(node, s));
		return e ? e : true;
	};
	if (node.enum) {
		kind = 'select';
		var pairs = schema.enumChoices(node);
		// a value the schema does not know (a kind of a plugin that is not installed) is kept, not replaced
		if (v !== '' && !pairs.some(function(p) { return p[0] === v; })) pairs.push([ v, T('{value} (unknown)', { value: v }) ]);
		var cs = toChoices(pairs, required ? null : T('(default)'));
		if (required && v === '' && pairs.length) v = pairs[0][0];
		w = new ui.Select(v, cs.choices, { sort: cs.order, optional: !required });
	} else if (refName) {
		kind = 'combobox';
		var rp = toChoices(refPairs(ctx, refName), required ? null : '');
		w = new ui.Combobox(v, rp.choices, { sort: rp.order, optional: !required, custom_placeholder: T('or type a name') });
	} else {
		kind = 'text';
		w = new ui.Textfield(v, {
			password: !!node['x-secret'], optional: true, validate: validate,
			placeholder: node.default != null ? String(node.default) :
				(node.minimum != null && node.maximum != null ? node.minimum + '..' + node.maximum : (node['x-path'] ? T('path') : ''))
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
	var w, ch = null;
	var ref = items['x-ref'] || node['x-ref'];
	var itemType = schema.typeOf(items);
	if (items.enum) {
		var cs = toChoices(schema.enumChoices(items), null);
		w = new ui.Dropdown(vals, cs.choices, { multiple: true, sort: cs.order, optional: true, display_items: 8, placeholder: T('(default)') });
		f.kind = 'multiselect';
	} else {
		if (ref) { var rp = toChoices(refPairs(ctx, ref), null); ch = rp.choices; }
		w = new ui.DynamicList(vals, ch, {
			optional: true, allowduplicates: !node.uniqueItems && !ref,
			placeholder: items['x-path'] ? T('path') : '',
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
		return a.length ? a : undefined;
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
	else if (t === 'object' || node.properties || node['x-kinds']) f = objectField(key, node, value, path, ctx, false);
	else if (t === 'array') {
		var it = node.items;
		if (it && (it.properties || it['x-kinds'] || schema.typeOf(it) === 'object')) f = arrayObjectField(key, node, value, path, ctx);
		else f = leafArray(key, node, value, path, ctx, required);
	}
	else if (t === 'boolean') f = leafBoolean(key, node, value, path, ctx);
		else f = leafString(key, node, value, path, ctx, required);
	f.key = key;
	ctx.form.fields.push({ path: path, node: node, field: f });
	return f;
}

function objectField(key, node, value, path, ctx, isEntry) {
	var f = baseField(path, node);
	var val = (value && typeof value === 'object' && !Array.isArray(value)) ? value : {};
	var req = node.required || [];
	var kids = [];
	var body = E('div', { 'class': 'splify2-object' });
	schema.allLayers(node).forEach(function(layer) {
		schema.layerProps(node, layer).forEach(function(kv) {
			var k = kv[0], sub = kv[1];
			var p = layer === '' ? (path ? path + '.' + k : k) : path + '.@' + layer + '.' + k;
			var required = req.indexOf(k) >= 0 || (layer !== '' && ((node['x-kinds'][layer].required || []).indexOf(k) >= 0));
			var c = buildNode(k, sub, val[k], p, ctx, required);
			var kid = { layer: layer, key: k, node: sub, field: c, required: required };
			kids.push(kid);
			if (c.el) body.appendChild(c.el);
			c.change(function() { refresh(); f.fire(); });
		});
	});
	var extras = schema.extraKeys(node, val);
	f.extras = extras;

	var active = function() {
		// two passes: kind is in the base layer, protocol in the layer of the kind
		// obj: what is written; eff: the same with the defaults of the schema (for x-when and kinds)
		var obj = {}, eff = {}, lay = [ '' ];
		for (var i = 0; i < 3; i++) {
			obj = {}; eff = {};
			kids.forEach(function(k) {
				if (lay.indexOf(k.layer) < 0) return;
				if (k.field.kind === 'const') return;
				var v = k.field.get();
				if (v !== undefined) { obj[k.key] = v; eff[k.key] = v; }
				else if (k.node.default !== undefined) eff[k.key] = k.node.default;
			});
			var nl = schema.layers(node, eff);
			if (nl.join('|') === lay.join('|')) break;
			lay = nl;
		}
		return { layers: lay, obj: eff };
	};
	var refresh = function() {
		var a = active();
		kids.forEach(function(k) {
			k.field.show(a.layers.indexOf(k.layer) >= 0 && schema.visible(k.node, a.obj));
		});
		f.layersNow = a.layers;
	};
	f.refresh = refresh;
	f.kids = kids;
	f.el = isEntry ? body : E('fieldset', { 'class': 'cbi-section splify2-section' }, [
		node.title && key ? E('legend', {}, label(key, node)) : '', body ]);
	f.get = function() {
		var a = active(), out = {};
		kids.forEach(function(k) {
			if (a.layers.indexOf(k.layer) < 0 || !schema.visible(k.node, a.obj)) return;
			var v = k.field.get();
			if (v !== undefined) out[k.key] = v;
		});
		extras.forEach(function(x) { out[x] = val[x]; });
		return isEntry ? out : schema.clean(out);
	};
	f.validate = function() {
		var a = active(), out = [];
		kids.forEach(function(k) {
			if (a.layers.indexOf(k.layer) < 0 || !schema.visible(k.node, a.obj)) return;
			out = out.concat(k.field.validate());
		});
		return out;
	};
	refresh();
	return f;
}

function summaryOf(name, v) {
	var bits = [];
	if (v && v.kind) bits.push(v.kind + (v.protocol ? ':' + v.protocol : ''));
	return name + (bits.length ? ' · ' + bits.join(' ') : '');
}

// Map of named entries (outputs, lists, clients, DNS upstreams).
//   opts.filter(name, value) - which entries this form shows; the rest is kept untouched
//   opts.newValue(name)      - value of a new entry
function mapField(key, node, value, path, ctx) {
	var f = baseField(path, node);
	var entryNode = schema.mapNode(node);
	var opts = (ctx.mapOptions && ctx.mapOptions[path]) || {};
	var val = (value && typeof value === 'object') ? value : {};
	var entries = [];
	var hidden = {};
	var list = E('div', { 'class': 'splify2-entries' });
	var namePat = node['x-name-pattern'] ? new RegExp(node['x-name-pattern']) : null;

	var addEntry = function(name, v, open) {
		var ef = objectField('', entryNode, v, path + '.*', ctx, true);
		ctx.form.fields.push({ path: path + '.*', node: entryNode, field: ef });
		var sum = E('summary', {}, summaryOf(name, v));
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
			var cur = ef.get();
			sum.textContent = summaryOf(name, cur);
			f.fire();
		});
	};
	Object.keys(val).forEach(function(n) {
		if (opts.filter && !opts.filter(n, val[n])) hidden[n] = val[n];
		else addEntry(n, val[n], false);
	});

	var nameIn = new ui.Textfield('', { optional: true, placeholder: T('name'), maxlength: 31 });
	var nameEl = nameIn.render();
	var add = E('button', { 'class': 'cbi-button cbi-button-add', type: 'button', click: function(ev) {
		ev.preventDefault();
		var n = String(nameIn.getValue() || '').trim();
		if (!n) { ctx.notify(T('Enter a name first')); return; }
		if (namePat && !namePat.test(n)) { ctx.notify(T('The name may contain letters, digits, _ - . and is up to 31 bytes long')); return; }
		if (entries.some(function(e) { return e.name === n; }) || has(hidden, n)) { ctx.notify(T('The name {name} is already taken', { name: n })); return; }
		addEntry(n, opts.newValue ? opts.newValue(n) : (entryNode.properties && entryNode.properties.kind && entryNode.properties.kind.enum ? { kind: entryNode.properties.kind.enum[0] } : {}), true);
		nameIn.setValue('');
		f.fire();
	} }, T('Add'));
	f.entries = entries;
	f.addNamed = function(n, v) { addEntry(n, v, true); };
	f.nameInput = nameIn;
	f.addButton = add;
	f.el = E('fieldset', { 'class': 'cbi-section splify2-section', 'data-splify2-key': key }, [
		node.title ? E('legend', {}, label(key, node)) : '',
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

function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

// Ordered array of objects (rules).
function arrayObjectField(key, node, value, path, ctx) {
	var f = baseField(path, node);
	var itemNode = node.items;
	var items = [];
	var list = E('div', { 'class': 'splify2-entries' });
	var renumber = function() {
		items.forEach(function(it, i) {
			var cur = it.field.get();
			it.sum.textContent = '#' + (i + 1) + (cur && cur.name ? ' · ' + cur.name : '');
		});
	};
	var addItem = function(v, open) {
		var ef = objectField('', itemNode, v, path + '.[]', ctx, true);
		ctx.form.fields.push({ path: path + '.[]', node: itemNode, field: ef });
		var sum = E('summary', {}, '');
		var it = { field: ef, sum: sum };
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
		var wrap = E('details', { 'class': 'splify2-entry' }, [ sum, E('div', { 'class': 'splify2-entry-body' }, [ ef.el,
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', { 'class': 'cbi-button', type: 'button', click: move(-1) }, T('Up')),
				E('button', { 'class': 'cbi-button', type: 'button', click: move(1) }, T('Down')), rm ]) ]) ]);
		if (open) wrap.setAttribute('open', '');
		it.el = wrap;
		items.push(it);
		list.appendChild(wrap);
		ef.change(function() { renumber(); f.fire(); });
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
		node.title ? E('legend', {}, label(key, node)) : '', list, E('div', { 'class': 'cbi-section-create' }, [ add ]) ]);
	f.get = function() {
		var a = items.map(function(it) { return it.field.get(); });
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

// A string (name from x-ref) or an object (inline definition) - the `dns` key of a rule.
function unionField(key, node, value, path, ctx, required) {
	var f = baseField(path, node);
	var strNode = { type: 'string', title: node.title, description: node.description, 'x-ref': node['x-ref'] };
	var objNode = { type: 'object', properties: node.properties, title: 'Inline definition' };
	var sv = typeof value === 'string' ? value : undefined;
	var ov = (value && typeof value === 'object') ? value : undefined;
	var sf = leafString(key, strNode, sv, path, ctx, false);
	var of = objectField('inline', objNode, ov, path, ctx, false);
	// the keys of the inline object are registered by objectField under the key itself (rules.[].dns.url)
	var det = E('details', { 'class': 'splify2-entry' }, [ E('summary', {}, T('Inline definition')), of.el ]);
	if (ov) det.setAttribute('open', '');
	f.el = E('div', { 'class': 'cbi-value-wrap' }, [ sf.el, det ]);
	hook(f.el, f);
	sf.change(function() { f.fire(); }); of.change(function() { f.fire(); });
	f.get = function() {
		var o = of.get();
		return o ? o : sf.get();
	};
	f.validate = function() { return of.get() ? of.validate() : sf.validate(); };
	return f;
}

return baseclass.extend({
	// Build the form of a schema node for a value. ctx:
	//   spec       the spec, for x-ref choices and "used by" checks
	//   devices    network devices, for x-ref: devices
	//   notify(s)  show a message to the person
	//   mapOptions { 'outputs': { filter, newValue } } by path
	build: function(node, value, ctx0) {
		var ctx = Object.assign({ notify: function() {} }, ctx0 || {});
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

// Names for x-ref: elements of the spec (+ the built-in names lan and all).
function autoformRefs(ctx, ref) {
	var spec = ctx.spec || {};
	var names;
	if (ref === 'devices') {
		names = (ctx.devices || []).slice();
		((spec.lan && spec.lan.devices) || []).forEach(function(d) { if (names.indexOf(d) < 0) names.push(d); });
		return names;
	}
	var parts = ref.split('.'), cur = spec;
	for (var i = 0; i < parts.length && cur; i++) cur = cur[parts[i]];
	names = cur && typeof cur === 'object' ? Object.keys(cur) : [];
	if (ref === 'clients') names.unshift('lan');
	if (ref === 'lists') names.unshift('all');
	return names;
}

// Where the spec names `name` (a key of the map at `path`): [ 'rules[2].out', ... ]. The entry itself is not counted.
function autoformUsedBy(ctx, path, name) {
	var out = [];
	var spec = ctx.spec || {};
	// only the keys that name an element: `direct` as the value of kind or on_fail is not a reference
	var REF_KEYS = [ 'out', 'over', 'members', 'default', 'to', 'for', 'upstream', 'other', 'servers', 'dns' ];
	var walk = function(v, p, k) {
		if (typeof v === 'string') { if (v === name && REF_KEYS.indexOf(k) >= 0) out.push(p); return; }
		if (Array.isArray(v)) { v.forEach(function(x, i) { walk(x, p + '[' + i + ']', k); }); return; }
		if (v && typeof v === 'object') Object.keys(v).forEach(function(kk) {
			if (p === path && kk === name) return;   // the entry itself
			walk(v[kk], p ? p + '.' + kk : kk, kk);
		});
	};
	walk(spec, '', '');
	return out;
}
