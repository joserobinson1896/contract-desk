import { contrast, worstDeltaE, deltaE } from './color.mjs';

const WHITE = '#FFFFFF';
const INK = '#151A2E';
const LIME = '#C3F53C';

console.log('=== Candidate accents (Hologram blue family) on white ===');
for (const c of ['#2C41E0', '#2B3FD9', '#2438C4', '#1F32B8']) {
  console.log(`  ${c}  vs white ${contrast(c, WHITE).toFixed(2)}:1   white-on-it ${contrast(WHITE, c).toFixed(2)}:1`);
}

console.log('\n=== Body/secondary text on candidate grounds ===');
for (const [name, t] of [['ink text', '#0F1424'], ['secondary', '#5A6076'], ['secondary+', '#565C72'], ['tertiary', '#8B92A8']]) {
  console.log(`  ${name.padEnd(11)} ${t}  on white ${contrast(t, WHITE).toFixed(2)}:1  on #F4F5F9 ${contrast(t, '#F4F5F9').toFixed(2)}:1`);
}

console.log('\n=== Success (lime family) as TEXT on white — needs >=4.5 ===');
for (const c of ['#4A6B00', '#43600A', '#3F5C00', '#547A00', '#5C8500']) {
  console.log(`  ${c}  ${contrast(c, WHITE).toFixed(2)}:1`);
}

console.log('\n=== Lime as a BACKGROUND (Hologram "Connected" pill) ===');
console.log(`  ink #0B0E1A on lime ${LIME}: ${contrast('#0B0E1A', LIME).toFixed(2)}:1`);
console.log(`  lime ${LIME} as text on white: ${contrast(LIME, WHITE).toFixed(2)}:1  <- unusable as text, block only`);

console.log('\n=== Nav: dark navy bar ===');
console.log(`  white on ink ${INK}: ${contrast(WHITE, INK).toFixed(2)}:1`);
console.log(`  muted rgba(255,255,255,.66) ~ #A0A3AD on ink: ${contrast('#A0A3AD', INK).toFixed(2)}:1`);
console.log(`  lime on ink: ${contrast(LIME, INK).toFixed(2)}:1`);
console.log(`  ink text on lime pill: ${contrast('#0B0E1A', LIME).toFixed(2)}:1`);

console.log('\n=== CHART PAIR: series (accent) vs defect (danger), all vision types ===');
for (const [series, defect, label] of [
  ['#007AFF', '#D70015', 'CURRENT (iOS blue / red)'],
  ['#2C41E0', '#D70015', 'NEW (Hologram blue / red)'],
  ['#2C41E0', '#C81E1E', 'NEW (Hologram blue / warmer red)'],
]) {
  const { rows, worst } = worstDeltaE(series, defect);
  console.log(`  ${label}`);
  console.log('    ' + rows.map((r) => `${r.mode}=${r.dE.toFixed(1)}`).join('  ') + `   WORST=${worst.dE.toFixed(1)} (${worst.mode})`);
}
