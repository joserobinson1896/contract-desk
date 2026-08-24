@AGENTS.md

# Contract → Billing Configuration

A signed telecom order form goes in; a billing configuration comes out, with every
defect in the contract surfaced before it becomes a wrong invoice.

**Core loop:** upload → parse → review findings → decide → project → invoice.

The app detects problems; a person decides them. That split is the product.

---

## Stack

| | |
|---|---|
| Runtime | Expo SDK 57 · React Native 0.86 · React 19.2 · TypeScript 6 |
| Routing | Expo Router — typed routes, React Compiler enabled |
| Web output | `server` (required for the `/api/parse` route) |
| Extraction | Gemini REST over `node:https` · `responseJsonSchema` + Zod re-validation |
| Schema/types | `zod` v4 — one definition serves extraction, storage validation, and TS types |
| Storage | `@react-native-async-storage/async-storage` (localStorage on web) |
| Charts | `react-native-svg`, hand-rolled |
| Config patches | `fast-json-patch` (RFC-6902) |
| Tests | `vitest` — domain layer only |
| UI verification | `playwright` driving the running app |

---

## Running it

```bash
npm run web        # browser
npm start          # then scan the QR with Expo Go
npm run verify     # typecheck + lint + tests
```

The app opens **empty**. For the reference contracts: **Settings → Load sample contracts**.

Two are seeded, and they are opposites on purpose. **Halcyon Motors** carries every
defect the rule engine looks for — ten blocking findings — and cannot be released
or invoiced. **Meridian Freight Systems** is drafted clean, raises nothing, and is
the one to use for the go-live and invoicing path. With only the defective one, the
happy path is unreachable and reads as broken rather than gated.

Seeding runs only on an empty library, so a deleted contract stays deleted. After
upgrading, press **Load sample contracts** to pick up a newly added fixture.

To import real PDFs you need `.env` (gitignored):

```bash
cp .env.example .env      # then put your key in it
GEMINI_API_KEY=AIza...
```

That is the whole setup. The key is read by the `/api/parse` route from
`process.env` and used only there. There is nothing to configure in the app — no
credential field, no token in device storage, no secret in the bundle.

---

## File structure

```
src/
  domain/              pure TypeScript — no React, no I/O, no storage
    schema.ts            Zod schemas + inferred types (the single definition)
    billing.ts           the month calculation
    policy.ts            decisions the contract leaves open
    flags.ts             runs both detection layers and merges them
    status.ts            commercial lifecycle + the transition table
    invoice.ts           generation, numbering, payment, implied status
    invoice-pdf.ts       the invoice document
    pdf.ts               a very small PDF writer (base-14, no dependency)
    fields.ts            config → labelled display groups, null-preserving
    resolve.ts           recording decisions, with audit trail
    record.ts            the stored contract record
    rules/               18 deterministic detectors, grouped by category
      index.ts             the registry — add a rule here
      minimum-spend.ts     band overlaps, gaps, decimal outliers, definitions
      charges.ts           unclassified charges, unpriced SKUs, fallback rates
      test-mode.ts         pooling conflicts, charges the exit clause omits
      term.ts              signature order, SIM-count basis, proration, migration
      coverage.ts          fields the contract never addresses
  data/                repository, invoice store, seeding, local settings,
                       invoice-file (opens a generated PDF per platform)
  import/              batch queue, file validation, document picker
  components/
    ui/                  design system: text, layout, chip, nav, segmented
    charts/              spend-schedule, pool-meter
    contract/            the five detail panes, invoice dialog, field grid
  hooks/               appearance/theme, breakpoints, contract loading
  fixtures/            the two public mock contracts — halcyon (defective),
                       meridian (clean)
  app/
    _layout.tsx          root stack
    (tabs)/              Home · Upload · Contracts · Invoices · Settings
      index.tsx            home — entry point at `/`, four destinations in a 2x2 grid
      contracts.tsx        the library, at `/contracts`
      invoices.tsx         every invoice across all contracts
    contract/[id].tsx    detail, five panes behind a segmented control
    api/parse+api.ts     server-side extraction (holds the API key)
```

`src/domain/` is deliberately free of React and I/O. That is what makes the contract
maths assertable to the cent in milliseconds, with no renderer and no network.

---

## The billing rule

The whole engine is these three lines, from Section B1 of the contract-to-billing
analysis. `src/domain/billing.ts` implements them and nothing else.

```
qualifying_fees = (sims × 2.43) + (MAX(0, mb_used − sims × 10) × 0.75)
                  + sms_charge − credits

rate_plan_total = MAX(qualifying_fees, minimum(month))

invoice_total   = rate_plan_total + non_qualifying_charges + tax
```

