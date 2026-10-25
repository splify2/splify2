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

return view.extend({
	load: function() {
		return i18n.load().then(function() {
			return store.load().then(function() { return { ok: true }; }, function(e) { return { ok: false, error: e }; });
		});
	},

	render: function(res) {
		var self = this;
		var bar = E('div', { 'class': 'splify2-bar' });
		var pane = E('div', {});
		var menu = E('ul', { 'class': 'cbi-tabmenu' });
		var note = function(msg, kind) { ui.addNotification(null, E('p', msg), kind || 'info'); };
		var host = {
			refresh: function() { drawBar(); },
			apply: function() {
				api.call('apply').then(function(r) {
					store.applied = store.clone(store.spec);
					note(T('Applied.') + (r.output ? ' ' + r.output : ''));
					drawBar();
				}, function(e) {
					note(E('div', {}, [ E('strong', {}, T('Apply failed')), E('pre', {}, (e.reply && e.reply.output) || e.message) ]), 'danger');
				});
			}
		};

		var drawBar = function() {
			bar.innerHTML = '';
			if (!res.ok) return;
			var p = store.pending();
			bar.appendChild(p.length ?
				E('span', {}, T('Saved but not applied: {keys}', { keys: p.join(', ') })) :
				E('span', {}, T('Everything saved is applied.')));
			bar.appendChild(E('button', { 'class': 'cbi-button cbi-button-apply', click: function() { host.apply(); } }, T('Apply')));
		};

		var failed = function() {
			return E('div', { 'class': 'alert-message danger' }, T('The spec could not be loaded: {error}', { error: res.error ? res.error.message : '' }));
		};

		var tabs = [ { id: 'overview', title: T('Overview'), draw: function() { return overview.render(host); }, needSpec: true } ];
		if (res.ok) {
			sections.defs().forEach(function(d) {
				tabs.push({ id: d.id, title: d.title, draw: function() { return sections.render(d, host); }, needSpec: true });
			});
			var other = sections.otherDef();
			if (other) tabs.push({ id: other.id, title: other.title, draw: function() { return sections.render(other, host); }, needSpec: true });
		}
		tabs.push({ id: 'spec', title: T('Spec'), draw: function() { return raw.render(host); }, needSpec: true });
		tabs.push({ id: 'plugins', title: T('Plugins'), draw: function() { return plugins.render(host); } });
		tabs.push({ id: 'settings', title: T('Settings'), draw: function() { return settings.render(host); } });

		var current = (window.location.hash || '').replace(/^#/, '');
		if (!tabs.some(function(t) { return t.id === current; })) current = 'overview';

		var show = function(id) {
			current = id;
			try { history.replaceState(null, '', window.location.pathname + window.location.search + '#' + id); } catch (e) { /* no history */ }
			Array.prototype.forEach.call(menu.children, function(li) {
				li.className = li.getAttribute('data-tab') === id ? 'cbi-tab' : 'cbi-tab-disabled';
			});
			var t = tabs.filter(function(x) { return x.id === id; })[0];
			pane.innerHTML = '';
			pane.appendChild(t.needSpec && !res.ok ? failed() : t.draw());
		};
		tabs.forEach(function(t) {
			menu.appendChild(E('li', { 'data-tab': t.id, 'class': 'cbi-tab-disabled' },
				E('a', { href: '#' + t.id, click: function(ev) { ev.preventDefault(); show(t.id); } }, t.title)));
		});

		drawBar();
		show(current);

		// Andromeda is the other interface of the same methods: a link when it is installed.
		var link = E('span', {});
		api.call('prefs_get').then(function(p) {
			if (p.andromeda) link.appendChild(E('a', { href: window.location.pathname + '?basic=0' }, T('Open Andromeda')));
		}, function() { /* no link */ });

		return E('div', { 'class': 'splify2-core' }, [ E('style', {}, CSS),
			E('h2', {}, T('splify2')), E('div', {}, link), bar, menu, pane ]);
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
