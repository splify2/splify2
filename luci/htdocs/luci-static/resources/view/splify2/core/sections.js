'use strict';
'require baseclass';
'require ui';
'require view.splify2.core.i18n as i18n';
'require view.splify2.core.schema as schema';
'require view.splify2.core.autoform as autoform';
'require view.splify2.core.store as store';

// The sections of the spec: every one is a form built by autoform from the schema of the core
// (`steer spec-schema`) - one field per key. A section edits some top-level keys of the spec:
//
//   Outputs   outputs, except groups         Groups   outputs of kind group
//   Rules     rules                          Lists    lists
//   DNS       dns                            Clients  lan, clients
//   Other     every other key the core knows (a key that no page above owns)
//
// The save writes the whole spec (store.save), the Apply button of the frame puts it into effect.

var T = i18n.T.bind(i18n);

return baseclass.extend({
	// [{ id, title, keys, options }] - a function: titles go through T() after the dictionary is loaded.
	defs: function() {
		return [
			{ id: 'outputs', title: T('Outputs'), keys: [ 'outputs' ], options: {
				outputs: { filter: function(n, v) { return !v || v.kind !== 'group'; } } } },
			{ id: 'groups', title: T('Groups'), keys: [ 'outputs' ], options: {
				outputs: {
					filter: function(n, v) { return v && v.kind === 'group'; },
					newValue: function() { return { kind: 'group' }; } } } },
			{ id: 'rules', title: T('Rules'), keys: [ 'rules' ] },
			{ id: 'lists', title: T('Lists'), keys: [ 'lists' ] },
			{ id: 'dns', title: T('DNS'), keys: [ 'dns' ] },
			{ id: 'clients', title: T('Clients'), keys: [ 'lan', 'clients' ] }
		];
	},

	owned: [ 'version', 'outputs', 'rules', 'lists', 'dns', 'lan', 'clients' ],

	// Keys of the schema that no page above owns: the frame covers every key of the core.
	otherKeys: function() {
		var self = this, p = (store.schema && store.schema.properties) || {};
		return Object.keys(p).filter(function(k) { return self.owned.indexOf(k) < 0; });
	},

	otherDef: function() {
		var keys = this.otherKeys();
		return keys.length ? { id: 'other', title: T('Other keys'), keys: keys } : null;
	},

	nodeOf: function(def) {
		var props = {}, root = store.schema;
		def.keys.forEach(function(k) { if (root.properties && root.properties[k]) props[k] = root.properties[k]; });
		return { type: 'object', properties: props };
	},

	render: function(def, host) {
		var self = this;
		var holder = E('div');
		var node = this.nodeOf(def);
		var form = null;
		var note = function(msg, kind) { ui.addNotification(null, E('p', msg), kind || 'info'); };

		var build = function() {
			var value = {};
			def.keys.forEach(function(k) { if (store.spec[k] !== undefined) value[k] = store.clone(store.spec[k]); });
			form = autoform.build(node, value, {
				spec: store.spec, devices: store.devices, notify: function(m) { note(m, 'warning'); },
				mapOptions: Object.keys(def.options || {}).reduce(function(o, k) { o[k] = def.options[k]; return o; }, {})
			});
			holder.innerHTML = '';
			holder.appendChild(form.el);
		};

		var save = function() {
			var errors = form.validate();
			if (errors.length) {
				note(E('div', {}, [ E('strong', {}, T('Not saved: some values are not valid')),
					E('ul', {}, errors.slice(0, 12).map(function(e) { return E('li', {}, e.title + ': ' + e.message); })) ]), 'danger');
				return;
			}
			var val = form.get() || {}, part = {};
			def.keys.forEach(function(k) { part[k] = val[k]; });
			store.save(store.merge(part)).then(function() {
				note(T('Saved. Press Apply to put the changes into effect.'));
				host.refresh();
				build();
			}, function(e) {
				if (e.conflict) {
					ui.showModal(T('The spec changed on the router'), [
						E('p', {}, T('It was changed (another window, ssh, a subscription update) after this page loaded it.')),
						E('div', { 'class': 'right' }, [
							E('button', { 'class': 'btn', click: ui.hideModal }, T('Keep editing')), ' ',
							E('button', { 'class': 'btn cbi-button-negative', click: function() {
								ui.hideModal();
								store.load().then(function() { build(); host.refresh(); });
							} }, T('Reload and discard my changes')) ]) ]);
					return;
				}
				note(E('div', {}, [ E('strong', {}, T('Not saved')), E('p', {}, e.message) ]), 'danger');
			});
		};

		if (store.legacy()) holder.appendChild(E('div', { 'class': 'alert-message warning' },
			T('The spec on this router is in the old format (v1). Open Spec to convert it, or use the Andromeda interface.')));
		build();
		return E('div', {}, [
			def.keys.every(function(k) { return !!(store.schema.properties || {})[k]; }) ? '' :
				E('div', { 'class': 'alert-message warning' }, T('The core does not know some keys of this section.')),
			holder,
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', { 'class': 'cbi-button cbi-button-save', click: save }, T('Save')), ' ',
				E('button', { 'class': 'cbi-button cbi-button-reset', click: function() { build(); } }, T('Reset')) ])
		]);
	}
});
