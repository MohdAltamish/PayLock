# Paylock UI redesign plan (apps/web only)

**Branch:** `feat/ui-redesign` in the worktree `/Users/mohdaltamish/Desktop/Paylock-ui`. `main` stays untouched until E2E and axe pass, and nothing is merged or pushed without asking the user.

**Decisions:**

- **1=a:** Tailwind v4 with hand-built primitives and CSS-only motion.
- **2=a:** contract criteria are read-only rows with weight bars.
- **3=a:** add the forbidden-word test and pure-helper unit tests. The persona picker always shows, and `?demo=1` only adds a "Demo" badge.

## Status

| #   | Task                                                        | Status                   |
| --- | ----------------------------------------------------------- | ------------------------ |
| 1   | Worktree, baseline checks, before screenshots               | **Done** (`d1c409e`)     |
| 2   | Tokens, Tailwind, app shell                                 | Next                     |
| 3   | Core primitives                                             | Planned                  |
| 5   | Landing                                                     | Planned                  |
| 7   | Deal detail layout                                          | Planned                  |
| 8   | Timeline                                                    | Planned                  |
| 11  | Risk Banner, Guard & fund step, override and cancel dialogs | Planned                  |
| 12  | Decision Panel and review                                   | Planned                  |
| 9   | Stepper and the Describe step                               | Planned                  |
| 10  | Contract step                                               | Planned                  |
| 6   | Deal list                                                   | Planned                  |
| 13  | Policy page, light restyle                                  | Planned (minimal)        |
| 14  | One screenshot pass                                         | Planned (minimal)        |
| 15  | Final verification and report                               | Planned                  |

Order: 1, 2, 3, 5, 7, 8, 11, 12, then 9 and 10, then 6, then 13, 14 and 15. Task 4 (feedback) is reduced to the two dialogs, which are built inside Task 11.

## Hard rules

- **Scope:** only change `apps/web/**`, plus `package-lock.json` from installing packages. Do not touch the API, schemas, skills, prisma, scripts, render.yaml, .env or docs.
- **Proxy and PayPal:** no change to `next.config.mjs` behaviour (the `/api` rewrite, `compress:false`, the CSP). Do not edit `PayPalButton.tsx`; restyle only its wrapper and the `.paypal-box` class.
- **Copy:** keep `lib/copy.ts` and the `COPY` constants. Never use the forbidden word.
- **Money:** money is a Decimal string. No `parseFloat` or `Number()` on money. Money values use `tabular-nums`.
- **Money state timing:** money state changes only after an API response or SSE event.
- **Test ids:** keep every `data-testid` and aria role the specs use. `money-state` and `deal-state` each render exactly once per page. Expected renames: none.
- **Blockers:**
  - axe reports 0 serious/critical on every page
  - the happy, scam and fail E2E paths pass in stub mode
  - the preset fidelity check passes
  - lint and web typecheck pass
  - no new vitest failures
- **Target:** Lighthouse accessibility ≥ 95 on landing and deal detail.
- **After every task:** run Prettier, lint, typecheck, vitest and Playwright (stub mode), then make one small commit.

## Design contract (wins over the search output)

- **Layout:** content width at most 1120px. Spacing scale 4/8/12/16/24/32/48. Deal detail uses an 8/4 column grid. Below 768px: one column, tables become cards, and the CTA sticks to the bottom of the screen.
- **Type:** Inter via `next/font`. Base size 15px on desktop and 16px on mobile. Headings weight 600, labels 500, body 400.
- **Colour:**

  | Role                                     | Hex       |
  | ---------------------------------------- | --------- |
  | background                               | `#FAFBFC` |
  | surface                                  | `#FFFFFF` |
  | border                                   | `#E6EAF0` |
  | text                                     | `#0F172A` |
  | muted text                               | `#64748B` |
  | accent (primary actions and Locked only) | `#2563EB` |

  Each status tone has a solid colour for icons, fills and borders, and a darker colour for text:

  | Tone    | Solid     | Text      |
  | ------- | --------- | --------- |
  | success | `#16A34A` | `#15803D` |
  | warning | `#D97706` | `#B45309` |
  | danger  | `#DC2626` | `#B91C1C` |
  | accent  | `#2563EB` | `#1D4ED8` |

  Every badge shows a colour, a Lucide icon and a text label together.

