'use strict';
'require baseclass';

// Pure helpers over the schema of spec keys (`steer spec-schema --json`, steer/docs/spec-schema.md): a subset
// of JSON Schema (type, enum, const, default, pattern, minimum, maximum, minLength, maxLength, minItems,
// maxItems, items, properties, required, additionalProperties, description) plus the words of the core:
//
//   x-schema-version, x-steer-version, x-platform (root: router | phone), x-plugins   root
//   x-example      a valid value (of an entry: a valid entry)
//   x-secret       a password field, never printed
//   x-path         etc | conf | abs: the string is a path of a file
//   x-ref          {section, also}: the value names an entry of a section (outputs, lists, clients,
//                  dns.upstreams); `also` - words allowed besides the names (all, lan, direct); on `items`
//                  of an array
//   x-when         {sibling: [values]}: the key means something only with such a value of the sibling
//   x-when-set     [siblings]: the key means something only when these siblings are written
//   x-needs        {value: [siblings]}: with this value the parser refuses without these siblings;
//                  "*" - with any value
//   x-one-or-list  an array that may be written as one value
//   x-unsupported  the key is parsed, but a spec with it is refused ("not supported yet")
//   x-platform     phone: the key is taken by the phone only (not drawn on the router)
//   x-plugin       id of the plugin whose schema gave the key
//   x-name         {pattern, maxLength, reserved}: the names of a map "name -> entry"
//   x-variants     {name: node}: an entry by variants; x-discriminator says how a value picks one:
//                  {key: kind, then: {tunnel: protocol}} - the name is the value of `kind`, and
//                  `kind:protocol` for the kinds of `then`; {has: servers, yes: group, no: server} - the
//                  key is written -> `yes`, else `no`
//   x-spec         in a variant: the keys that make the value this variant ({kind: tunnel, protocol: vless})
//   x-absent       in a variant: the reason the variant is not in this build (a variant without keys)
//   x-protocols    protocols of kind tunnel
//
// No DOM here: the form is built by autoform.js, and this file is what the tests run on plain node.

// marker of a string that the frame shows later through T(): the list of strings is built from it
function N(s) { return s; }

function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

function isObj(x) { return x !== null && typeof x === 'object' && !Array.isArray(x); }