**Qualifying fees carry no month term.** At a fixed fleet and usage they are
identical in month 3 and month 30. The month enters one level up, through
`minimum(month)`. A qualifying-fee figure that holds flat while the month changes
is the formula working, not a stale calculation — the invoice total is what steps.

**`sims` is a count of ACTIVE SIMs only.** Test Mode SIMs neither pay the recurring
charge nor add their 10 MB to the pool. The same count drives both, so the two can
never diverge — a SIM that isn't paying $2.43 must not be enlarging the pool, or the
pool grows with no revenue behind it and overage comes out too low.

**Included data is per SIM, pooled.** `sims × 10` MB, assessed against the pool
total at end of month. One SIM over its own 10 MB creates no overage while the pool
has room. A flat 10 MB allowance would overbill.

**Qualifying** means the charges the contract counts toward minimum spend: the
recurring charge, data overage, and SMS, less credits. Excluded by the contract's
Actual Spend definition: SIM card purchases, setup, implementation, late payment
charges. Taxes are excluded separately — all rates are quoted exclusive of tax.
SMS is included as a working assumption, flagged pending confirmation.

The minimum-spend bands, as signed:

| Months | Minimum per month |
|---|---|
| 1–3 | $3.00 — flagged, 100× below the next band |
| 4–6 | $300.00 |
| 7–12 | $600.00 — flagged, overlaps the next band at month 12 |
| 12–24 | $1,200.00 — flagged, overlaps the previous band at month 12 |
| 25–36 and following | $2,400.00 |

Month 1 is August 2026, the order form start date. Month 12 sits in two bands and
does not compute until someone records which one controls.

---

## Decisions

Several of these look arbitrary until you know what they prevent.

**Defects are recorded, never repaired.** Extraction transcribes what the contract
says, including where it is wrong. A config that silently fixes a signed contract
hides the defect and leaves the QA pass nothing to find. The error is the signal.

**`null` means the contract is silent.** Not zero, and not "we couldn't find it".
Several rules fire precisely on null, so collapsing the distinction blinds them.

**Two detection layers.** Deterministic rules are the reliable floor — exact
pointers, real dollar impact, no API cost, incapable of inventing a finding, and
blind to anything nobody anticipated. A separate adversarial model review covers
the unanticipated. On overlap the rule wins (its maths is derived from the config);
model-only findings never gate go-live on their own.

**Extraction and review are separate model calls.** One transcribes and must be
literal; the other critiques and must be skeptical. One prompt doing both degrades
both — a transcriber asked to judge starts "helpfully" normalising away defects.

**Findings ship open.** Nothing is pre-answered. Every resolution records who
decided what, and when.

**`Charge.kind` is load-bearing.** Narrow Actual Spend is "rate plan / add-on /
support package", so minimum-spend eligibility *derives* from kind. That is why an
`unclassified` charge is a finding rather than a silent default.

**`BillingPolicy.setBy` separates a default from a decision.** A field still marked
`default` keeps its finding open. A silent default is how a guess reaches an invoice.

**Financial Projections refuses ambiguous months.** When two minimum-spend bands
claim the same month and nobody has decided which controls, it returns `blocked` and
names the finding. A plausible wrong number is worse than no number.

**Appearance has three states, not two.** `system` follows the device, `light` and
`dark` override it. A plain toggle cannot say "match my device", which is both the
common preference and the one an OS night schedule drives — collapsing it would
break the automatic switch-over at dusk. Stored in `AsyncStorage`, resolved once in
`AppearanceProvider`, held in context. Reading storage per component would make
every themed view do async work on mount and flash the wrong palette on the way.

**Dark mode draws edges the values no longer carry.** Against white, the navy nav
defines its own boundary. Against a near-black page it measures 1.2:1 against the
ground and the edge disappears, so dark adds a hairline — and the home card's glyph
block, which is ink on white, steps up to `inkRaised` plus a border to stay visible
at all. Every dark token was re-checked on the surface it actually sits on:
text 17.7:1, secondary 8.0:1, tertiary 5.2:1, accent 5.9:1, danger 5.2:1, all pass.
Run `node tools/validate-dark.mjs`.

**Colour is measured, not picked.** The palette is Hologram's — navy chrome, white
working area, lime signal, blue action — but every value was checked before it went
in. CIEDE2000 with Viénot–Brettel–Mollon dichromat simulation across normal, protan,
deutan and tritan vision:

| Pair | Worst ΔE | Note |
|---|---|---|
| chart series vs defect | 46.1 light / 44.2 dark | floor is 15 |
| `warning` vs `danger` | **3.9** (protan) | why severity always carries a text label |
| `success` vs `danger` | **1.4** (protan) | same reason |

