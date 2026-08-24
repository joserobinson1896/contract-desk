# tools

Standalone scripts. Not part of the app bundle and not run by the test suite —
they exist to check work that is otherwise easy to assert without evidence.

## Colour validation

The palette is measured rather than chosen. `color.mjs` implements WCAG contrast,
CIEDE2000, and Viénot–Brettel–Mollon dichromat simulation with no dependencies;
the three validators use it to check the tokens actually shipped in
`src/constants/theme.ts`.

```bash
node tools/validate-palette.mjs    # light palette, chart pair, text contrast
node tools/validate-dark.mjs       # every dark token on the surface it sits on
node tools/validate-status.mjs     # the four contract-status badge colours
```

Rerun the relevant one before changing a colour token. The numbers quoted in
`README.md` and `CLAUDE.md` come from these scripts, so a token change that is not
re-measured makes those docs wrong.

What they are guarding against, concretely:

- Text below the 4.5:1 readable floor. `textTertiary` was 2.8:1 before this caught it.
- Two marks in one chart that collapse under colour-vision deficiency. The chart
  pair holds at ΔE 46.1 worst-case; the 15 floor is the threshold to stay above.
- Status colours being trusted to carry meaning alone. They cannot —
  `warning` vs `danger` measures ΔE 3.9 under protanopia, which is why every
  status chip carries a text label.
