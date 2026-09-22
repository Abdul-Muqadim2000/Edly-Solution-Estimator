/* Bridges the app's browser storage to /api/state, so the spreadsheet is the source of truth
   and every tab — and every teammate — sees the same data.

   The app keeps its working state under a fixed set of storage keys. On boot we pull the store
   and write those keys before the app reads them; afterwards every change is pushed back,
   debounced. Nothing in the app had to change: the keys are the contract.

   Two rules keep data safe:
     1. Never push before a successful pull. An empty local state must not overwrite the store
        just because the network was down.
     2. Never overwrite local edits with a background pull. If both sides changed, say so and
        let the person reload rather than silently picking a winner. */

(function () {
  'use strict';

  const API = '/api/state';

  /* every key the app persists, except edly-auth-v1 — a session belongs to its browser */
  const DATA_KEYS = {
    estimations: 'edly-estimates-v1',
    requests: 'edly-requests-v1',
    solutions: 'edly-catalog-add-v1',
    bundles: 'edly-bundle-add-v1'
  };
  const SETTING_KEYS = [
    'edly-bundle-calc-v1',      // selections, buffers, rates, delivery plan, display prefs
    'edly-open-est-v1',         // which estimation is open
    'edly-plat-v1',             // last practice / platform
    'edly-catalog-sheetmap-v1', // sheets loaded for non-Open edX platforms
    'edly-catalog-sheet-v1'     // a hand-loaded Open edX catalog
  ];
  const WATCHED = Object.values(DATA_KEYS).concat(SETTING_KEYS);

  const rawGet = k => { try { return localStorage.getItem(k); } catch { return null; } };
  const readJson = (k, dflt) => { const v = rawGet(k); if (v == null) return dflt; try { return JSON.parse(v); } catch { return dflt; } };

  let origSet = null;
  const writeRaw = (k, v) => {
    try { (origSet || localStorage.setItem.bind(localStorage))(k, v); } catch {}
  };

  function collect() {
    const settings = {};
    SETTING_KEYS.forEach(k => {
      const raw = rawGet(k);
      if (raw == null) return;
      try { settings[k] = JSON.parse(raw); } catch { settings[k] = raw; }
    });
    return {
      estimations: readJson(DATA_KEYS.estimations, []) || [],
      requests: readJson(DATA_KEYS.requests, []) || [],
      solutions: readJson(DATA_KEYS.solutions, []) || [],
      bundles: readJson(DATA_KEYS.bundles, []) || [],
      settings
    };
  }

  function apply(state) {
    if (!state) return;
    writeRaw(DATA_KEYS.estimations, JSON.stringify(state.estimations || []));
    writeRaw(DATA_KEYS.requests, JSON.stringify(state.requests || []));
    writeRaw(DATA_KEYS.solutions, JSON.stringify(state.solutions || []));
    writeRaw(DATA_KEYS.bundles, JSON.stringify(state.bundles || []));
    const settings = state.settings || {};
    SETTING_KEYS.forEach(k => {
      if (!(k in settings)) return;
      const v = settings[k];
      if (v == null) return;
      writeRaw(k, typeof v === 'string' ? v : JSON.stringify(v));
    });
  }

  /* ---------- status pill ---------- */

  const pill = {
    el: null,
    show(text, tone) {
      if (!this.el) {
        if (!document.body) { document.addEventListener('DOMContentLoaded', () => this.show(text, tone)); return; }
        const el = document.createElement('div');
        el.style.cssText = 'position:fixed;bottom:14px;left:14px;z-index:99999;max-width:min(360px,60vw);'
          + 'font:600 11px/1.45 "IBM Plex Mono",ui-monospace,monospace;padding:7px 12px;border-radius:12px;'
          + 'border:1px solid #E5E5E3;background:#FFFFFF;color:#6E6E6E;box-shadow:0 6px 18px rgba(20,20,20,.12);'
          + 'transition:opacity .25s';
        document.body.appendChild(el);
        this.el = el;
      }
      this.el.textContent = text;
      this.el.style.color = tone === 'bad' ? '#C0161C' : tone === 'warn' ? '#8A5A12' : tone === 'busy' ? '#B45309' : '#00846F';
      this.el.style.borderColor = tone === 'bad' ? '#F3B9BB' : tone === 'warn' ? '#F0C68A' : '#E5E5E3';
      this.el.style.background = tone === 'bad' ? '#FDECEC' : tone === 'warn' ? '#FDF3E3' : '#FFFFFF';
      this.el.style.opacity = '1';
      this.el.style.pointerEvents = tone === 'bad' || tone === 'warn' ? 'auto' : 'none';
      clearTimeout(this._t);
      if (tone === 'good') this._t = setTimeout(() => { if (this.el) this.el.style.opacity = '0'; }, 2400);
    }
  };

  /* ---------- sync ---------- */

  let hydrated = false;       // a read has succeeded; only then may we write
  let lastSynced = '';        // the payload the store last confirmed
  let storeName = 'store';
  let pushTimer = null;
  let inFlight = false;
  let failures = 0;

  const shortName = label => String(label || 'store').split(':')[0];

  async function push(reason) {
    if (!hydrated) { pill.show('waiting for the store before saving…', 'warn'); return; }
    if (inFlight) { schedule(400); return; }
    const body = JSON.stringify(collect());
    if (body === lastSynced) return;
    inFlight = true;
    pill.show('saving…', 'busy');
    try {
      const res = await fetch(API, { method: 'PUT', headers: { 'content-type': 'application/json' }, body });
      const out = await res.json();
      if (!res.ok || !out.ok) throw new Error(out.error || ('HTTP ' + res.status));
      lastSynced = body;
      storeName = shortName(out.label);
      failures = 0;
      pill.show('saved to ' + storeName + ' · ' + out.counts.estimations + ' estimations', 'good');
    } catch (err) {
      failures++;
      pill.show('NOT SAVED — ' + (err.message || err) + ' · retrying', 'bad');
      schedule(Math.min(30000, 2000 * failures));
    } finally {
      inFlight = false;
    }
  }

  function schedule(delay) {
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => push('change'), delay == null ? 1200 : delay);
  }

  async function pull(background) {
    try {
      const res = await fetch(API + '?t=' + Date.now(), { cache: 'no-store' });
      const out = await res.json();
      if (!res.ok || !out.ok) throw new Error(out.error || ('HTTP ' + res.status));
      storeName = shortName(out.label);
      const incoming = JSON.stringify({
        estimations: out.state.estimations || [],
        requests: out.state.requests || [],
        solutions: out.state.solutions || [],
        bundles: out.state.bundles || [],
        settings: out.state.settings || {}
      });

      if (!hydrated) {
        if (!out.empty) apply(out.state);
        hydrated = true;
        lastSynced = out.empty ? '' : JSON.stringify(collect());
        pill.show(out.empty ? storeName + ' is empty — starting fresh' : 'loaded from ' + storeName, 'good');
        return;
      }

      if (incoming === lastSynced) return;                 // nothing new
      const localDirty = JSON.stringify(collect()) !== lastSynced;
      if (localDirty) {
        pill.show('changed in ' + storeName + ' by someone else — reload to merge', 'warn');
        return;                                            // never clobber unsaved local edits
      }
      apply(out.state);
      lastSynced = JSON.stringify(collect());
      pill.show('updated from ' + storeName + ' — reload to see it', 'warn');
    } catch (err) {
      if (!hydrated) {
        failures++;
        pill.show('cannot reach the store — nothing will be saved (' + (err.message || err) + ')', 'bad');
        if (failures < 6) setTimeout(() => pull(true), Math.min(15000, 1500 * failures));
      }
    }
  }

  /* watch only the keys the app owns */
  origSet = localStorage.setItem.bind(localStorage);
  localStorage.setItem = function (k, v) {
    origSet(k, v);
    if (WATCHED.indexOf(k) >= 0) schedule();
  };
  const origRemove = localStorage.removeItem.bind(localStorage);
  localStorage.removeItem = function (k) {
    origRemove(k);
    if (WATCHED.indexOf(k) >= 0) schedule();
  };
  window.addEventListener('storage', e => { if (WATCHED.indexOf(e.key) >= 0) schedule(600); });

  /* last chance on the way out — only if we have something confirmed to compare against */
  window.addEventListener('beforeunload', () => {
    if (!hydrated) return;
    const body = JSON.stringify(collect());
    if (body === lastSynced) return;
    try { navigator.sendBeacon(API, new Blob([body], { type: 'application/json' })); } catch {}
  });

  document.addEventListener('visibilitychange', () => { if (!document.hidden) pull(true); });
  setInterval(() => { if (!document.hidden) pull(true); }, 45000);

  window.EdlySync = {
    pull, push, collect, apply, API,
    keys: WATCHED,
    get status() { return { hydrated, store: storeName, pending: JSON.stringify(collect()) !== lastSynced }; }
  };

  pull(false);
})();
