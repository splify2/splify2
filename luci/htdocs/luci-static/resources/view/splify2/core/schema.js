'use strict';
'require baseclass';

// Pure helpers over the schema of spec keys (`steer spec-schema --json`): the subset of JSON Schema of
// plugin-sdk/schema/kind-keys.schema.json plus the extensions the core and the plugins use:
//
//   x-path    string is a path to a file (etc: relative to the spec directory, conf, abs)
//   x-secret  value is a secret: a password field, never printed
//   x-ref     string (or items of an array) names an element of the spec: outputs, clients, lists,
//             dns.upstreams, or "devices" (network devices of the router)
//   x-when    {sibling: [values]}: the key is shown (and written) only when the sibling key has one of the
//             values; booleans and numbers are compared as strings
//   x-map     object whose keys are names chosen by the person; the value of x-map is the schema of an entry
//   x-kinds   {name: node}: keys of one kind of an entry, chosen by the `kind` key of the entry ("tunnel"
//             and then "tunnel:vless" when the entry has protocol: vless) - the format of plugin kinds
//   x-name-pattern  pattern for the names of an x-map
//
// No DOM here: the form is built by autoform.js, and this file is what the tests run on plain node.

// marker of a string that the frame shows later through T(): the list of strings is built from it
function N(s) { return s; }

function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

