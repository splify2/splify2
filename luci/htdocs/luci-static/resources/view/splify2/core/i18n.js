'use strict';
'require baseclass';
'require rpc';

// Dictionary of the splify2 frame (SPLIFY2_PLATFORM.md, 8.3).
//
// The frame is written in English: the key of a string is the English text itself, so without any
// dictionary everything reads fine. A language plugin carries i18n/core/<lang>.json (flat
// "English text" -> translation; {name} substitutions; plural forms as an object) and the backend
// method i18n_get returns the dictionaries of all enabled plugins for a language. One JSON, no
// po/lmo, no LuCI cache reset.
//
// Every user-visible string of the frame goes through T() with a LITERAL first argument - the list of
// all such strings (strings.json) is built from the source by tests/automatch.mjs, and a language
// plugin is checked against it.

var callPrefs = rpc.declare({ object: 'splify2', method: 'prefs_get' });
var callDict = rpc.declare({ object: 'splify2', method: 'i18n_get', params: [ 'lang' ] });

return baseclass.extend({
	dict: {},
	lang: 'en',
	prefs: null,   // the answer of prefs_get the language came from: the frame reads it, not a second call

	// The language of the person: LuCI language (prefs_get.lang), "auto" - the browser's.
	// Candidates from the most to the least exact: pt-BR, pt.
	candidates: function(lang) {
		var l = (lang && lang !== 'auto') ? lang : ((typeof navigator !== 'undefined' && navigator.language) || 'en');
		l = String(l).replace('_', '-');
		var out = [ l ];
		if (l.indexOf('-') > 0) out.push(l.split('-')[0]);
		return out;
	},

	// The main page (view/splify2/index.js) asks prefs_get to choose the interface: it hands the answer here, so the
	// frame does not ask it a second time after it.
	seed: function(prefsPromise) { this.prefsSeed = prefsPromise; },

	// Loads the dictionary once. Never rejects: a frame without a dictionary is an English frame.
	load: function() {
		var self = this;
		if (this.loading) return this.loading;
		this.loading = Promise.resolve(this.prefsSeed || callPrefs()).then(function(p) {
			self.prefs = p || null;
			var cands = self.candidates(p && p.lang);
			self.lang = cands[0];
			var next = function(i) {
				if (i >= cands.length) return Promise.resolve();
				return Promise.resolve(callDict(cands[i])).then(function(r) {
					if (r && r.ok && r.dicts && r.dicts.length) {
						self.lang = cands[i];
						r.dicts.forEach(function(d) { self.merge(d.dict); });
						return;
					}
					return next(i + 1);
				});
			};
			return next(0);
		}).catch(function() { /* English */ });
		return this.loading;
	},

	merge: function(d) {
		if (!d || typeof d !== 'object') return;
		for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k)) this.dict[k] = d[k];
	},

	subst: function(s, vars) {
		if (!vars) return s;
		return s.replace(/\{([A-Za-z0-9_]+)\}/g, function(m, name) {
			return Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m;
		});
	},

	// The call T with a literal text and an optional object of {name} values gives the translated string.
	T: function(s, vars) {
		var t = this.dict[s];
		if (typeof t !== 'string') t = s;
		return this.subst(t, vars);
	},

	// TN(n, { one: ..., other: ... }) - plural forms; a dictionary entry for the
	// "one" form (an object with the same category names) replaces the English forms.
	TN: function(n, forms) {
		var f = forms;
		var tr = this.dict[forms.other];
		if (tr && typeof tr === 'object') f = tr;
		var cat = 'other';
		try { cat = new Intl.PluralRules(this.lang).select(n); } catch (e) { cat = (n === 1) ? 'one' : 'other'; }
		var s = f[cat] != null ? f[cat] : (f.other != null ? f.other : '');
		return this.subst(s, { n: n });
	}
});
