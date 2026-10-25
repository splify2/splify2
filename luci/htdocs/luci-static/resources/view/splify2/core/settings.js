'use strict';
'require baseclass';
'require ui';
'require view.splify2.core.i18n as i18n';
'require view.splify2.core.api as api';
'require view.splify2.core.store as store';

// Settings of the frame itself: which interface opens as the main page, and whether lists and packages
// are downloaded through a tunnel. The keys of the spec are in the sections, not here.

var T = i18n.T.bind(i18n);

return baseclass.extend({
	render: function(host) {
		var note = function(msg, kind) { ui.addNotification(null, E('p', msg), kind || 'info'); };
		var out = E('div', { 'class': 'cbi-section' });

		Promise.all([ api.call('prefs_get'), api.call('fetch_mode').catch(function() { return null; }) ]).then(function(r) {
			var prefs = r[0], fetch = r[1];
			var choices = [ [ 'basic', T('Basic (this page)') ] ];
			if (prefs.andromeda || prefs.interface === 'andromeda') choices.unshift([ 'andromeda', T('Andromeda') ]);
			if (!choices.some(function(c) { return c[0] === prefs.interface; })) choices.push([ prefs.interface, prefs.interface ]);
			var sel = E('select', { 'class': 'cbi-input-select' }, choices.map(function(c) {
				return E('option', { value: c[0], selected: c[0] === prefs.interface ? 'selected' : null }, c[1]);
			}));
			var saveIf = function() {
				api.call('prefs_set', { interface: sel.value }).then(function() {
					note(T('Saved. The chosen interface opens the next time you open splify2.'));
				}, function(e) { note(e.message, 'danger'); });
			};
			out.appendChild(E('h3', {}, T('Interface')));
			out.appendChild(E('div', { 'class': 'cbi-value' }, [
				E('label', { 'class': 'cbi-value-title' }, T('Main page')),
				E('div', { 'class': 'cbi-value-field' }, [ sel, ' ', E('button', { 'class': 'cbi-button cbi-button-save', click: saveIf }, T('Save')),
					E('div', { 'class': 'cbi-value-description' }, T('This page is always available at the address of splify2 with ?basic=1.')) ]) ]));
			if (fetch) {
				var box = E('input', { type: 'checkbox', checked: fetch.mode === 'always' ? 'checked' : null });
				var saveF = function() {
					api.call('fetch_mode_set', { mode: box.checked ? 'always' : 'off' }).then(function() { note(T('Saved.')); },
						function(e) { note(e.message, 'danger'); });
				};
				out.appendChild(E('h3', {}, T('Downloads')));
				out.appendChild(E('div', { 'class': 'cbi-value' }, [
					E('label', { 'class': 'cbi-value-title' }, T('Download through a tunnel')),
					E('div', { 'class': 'cbi-value-field' }, [ box, ' ', E('button', { 'class': 'cbi-button cbi-button-save', click: saveF }, T('Save')),
						E('div', { 'class': 'cbi-value-description' }, fetch.out ?
							T('Lists and packages are downloaded through the output {out}.', { out: fetch.out }) :
							T('There is no running output with its own table yet.')) ]) ]));
			}
		}, function(e) { out.appendChild(E('p', {}, e.message)); });
		return out;
	}
});
