/**
 * bun run store:probe     which provider is configured, and can it be reached
 * bun run store:discover  list drives / sheets you can write to (for MS_DRIVE_ID etc.)
 * bun run state:dump      print what is stored
 * bun run state:seed      write an empty store so the first read has something
 */

import { discover, loadState, saveState, storeKind, storeLabel } from '../server/store';
import { EMPTY_STATE } from '../server/schema';

const command = process.argv[2] ?? 'dump';

if (command === 'probe' || command === 'discover') {
  console.log(`provider  ${storeKind()}`);
  console.log(`target    ${await storeLabel()}`);
  try {
    const state = await loadState();
    console.log(`read      ok${state ? '' : ' (empty — nothing stored yet)'}`);
  } catch (error) {
    console.log(`read      FAILED — ${(error as Error).message}`);
  }
  if (command === 'discover') {
    try {
      const targets = await discover();
      if (targets.length === 0) console.log('\nNothing to list for this provider.');
      else {
        console.log('\nreachable targets:');
        for (const target of targets) console.log(`  ${JSON.stringify(target)}`);
      }
    } catch (error) {
      console.log(`\ndiscover FAILED — ${(error as Error).message}`);
    }
  }
  process.exit(0);
}

if (command === 'seed') {
  if (await loadState()) {
    console.log(`Store already has data at ${await storeLabel()} — nothing to do.`);
    process.exit(0);
  }
  const result = await saveState(EMPTY_STATE);
  console.log(`Seeded empty store → ${result.store}`);
  if (result.url) console.log(`url: ${result.url}`);
  process.exit(0);
}

const state = await loadState();
console.log(`provider     ${storeKind()}`);
console.log(`target       ${await storeLabel()}`);
if (!state) {
  console.log('\nNothing stored yet. Run: bun run state:seed');
  process.exit(0);
}
console.log(`estimations  ${state.estimations.length}`);
for (const estimation of state.estimations) {
  console.log(`   ${estimation.plat.padEnd(11)}${String(estimation.total).padStart(9)} h  ${estimation.name}${estimation.client ? ` — ${estimation.client}` : ''}`);
}
const pending = state.requests.filter((request) => !(Number(request.est) > 0)).length;
console.log(`requests     ${state.requests.length}  (${pending} awaiting an estimate)`);
console.log(`solutions    ${state.solutions.length} added at the desk`);
console.log(`bundles      ${state.bundles.length} custom categories`);
console.log(`settings     ${Object.keys(state.settings).length} keys`);
