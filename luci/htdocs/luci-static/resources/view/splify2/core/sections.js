'use strict';
'require baseclass';
'require ui';
'require view.splify2.core.i18n as i18n';
'require view.splify2.core.schema as schema';
'require view.splify2.core.autoform as autoform';
'require view.splify2.core.store as store';

// The sections of the spec: one tab for every root section of the schema of the core (`steer spec-schema`),
// in its order: lan, clients, lists, outputs, dns, rules. Every tab is a form built by autoform - one field for
// every key. `version` is not a form. A root key of a newer core that no tab names goes to "Other keys".
//
// The save writes the whole spec (store.save), the Apply button of the frame puts it into effect.

var T = i18n.T.bind(i18n);

return baseclass.extend({
	// Titles of the root sections the frame knows (a function: titles go through T() after the dictionary is loaded).
	titles: function() {
		return { lan: T('LAN'), clients: T('Clients'), lists: T('Lists'), outputs: T('Outputs'), dns: T('DNS'), rules: T('Rules') };
	},

	// [{ id, title, keys }]: the root sections that the schema of this core has.
	defs: function() {
		var p = (store.schema && store.schema.properties) || {}, t = this.titles();
		return Object.keys(p).filter(function(k) { return t[k]; }).map(function(k) { return { id: k, title: t[k], keys: [ k ] }; });
	},

	// Keys of the schema that no tab owns: the frame covers every key of the core.
	otherKeys: function() {
		var p = (store.schema && store.schema.properties) || {}, t = this.titles();
		return Object.keys(p).filter(function(k) { return k !== 'version' && !t[k]; });
	},

	otherDef: function() {
		var keys = this.otherKeys();
		return keys.length ? { id: 'other', title: T('Other keys'), keys: keys } : null;
	},

	nodeOf: function(def) {
		var props = {}, root = store.schema;
		def.keys.forEach(function(k) { if (root.properties && root.properties[k]) props[k] = root.properties[k]; });
		return { type: 'object', properties: props, 'x-platform': schema.platformOf(root) };
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
				spec: store.spec, devices: store.devices, schemaRoot: store.schema, platform: schema.platformOf(store.schema),
				notify: function(m) { note(m, 'warning'); }
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
