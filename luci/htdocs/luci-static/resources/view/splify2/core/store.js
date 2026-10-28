'use strict';
'require baseclass';
'require view.splify2.core.api as api';

// The state shared by the tabs of the frame: the spec as the person edits it, its revision (for
// the conflict check of spec_set), the schema of the keys, the devices, what is applied.
//
// A tab never writes the spec by itself: it hands the new keys of its section to save(), which merges
// them into the loaded spec and writes the whole spec (the same way the React panel does).

function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

function canon(v) {
	return JSON.stringify(v, function(k, x) {
		if (x && typeof x === 'object' && !Array.isArray(x)) {
			var o = {};
			Object.keys(x).sort().forEach(function(kk) { o[kk] = x[kk]; });
			return o;
		}
		return x;
	});
}

return baseclass.extend({
	spec: null, rev: '', schema: null, schemaSource: '', devices: [], applied: null,
	// gen grows every time the spec of the store is replaced (load, save): an open tab compares it with the
	// gen it was drawn at. schemaP: the schema of the core is asked once per page (`steer spec-schema` is the
	// slowest call of the frame) and again only after invalidateSchema() - a plugin or the core changed.
	gen: 0, schemaP: null,

	// The schema of the last page is kept in the browser (localStorage): the forms open with it at once, and the
	// schema of the core is asked all the same, in the background. When it differs (the core or its plugins changed
	// without this page knowing), the store takes it and calls onSchema(): the frame redraws the forms nobody edited.
	// The backend gives no cheap mark of "this core with these plugins" to ask first, so the check is the answer itself.
	cacheKey: 'splify2.core.schema',
	onSchema: null,

	readCache: function() {
		try {
			var t = window.localStorage.getItem(this.cacheKey);
			var c = t ? JSON.parse(t) : null;
			return c && c.schema && c.text ? c : null;
		} catch (e) { return null; }
	},
	writeCache: function(text, r) {
		try { window.localStorage.setItem(this.cacheKey, JSON.stringify({ text: text, schema: r.schema, source: r.source || 'core' })); }
		catch (e) { /* private window, full storage: no cache */ }
	},

	invalidateSchema: function() {
		this.schemaP = null;
		try { window.localStorage.removeItem(this.cacheKey); } catch (e) { /* no storage */ }
	},

	loadSchema: function() {
		var self = this;
		if (this.schemaP) return this.schemaP;
		var cached = this.readCache();
		var take = function(r) { self.schema = r.schema; self.schemaSource = r.source || 'core'; return self.schema; };
		var fresh = api.call('spec_schema').then(function(r) {
			var text = JSON.stringify({ schema: r.schema, source: r.source || 'core' });
			self.writeCache(text, r);
			if (cached && cached.text === text) return self.schema;
			take(r);
			if (cached && self.onSchema) self.onSchema();
			return self.schema;
		});
		if (cached) {
			take(cached);
			this.schemaP = Promise.resolve(this.schema);
			fresh.catch(function() { /* the cached schema stays */ });
		} else {
			var p = this.schemaP = fresh;
			p.catch(function() { if (self.schemaP === p) self.schemaP = null; });
		}
		return this.schemaP;
	},

	// Everything the forms need, in one go. Errors of the optional parts do not stop the frame.
	load: function() {
		var self = this;
		return Promise.all([
			api.call('spec_get'),
			this.loadSchema(),
			api.call('devices').catch(function() { return { devices: [] }; }),
			api.call('applied_get').catch(function() { return null; })
		]).then(function(r) {
			var spec = clone(r[0]);
			self.rev = spec.rev || '';
			delete spec.rev;
			self.spec = spec;
			self.devices = ((r[2] && r[2].devices) || []).map(function(d) { return d.name; });
			self.applied = r[3] ? (function(a) { a = clone(a); delete a.rev; return a; })(r[3]) : null;
			self.gen++;
			return self;
		});
	},

	// Top-level keys that differ from what is applied: [] when everything is applied.
	pending: function() {
		if (!this.spec || !this.applied) return [];
		var a = this.applied, s = this.spec, keys = {};
		Object.keys(a).concat(Object.keys(s)).forEach(function(k) { keys[k] = 1; });
		return Object.keys(keys).filter(function(k) { return canon(a[k]) !== canon(s[k]); }).sort();
	},

	legacy: function() { return !!this.spec && this.spec.version !== 2; },

	// Set the keys of a section: { outputs: {...}, rules: undefined } - undefined removes the key.
	merge: function(part) {
		var out = clone(this.spec) || { version: 2 };
		Object.keys(part).forEach(function(k) {
			if (part[k] === undefined) delete out[k]; else out[k] = clone(part[k]);
		});
		if (out.version === undefined) out.version = 2;
		return out;
	},

	// Write the whole spec. Rejects with .conflict when the spec on the router changed meanwhile.
	save: function(spec) {
		var self = this;
		return api.call('spec_set', { spec: JSON.stringify(spec), rev: this.rev }).then(function(r) {
			self.spec = clone(spec);
			if (r.rev) self.rev = r.rev;
			self.gen++;
			return r;
		}, function(e) {
			if (e.reply && e.reply.conflict) { e.conflict = true; if (e.reply.rev) e.currentRev = e.reply.rev; }
			throw e;
		});
	},

	// Write the spec from the text of the raw editor (YAML; the core translates it and names the line and the
	// column of a parse error). `rev` is the revision the text was read at. The loaded state is read again:
	// the spec of the forms is whatever the core made of the text.
	saveText: function(text, rev) {
		var self = this;
		return api.call('spec_set', { spec: text, rev: rev }).then(function(r) {
			return self.load().then(function() { return r; });
		}, function(e) {
			if (e.reply && e.reply.conflict) { e.conflict = true; if (e.reply.rev) e.currentRev = e.reply.rev; }
			throw e;
		});
	},

	apply: function() {
		var self = this;
		return api.call('apply').then(function(r) {
			self.applied = clone(self.spec);
			return r;
		});
	},

	canon: canon,
	clone: clone
});
