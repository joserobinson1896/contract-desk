import { contrast, worstDeltaE } from './color.mjs';
const L = { surface:'#FFFFFF', textSecondary:'#5A6076', accent:'#2C41E0', warning:'#8A6100', success:'#43600A' };
const D = { surface:'#141826', textSecondary:'#A8AEC0', accent:'#7C8BFF', warning:'#FF9F0A', success:'#C3F53C' };

const map = (t) => ({ draft: t.textSecondary, active: t.accent, invoiced: t.warning, paid: t.success });

for (const [name, t] of [['LIGHT', L], ['DARK', D]]) {
  const m = map(t);
  console.log(`=== ${name}: badge text on its own chip ground ===`);
  for (const [k, v] of Object.entries(m)) {
    console.log(`  ${k.padEnd(9)} ${v}  on ${t.surface}: ${contrast(v, t.surface).toFixed(2)}:1  ${contrast(v,t.surface)>=4.5?'PASS':'FAIL'}`);
  }
  console.log(`  --- worst pairwise separation across normal/protan/deutan/tritan ---`);
  const keys = Object.keys(m);
  let worst = { dE: Infinity, pair: '', mode: '' };
  for (let i=0;i<keys.length;i++) for (let j=i+1;j<keys.length;j++) {
    const w = worstDeltaE(m[keys[i]], m[keys[j]]);
    if (w.worst.dE < worst.dE) worst = { dE: w.worst.dE, pair: `${keys[i]}/${keys[j]}`, mode: w.worst.mode };
  }
  console.log(`  worst pair: ${worst.pair} = ΔE ${worst.dE.toFixed(1)} (${worst.mode})`);
  console.log('');
}
