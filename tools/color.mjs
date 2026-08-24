// Colour maths: WCAG contrast, CIEDE2000, and CVD simulation (Viénot 1999).
export const hex = (h) => {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16) / 255);
};
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const unlin = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function luminance(h) {
  const [r, g, b] = hex(h).map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

function toXYZ([r, g, b]) {
  [r, g, b] = [r, g, b].map(lin);
  return [
    r * 0.4124564 + g * 0.3575761 + b * 0.1804375,
    r * 0.2126729 + g * 0.7151522 + b * 0.072175,
    r * 0.0193339 + g * 0.119192 + b * 0.9503041,
  ];
}
function toLab(rgb) {
  const [X, Y, Z] = toXYZ(rgb);
  const [xn, yn, zn] = [0.95047, 1, 1.08883];
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
  const [fx, fy, fz] = [f(X / xn), f(Y / yn), f(Z / zn)];
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000. */
export function deltaE(h1, h2) {
  const [L1, a1, b1] = toLab(hex(h1));
  const [L2, a2, b2] = toLab(hex(h2));
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const ap1 = (1 + G) * a1, ap2 = (1 + G) * a2;
  const Cp1 = Math.hypot(ap1, b1), Cp2 = Math.hypot(ap2, b2);
  const hp = (b, ap) => { if (b === 0 && ap === 0) return 0; const d = (Math.atan2(b, ap) * 180) / Math.PI; return d >= 0 ? d : d + 360; };
  const hp1 = hp(b1, ap1), hp2 = hp(b2, ap2);
  const dLp = L2 - L1, dCp = Cp2 - Cp1;
  let dhp = 0;
  if (Cp1 * Cp2 !== 0) { dhp = hp2 - hp1; if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360; }
  const dHp = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dhp * Math.PI) / 360);
  const Lbp = (L1 + L2) / 2, Cbp = (Cp1 + Cp2) / 2;
  let hbp = hp1 + hp2;
  if (Cp1 * Cp2 !== 0) { if (Math.abs(hp1 - hp2) > 180) hbp += hbp < 360 ? 360 : -360; hbp /= 2; }
  const T = 1 - 0.17 * Math.cos(((hbp - 30) * Math.PI) / 180) + 0.24 * Math.cos((2 * hbp * Math.PI) / 180)
    + 0.32 * Math.cos(((3 * hbp + 6) * Math.PI) / 180) - 0.2 * Math.cos(((4 * hbp - 63) * Math.PI) / 180);
  const dth = 30 * Math.exp(-(((hbp - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lbp - 50) ** 2) / Math.sqrt(20 + (Lbp - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin((2 * dth * Math.PI) / 180) * Rc;
  return Math.sqrt((dLp / Sl) ** 2 + (dCp / Sc) ** 2 + (dHp / Sh) ** 2 + Rt * (dCp / Sc) * (dHp / Sh));
}

/** Viénot, Brettel & Mollon 1999 dichromat simulation. */
export function cvd(h, kind) {
  let [r, g, b] = hex(h).map(lin);
  // sRGB -> LMS (Hunt-Pointer-Estevez, normalised to D65)
  const L = 0.31399022 * r + 0.63951294 * g + 0.04649755 * b;
  const M = 0.15537241 * r + 0.75789446 * g + 0.08670142 * b;
  const S = 0.01775239 * r + 0.10944209 * g + 0.87256922 * b;
  let l = L, m = M, s = S;
  if (kind === 'protan') l = 1.05118294 * M - 0.05116099 * S;
  if (kind === 'deutan') m = 0.9513092 * L + 0.04866992 * S;
  if (kind === 'tritan') s = -0.86744736 * L + 1.86727089 * M;
  r = 5.47221206 * l - 4.6419601 * m + 0.16963708 * s;
  g = -1.1252419 * l + 2.29317094 * m - 0.1678952 * s;
  b = 0.02980165 * l - 0.19318073 * m + 1.16364789 * s;
  const to255 = (c) => Math.max(0, Math.min(255, Math.round(unlin(Math.max(0, Math.min(1, c)))* 255)));
  return '#' + [r, g, b].map((c) => to255(c).toString(16).padStart(2, '0')).join('');
}

export function worstDeltaE(a, b) {
  const modes = ['normal', 'protan', 'deutan', 'tritan'];
  const rows = modes.map((mode) => {
    const [x, y] = mode === 'normal' ? [a, b] : [cvd(a, mode), cvd(b, mode)];
    return { mode, dE: deltaE(x, y) };
  });
  return { rows, worst: rows.reduce((w, r) => (r.dE < w.dE ? r : w)) };
}
