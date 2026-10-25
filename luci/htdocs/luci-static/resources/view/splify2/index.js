'use strict';
'require view';
'require rpc';
'require ui';

// The main page of splify2: Andromeda (the React panel, view/splify2/home) or the frame (view/splify2/core/main).
// The setting `interface` (SPLIFY2_PLATFORM.md, 6.2) decides: prefs_get -> andromeda | basic | <plugin>.
// ?basic=1 always opens the frame (safe mode), ?basic=0 always opens Andromeda; the choice is not saved.
//

var callPrefs = rpc.declare({ object: 'splify2', method: 'prefs_get' });

function forced() {
	var m = /[?&]basic=([01])\b/.exec(window.location.search || '');
	return m ? (m[1] === '1' ? 'basic' : 'andromeda') : null;
}

var KEY = 'splify2:interface';
function remembered() { try { return window.localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
function remember(v) { try { window.localStorage.setItem(KEY, v); } catch (e) { /* private window */ } }

// L.require instantiates a view class, and a LuCI view draws itself when it is instantiated; so this view
// does not draw anything: it only decides and requires the chosen one.
return view.extend({
	__init__: function() {
		var f = forced();
		var asked = Promise.resolve(callPrefs()).then(function(p) {
			return (p && p.interface) || 'basic';
		}).catch(function() { return 'basic'; });
		// The loader of Andromeda was measured to be sensitive to every request that precedes it, so the
		// last choice is used at once and prefs_get only confirms it: when the setting changed meanwhile,
		// the page reloads once.
		var guess = f || remembered();
		var pick = guess ? Promise.resolve(guess) : asked;
		if (!f && guess) asked.then(function(now) {
			remember(now);
			if (now !== guess) window.location.reload();
		});
		else if (!f) asked.then(remember);
		pick.then(function(which) {
			return L.require(which === 'andromeda' ? 'view.splify2.home' : 'view.splify2.core.main');
		}).catch(function(e) {
			ui.addNotification(null, E('p', e.message || String(e)), 'danger');
		});
	},

	handleSave: null, handleSaveApply: null, handleReset: null
});
