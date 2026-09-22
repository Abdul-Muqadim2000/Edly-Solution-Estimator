/* bun run store:probe     — which provider is configured, and can it be reached
   bun run store:discover  — list drives / sheets you can write to (for MS_DRIVE_ID etc.)
   bun run state:dump      — print what is stored
   bun run state:seed      — write an empty store so the first read has something */

import { loadState, saveState, storeLabel, storeKind, discover } from '../lib/store.js';
import { EMPTY_STATE } from '../lib/schema.js';

const cmd = process.argv[2] || 'dump';

if (cmd === 'probe' || cmd === 'discover') {
  console.log('provider  ' + storeKind());
  console.log('target    ' + (await storeLabel()));
  try {
    const state = await loadState();
    console.log('read      ok' + (state ? '' : ' (empty — nothing stored yet)'));
  } catch (err) {
    console.log('read      FAILED — ' + (err.message || err));
  }
  if (cmd === 'discover') {
    try {
      const found = await discover();
      if (!found.length) console.log('\nNothing to list for this provider.');
      else {
        console.log('\nreachable targets:');
        found.forEach(f => console.log('  ' + JSON.stringify(f)));
      }
    } catch (err) {
      console.log('\ndiscover FAILED — ' + (err.message || err));
    }
  }
  process.exit(0);
}

if (cmd === 'seed') {
  const existing = await loadState();
  if (existing) {
    console.log('Store already has data at ' + (await storeLabel()) + ' — nothing to do.');
    process.exit(0);
  }
  const out = await saveState(EMPTY_STATE);
  console.log('Seeded empty store → ' + out.store);
  if (out.url) console.log('url: ' + out.url);
  process.exit(0);
}

const state = await loadState();
console.log('provider     ' + storeKind());
console.log('target       ' + (await storeLabel()));
if (!state) {
  console.log('\nNothing stored yet. Run: bun run state:seed');
  process.exit(0);
}
console.log('estimations  ' + state.estimations.length);
state.estimations.forEach(e => console.log('   ' + String(e.plat).padEnd(11) + String(e.total).padStart(9) + ' h  ' + e.name + (e.client ? ' — ' + e.client : '')));
console.log('requests     ' + state.requests.length + '  (' + state.requests.filter(r => !(+r.est > 0)).length + ' awaiting an estimate)');
console.log('solutions    ' + state.solutions.length + ' added at the desk');
console.log('bundles      ' + state.bundles.length + ' custom categories');
console.log('settings     ' + Object.keys(state.settings).length + ' keys');
