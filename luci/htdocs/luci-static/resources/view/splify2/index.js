'use strict';
'require view';
'require rpc';
'require ui';

// The main page of splify2: the frame (view/splify2/core/main) or the interface of a plugin with
// `splify2.luci.interface` (splify2-api 1.1) - Andromeda is one. The setting `interface` decides:
// prefs_get -> basic | <plugin id>; `interfaces` of the answer names the LuCI module of every interface plugin
// (view.splify2.p-<id>.<view>). ?basic=1 always opens the frame (safe mode), ?basic=0 always opens Andromeda; the
// choice is not saved. A plugin view that cannot be loaded (the plugin is not installed yet, was removed, or the file
// is gone) never leaves a blank page: the frame opens in its place with a note.
//

var callPrefs = rpc.declare({ object: 'splify2', method: 'prefs_get' });

function forced() {
	var m = /[?&]basic=([01])\b/.exec(window.location.search || '');
	return m ? (m[1] === '1' ? 'basic' : 'andromeda') : null;
}

var KEY = 'splify2:interface';
function remembered() { try { return window.localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
function remember(v) { try { window.localStorage.setItem(KEY, v); } catch (e) { /* private window */ } }

var FRAME = 'view.splify2.core.main';

// L.require instantiates a view class, and a LuCI view draws itself when it is instantiated; so this view
// does not draw anything: it only decides and requires the chosen one.
return view.extend({
	__init__: function() {
		// Installs take minutes (the core, plugins): LuCI's default of 20 s would cut the call while the router
		// still finishes it. The frame owns this setting, not the interface plugins; a larger value of the
		// administrator stays.
		if (!(Number(L.env.rpctimeout) >= 120)) L.env.rpctimeout = 120;
		var f = forced();
		var prefs = Promise.resolve(callPrefs()).then(function(p) {
			return p || {};
		}).catch(function() { return {}; });
		var asked = prefs.then(function(p) { return p.interface || 'basic'; });
		// The loader of Andromeda was measured to be sensitive to every request that precedes it, so the
		// last choice is used at once and prefs_get only confirms it: when the setting changed meanwhile,
		// the page reloads once.
		var guess = f || remembered();
		if (!f && guess) asked.then(function(now) {
			remember(now);
			if (now !== guess) window.location.reload();
		});
		else if (!f) asked.then(remember);
		function moduleOf(which, p) {
			if (which === 'basic') return FRAME;
			var list = (p && p.interfaces) || [];
			for (var i = 0; i < list.length; i++)
				if (list[i].id === which) return list[i].view;
			// prefs_get did not answer (or is older): the module name follows the rule of splify2-api 1.1.
			return list.length || (p && p.ok) ? null : 'view.splify2.p-' + which + '.home';
		}
		// The frame takes the answer of prefs_get from here (its language), so it does not ask it again; its
		// dictionary module is fetched while prefs_get is on its way, unless Andromeda is the known choice.
		var seeded = null;
		var seedFrame = function() {
			if (!seeded) seeded = L.require('view.splify2.core.i18n').then(function(i18n) { i18n.seed(prefs); });
			return seeded;
		};
		var openFrame = function() { return seedFrame().then(function() { return L.require(FRAME); }); };
		if (!guess || guess === 'basic') seedFrame().catch(function() { /* the frame asks prefs_get itself */ });
		// The frame remembered: it opens at once - its module does not depend on the answer.
		var pick = guess ? Promise.resolve(guess) : asked;
		var opened = guess === 'basic' ? openFrame() : Promise.all([ pick, prefs ]).then(function(r) {
			var mod = moduleOf(r[0], r[1]);
			if (!mod) {
				if (r[0] !== 'basic') ui.addNotification(null, E('p', {}, 'The interface "' + r[0] + '" is not installed or is disabled. The basic view is shown instead.'), 'warning');
				return openFrame();
			}
			if (mod === FRAME) return openFrame();
			return L.require(mod).catch(function(e) {
				ui.addNotification(null, E('p', {}, 'The interface "' + r[0] + '" did not open (' + (e.message || String(e)) + '). The basic view is shown instead.'), 'warning');
				return openFrame();
			});
		});
		opened.catch(function(e) {
			ui.addNotification(null, E('p', e.message || String(e)), 'danger');
		});
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