return baseclass.extend({
	has: has,

	// The type the form draws: string | integer | number | boolean | array | object | union
	// (union - a string or an object, like the `dns` key of a rule).
	typeOf: function(node) {
		var t = node.type;
		if (Array.isArray(t)) {
			if (t.indexOf('object') >= 0 && t.indexOf('string') >= 0) return 'union';
			if (t.indexOf('array') >= 0) return 'array';
			t = t.filter(function(x) { return x !== 'null'; })[0];
		}
		if (t) return t;
		if (node['x-map'] || node.properties || node['x-kinds']) return 'object';
		if (node.items) return 'array';
		if (node.enum) return 'string';
		return 'string';
	},

	isMap: function(node) { return !!node['x-map'] || (node.additionalProperties && typeof node.additionalProperties === 'object'); },
	mapNode: function(node) { return node['x-map'] || node.additionalProperties; },

	// Names of kinds of an entry node that has x-kinds, in the order of the schema.
	kindNames: function(node) { return node['x-kinds'] ? Object.keys(node['x-kinds']) : []; },

	// The layers that apply to an entry value: ['', 'tunnel', 'tunnel:vless'] - the base properties and
	// then the keys of the kind and of kind:protocol. '' is the base layer.
	layers: function(node, value) {
		var out = [ '' ];
		var K = node['x-kinds'];
		if (!K) return out;
		var kind = value && typeof value.kind === 'string' ? value.kind : null;
		if (kind && has(K, kind)) {
			out.push(kind);
			var proto = value.protocol;
			if (typeof proto === 'string' && has(K, kind + ':' + proto)) out.push(kind + ':' + proto);
		}
		return out;
	},

	// Properties of a layer: [[key, node], ...]
	layerProps: function(node, layer) {
		var src = layer === '' ? node : node['x-kinds'][layer];
		var p = (src && src.properties) || {};
		return Object.keys(p).map(function(k) { return [ k, p[k] ]; });
	},

	// Every layer that can ever apply (for building all fields once and hiding the ones that do not apply).
	allLayers: function(node) { return [ '' ].concat(this.kindNames(node)); },

	// x-when check against the sibling values.
	visible: function(node, siblings) {
		var w = node['x-when'];
		if (!w) return true;
		for (var k in w) {
			if (!has(w, k)) continue;
			var v = siblings ? siblings[k] : undefined;
			var list = w[k].map(String);
			if (v === undefined || v === null || list.indexOf(String(v)) < 0) return false;
		}
		return true;
	},

	// Values of a node that the form must keep even if it has no field (a key of a newer core,
	// a hidden key): the unknown keys of an object value.
	extraKeys: function(node, value, layers) {
		var known = {};
		var self = this;
		(layers || [ '' ]).forEach(function(l) {
			self.layerProps(node, l).forEach(function(kv) { known[kv[0]] = 1; });
		});
		if (node['x-kinds']) self.allLayers(node).forEach(function(l) {
			self.layerProps(node, l).forEach(function(kv) { known[kv[0]] = 1; });
		});
		return Object.keys(value || {}).filter(function(k) { return !known[k]; });
	},

	// Validation of a leaf value against the node. Returns an error text (English, goes through T() in the
	// caller) as [text, vars] or null.
	check: function(node, v) {
		var t = this.typeOf(node);
		if (v === undefined || v === null || v === '') return null;
		if (t === 'integer' || t === 'number') {
			var n = Number(v);
			if (isNaN(n) || (t === 'integer' && Math.floor(n) !== n)) return [ t === 'integer' ? N('Expecting an integer') : N('Expecting a number') ];
			if (node.minimum != null && n < node.minimum) return [ N('The value must be at least {min}'), { min: node.minimum } ];
			if (node.maximum != null && n > node.maximum) return [ N('The value must be at most {max}'), { max: node.maximum } ];
			return null;
		}
		if (t === 'string') {
			var s = String(v);
			if (node.enum && node.enum.map(String).indexOf(s) < 0) return [ N('The value is not one of the allowed ones') ];
			if (node.minLength != null && s.length < node.minLength) return [ N('The value is too short') ];
			if (node.maxLength != null && s.length > node.maxLength) return [ N('The value is longer than {max} characters'), { max: node.maxLength } ];
			if (node.pattern) {
				try { if (!new RegExp(node.pattern).test(s)) return [ N('The value does not match the expected form') ]; } catch (e) { /* pattern the browser cannot read */ }
			}
		}
		return null;
	},

	// Choices of an enum node: [[value, label], ...] (labels equal values).
	enumChoices: function(node) {
		var src = node.enum || (node.items && node.items.enum) || [];
		return src.map(function(x) { return [ String(x), String(x) ]; });
	},

	// Coerce the text of a field to the JSON value of the node.
	coerce: function(node, s) {
		var t = this.typeOf(node);
		if (s === '' || s === undefined || s === null) return undefined;
		if (t === 'integer' || t === 'number') { var n = Number(s); return isNaN(n) ? s : n; }
		if (t === 'boolean') return s === true || s === 'true' || s === '1';
		return s;
	},

	// Remove what the person left empty: '', [], {} and undefined (a map entry is always kept).
	clean: function(v) {
		if (Array.isArray(v)) {
			var a = v.filter(function(x) { return x !== undefined && x !== null && x !== ''; });
			return a.length ? a : undefined;
		}
		if (v && typeof v === 'object') {
			var o = {}, any = false;
			for (var k in v) if (has(v, k) && v[k] !== undefined) { o[k] = v[k]; any = true; }
			return any ? o : undefined;
		}
		if (v === '' || v === null) return undefined;
		return v;
	},

	// Every key of the schema as a path, the way the form names its fields:
	//   a.b        object key
	//   a.*        entry of an x-map          a.[]   item of an array of objects
	//   a.@kind    layer of x-kinds           (so: outputs.*.@tunnel:vless.transport)
	// Used by the coverage test: a key without a field is a red test.
	paths: function(node, prefix) {
		var out = [];
		var self = this;
		var walk = function(n, p) {
			var t = self.typeOf(n);
			if (self.isMap(n)) {
				walk(self.mapNode(n), p + '.*');
				return;
			}
			if (t === 'array' && n.items && (self.typeOf(n.items) === 'object' || n.items.properties)) {
				walk(n.items, p + '.[]');
				return;
			}
			if (n.properties || n['x-kinds']) {
				Object.keys(n.properties || {}).forEach(function(k) {
					var q = p ? p + '.' + k : k;
					out.push(q);
					walk(n.properties[k], q);
				});
				if (n['x-kinds']) Object.keys(n['x-kinds']).forEach(function(l) {
					var kn = n['x-kinds'][l];
					Object.keys(kn.properties || {}).forEach(function(k) {
						var q = p + '.@' + l + '.' + k;
						out.push(q);
						walk(kn.properties[k], q);
					});
				});
				return;
			}
			if (t === 'union' && n.properties) {
				Object.keys(n.properties).forEach(function(k) { out.push(p + '.' + k); });
			}
		};
		walk(node, prefix || '');
		return out;
	}
});