- **Shape:** cards have a 10px radius, a 1px border and one soft shadow. Controls have an 8px radius. Hover shadows only on clickable things.
- **Focus:** a 2px accent ring with a 2px offset. `scroll-padding` keeps sticky bars from covering focused controls.
- **Targets:** at least 24px on desktop and 44px on mobile, with 8px gaps.
- **Motion:**
  - 150ms for colour changes and 200ms for transforms, ease-out.
  - Animate only `transform` and `opacity`.
  - Exits run shorter than enters.
  - Timeline items stagger by 40ms.
  - Respect reduced motion.
- **Icons:** Lucide only. No emoji.
- **Forms:** every field has a visible label. Validate when the user leaves a field. Errors appear below the field via `aria-describedby`. Skeletons appear only after 200ms. Long IDs wrap.

## Tasks

### Task 2: Tokens, Tailwind and the app shell

- Install `tailwindcss` and `@tailwindcss/postcss` as dev dependencies and `lucide-react` as a runtime dependency. Add `postcss.config.mjs`.
- In `globals.css`, `@theme` holds the primitive, semantic and component tokens. The base layer sets the focus ring, the skip link, `scroll-padding`, the reduced-motion reset and the root font size.
- Load Inter in `layout.tsx`. Add a small `lib/cn.ts` helper.
- `Shell` gets:
  - a sticky nav with the Lock logo mark
  - `aria-current` on the current link
  - "Switch user" set apart from the other links
  - a quiet footer
  - the `?demo=1` badge, remembered in `sessionStorage`
- `signed-in-as` stays exactly the display name.

### Task 3: Core primitives

- New components in `components/primitives/`:
  - `Button`: primary, secondary, destructive and ghost variants; sm and md sizes; a `loading` prop that shows a spinner, sets `aria-busy` and disables the button. Plus `ButtonLink`.
  - `Badge`, `Card`.
  - `Field`: wraps Input, Select and Textarea with a label, hint, error, `aria-describedby` and `aria-invalid`.
  - `Spinner`, `Skeleton`.
  - `Alert`: `ErrorNote` stays as a wrapper around it.
- `lib/tone.ts` maps every money state and deal state to a tone and an icon. `MoneyBadge` and `StateBadge` are rebuilt on `Badge`, keeping their ids, role and text.
- Swap the primitives into every page. Layouts don't change yet.
- Test: `src/tone.test.ts`.

### Task 5: Landing

- The heading reads "AI escrow that pays on proof." with the existing subtitle.
- Lock, Verify and Release form one connected strip (Lock, ScanSearch and BadgeCheck icons).
- One primary CTA scrolls to the persona picker. A quiet secondary link, "See a demo deal".
- The persona picker card keeps the `login-*` ids. An error alert appears if the API is unreachable.

### Task 7: Deal detail layout

- Split the page into `components/deal/`. The data flow (`load`, SSE plus the 2s poll, `act`) stays as it is.
- The sticky header holds the title, the parties, the amount, `StateBadge` and `MoneyBadge`. This is the only place the two badges render.
- Left column: the action cards, the decision, the settlement error, and the Timeline.
- Right column, sticky: Contract, Risk summary, Messages and Payment cards. Payment IDs wrap on small screens.
- A loading skeleton, and a styled wrapper around the PayPal button.

### Task 8: Timeline

- `lib/actors.ts` labels each event You, Buyer, Seller, Paylock AI, PayPal or Paylock.
- Each item shows an icon, an actor chip, the title, a time with a full-date tooltip, and a "Details" disclosure for PayPal IDs.
- New items fade and slide in, 40ms apart. Auto-scroll happens only when the user is near the bottom.
- Keep `aria-live` and `data-testid="timeline"`.
- Test: `src/actors.test.ts`.

### Task 11: Risk Banner, Guard & fund step and dialogs

- **Dialog primitive:** native `<dialog>`, labelled, closes with Esc, returns focus to its trigger. Used for exactly two dialogs:
  - the **Override** reason (FLAGGED, but not when the block reason is POLICY_CAP)
  - the **Cancel deal** confirmation
