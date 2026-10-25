'use strict';
'require baseclass';
'require ui';
'require view.splify2.core.i18n as i18n';
'require view.splify2.core.api as api';
'require view.splify2.core.store as store';

// Overview: the state of the core, the verdicts of its checks, the counts of the spec, start and stop,
// the support report. The frame draws no charts and keeps no history: that is a plugin's work.

var T = i18n.T.bind(i18n);

function kv(rows) {
	return E('table', { 'class': 'table' }, rows.map(function(r) {
		return E('tr', { 'class': 'tr' }, [ E('td', { 'class': 'td left', 'width': '33%' }, r[0]), E('td', { 'class': 'td left' }, r[1]) ]);
	}));
}

function verdictCell(v) {
	var cls = v === 'ok' ? 'label-success' : (v === 'warn' || v === 'info' ? 'label-warning' : 'label-danger');
	return E('span', { 'class': 'label ' + cls, style: 'padding:2px 8px;border-radius:3px;color:#fff;background:' +
		(v === 'ok' ? '#2e7d32' : (v === 'warn' || v === 'info' ? '#b26a00' : '#c62828')) }, v);
}

return baseclass.extend({
	render: function(host) {
		var out = E('div', {});
		var note = function(msg, kind) { ui.addNotification(null, E('p', msg), kind || 'info'); };

		var act = function(method, okText) {
			return function() {
				api.call(method).then(function(r) {
					note(okText + (r.output ? ' ' + r.output : ''));
					draw();
				}, function(e) {
					note(E('div', {}, [ E('strong', {}, T('The action failed')), E('pre', {}, (e.reply && e.reply.output) || e.message) ]), 'danger');
				});
			};
		};
		var report = function() {
			api.call('support_report').then(function(r) {
				ui.showModal(T('Support report'), [
					E('p', {}, T('Contains no secrets: no subscription links, keys or node names.')),
					E('textarea', { readonly: 'readonly', rows: 18, style: 'width:100%;font-family:monospace' }, r.text || ''),
					E('div', { 'class': 'right' }, [ E('button', { 'class': 'btn', click: ui.hideModal }, T('Close')) ]) ]);
			}, function(e) { note(e.message, 'danger'); });
		};

		var draw = function() {
			Promise.all([
				api.call('engine').catch(function(e) { return { error: e.message }; }),
				api.call('diag').catch(function(e) { return { error: e.message }; })
			]).then(function(r) {
				var eng = r[0], diag = r[1], spec = store.spec || {};
				var rows = [];
				if (eng.error) rows.push([ T('Core'), E('span', { 'class': 'label-danger' }, eng.error) ]);
				else {
					rows.push([ T('Core'), eng.present ? T('steer {version}', { version: eng.version || '?' }) : T('Not installed') ]);
					rows.push([ T('State'), eng.running ? T('Running') : T('Stopped') ]);
					rows.push([ T('Start at boot'), eng.enabled ? T('Yes') : T('No') ]);
					if (eng.busy) rows.push([ T('Busy'), T('Managed by {name}', { name: eng.busy }) ]);
					rows.push([ T('splify2'), eng.ui_version || '?' ]);
				}
				rows.push([ T('Outputs'), String(Object.keys(spec.outputs || {}).length) ]);
				rows.push([ T('Rules'), String((spec.rules || []).length) ]);
				rows.push([ T('Lists'), String(Object.keys(spec.lists || {}).length) ]);
				rows.push([ T('Schema of keys'), store.schemaSource === 'core' ? T('From the core') : T('The forms follow the package: steer {need} or newer gives them their own schema.', { need: '2.1' }) ]);
				var checks = (diag.checks || []).map(function(c) {
					return E('tr', { 'class': 'tr' }, [ E('td', { 'class': 'td' }, verdictCell(c.verdict)), E('td', { 'class': 'td left' }, c.what || c.id),
						E('td', { 'class': 'td left' }, c.why || '') ]);
				});
				out.innerHTML = '';
				out.appendChild(E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, T('Status')), kv(rows),
					E('div', { 'class': 'cbi-page-actions' }, [
						E('button', { 'class': 'cbi-button cbi-button-apply', click: function() { host.apply(); } }, T('Apply')), ' ',
						eng.running ? E('button', { 'class': 'cbi-button cbi-button-negative', click: act('engine_stop', T('Stopped.')) }, T('Stop')) :
							E('button', { 'class': 'cbi-button cbi-button-positive', click: act('engine_start', T('Started.')) }, T('Start')), ' ',
						E('button', { 'class': 'cbi-button', click: report }, T('Support report')) ]) ]));
				out.appendChild(E('div', { 'class': 'cbi-section' }, [
					E('h3', {}, T('Checks')),
					diag.error ? E('p', {}, diag.error) : (checks.length ? E('table', { 'class': 'table' }, checks) : E('p', {}, T('No checks reported.'))) ]));
			});
		};
		draw();
		return out;
	}
});
