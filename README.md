# Contract Desk

**Signed telecom order form in. Billing configuration out — with every defect in the contract
surfaced before it becomes a wrong invoice.**

Upload a PDF. The app extracts every billable term, flags what is ambiguous, contradictory or
unstated, holds those findings open until a person decides them, and only then lets you project
a month or issue an invoice.

Built with Expo / React Native. Runs in a browser and on device.

```
upload → parse → review findings → decide → project → invoice
```

---

## Contents

- [Why it works this way](#why-it-works-this-way)
- [Quick start](#quick-start)
- [The full loop, end to end](#the-full-loop-end-to-end)
- [Configuration](#configuration)
- [The billing rule](#the-billing-rule)
- [How detection works](#how-detection-works)
- [Contract status and invoicing](#contract-status-and-invoicing)
- [Architecture](#architecture)
- [Adding a rule](#adding-a-rule)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Security](#security)
- [Known limits](#known-limits)

---

## Why it works this way

A signed contract is written for humans, not billing systems. Pooled data, tiered minimum spend
and test-mode conversion are easy to misread and expensive to get wrong — and anything ambiguous
becomes a wrong invoice the moment somebody quietly guesses.

Four decisions follow from that. They look arbitrary until you know what they prevent.

**Defects are recorded, never repaired.** Extraction transcribes what the contract says,
*including where it is wrong*. A config that silently fixes a signed contract hides the defect
and leaves the QA pass nothing to find. The error is the signal.

**`null` means the contract is silent.** Not zero, and not "we couldn't find it". Several rules
fire precisely on `null`, so collapsing the distinction blinds them.

**Findings ship open.** The app detects; a person decides. Every resolution records who decided
what, and when. Nothing is pre-answered.

**The engine refuses ambiguous months.** When two minimum-spend bands claim the same month and
nobody has decided which controls, it returns `blocked` and names the finding. A plausible wrong
number is worse than no number — and far worse once it has been invoiced.

---

## Quick start

```bash
npm install
npm run web          # browser
npm start            # then scan the QR with Expo Go
```

The app opens **empty**. Load the two reference contracts:

> **Settings → Load sample contracts**

They are opposites on purpose:

| Contract | State | Use it for |
|---|---|---|
| **Halcyon Motors** | 10 blocking findings | Seeing detection work. Cannot be released or invoiced — that gate *is* the product. |
| **Meridian Freight Systems** | Clean, zero findings | Walking the go-live and invoicing path end to end. |

No API key is needed for either. Extraction is only required to import your *own* PDFs.

> Seeding runs only on an empty library, so a contract you delete stays deleted. After pulling
> new code, press **Load sample contracts** again to pick up a newly added fixture.

---

## The full loop, end to end

Try it on **Meridian Freight Systems**, which is clean.

**0 · Home** — four destinations as a 2×2 grid on desktop, a single column on phone.

**1 · Contracts** — the library. Status badge, blocking count, open findings. Filter by status,
and click any row to expand the full field set from the order form in a labelled grid. Fields the
contract never addresses read *Not stated* rather than showing a blank.

**2 · Findings** — every defect, grouped by severity, each with the clause quoted, both readings,
the dollar impact, and the question to put to Deal Desk. Resolve one and the counts move.

**3 · Policy** — the nine choices the contract leaves open. Each ships with a conservative
default so a month can be computed at all, but *a default is not a decision*: until someone sets
a value deliberately it reads **not decided** and its finding stays open.

**4 · Financial Projections** — set month, active SIMs and pooled data; see qualifying fees, the
period minimum, which one controls, and the invoice total. Month 12 on Halcyon refuses to
compute and tells you why.

**5 · Generate Invoice** — top right of the contract page. Preview the total before committing.
Requires the contract to be **Active**, which requires every blocking finding resolved.

**6 · Invoices** — every invoice across all contracts. Click one to open it as a **PDF**. Mark it
paid and the contract's status follows.

---

## Configuration

Everything above works with no configuration. You only need a key to import your own PDFs.

```bash
cp .env.example .env
```

Then set your [Google AI Studio](https://aistudio.google.com/apikey) key:

```bash
GEMINI_API_KEY=AIza...
```

**Restart the dev server** so the route picks it up.

There is nothing to configure inside the app. The key is read from `process.env` inside the
`/api/parse` route and never leaves the server — the browser sends a PDF and gets back a config.
It is never given a credential to hold, because a secret in browser JavaScript is readable by
anyone who opens devtools.

### Model and cost

**Every upload is two calls** — one to transcribe, one to review. Measured on a three-page order
form: ~6.3k input, ~7.7k output tokens.

| `GEMINI_MODEL` | Time | Notes |
|---|---|---|
| `gemini-3.7-flash` | **~29s** | Default. Cheap. |
| `gemini-3.1-pro-preview` | ~324s | Materially the same extraction on the same contract. |

Flash is the default because **the quality floor does not come from the model**: eighteen
deterministic rules run over whatever is extracted, and the output is re-validated against the
same Zod schema either way. A weaker transcription surfaces as findings to resolve, not as a
silently wrong configuration.

List what your key can reach:

```bash
curl -s -H "x-goog-api-key: $GEMINI_API_KEY" \
  https://generativelanguage.googleapis.com/v1beta/models
```

> **`/api/parse` spends money.** It is guarded by a per-IP rate limit, a same-origin check and
> strict size and content validation. Those bound abuse; they are **not** user authentication,
> since a non-browser client can forge an Origin header. Anyone who can reach a public deployment
> can burn your API credits — put it behind your own auth layer, or keep the deployment private.

---

## The billing rule

The whole engine is these three lines. `src/domain/billing.ts` implements them and nothing else.

```
qualifying_fees = (sims × mrc) + (MAX(0, mb_used − sims × included) × overage)
                  + sms_charge − credits

rate_plan_total = MAX(qualifying_fees, minimum(month))

invoice_total   = rate_plan_total + non_qualifying_charges + tax
```

**Qualifying fees carry no month term.** At a fixed fleet and usage they are identical in month 3
and month 30. The month enters one level up, through `minimum(month)`. A qualifying-fee figure
that holds flat while the month changes is the formula working, not a stale calculation — the
invoice total is what steps.

**`sims` counts ACTIVE SIMs only.** Test Mode SIMs neither pay the recurring charge nor add their
allowance to the pool. The same count drives both, so they can never diverge — a SIM that is not
paying must not be enlarging the pool, or overage comes out too low.

**Included data is per SIM, pooled.** One SIM over its own allowance creates no overage while the
pool has room. A flat allowance would overbill.

Worked example — 150 SIMs, 2,400 MB, month 8:

```
(150 × $2.43) + (MAX(0, 2400 − 1500) × $0.75)   =  $364.50 + $675.00  =  $1,039.50
MAX($1,039.50, $600.00)                          =  $1,039.50           actual fees control
```

---

## How detection works

Two layers, because either alone is insufficient.

### Deterministic rules — the floor

Eighteen predicates over the extracted config. Precise JSON pointers, real dollar impact, zero
API cost, fully unit-tested, incapable of inventing a finding.

Their limit is that a rule only catches what someone anticipated.

```
src/domain/rules/
  minimum-spend.ts   band overlaps, gaps, decimal outliers, contradictory definitions
  charges.ts         unclassified charges, unpriced SKUs, unstated fallback rates
  test-mode.ts       pooling conflicts, charges the exit clause omits
  term.ts            signature ordering, SIM-count basis, proration, migration deadlines
  coverage.ts        fields the contract never addresses
```

### Adversarial model review — the coverage layer

A second, separate model call whose only job is to critique the contract: find anything
ambiguous, contradictory or under-specified; quote the clause; give both readings and the dollar
impact; **resolve nothing**.

It is kept apart from extraction on purpose. Extraction transcribes and must be literal; review
critiques and must be skeptical. One prompt doing both degrades both — a transcriber asked to
judge starts "helpfully" normalising away the defects.

The review call also receives the extracted config, so it double-checks extraction quality as a
side effect.

### Merging

- A model finding landing on the same config location as a rule finding **collapses into the
  rule's version** — the rule's maths is derived from the config, so it is the one to trust.
- Model-only findings survive, marked as such, and **never gate go-live on their own**. A
  hallucinated finding should cost a glance, not a blocked launch.

---

## Contract status and invoicing

Every contract carries a status: **Draft → Active → Invoiced → Paid**.

This is a *second* axis, not a replacement for the QA lifecycle underneath it:

| | asks | set by |
|---|---|---|
| `lifecycle` | Is this configuration safe to bill from? | **derived** from open findings |
| `status` | Where is this contract in the billing cycle? | **actions** people take |

Only `status` is ever shown as a badge — two status-shaped chips made the reader decide which to
believe. The QA state appears as a plain sentence beneath it, saying what it would take to move
forward: *"Not yet released for billing. 10 blocking findings must be resolved before it can go
Active."*

**Transitions are a table, not a free-text field.** Forward through the cycle, plus the reversals
that genuinely happen — withdrawing a release, voiding an invoice. `Draft → Paid` is refused:
that would be money against a contract nobody released and no invoice was raised for. Going
Active is gated on the same `canGoLive` check the rest of the app uses, so the status model
cannot route around it. Every move is written to the audit log with both endpoints.

### Invoices

An invoice is a **committed run of the billing engine** — it calls the same `simulateMonth` the
projections pane uses and the worked-example tests pin to the cent. There is no second formula,
so two numbers for one month cannot disagree.

Three consequences, all deliberate:

1. **A month the engine refuses cannot be invoiced.** Generation fails and names the finding.
2. **The invoice stores its own inputs and line items.** Re-deriving the total later from a config
   edited since would silently restate history. An issued invoice records what *was* billed.
3. **Only a released contract can be invoiced.** The go-live gate stands between an undecided
   contract and real money.

Clicking an invoice opens it as a **PDF** — generated in-process by a small hand-rolled writer
(`src/domain/pdf.ts`), no dependency and no network. It restates the stored figures, groups
charges that do not count toward minimum spend under their own heading, and explains the
arithmetic in words: *"Qualifying fees of $1,430.00 exceed the period minimum of $900.00 by
$530.00, so actual fees control."*

---

## Architecture

```
src/
  domain/              pure TypeScript — no React, no I/O, no storage
    schema.ts            Zod schemas + inferred types (one definition serves all three uses)
    billing.ts           the month calculation
    policy.ts            decisions the contract leaves open
    flags.ts             runs both detection layers and merges them
    status.ts            the commercial lifecycle and its transition table
    invoice.ts           invoice generation, numbering, payment
    invoice-pdf.ts       the invoice document
    pdf.ts               a very small PDF writer
    fields.ts            config → labelled display groups
    resolve.ts           recording decisions, with audit trail
    rules/               18 deterministic detectors, grouped by category
  data/                repository, invoice store, seeding, local settings
  import/              batch queue, file validation, document picker
  components/
    ui/                  design system: text, layout, chip, nav, segmented
    charts/              spend-schedule, pool-meter
    contract/            the five detail panes, invoice dialog, field grid
  hooks/               theme/appearance, breakpoints, contract loading
  fixtures/            the two public mock contracts
  app/
    (tabs)/              Home · Upload · Contracts · Invoices · Settings
    contract/[id].tsx    detail, five panes behind a segmented control
    api/parse+api.ts     server-side extraction (holds the API key)
```

`src/domain/` is deliberately free of React and I/O. That is what makes the contract maths
assertable to the cent in milliseconds, with no renderer and no network.

### Billing policy

Where a contract is silent, someone must choose. Nine choices, explicit per contract, each linked
to the finding that raises it:

Actual Spend definition · SMS toward minimum · Test Mode pool contribution · Test Mode SMS
billing · mid-month proration · SIM-count basis · overage rounding · pool rollover ·
overlapping-band resolution

`BillingPolicy.setBy` separates a default from a decision. A field still marked `default` keeps
its finding open. A silent default is how a guess reaches an invoice.

### Appearance

Three states, not two: **System** follows the device, **Light** and **Dark** override it. A plain
toggle cannot say "match my device", which is what an OS night-mode schedule drives. There is a
toggle in the nav bar and the full control in Settings.

Colours are measured, not picked — CIEDE2000 with Viénot–Brettel–Mollon dichromat simulation
across normal, protan, deutan and tritan vision. Run `node tools/validate-palette.mjs`.
Severity is **never** encoded by colour alone: `warning` vs `danger` collapses to ΔE 3.9 under
protanopia, which is why every status carries a text label.

---

## Adding a rule

```ts
// src/domain/rules/charges.ts
export const myRule: FlagRule = {
  id: 'my_rule',
  category: 'charges',
  describes: 'One line on the defect class.',
  detect(ctx) {
    if (!somethingWrong(ctx.config)) return [];
    return [{ ruleId: 'my_rule', severity: 'blocking', /* … */ }];
  },
};
```

Export it and add it to `ALL_RULES` in `src/domain/rules/index.ts`. Nothing else changes.

Severity convention: **blocking** if it changes an invoice amount, **non-blocking** otherwise.

> A rule must be *satisfiable*. If it fires on an absence, the schema needs a field that can
> represent the contract addressing it — otherwise the rule fires on every contract forever and
> is a constant, not a check. `simCountBasis`, `prorationOnActivation` and
> `testMode.poolContribution` exist for exactly this reason.

---

## Testing

```bash
npm run verify     # typecheck + lint + tests
```

**155 tests, all in `src/domain/`.** The ones that carry weight:

- **Both worked months to the cent** — 150 SIMs / 2,400 MB → `$1,039.50` (actual fees control);
  20 SIMs / 100 MB → `$300.00` (the minimum controls).
- **Term totals, not just single months** — 40 SIMs over months 1–6 at 500 MB/month totals
  `$1,416.60`; the same six months at 80 SIMs totals `$1,483.20`, because the larger pool absorbs
  the usage. A total that never moves when the fleet changes is the failure these catch.
- **The pooled-data trap** — one SIM over its own allowance creates no overage while the pool has
  room; the pool scales with the fleet.
- **Month 12 refuses to compute** while its bands overlap, then computes once a decision is
  recorded.
- **Detection under mutation** — defects are *injected* into the reference contract (a band gap,
  an unpriced add-on, a foreign escalation curve) and must be caught. Recognising one contract
  proves nothing.
- **A clean contract produces zero findings** — otherwise every finding on the defective one is
  suspect.
- **Invoices agree with the engine**, refuse the months it refuses, and keep billing month after
  month once a contract is released.
- **PDF cross-reference offsets** — every xref entry must point at the object it claims, or the
  file opens blank rather than obviously broken.

To verify the UI, drive the running app with Playwright (`channel: 'chrome'` — the bundled
chromium is not installed) rather than trusting a typecheck.

---

## Troubleshooting

**Upload fails with "Gemini returned an error during extraction"**
The server runtime kills every outbound `fetch` from an API route at **30 seconds**, and
extraction takes longer. `/api/parse` therefore calls the REST API over `node:https`, which is
not capped. If you refactor that back to `fetch` or an SDK that uses it, this returns.

**503 `not_configured`**
`GEMINI_API_KEY` is not set, or the dev server was started before `.env` existed. Set it and
restart.

**504 `upstream_timeout`**
The contract is long or the model is slow. Timeouts are deliberately **not retried** — the
timed-out request was still billed, and retrying three times triples the cost for a call that
will probably time out again. Press Retry, or set `GEMINI_MODEL` to a faster model.

**502 "model is not available to this key"**
Set `GEMINI_MODEL` to one your key can reach (see [Configuration](#configuration)).

**Only one sample contract appears**
Seeding runs only on an empty library. Press **Settings → Load sample contracts** again.

**A blank page after an edit**
`<Link asChild>` rejects style arrays — wrap in `StyleSheet.flatten`. It throws at runtime while
typecheck and tests both pass.

---

## Security

- **The client holds no credential at all.** `GEMINI_API_KEY` is read from `process.env` inside
  the route and never appears in a response, an error message, or the bundle. Verified by
  building the web export and grepping every client asset.
- **Never prefix a secret with `EXPO_PUBLIC_`.** That inlines the value into the client bundle at
  build time. It is the one mistake that undoes all of the above, and it looks harmless in a diff.
- **`.env` is gitignored** and must stay that way. `.env.example` holds placeholders only.
- **Never commit real customer contracts.** Only the public mocks ship. `fixtures/private/` and
  `*.private.json` are gitignored.
- **PDFs are not retained.** Local storage is a ~5 MB quota; base64 contracts would exhaust it
  after two. Records keep the content hash, filename and page count.

---

## Known limits

- **Storage is per-browser.** Contracts and invoices live in local storage. Settings → Export
  copies the whole library — contracts *and* invoices — as JSON.
- **The rate limiter is in-memory.** Single-instance only; it resets on redeploy and does not
  coordinate across replicas. Anything multi-instance needs a shared store.
- **`/api/parse` has no user authentication.** See the warning in
  [Configuration](#configuration).
- **Extraction quality is not guaranteed.** A clean contract can still produce findings if the
  model was unsure — which is the review layer working, but it means "zero findings" is not a
  promise. The deterministic rules are the part that is guaranteed.
