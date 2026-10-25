'use strict';
'require baseclass';
'require ui';
'require view.splify2.core.i18n as i18n';
'require view.splify2.core.api as api';
'require view.splify2.core.store as store';

// The raw spec: the fallback that makes the frame complete. Any key of the core - even one that the
// forms do not know yet (a kind of a plugin that is not installed) - can be written here. The text is
// the YAML of the spec as the core prints it (spec_yaml: `steer spec convert`); "Check" asks the core
// without writing (spec_check), "Save" writes it (spec_set). The core reads the YAML and names the line
// and the column of a parse error. Comments are not kept: the core prints the saved spec from the parsed one.

var T = i18n.T.bind(i18n);

return baseclass.extend({
	render: function(host) {
		var area = E('textarea', { rows: 30, spellcheck: 'false', style: 'width:100%;font-family:monospace;font-size:13px' });
		var result = E('div', {});
		var pend = E('div', {});
		var rev = '';   // the revision the text in the editor was read at

		var show = function(ok, text) {
			result.innerHTML = '';
			result.appendChild(E('div', { 'class': 'alert-message ' + (ok ? 'success' : 'danger') }, [ E('pre', { style: 'white-space:pre-wrap;margin:0' }, text) ]));
		};

		// A refusal of the core: with the line and the column when it gives them, and the cursor goes there.
		var refuse = function(e) {
			if (e.line) {
				show(false, T('Line {line}, column {col}: {error}', { line: e.line, col: e.col || 1, error: e.message }));
				try {
					var lines = area.value.split('\n'), pos = 0;
					for (var i = 0; i < e.line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
					area.focus();
					area.setSelectionRange(pos, pos + (lines[e.line - 1] || '').length);
				} catch (x) { /* no selection */ }
			} else show(false, e.message);
		};

		var fill = function() {
			var p = store.pending();
			pend.innerHTML = '';
			pend.appendChild(p.length ?
				E('p', {}, T('Differs from the applied spec in: {keys}', { keys: p.join(', ') })) :
				E('p', {}, T('The saved spec is applied.')));
			return api.call('spec_yaml').then(function(r) {
				area.value = r.yaml;
				rev = r.rev || '';
			}, function(e) { show(false, e.message); });
		};

		var check = function() {
			api.call('spec_check', { spec: area.value }).then(function(r) {
				show(true, r.warn ? T('The core accepts the spec, with warnings:') + '\n' + r.warn : T('The core accepts the spec.'));
			}, refuse);
		};
		var save = function() {
			store.saveText(area.value, rev).then(function(r) {
				host.refresh();
				return fill().then(function() {
					show(true, (r.warn ? r.warn + '\n' : '') + T('Saved. Press Apply to put the changes into effect.'));
				});
			}, function(e) {
				if (e.conflict) show(false, T('The spec changed on the router after it was opened. Press Reload to see it, then repeat your change.'));
				else refuse(e);
			});
		};
		var reload = function() {
			store.load().then(function() { result.innerHTML = ''; host.refresh(); return fill(); }, function(e) { show(false, e.message); });
		};

		fill();
		return E('div', { 'class': 'cbi-section' }, [
			E('p', {}, T('The spec in YAML. Edit it, then press Check or Save.')),
			pend, area, result,
			E('div', { 'class': 'cbi-page-actions' }, [
				E('button', { 'class': 'cbi-button', click: check }, T('Check')), ' ',
				E('button', { 'class': 'cbi-button cbi-button-save', click: save }, T('Save')), ' ',
				E('button', { 'class': 'cbi-button cbi-button-reset', click: reload }, T('Reload')) ])
		]);
	}
});