Contrast, on the surface each colour actually sits on: text 18.3:1, secondary 6.2:1,
tertiary 4.5:1 (up from 2.8:1 — the old tertiary was below the readable floor),
accent 7.1:1, white-on-accent 7.1:1, lime pill 15.1:1, nav 17.2:1.

**The lime is a block, never a foreground.** At 1.3:1 on white it cannot be text.
It appears as a filled pill behind near-black — the treatment Hologram's own status
pills use — and as one hairline rule. Used on all three home cards it would stop
reading as a signal, so it marks one thing per screen.

**Dark chrome, light content.** The nav carries the brand navy so the page reads as
a distinct working surface without a border being drawn around it. This mirrors the
sidebar-and-canvas split in Hologram's platform.

The colour maths lives in `tools/color.mjs` — rerun it before changing a token.

**Navigator headers are off app-wide.** Each screen renders its own title inside the
shared width container. A full-bleed header over a width-capped body is what pushed
the Settings link to the far screen edge.

**Extraction runs on Gemini, over raw REST.** No SDK: the one that existed used
`fetch`, and the runtime kills that at 30s (below). The REST surface here is a
single POST, so owning it costs less than working around a transport we do not
control. The key travels in an `x-goog-api-key` header, never the query string,
so it cannot be captured by anything that logs URLs.

**Outbound `fetch` from an API route is killed at 30 seconds.** Not by Gemini, and
not by the SDK — by the server runtime itself. Extraction takes 30-300s depending
on the model, so it died a third of the way through and reported "Gemini returned
an error", which was false. `/api/parse` therefore calls the REST API over
`node:https`, which is not capped. Verified: an outbound `fetch` to a 45s endpoint
fails at 30.0s; the same call over `node:https` returns at 45.0s. Do not "simplify"
this back to `fetch` or an SDK that uses it.

**Every upload is two paid calls, and the queue used to retry timeouts three
times.** `upstream_timeout` is now non-retryable: the timed-out request was still
billed, and a contract that exhausted the ceiling once will do it again. The Retry
button still exists — the app just no longer spends three times without being
asked.

**Model choice is a cost decision, not a correctness one.** Flash measured 29s
against Pro's 324s on the same contract with materially the same extraction. The
quality floor is the eighteen deterministic rules plus Zod re-validation, which run
identically whatever produced the config.

**Structured output is constrained AND re-validated.** Gemini generates against
`responseJsonSchema` (converted from the Zod schema with `z.toJSONSchema`), but the
response is then parsed with the same Zod schema the rest of the app uses. The
schema the model is given and the schema the app trusts are the same definition,
and only the second decides what gets through — so a drifting response is rejected
at the boundary instead of reaching the billing engine as a half-valid config. The
`$schema` meta-key must be stripped; the API rejects it.

**Upstream errors are mapped by status, and the body is never echoed.** A Gemini
error body can carry the key, the project, or the whole prompt — keeping those
server-side is this endpoint's entire point. `httpFailure` maps the status: 401/403
→ key rejected, 429 → rate limited, 404 → the configured model is not available to
that key (set `GEMINI_MODEL`).

**The parse route is a spending endpoint.** Per-IP rate limit, same-origin check,
magic-byte validation, 20 MB cap. Note what that is not: an Origin header is
trivially forged by a non-browser client, so these bound abuse rather than
authenticate a caller. Anyone who can reach a public deployment can spend your API
credits — put it behind your own auth layer, or keep the deployment private.

**The client holds no credential at all.** `GEMINI_API_KEY` is read from
`process.env` inside the route handler and never leaves the server: not in a
response, not in an error message, not in the bundle. An earlier build had the user
paste a shared token in Settings; that made a secret the client could hold, and a
secret the client can hold is one anyone with devtools can read. The fields are
gone, and a stale token from that build is purged from device storage at app start.

**Never prefix a secret with `EXPO_PUBLIC_`.** That prefix inlines the value into
the client bundle at build time. It is the one mistake that would undo all of the
above, and it looks harmless in a diff.

**PDFs are not retained.** localStorage is a ~5 MB quota; base64 contracts would
exhaust it after two. Records keep the content hash, filename, and page count.

---

## Status and invoicing

**Two axes, one badge.** `lifecycle` (derived from findings) asks whether the config
is safe to bill from; `status` (Draft → Active → Invoiced → Paid, moved by actions)
asks where the contract is in the billing cycle. They answer different questions and
a contract can legitimately be Draft *and* Verified — reviewed, not yet released.

Only `status` is rendered as a badge. Two status-shaped chips made the reader decide
which to believe; the QA state appears as a sentence underneath saying what it would
take to move forward. `lifecycle` still gates go-live and the portfolio tiles.

