'use strict';
'require baseclass';
'require rpc';

// The methods of the rpcd object `splify2` that the frame calls (docs/rpcd-api.md). One place, so
// that a method the frame calls but the backend does not have is caught by tests/automatch.mjs.
//
// A refusal arrives as a SUCCESSFUL call with ok:false (rpcd-api.md, "Conventions"): call() turns it
// into a rejected promise carrying the words of the backend (message) and the machine word (code).

var M = {
	status: [],
	diag: [],
	support_report: [],
	engine: [],
	engine_start: [],
	engine_stop: [],
	spec_get: [],
	applied_get: [],
	spec_set: [ 'spec', 'rev' ],
	spec_check: [ 'spec' ],
	spec_schema: [],
	apply: [],
	devices: [],
	prefs_get: [],
	prefs_set: [ 'interface' ],
	fetch_mode: [],
	fetch_mode_set: [ 'mode' ],
	plugins_list: [],
	plugins_search: [ 'query' ],
	plugin_status: [ 'id' ],
	plugin_job: [ 'id' ],
	plugin_install: [ 'id', 'version' ],
	plugin_update: [ 'id' ],
	plugin_remove: [ 'id', 'force', 'purge' ],
	plugin_enable: [ 'id' ],
	plugin_disable: [ 'id' ],
	plugin_autoupdate: [ 'id', 'enabled' ],
	plugin_settings_get: [ 'id' ],
	plugin_settings_set: [ 'id', 'values' ],
	repo_key: [ 'key' ],
	repo_add: [ 'url', 'key', 'key_id' ],
	repo_del: [ 'name' ]
};

var fns = {};
Object.keys(M).forEach(function(name) {
	fns[name] = rpc.declare({ object: 'splify2', method: name, params: M[name] });
});

return baseclass.extend({
	methods: M,

	// call('plugin_install', { id: 'vless' }) -> Promise of the answer; rejects with Error(message).
	call: function(name, args) {
		var f = fns[name];
		if (!f) return Promise.reject(new Error('unknown method ' + name));
		var a = args || {};
		return Promise.resolve(f.apply(null, M[name].map(function(k) { return a[k]; }))).then(function(r) {
			if (r == null) throw new Error('no answer from ' + name);
			if (r.ok === false || (r.error && r.ok == null)) {
				var e = new Error(r.error || 'failed');
				e.code = r.code; e.reply = r;
				throw e;
			}
			return r;
		});
	}
});
