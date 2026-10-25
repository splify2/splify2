'use strict';
'require baseclass';
'require ui';
'require view.splify2.core.i18n as i18n';
'require view.splify2.core.api as api';
'require view.splify2.core.autoform as autoform';

// Plugins: the catalog and the repositories (a third-party repository is marked), install, update,
// enable, disable, remove, auto-update, and the settings of a plugin drawn from ITS schema
// (plugin_settings_get: the schema is required by the manifest). The methods are the same as in the
// React panel's "Plugins" tab (docs/rpcd-api.md, "Plugins").

var T = i18n.T.bind(i18n);

// Versions as numbers by parts: -1, 0, 1.
function cmpVer(a, b) {
	var x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
	for (var i = 0; i < Math.max(x.length, y.length); i++) {
		var d = (x[i] || 0) - (y[i] || 0);
		if (d) return d < 0 ? -1 : 1;
	}
	return 0;
}

function badge(text, color, title) {
	return E('span', { title: title || '', style: 'display:inline-block;margin-left:6px;padding:1px 7px;border-radius:3px;font-size:85%;color:#fff;background:' + color }, text);
}

return baseclass.extend({
	render: function(host) {
		var root = E('div', {});
		var note = function(msg, kind) { ui.addNotification(null, E('p', msg), kind || 'info'); };
		// The core before 2.1 has no plugin manager: the backend says it with the code core_too_old and the
		// numbers (installed, need), and the words are ours.
		var oldCore = function(e) { return e && e.code === 'core_too_old' ? { installed: e.reply.installed || '?', need: e.reply.need || '2.1' } : null; };
		var oldText = function(o) { return T('Plugins need steer {need} or newer. Installed: {installed}.', { need: o.need, installed: o.installed }); };
		var fail = function(e) {
			var o = oldCore(e);
			note(o ? oldText(o) : (e.message || String(e)), 'danger');
		};
		var state = { list: null, catalog: null, query: '' };
		var jobs = {};   // id -> text of the progress

		// Name and description in the language of the person: the core gives the words of the manifest, the
		// backend adds the ones from the plugin's own dictionary (plugins_list.names).
		var wordsOf = function(p, field) {
			var n = state.list && state.list.names && state.list.names[p.id];
			return (n && n[field]) || p[field] || '';
		};
		var repoOf = function(name) {
			var rs = (state.list && state.list.repos) || [];
			for (var i = 0; i < rs.length; i++) if (rs[i].name === name) return rs[i];
			return null;
		};
		var thirdParty = function(repoName) {
			var r = repoOf(repoName);
			return !!r && !r.official;
		};
		var repoBadge = function(name) {
			var out = [ name || '' ];
			if (thirdParty(name)) out.push(badge(T('Third-party'), '#b26a00', T('From a repository that is not the official one: the code is not reviewed by splify2.')));
			return out;
		};

		// A long action (install, update) is a job: poll plugin_job until it is done.
		var follow = function(jobId, pluginId) {
			jobs[pluginId] = T('Working...');
			var tick = function() {
				api.call('plugin_job', { id: jobId }).then(function(r) {
					if (r.state === 'running') { jobs[pluginId] = r.progress || T('Working...'); draw(); setTimeout(tick, 2000); return; }
					delete jobs[pluginId];
					note(T('Done: {id}', { id: pluginId }));
					load();
				}, function(e) { delete jobs[pluginId]; fail(e); load(); });
			};
			draw();
			setTimeout(tick, 1000);
		};

		var act = function(method, args, okText) {
			return function() {
				api.call(method, args).then(function(r) {
					if (r.job) follow(r.job, args.id || '*');
					else { if (okText) note(okText); load(); }
				}, fail);
			};
		};

		var remove = function(p) {
			var purge = E('input', { type: 'checkbox' });
			var go = function(force) {
				api.call('plugin_remove', { id: p.id, force: force, purge: purge.checked }).then(function() {
					ui.hideModal(); note(T('Removed: {id}', { id: p.id })); load();
				}, function(e) {
					ui.hideModal();
					if (!force) {
						ui.showModal(T('Remove {id}?', { id: p.id }), [
							E('p', {}, e.message),
							E('p', {}, T('Remove it anyway? The outputs that need it stop working.')),
							E('div', { 'class': 'right' }, [ E('button', { 'class': 'btn', click: ui.hideModal }, T('Cancel')), ' ',
								E('button', { 'class': 'btn cbi-button-negative', click: function() { go(true); } }, T('Remove anyway')) ]) ]);
					} else fail(e);
				});
			};
			ui.showModal(T('Remove {id}?', { id: p.id }), [
				E('p', {}, [ purge, ' ', T('Also delete its settings') ]),
				E('div', { 'class': 'right' }, [ E('button', { 'class': 'btn', click: ui.hideModal }, T('Cancel')), ' ',
					E('button', { 'class': 'btn cbi-button-negative', click: function() { go(false); } }, T('Remove')) ]) ]);
		};

		var settings = function(p) {
			api.call('plugin_settings_get', { id: p.id }).then(function(r) {
				var form = autoform.build(r.schema, r.values || {}, { spec: {}, devices: [], notify: function(m) { note(m, 'warning'); } });
				var save = function() {
					var errs = form.validate();
					if (errs.length) { note(errs.map(function(e) { return e.title + ': ' + e.message; }).join('; '), 'danger'); return; }
					api.call('plugin_settings_set', { id: p.id, values: form.get() || {} }).then(function() {
						ui.hideModal(); note(T('Settings of {id} saved.', { id: p.id }));
					}, fail);
				};
				ui.showModal(T('Settings of {id}', { id: p.id }), [
					form.el,
					E('div', { 'class': 'right' }, [ E('button', { 'class': 'btn', click: ui.hideModal }, T('Cancel')), ' ',
						E('button', { 'class': 'btn cbi-button-positive', click: save }, T('Save')) ]) ]);
			}, function(e) {
				if (e.code === 'no_settings') note(T('{id} has no settings.', { id: p.id }));
				else fail(e);
			});
		};

		var addRepo = function() {
			var url = E('input', { type: 'text', 'class': 'cbi-input-text', placeholder: 'https://', style: 'width:100%' });
			var key = E('textarea', { rows: 5, style: 'width:100%;font-family:monospace', placeholder: T('Public key of the repository') });
			var step2 = function() {
				api.call('repo_key', { key: key.value }).then(function(k) {
					ui.showModal(T('Trust this repository?'), [
						E('p', {}, T('Address: {url}', { url: url.value })),
						E('p', {}, T('Key number: {id}', { id: k.key_id })),
						E('p', {}, T('Plugins of a repository you add run as root on the router. Add only repositories you trust; compare the key number with the one the author published.')),
						E('div', { 'class': 'right' }, [ E('button', { 'class': 'btn', click: ui.hideModal }, T('Cancel')), ' ',
							E('button', { 'class': 'btn cbi-button-negative', click: function() {
								api.call('repo_add', { url: url.value, key: key.value, key_id: k.key_id }).then(function() {
									ui.hideModal(); note(T('Repository added.')); load();
								}, function(e) { ui.hideModal(); fail(e); });
							} }, T('Add the repository')) ]) ]);
				}, fail);
			};
			ui.showModal(T('Add a repository'), [
				E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, T('Address')), E('div', { 'class': 'cbi-value-field' }, url) ]),
				E('div', { 'class': 'cbi-value' }, [ E('label', { 'class': 'cbi-value-title' }, T('Key')), E('div', { 'class': 'cbi-value-field' }, key) ]),
				E('div', { 'class': 'right' }, [ E('button', { 'class': 'btn', click: ui.hideModal }, T('Cancel')), ' ',
					E('button', { 'class': 'btn cbi-button-positive', click: step2 }, T('Continue')) ]) ]);
		};

		var installedRows = function() {
			var ps = (state.list && state.list.plugins) || [];
			if (!ps.length) return E('p', {}, T('No plugins are installed.'));
			return E('table', { 'class': 'table' }, [
				E('tr', { 'class': 'tr table-titles' }, [ T('Plugin'), T('Version'), T('Repository'), T('State'), T('Auto-update'), '' ].map(function(h) { return E('th', { 'class': 'th' }, h); }))
			].concat(ps.map(function(p) {
				var enabled = p.state === 'enabled';
				var upd = p.update || p.update_available || p.available;
				var busy = jobs[p.id];
				var au = E('input', { type: 'checkbox', checked: p.auto_update ? 'checked' : null, change: function(ev) {
					api.call('plugin_autoupdate', { id: p.id, enabled: ev.target.checked }).then(function() { load(); }, function(e) { fail(e); load(); });
				} });
				return E('tr', { 'class': 'tr', 'data-plugin': p.id }, [
					E('td', { 'class': 'td' }, [ E('strong', {}, p.id), wordsOf(p, 'name') && wordsOf(p, 'name') !== p.id ? ' ' + wordsOf(p, 'name') : '',
						wordsOf(p, 'description') ? E('div', { 'class': 'cbi-value-description' }, wordsOf(p, 'description')) : '' ]),
					E('td', { 'class': 'td' }, [ p.version || '', upd ? badge(T('Update {version}', { version: typeof upd === 'string' ? upd : '' }), '#1565c0') : '' ]),
					E('td', { 'class': 'td' }, repoBadge(p.repo)),
					E('td', { 'class': 'td' }, [ busy ? busy : (p.state || ''), p.why ? E('div', { 'class': 'cbi-value-description' }, String(p.why)) : '' ]),
					E('td', { 'class': 'td' }, au),
					E('td', { 'class': 'td cbi-section-actions' }, busy ? '' : [
						E('button', { 'class': 'cbi-button', click: function() { settings(p); } }, T('Settings')), ' ',
						enabled ? E('button', { 'class': 'cbi-button', click: act('plugin_disable', { id: p.id }, T('Disabled: {id}', { id: p.id })) }, T('Disable')) :
							E('button', { 'class': 'cbi-button cbi-button-positive', click: act('plugin_enable', { id: p.id }, T('Enabled: {id}', { id: p.id })) }, T('Enable')), ' ',
						upd ? E('button', { 'class': 'cbi-button cbi-button-action', click: act('plugin_update', { id: p.id }) }, T('Update')) : '', upd ? ' ' : '',
						E('button', { 'class': 'cbi-button cbi-button-remove', click: function() { remove(p); } }, T('Remove')) ])
				]);
			})));
		};

		var catalogRows = function() {
			var cat = state.catalog || [];
			var have = {};
			((state.list && state.list.plugins) || []).forEach(function(p) { have[p.id] = 1; });
			if (!cat.length) return E('p', {}, state.catalog ? T('Nothing found.') : T('Loading...'));
			return E('table', { 'class': 'table' }, [
				E('tr', { 'class': 'tr table-titles' }, [ T('Plugin'), T('Version'), T('Repository'), '' ].map(function(h) { return E('th', { 'class': 'th' }, h); }))
			].concat(cat.map(function(p) {
				var busy = jobs[p.id];
				return E('tr', { 'class': 'tr', 'data-catalog': p.id }, [
					E('td', { 'class': 'td' }, [ E('strong', {}, p.id), wordsOf(p, 'name') && wordsOf(p, 'name') !== p.id ? ' ' + wordsOf(p, 'name') : '',
						wordsOf(p, 'description') ? E('div', { 'class': 'cbi-value-description' }, wordsOf(p, 'description')) : '' ]),
					E('td', { 'class': 'td' }, p.version || ''),
					E('td', { 'class': 'td' }, repoBadge(p.repo)),
					E('td', { 'class': 'td' }, busy ? busy : (have[p.id] ? T('Installed') :
						E('button', { 'class': 'cbi-button cbi-button-action', click: act('plugin_install', { id: p.id }) }, T('Install'))))
				]);
			})));
		};

		var reposTable = function() {
			var rs = (state.list && state.list.repos) || [];
			return E('table', { 'class': 'table' }, [
				E('tr', { 'class': 'tr table-titles' }, [ T('Name'), T('Address'), '' ].map(function(h) { return E('th', { 'class': 'th' }, h); }))
			].concat(rs.map(function(r) {
				return E('tr', { 'class': 'tr', 'data-repo': r.name }, [
					E('td', { 'class': 'td' }, [ r.name, r.official ? badge(T('Official'), '#2e7d32') : badge(T('Third-party'), '#b26a00') ]),
					E('td', { 'class': 'td' }, r.url || ''),
					E('td', { 'class': 'td cbi-section-actions' }, r.official ? '' :
						E('button', { 'class': 'cbi-button cbi-button-remove', click: function() {
							api.call('repo_del', { name: r.name }).then(function() { note(T('Repository removed.')); load(); }, fail);
						} }, T('Remove')))
				]);
			})));
		};

		// Update the core to the newest release the frame works with (steer_versions, steer_install): the
		// call downloads a package, so the timeout of the call is raised, as the Andromeda page does.
		var updateCore = function(o) {
			var go = function(version) {
				if (typeof L !== 'undefined' && L.env && !(Number(L.env.rpctimeout) >= 120)) L.env.rpctimeout = 120;
				ui.showModal(T('Updating steer'), [ E('p', { 'class': 'spinning' }, T('Working...')) ]);
				api.call('steer_install', { version: version }).then(function() {
					ui.hideModal();
					note(T('steer updated to {version}.', { version: version }));
					load();
				}, function(e) { ui.hideModal(); fail(e); });
			};
			api.call('steer_versions').then(function(r) {
				var vs = (r.versions || []).filter(function(v) { return v !== r.prerelease && /^\d+(\.\d+)+$/.test(v) && cmpVer(v, o.need) >= 0; });
				var newest = vs.reduce(function(m, v) { return !m || cmpVer(v, m) > 0 ? v : m; }, null);
				if (!newest) { note(T('No steer {need} or newer is available for this router.', { need: o.need }), 'warning'); return; }
				ui.showModal(T('Update steer to {version}?', { version: newest }), [
					E('div', { 'class': 'right' }, [ E('button', { 'class': 'btn', click: ui.hideModal }, T('Cancel')), ' ',
						E('button', { 'class': 'btn cbi-button-action', click: function() { ui.hideModal(); go(newest); } }, T('Update the core')) ]) ]);
			}, fail);
		};

		var search = E('input', { type: 'text', 'class': 'cbi-input-text', placeholder: T('Search the catalog'), keyup: function(ev) {
			if (ev.key === 'Enter') { state.query = ev.target.value; loadCatalog(); }
		} });
		var autoAll = E('button', { 'class': 'cbi-button', click: act('plugin_update', {}) }, T('Update all'));
		var body = E('div', {});

		var draw = function() {
			body.innerHTML = '';
			if (!state.list) { body.appendChild(E('p', {}, T('Loading...'))); return; }
			if (state.list.old) {
				body.appendChild(E('div', { 'class': 'cbi-section' }, [
					E('div', { 'class': 'alert-message warning' }, oldText(state.list.old)),
					E('div', { 'class': 'cbi-page-actions' }, [
						E('button', { 'class': 'cbi-button cbi-button-action', click: function() { updateCore(state.list.old); } }, T('Update the core')) ]) ]));
				return;
			}
			if (state.list.error) { body.appendChild(E('div', { 'class': 'alert-message warning' }, state.list.error)); return; }
			body.appendChild(E('div', { 'class': 'cbi-section' }, [ E('h3', {}, T('Installed')), installedRows(), E('div', { 'class': 'cbi-page-actions' }, [ autoAll ]) ]));
			body.appendChild(E('div', { 'class': 'cbi-section' }, [ E('h3', {}, T('Catalog')),
				state.list.repos_error ? E('div', { 'class': 'alert-message warning' }, state.list.repos_error) : '',
				search, catalogRows() ]));
			body.appendChild(E('div', { 'class': 'cbi-section' }, [ E('h3', {}, T('Repositories')), reposTable(),
				E('div', { 'class': 'cbi-page-actions' }, [ E('button', { 'class': 'cbi-button cbi-button-add', click: addRepo }, T('Add a repository')) ]) ]));
		};

		var loadCatalog = function() {
			api.call('plugins_search', { query: state.query || undefined }).then(function(r) { state.catalog = r.plugins || []; draw(); },
				function(e) { state.catalog = []; draw(); fail(e); });
		};
		var load = function() {
			api.call('plugins_list', { lang: i18n.lang }).then(function(r) { state.list = r; draw(); loadCatalog(); },
				function(e) { var o = oldCore(e); state.list = o ? { old: o } : { error: e.message }; draw(); });
		};
		root.appendChild(body);
		draw();
		load();
		return root;
	}
});