**Transitions live in one table** (`status.ts`). Forward through the cycle plus the
reversals that really happen. `draft → paid` is refused — money against a contract
nobody released and no invoice was raised for. Going Active re-asserts `canGoLive`,
so the status model cannot route around the gate. Every move is audited with both
endpoints.

**An invoice is a committed run of the billing engine.** It calls the same
`simulateMonth` as the projections pane, so two numbers for one month cannot
disagree. It stores its own inputs and line items: an issued invoice records what
*was* billed, and re-deriving it from a config edited since would restate history.

**The PDF writer is hand-rolled** (`pdf.ts`) — base-14 Helvetica, no embedding, no
dependency, no network. Byte offsets in the cross-reference table are measured as
the string is assembled; a wrong one makes readers reject the file entirely.

---

## Gotchas

Each of these has already cost a debugging cycle.

- **`Alert.alert` is a silent no-op on react-native-web.** It neither prompts nor
  throws, so a confirm-then-destroy flow built on it becomes a dead button on the
  platform the app actually runs on. Use `window.confirm` under `Platform.OS ===
  'web'`. Feature-testing the shim does not help — it exports no keys at all.
- **Invoices are gated on "released", not on `status === 'active'`.** The first
  invoice moves a contract to Invoiced; requiring `active` exactly meant it could
  then never be invoiced again. Billing is monthly, so that is the ordinary case.
- **Deleting a contract must cascade to its invoices.** Otherwise the invoice list
  shows rows that open nothing and receivables count a customer who is gone.
- **An invoice id must not be a timestamp alone.** Two generated inside the same
  millisecond collide, and `saveInvoice` replaces by id — so one vanishes
  silently. Keyed on the invoice number, which is unique by construction.
- **The PDF Info dictionary is not WinAnsi.** An unmarked string there is decoded
  as PDFDocEncoding, where the em-dash byte is a different letter and the title in
  the viewer's tab comes out misspelt. Use UTF-16BE with a BOM.

- **`<Link asChild>` rejects style arrays.** Wrap in `StyleSheet.flatten` — otherwise
  it throws at runtime and renders a blank page, while typecheck and tests both pass.
- **Use `boxShadow`, not `shadow*`.** React Native Web warns on the old props; see
  `elevation()` in `components/ui/layout.tsx`.
- **Seeding belongs at app start, not in a screen.** Seeding from the library screen
  meant deep-linking to a contract found an empty library and reported it missing.
- **`useFocusEffect` already fires on mount.** A companion `useEffect` double-loads
  and trips the `set-state-in-effect` lint rule.
- **Zod's same-name `const` + `type` idiom trips `no-redeclare`.** It is legal TS and
  deliberate; the rule is disabled for `src/domain/**` in `eslint.config.js`.
- **Never commit real customer contracts.** Only the public mock ships.
  `fixtures/private/` and `*.private.json` are gitignored, as is `.env`.

---

## Testing

155 tests, all in `src/domain/`. The ones that carry weight:

- **Both worked months to the cent** — 150 SIMs / 2,400 MB → `$1,039.50` (actual fees
  control); 20 SIMs / 100 MB → `$300.00` (the minimum controls).
- **The pooled-data trap** — one SIM over its own allowance creates no overage while
  the pool has room; the pool scales with the fleet.
- **Month 12 blocked**, then computable once a decision is recorded.
- **Detection under mutation** — defects are *injected* into the reference contract
  (a band gap, an unpriced add-on, a foreign escalation curve) and must be caught.
  Reproducing one known contract proves nothing; this is the real test.
- **A clean contract produces zero findings** — Meridian. Without it, every finding
  on the defective fixture is suspect, and the invoicing path is unreachable.
- **Term totals, not just single months** — 40 SIMs over months 1-6 at 500 MB/month
  totals `$1,416.60` (three months of actual fees, three where the minimum controls);
  the same six months at 80 SIMs totals `$1,483.20`, because the larger pool absorbs
  the usage and the overage line disappears. A total that never moves when the fleet
  changes is the failure these catch.
- **Invoices agree with the engine** to the cent, refuse the months it refuses, and
  keep billing month after month once the contract is released.
- **The status transition table** — the cycle walks forward, the real reversals are
  allowed, `draft → paid` is refused, and the QA gate is re-asserted on `→ active`.
- **PDF cross-reference offsets** — every xref entry must point at the object it
  claims. A wrong offset opens as a blank page rather than an obvious error.
- **`null` survives the field projection** — a null `nonRenewalNoticeDays` reads
  "Not stated" while a real `0` still reads "0 days".

To verify the UI, drive the running app with Playwright (`channel: 'chrome'` — the
bundled chromium is not installed) rather than trusting a typecheck.