- `do-not-fund` stays a single click.
- **RiskBanner:**
  - a shield icon for each level
  - exact text "Risk: Low", "Risk: Medium" or "Risk: High", then the summary
  - "See risk signals (n)", with a Rule/AI tag, weight and evidence for each signal
  - the recommended action line
  - `role="alert"` for High, `role="status"` otherwise
- **Guard & fund step:**
  - a summary card with the amount, the seller and the number of criteria
  - CTA by level: Low shows "Lock funds with PayPal" plus `fund-test-card`; Medium shows "Review and approve"; High shows `do-not-fund` plus "Override anyway"
  - a sticky bottom CTA on mobile
- **Deferred:** the "Report this account" dialog.

### Task 12: Decision Panel and review

- Outcome badge with the text "PASS", "PARTIAL" or "FAIL" plus an icon.
- An SVG score ring with its percentage as visible text.
- A per-criterion table: a met icon plus "Yes" or "No", a confidence meter plus its percentage, and an evidence excerpt with "Show more".
- Then the reasoning paragraph. On mobile the table becomes cards.
- In NEEDS_REVIEW, an "Override decision" dialog requires a note, offers "Approve release" and "Reject and return funds", and keeps `review-card`.

### Task 9: Stepper and the Describe step

- `lib/wizard.ts` maps a deal state to step 1, 2 or 3, or none.
- A `Stepper` (`<ol>` with `aria-current="step"`) appears on `/deals/new` and on the deal page before funding.
- Example chips set `request` to `p.request` **exactly**.
- The request field validates when you leave it and shows a character count. `create-deal` sticks to the bottom on mobile.
- Test: `src/wizard.test.ts`.

### Task 10: Contract step

- In CONTRACTED, a "Review the contract" card shows the scope, read-only criteria rows (a "Checked by" tag and a weight meter), ambiguity callouts, the deadline and the partial-payment minimum.
- `run-guard` is the primary action, and "Cancel deal" uses the confirmation dialog. No sliders.

### Task 6: Deal list

- `lib/dealFilters.ts` provides the All, Active, Needs you and Closed groups. "Needs you" depends on whether you are the buyer or the seller.
- A radio-group segmented control shows a count for each filter and stores the choice in `?filter=`.
- The table shows title, counterparty, amount in tabular figures, a money-state badge (from `moneyState()`), state and created time. On mobile the rows become cards.
- Skeleton rows while loading, and an empty state for each filter. The list must not use the `money-state` or `deal-state` ids.
- Test: `src/dealFilters.test.ts`.

### Task 13 (minimal): Policy page

- A card form with `Field`s and a `$` prefix, and a styled medium-risk checkbox.
- The preview sentence moves into a callout. Save shows a loading state. The validation logic stays as it is.

### Task 14 (minimal): Screenshot pass

- `SCREENSHOTS=1 SCREENS_LABEL=after` at 375px and 1280px.
- Review against the contract, fix issues in one batch, then recapture once.

### Task 15: Final verification and report

- Run all blockers, plus replay-mode E2E if fixtures are available, plus Lighthouse on landing and deal detail.
- Run `git diff --stat main...feat/ui-redesign` (only `apps/web` and `package-lock.json`).
- **The report covers:**
  - before and after screenshots at 375 and 1280
  - renamed test ids
  - axe, E2E and Lighthouse results
  - conflicts between the search output and the contract
  - deferred items: toasts, the report dialog, badge-change animation, dark mode
  - the `docs/UI_UX.md` colour mismatch

## Notes so far

- **Already failing on `main`:** `apps/api/src/eval/demo-fixture-hash.test.ts` imports `hashDemoPath`, which `run.ts` doesn't export. This breaks the API typecheck and causes 4 vitest failures. It's outside scope and left as it is.
- **ui-ux-pro-max search:** it suggested a dark theme with a green accent and the Fira fonts, which the contract overrides. It also suggested Next.js Server Actions, which aren't adopted because the browser must talk only to `/api`. Its focus guidance (`scroll-padding` set to the header height, a 2px ring with a 2px offset) matches the contract.
- **Screenshots:** "before" screenshots are in `apps/web/.screens/before/` (gitignored). Capture with `SCREENSHOTS=1 SCREENS_LABEL=<label> npx playwright test e2e/screens.spec.ts`.
