import { contrast, worstDeltaE } from './color.mjs';

const D = {
  text: '#FFFFFF', background: '#07090F', surface: '#141826', surfaceRaised: '#1F2434',
  textSecondary: '#A8AEC0', textTertiary: '#858BA0', accent: '#7C8BFF',
  success: '#C3F53C', warning: '#FF9F0A', danger: '#FF453A', advisory: '#BF5AF2',
};
const INK = '#151A2E', LIME = '#C3F53C', ONINK_MUTED = '#A0A3AD';

const pass = (r, floor) => (r >= floor ? 'PASS' : 'FAIL');
console.log('=== DARK: text on surface #141826 (floor 4.5 body / 3.0 large) ===');
for (const k of ['text','textSecondary','textTertiary','accent','success','warning','danger','advisory']) {
  const r = contrast(D[k], D.surface);
  console.log(`  ${k.padEnd(14)} ${D[k]}  ${r.toFixed(2)}:1  ${pass(r,4.5)}`);
}
console.log('\n=== DARK: same on page background #07090F ===');
for (const k of ['text','textSecondary','textTertiary','accent']) {
  const r = contrast(D[k], D.background);
  console.log(`  ${k.padEnd(14)} ${r.toFixed(2)}:1  ${pass(r,4.5)}`);
}
console.log('\n=== DARK: nav navy on dark page (surface separation) ===');
console.log(`  nav ${INK} vs page ${D.background}: ${contrast(INK, D.background).toFixed(2)}:1 (separation, not text)`);
console.log(`  lime on nav: ${contrast(LIME, INK).toFixed(2)}:1`);
console.log(`  muted on nav: ${contrast(ONINK_MUTED, INK).toFixed(2)}:1  ${pass(contrast(ONINK_MUTED,INK),4.5)}`);
console.log(`  glyph box inkRaised #1F2540 vs card ${D.surface}: ${contrast('#1F2540', D.surface).toFixed(2)}:1 (separation)`);
console.log(`  lime on inkRaised: ${contrast(LIME,'#1F2540').toFixed(2)}:1`);

console.log('\n=== DARK: chart pair across vision types ===');
const w = worstDeltaE(D.accent, D.danger);
console.log('  ' + w.rows.map(r=>`${r.mode}=${r.dE.toFixed(1)}`).join('  ') + `  WORST=${w.worst.dE.toFixed(1)} (${w.worst.mode})`);
