'use strict';
'require baseclass';
'require ui';
'require view.splify2.core.i18n as i18n';
'require view.splify2.core.api as api';
'require view.splify2.core.store as store';

// The raw spec: the fallback that makes the frame complete. Any key of the core - even one that the
// forms do not know yet (a kind of a plugin that is not installed) - can be written here. The text is
// the JSON of the spec; "Check" asks the core (`steer check`) without writing, "Save" writes it.

var T = i18n.T.bind(i18n);

return baseclass.extend({
	render: function(host) {
		var note = function(msg, kind) { ui.addNotification(null, E('p', msg), kind || 'info'); };
		var area = E('textarea', { rows: 30, spellcheck: 'false', style: 'width:100%;font-family:monospace;font-size:13px' });
		var result = E('div', {});
		var pend = E('div', {});

		var fill = function() {
			area.value = JSON.stringify(store.spec, null, 2);
			var p = store.pending();
			pend.innerHTML = '';
			pend.appendChild(p.length ?
				E('p', {}, T('Differs from the applied spec in: {keys}', { keys: p.join(', ') })) :
				E('p', {}, T('The saved spec is applied.')));
		};

		var parse = function() {
			try {
				var v = JSON.parse(area.value);
				if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(T('The spec must be a JSON object'));
				return v;
			} catch (e) {
				result.innerHTML = '';
				result.appendChild(E('div', { 'class': 'alert-message danger' }, T('Not valid JSON: {error}', { error: e.message })));
				return null;
			}
		};
		var show = function(ok, text) {
			result.innerHTML = '';
			result.appendChild(E('div', { 'class': 'alert-message ' + (ok ? 'success' : 'danger') }, [ E('pre', { style: 'white-space:pre-wrap;margin:0' }, text) ]));
		};

		var check = function() {
			var v = parse(); if (!v) return;
			api.call('spec_check', { spec: JSON.stringify(v) }).then(function(r) {
				show(true, r.warn ? T('The core accepts the spec, with warnings:') + '\n' + r.warn : T('The core accepts the spec.'));
			}, function(e) { show(false, e.message); });
		};
		var save = function() {
			var v = parse(); if (!v) return;
			store.save(v).then(function(r) {
				show(true, (r.warn ? r.warn + '\n' : '') + T('Saved. Press Apply to put the changes into effect.'));
				host.refresh(); fill();
			}, function(e) {
				if (e.conflict) show(false, T('The spec changed on the router after it was opened. Press Reload to see it, then repeat your change.'));
				else show(false, e.message);
			});
		};
		var reload = function() {
			store.load().then(function() { fill(); result.innerHTML = ''; host.refresh(); }, function(e) { show(false, e.message); });
		};

		fill();
		return E('div', { 'class': 'cbi-section' }, [
			E('p', {}, T('The whole spec as JSON. Any key of the core can be written here, including those the forms do not cover yet.')),
			pend, area, result,
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', { 'class': 'cbi-button', click: check }, T('Check')), ' ',
				E('button', { 'class': 'cbi-button cbi-button-save', click: save }, T('Save')), ' ',
				E('button', { 'class': 'cbi-button cbi-button-reset', click: reload }, T('Reload')) ])
		]);
	}
});
