'use strict';
'require view';
'require ui';
'require view.splify2.core.i18n as i18n';
'require view.splify2.core.api as api';
'require view.splify2.core.store as store';
'require view.splify2.core.sections as sections';
'require view.splify2.core.overview as overview';
'require view.splify2.core.raw as raw';
'require view.splify2.core.plugins as plugins';
'require view.splify2.core.settings as settings';

// The frame of splify2 (SPLIFY2_PLATFORM.md, section 5): the pages of the core in classic LuCI JS,
// English, without themes or clever logic. Everything of the core is here: the status, a form for
// every key of the spec (from the schema of the core), the raw spec, apply, and the plugins.
//
// It opens as the main page when the setting `interface` says so (view/splify2/index.js decides:
// Andromeda or this frame); with ?basic=1 it always opens.

var T = i18n.T.bind(i18n);

var CSS = '.splify2-entry{border:1px solid var(--border-color-medium,#ccc);border-radius:3px;margin:6px 0;padding:0 8px}' +
	'.splify2-entry>summary{cursor:pointer;padding:6px 0;font-weight:600}' +
	'.splify2-entry-body{padding:4px 0 8px}' +
	'.splify2-section>legend{font-weight:600}' +
	'.splify2-bar{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:8px 0}';

function clear(node) { while (node.lastChild) node.removeChild(node.lastChild); }

return view.extend({
	// The dictionary and the spec are asked at the same time; the page is drawn as soon as the dictionary is
	// here (the words of the tabs), and the tabs of the spec appear when the spec and its schema arrive.
	load: function() {
		this.storeP = store.load().then(function() { return { ok: true }; }, function(e) { return { ok: false, error: e }; });
		return i18n.load();
	},

	render: function() {
		var self = this;
		var res = { pending: true };
		var bar = E('div', { 'class': 'splify2-bar' });
		var pane = E('div', {});
		var menu = E('ul', { 'class': 'cbi-tabmenu' });
		var note = function(msg, kind) { ui.addNotification(null, E('p', msg), kind || 'info'); };
		var views = {};          // id -> the element of a drawn tab: a tab keeps its unsaved edits while another one is open
		var schemaStale = false; // a plugin changed: the schema of the core is asked again when a form opens
		var host = {
			refresh: function() { drawBar(); },
			apply: function() {
				return api.call('apply').then(function(r) {
					store.applied = store.clone(store.spec);
					note(T('Applied.') + (r.output ? ' ' + r.output : ''));
					drawBar();
				}, function(e) {
					note(E('div', {}, [ E('strong', {}, T('Apply failed')), E('pre', {}, (e.reply && e.reply.output) || e.message) ]), 'danger');
				});
			},
			pluginsChanged: function() { store.invalidateSchema(); schemaStale = true; }
		};
		var applyBtn = api.once(function() { return host.apply(); });

		var drawBar = function() {
			clear(bar);
			if (res.pending || !res.ok) return;
			var p = store.pending();
			bar.appendChild(p.length ?
				E('span', {}, T('Saved but not applied: {keys}', { keys: p.join(', ') })) :
				E('span', {}, T('Everything saved is applied.')));
			bar.appendChild(E('button', { 'class': 'cbi-button cbi-button-apply', click: applyBtn }, T('Apply')));
		};

		var failed = function() {
			return E('div', { 'class': 'alert-message danger' }, T('The spec could not be loaded: {error}', { error: res.error ? res.error.message : '' }));
		};

		var tabs = [];
		var addTab = function(t, before) {
			var li = E('li', { 'data-tab': t.id, 'class': t.id === current ? 'cbi-tab' : 'cbi-tab-disabled' },
				E('a', { href: '#' + t.id, click: function(ev) { ev.preventDefault(); show(t.id); } }, t.title));
			t.li = li;
			var at = before ? tabs.indexOf(before) : -1;
			if (at < 0) { tabs.push(t); menu.appendChild(li); }
			else { tabs.splice(at, 0, t); menu.insertBefore(li, before.li); }
		};
		var tabOf = function(id) { return tabs.filter(function(x) { return x.id === id; })[0]; };

		var show = function(id) {
			var t = tabOf(id);
			if (!t) return;
			current = id;
			try { history.replaceState(null, '', window.location.pathname + window.location.search + '#' + id); } catch (e) { /* no history */ }
			tabs.forEach(function(x) { x.li.className = x.id === id ? 'cbi-tab' : 'cbi-tab-disabled'; });
			if (t.needSpec && !res.pending && res.ok && schemaStale) { reload(); }
			clear(pane);
			if (t.needSpec && res.pending) { pane.appendChild(E('p', { 'class': 'spinning' }, T('Loading...'))); return; }
			if (t.needSpec && !res.ok) { pane.appendChild(failed()); return; }
			var el = views[id];
			if (el) { if (el.splify2Show) el.splify2Show(); }
			else el = views[id] = t.draw();
			pane.appendChild(el);
		};

		var specTab;
		var sectionTabs = [];
		// The tabs of the root sections of the schema, before "Spec"; a section the new schema lacks is gone.
		var drawSections = function() {
			sectionTabs.forEach(function(t) {
				tabs.splice(tabs.indexOf(t), 1);
				if (t.li.parentNode) t.li.parentNode.removeChild(t.li);
			});
			sectionTabs = [];
			if (!res.ok) return;
			var defs = sections.defs(), other = sections.otherDef();
			if (other) defs.push(other);
			defs.forEach(function(d) {
				var t = { id: d.id, title: d.title, draw: function() { return sections.render(d, host); }, needSpec: true };
				sectionTabs.push(t);
				addTab(t, specTab);
			});
		};

		var settle = function(r) {
			res = r;
			drawSections();
			drawBar();
			if (!tabOf(current)) current = 'overview';
			show(current);
		};
		// After a plugin changed: the spec and the new schema; the forms nobody edited are drawn again.
		var reload = function() {
			schemaStale = false;
			res = { pending: true };
			Object.keys(views).forEach(function(id) {
				var t = tabOf(id), el = views[id];
				if (t && t.needSpec && !(el.splify2Dirty && el.splify2Dirty())) delete views[id];
			});
			store.load().then(function() { return { ok: true }; }, function(e) { return { ok: false, error: e }; }).then(settle);
		};

		var current = (window.location.hash || '').replace(/^#/, '') || 'overview';

		addTab({ id: 'overview', title: T('Overview'), draw: function() { return overview.render(host); }, needSpec: true });
		addTab(specTab = { id: 'spec', title: T('Spec'), draw: function() { return raw.render(host); }, needSpec: true });
		addTab({ id: 'plugins', title: T('Plugins'), draw: function() { return plugins.render(host); } });
		addTab({ id: 'settings', title: T('Settings'), draw: function() { return settings.render(host); } });

		// a section named in the address opens when the schema says it exists
		if (tabOf(current)) show(current);
		else { pane.appendChild(E('p', { 'class': 'spinning' }, T('Loading...'))); }
		(this.storeP || store.load().then(function() { return { ok: true }; }, function(e) { return { ok: false, error: e }; })).then(settle);

		// Andromeda is the other interface of the same methods: a link when it is installed (prefs_get came with the dictionary).
		var link = E('span', {});
		if (i18n.prefs && i18n.prefs.andromeda) link.appendChild(E('a', { href: window.location.pathname + '?basic=0' }, T('Open Andromeda')));

		return E('div', { 'class': 'splify2-core' }, [ E('style', {}, CSS),
			E('h2', {}, T('splify2')), E('div', {}, link), bar, menu, pane ]);
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
