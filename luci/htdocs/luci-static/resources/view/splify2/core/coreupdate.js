'use strict';
'require baseclass';
'require ui';
'require view.splify2.core.i18n as i18n';
'require view.splify2.core.api as api';

// Updating the core from the base view. The panel needs steer {min_version} (engine.min_version); plugins,
// Andromeda and the updater plugin install only on such a core. When the panel arrived on an older core (the
// self-update of 26.10.x), the backend updates the core itself: steer_install without the updater plugin starts
// splify2-core-update in the background and answers {started} at once, and `engine` reports its progress
// (core_update: state running|done|failed, progress, error, retry). With the updater plugin, steer_install answers
// when it is done. Both answers are handled here; the overview and the Plugins tab use the same flow.

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

// The core is installed and older than the panel needs.
function outdated(eng) {
	return !!(eng && eng.present && eng.version && eng.min_version && cmpVer(eng.version, eng.min_version) < 0);
}

function running(eng) {
	return !!(eng && eng.core_update && eng.core_update.state === 'running');
}

// Poll `engine` until the update is not running: onProgress(text) on every answer. While the core is replaced and
// rpcd is reloaded, a call may fail: that is waited out (a minute of failures in a row ends the wait).
function follow(onProgress) {
	return new Promise(function(resolve, reject) {
		var errors = 0;
		var tick = function() {
			api.call('engine').then(function(eng) {
				errors = 0;
				var cu = eng.core_update || {};
				if (cu.state === 'running') {
					onProgress(cu.progress || T('Working...'));
					setTimeout(tick, 2000);
					return;
				}
				if (cu.state === 'failed') {
					var e = new Error(cu.error || T('The core update failed'));
					e.code = cu.code; e.retry = cu.retry;
					reject(e);
					return;
				}
				resolve(eng);
			}, function(e) {
				if (++errors > 30) { reject(e); return; }
				setTimeout(tick, 2000);
			});
		};
		setTimeout(tick, 1500);
	});
}

// A modal with the line of progress; the update ends with a reload of the page: the plugins, the language and
// Andromeda arrive with it, and rpcd learns their methods.
function watch(version) {
	var line = E('p', { 'class': 'spinning' }, T('Working...'));
	ui.showModal(T('Updating steer'), [ line ]);
	return follow(function(text) { line.textContent = text; }).then(function(eng) {
		ui.showModal(T('The core is updated'), [
			E('p', {}, T('steer {version} is installed. The page reloads to show the plugins.', { version: eng.version || version || '' })) ]);
		setTimeout(function() { window.location.reload(); }, 4000);
		return eng;
	}, function(e) {
		ui.hideModal();
		var words = [ E('strong', {}, T('The core update failed')), E('p', {}, e.message) ];
		if (e.retry) words.push(E('p', {}, T('It will be retried automatically every hour; the button repeats it now.')));
		ui.addNotification(null, E('div', {}, words), 'danger');
		e.shown = true;
		throw e;
	});
}

// The newest release not older than `need` (stable only, like the backend chooses), confirmation, the install.
function start(need) {
	return api.call('steer_versions').then(function(r) {
		var vs = (r.versions || []).filter(function(v) { return v !== r.prerelease && /^\d+(\.\d+)+$/.test(v) && cmpVer(v, need) >= 0; });
		var newest = vs.reduce(function(m, v) { return !m || cmpVer(v, m) > 0 ? v : m; }, null);
		if (!newest && r.prerelease && cmpVer(r.prerelease, need) >= 0) newest = r.prerelease;
		if (!newest) {
			ui.addNotification(null, E('p', {}, T('No steer {need} or newer is available for this router.', { need: need })), 'warning');
			return;
		}
		return new Promise(function(resolve) {
			var go = function() {
				// With the updater plugin the call lasts as long as the download and the install: raise the timeout.
				if (typeof L !== 'undefined' && L.env && !(Number(L.env.rpctimeout) >= 120)) L.env.rpctimeout = 120;
				ui.showModal(T('Updating steer'), [ E('p', { 'class': 'spinning' }, T('Working...')) ]);
				api.call('steer_install', { version: newest }).then(function(res) {
					if (res.started) return watch(newest);
					ui.hideModal();
					ui.addNotification(null, E('p', {}, T('steer updated to {version}.', { version: newest })), 'info');
					setTimeout(function() { window.location.reload(); }, 2000);
				}).then(resolve, function(e) {
					ui.hideModal();
					if (!e.shown && e.message) ui.addNotification(null, E('p', {}, e.message), 'danger');
					resolve();
				});
			};
			ui.showModal(T('Update steer to {version}?', { version: newest }), [
				E('div', { 'class': 'right' }, [ E('button', { 'class': 'btn', click: function() { ui.hideModal(); resolve(); } }, T('Cancel')), ' ',
					E('button', { 'class': 'btn cbi-button-action', click: go }, T('Update the core')) ]) ]);
		});
	}, function(e) {
		ui.addNotification(null, E('p', {}, e.message || String(e)), 'danger');
	});
}

// The block of the overview: the core is older than needed, or its update runs or failed. Null - nothing to say.
function banner(eng) {
	if (!eng || eng.error) return null;
	var cu = eng.core_update || {};
	if (cu.state === 'running') {
		return E('div', { 'class': 'alert-message notice' }, [
			E('p', { 'class': 'spinning' }, T('Updating the core: {progress}', { progress: cu.progress || T('Working...') })),
			E('div', { 'class': 'cbi-page-actions' }, [ E('button', { 'class': 'cbi-button', click: function() { watch(cu.version).catch(function() {}); } }, T('Show progress')) ]) ]);
	}
	if (!outdated(eng)) return null;
	var words = [ E('p', {}, T('steer {installed} is older than this panel needs ({need}). Plugins and Andromeda appear after the update.', { installed: eng.version, need: eng.min_version })) ];
	if (cu.state === 'failed') {
		words.push(E('p', {}, [ E('strong', {}, T('The core update failed')), ': ', cu.error || '' ]));
		if (cu.retry) words.push(E('p', {}, T('It will be retried automatically every hour; the button repeats it now.')));
	}
	if (eng.busy) words.push(E('p', {}, T('Managed by {name}', { name: eng.busy })));
	else words.push(E('div', { 'class': 'cbi-page-actions' }, [
		E('button', { 'class': 'cbi-button cbi-button-action', click: api.once(function() { return start(eng.min_version); }) }, T('Update the core')) ]));
	return E('div', { 'class': 'alert-message warning' }, words);
}

return baseclass.extend({
	cmpVer: cmpVer,
	outdated: outdated,
	running: running,
	follow: follow,
	watch: watch,
	start: start,
	banner: banner
});