return baseclass.extend({
	has: has,

	// The type the form draws: string | integer | number | boolean | array | object | union
	// (union - a string or an object, like the `dns` key of a rule). A type of several scalars
	// ([integer, string]: a port or a range) is a string that is written as a number when it is one.
	typeOf: function(node) {
		var t = node.type;
		if (Array.isArray(t)) {
			if (t.indexOf('object') >= 0 && t.indexOf('string') >= 0) return 'union';
			if (t.indexOf('array') >= 0) return 'array';
			if (t.indexOf('string') >= 0) return 'string';
			t = t.filter(function(x) { return x !== 'null'; })[0];
		}
		if (t) return t;
		if (node.properties || node['x-variants'] || isObj(node.additionalProperties)) return 'object';
		if (node.items) return 'array';
		return 'string';
	},

	// The platform of a schema: router | phone (a node without the word is for both).
	platformOf: function(root) { return (root && typeof root['x-platform'] === 'string' && root['x-platform']) || 'router'; },
	applies: function(node, platform) { return !node['x-platform'] || node['x-platform'] === (platform || 'router'); },

	// A map "name -> entry": additionalProperties is a schema.
	isMap: function(node) { return isObj(node.additionalProperties); },
	mapNode: function(node) { return node.additionalProperties; },

	// An array of objects (rules).
	isObjectArray: function(node) {
		return this.typeOf(node) === 'array' && !!node.items && !!(node.items.properties || node.items['x-variants']);
	},

	// ---- variants -------------------------------------------------------------------------

	variantsOf: function(node) { return isObj(node['x-variants']) ? node['x-variants'] : null; },
	disc: function(node) { return isObj(node['x-discriminator']) ? node['x-discriminator'] : null; },

	// Keys that choose the variant (kind, protocol): they are drawn as selectors, not as fields.
	selectorKeys: function(node) {
		var d = this.disc(node), out = [];
		if (d && d.key) {
			out.push(d.key);
			Object.keys(d.then || {}).forEach(function(k) { if (out.indexOf(d.then[k]) < 0) out.push(d.then[k]); });
		}
		return out;
	},

	// Variant of a value: its name or null (no key yet, a kind this core does not know).
	variantName: function(node, value) {
		var V = this.variantsOf(node), d = this.disc(node);
		if (!V || !d) return null;
		var v = isObj(value) ? value : {};
		if (d.has) {
			var n = has(v, d.has) && v[d.has] !== undefined ? d.yes : d.no;
			return has(V, n) ? n : null;
		}
		var kind = typeof v[d.key] === 'string' ? v[d.key] : null;
		if (!kind) return null;
		var then = d.then || {};
		if (has(then, kind)) {
			var p = v[then[kind]];
			var name = kind + ':' + p;
			return typeof p === 'string' && has(V, name) ? name : null;
		}
		return has(V, kind) ? kind : null;
	},

	// The keys a value must have to be the variant: x-spec ({kind: tunnel, protocol: vless}).
	specOf: function(node, name) {
		var V = this.variantsOf(node);
		var v = V && V[name];
		return (v && isObj(v['x-spec'])) ? v['x-spec'] : {};
	},

	// Names of the variants in the order of the schema: [{name, node, absent, plugin}]
	variantList: function(node) {
		var V = this.variantsOf(node) || {};
		return Object.keys(V).map(function(n) {
			var v = V[n];
			return { name: n, node: v, absent: typeof v['x-absent'] === 'string' ? v['x-absent'] : null,
				plugin: isObj(v['x-plugin']) ? v['x-plugin'] : null };
		});
	},

	// Choices of the first selector (kind): [{value, absent, plugin, description}]. A kind of which every
	// variant is absent is absent. Kinds come from the schema of `kind` (enum), then from the variants.
	kindChoices: function(node) {
		var d = this.disc(node), self = this, out = [], seen = {};
		if (!d || !d.key) return out;
		var list = this.variantList(node);
		var kindOf = function(vr) { var sp = self.specOf(node, vr.name); return sp[d.key] != null ? String(sp[d.key]) : vr.name; };
		var kinds = [];
		var base = node.properties && node.properties[d.key];
		(base && base.enum || []).forEach(function(k) { kinds.push(String(k)); });
		list.forEach(function(vr) { var k = kindOf(vr); if (kinds.indexOf(k) < 0) kinds.push(k); });
		kinds.forEach(function(k) {
			if (seen[k]) return;
			seen[k] = 1;
			var vs = list.filter(function(vr) { return kindOf(vr) === k; });
			var then = d.then && d.then[k];
			var absent = vs.length && vs.every(function(vr) { return vr.absent; }) ? vs[0].absent : null;
			var plug = vs.length === 1 && !then && vs[0].plugin ? vs[0].plugin : null;
			out.push({ value: k, absent: absent, plugin: plug, protocol: then || null,
				description: !then && vs.length === 1 ? vs[0].node.description : (base && base.description) });
		});
		return out;
	},

	// Choices of the second selector for a kind of `then` (protocol): [{value, absent, plugin, description}]
	protocolChoices: function(node, kind) {
		var d = this.disc(node), self = this, out = [];
		if (!d || !d.then || !d.then[kind]) return out;
		var pk = d.then[kind];
		var protos = (Array.isArray(node['x-protocols']) ? node['x-protocols'] : []).map(String);
		var list = this.variantList(node).filter(function(vr) { return self.specOf(node, vr.name)[d.key] === kind; });
		list.forEach(function(vr) { var p = self.specOf(node, vr.name)[pk]; if (p != null && protos.indexOf(String(p)) < 0) protos.push(String(p)); });
		protos.forEach(function(p) {
			var vr = list.filter(function(x) { return String(self.specOf(node, x.name)[pk]) === p; })[0];
			out.push({ value: p, absent: vr ? vr.absent : null, plugin: vr ? vr.plugin : null,
				description: vr ? vr.node.description : '' });
		});
		return out;
	},

	// Choices of the selector of a `has` discriminator: the variants.
	hasChoices: function(node) {
		return this.variantList(node).map(function(vr) {
			return { value: vr.name, absent: vr.absent, plugin: vr.plugin, description: vr.node.description };
		});
	},

	// The first variant that this build has: where a new entry of a map starts.
	firstVariant: function(node) {
		var l = this.variantList(node).filter(function(vr) { return !vr.absent; });
		return l.length ? l[0].name : null;
	},

	// A new entry: the keys of its first available variant (x-spec), no invented values.
	newEntry: function(node) {
		var n = this.firstVariant(node);
		if (n && this.disc(node) && this.disc(node).key) return JSON.parse(JSON.stringify(this.specOf(node, n)));
		return {};
	},

	// The properties of one layer of an entry: '' is the base, any other is the name of a variant.
	// The keys that choose the variant and the x-spec keys of the variant are not fields.
	layerProps: function(node, layer, platform) {
		var self = this, src, skip = {};
		if (layer === '') {
			src = node;
			this.selectorKeys(node).forEach(function(k) { skip[k] = 1; });
		} else {
			src = (this.variantsOf(node) || {})[layer] || {};
			Object.keys(this.specOf(node, layer)).forEach(function(k) { skip[k] = 1; });
		}
		var p = src.properties || {};
		return Object.keys(p).filter(function(k) { return !skip[k] && self.applies(p[k], platform); })
			.map(function(k) { return [ k, p[k] ]; });
	},

	requiredOf: function(node, layer) {
		var src = layer === '' ? node : ((this.variantsOf(node) || {})[layer] || {});
		return src.required || [];
	},

	// Every key of the entry the form knows, in any layer (platform keys of the other platform are not
	// known: such a key stays in the value as an unknown one).
	knownKeys: function(node, platform) {
		var self = this, known = {};
		this.selectorKeys(node).forEach(function(k) { known[k] = 1; });
		var layers = [ '' ].concat(Object.keys(this.variantsOf(node) || {}));
		layers.forEach(function(l) {
			self.layerProps(node, l, platform).forEach(function(kv) { known[kv[0]] = 1; });
			if (l !== '') Object.keys(self.specOf(node, l)).forEach(function(k) { known[k] = 1; });
		});
		return known;
	},

	// Keys of an object value that the form must keep though it has no field: a key of a newer core, a key of
	// the other platform. With a variant that the form cannot draw (absent, unknown) all keys stay.
	extraKeys: function(node, value, variant, platform) {
		var self = this, v = value || {};
		var all = Object.keys(v);
		if (this.variantsOf(node)) {
			var V = this.variantsOf(node);
			if (variant === null || !has(V, variant) || V[variant]['x-absent']) {
				var sel = {};
				this.selectorKeys(node).forEach(function(k) { sel[k] = 1; });
				return all.filter(function(k) { return !sel[k]; });
			}
		}
		var known = this.knownKeys(node, platform);
		return all.filter(function(k) { return !known[k]; });
	},

	// ---- conditions ---------------------------------------------------------------------------

	// x-when (by the values the record has, defaults counted) and x-when-set (by the keys written).
	visible: function(node, eff, written) {
		var w = node['x-when'];
		if (w) {
			for (var k in w) {
				if (!has(w, k)) continue;
				var v = eff ? eff[k] : undefined;
				var list = w[k].map(String);
				if (v === undefined || v === null || list.indexOf(String(v)) < 0) return false;
			}
		}
		var s = node['x-when-set'];
		if (s) {
			for (var i = 0; i < s.length; i++) {
				var x = written ? written[s[i]] : undefined;
				if (x === undefined || x === null || x === '') return false;
			}
		}
		return true;
	},

	// x-needs of a written key: the neighbours the value needs and the record does not have.
	// Returns [text, vars] or null.
	needs: function(node, key, value, written) {
		var nd = node['x-needs'];
		if (!nd || value === undefined || value === null) return null;
		var missing = [];
		Object.keys(nd).forEach(function(val) {
			if (val !== '*' && String(value) !== val) return;
			nd[val].forEach(function(n) {
				var x = written ? written[n] : undefined;
				if ((x === undefined || x === null || x === '') && missing.indexOf(n) < 0) missing.push(n);
			});
		});
		if (!missing.length) return null;
		return [ N('{key} needs: {need}'), { key: key, need: missing.join(', ') } ];
	},

	// ---- values -------------------------------------------------------------------------------

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
		// [integer, string]: 443 is a number, 50000-65535 stays a string
		if (Array.isArray(node.type) && node.type.indexOf('integer') >= 0 && /^-?[0-9]+$/.test(String(s))) return Number(s);
		return s;
	},

	// Remove what the person left empty: '', [], {} and undefined.
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

	// ---- references -------------------------------------------------------------------------------

	// x-ref as {section, also}; a string is a section.
	refOf: function(node) {
		var r = node && node['x-ref'];
		if (!r) return null;
		return typeof r === 'string' ? { section: r, also: [] } : { section: r.section, also: r.also || [] };
	},

	// Where the spec names `name` of `section` through an x-ref: [ 'rules[2].out', ... ]. Found by the schema,
	// not by a list of keys: a `direct` that is a value of `kind` is not a reference. The entry itself is not
	// counted.
	usedBy: function(root, spec, section, name) {
		var out = [], self = this;
		var walk = function(node, v, p) {
			if (!node || v === undefined || v === null) return;
			var ref = self.refOf(node);
			if (ref && ref.section === section && typeof v === 'string' && v === name) { out.push(p); return; }
			if (Array.isArray(v)) {
				if (node.items) v.forEach(function(x, i) { walk(node.items, x, p + '[' + i + ']'); });
				return;
			}
			if (!isObj(v)) return;
			if (self.isMap(node)) {
				Object.keys(v).forEach(function(k) {
					if (p === section && k === name) return;
					walk(self.mapNode(node), v[k], p ? p + '.' + k : k);
				});
				return;
			}
			var vn = self.variantName(node, v), V = self.variantsOf(node);
			var layers = [ node ];
			if (V && vn && has(V, vn)) layers.push(V[vn]);
			Object.keys(v).forEach(function(k) {
				var sub = null;
				layers.forEach(function(l) { if (l.properties && l.properties[k]) sub = l.properties[k]; });
				if (sub) walk(sub, v[k], p ? p + '.' + k : k);
			});
		};
		walk(root, spec, '');
		return out;
	},

	// Every key of the schema as a path, the way the form names its fields:
	//   a.b          key of an object            a.*      entry of a map "name -> entry"
	//   a.[]         item of an array of objects
	//   a.@v.k       key k of the variant v of the entry a (outputs.*.@tunnel:vless.transport)
	//   a.kind, a.protocol   selectors of the variant (a `key` discriminator)
	//   a.@variant   selector of a variant of a `has` discriminator
	// Variants that are absent in this build have no keys. Used by the coverage test: a key without a
	// field is a red test.
	paths: function(node, prefix, platform) {
		var out = [], self = this;
		platform = platform || this.platformOf(node);
		var walk = function(n, p) {
			if (self.isMap(n)) { walk(self.mapNode(n), p + '.*'); return; }
			if (self.isObjectArray(n)) { walk(n.items, p + '.[]'); return; }
			var d = self.disc(n);
			if (self.variantsOf(n) && d) {
				if (d.has) out.push(p + '.@variant');
				else self.selectorKeys(n).forEach(function(k) { out.push(p + '.' + k); });
			}
			self.layerProps(n, '', platform).forEach(function(kv) {
				var q = p ? p + '.' + kv[0] : kv[0];
				out.push(q);
				walk(kv[1], q);
			});
			Object.keys(self.variantsOf(n) || {}).forEach(function(l) {
				self.layerProps(n, l, platform).forEach(function(kv) {
					var q = p + '.@' + l + '.' + kv[0];
					out.push(q);
					walk(kv[1], q);
				});
			});
		};
		walk(node, prefix || '');
		return out;
	}
});

