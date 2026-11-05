# Paylock: UI/UX Specification

## Design principles

1. **The money state is always visible.** Every screen shows where the funds are: Reserved, Locked, Released, Returned.
2. **Explain, don't just warn.** Risk and verification results always show reasons and evidence.
3. **Confidence through calm.** Trust products should feel steady: generous whitespace, few colors, no gimmicks.
4. **One primary action per screen.**
5. **Accessible by default.** WCAG 2.1 AA, keyboard-first, screen reader labels on all state badges.

## Design system

- **Typography**: Inter; 16px base; headings 600 weight.
- **Colors**:
  - Navy `#0B1F3A` primary, text
  - Slate `#5B6B7F` secondary text
  - Green `#1F9D55` Released / Pass
  - Amber `#D98E04` Medium risk / Partial / Awaiting
  - Red `#C62828` High risk / Fail / Voided
  - Blue `#1565C0` Locked / info
  - Surface `#F7F9FC`, card `#FFFFFF`, border `#E3E8EF`
- **Components**: shadcn/ui on Tailwind. Badges, Cards, Timeline, Stepper, Dialog, Toast, DataTable.
- **Icons**: Lucide. Lock, ShieldAlert, CheckCircle2, XCircle, Clock.
- **Motion**: 150-200ms ease-out; state badge pulses once on change.

## Information architecture

```
/                       Landing: value prop, "Create a deal", "How it works"
/deals                  Deal list (buyer and seller tabs)
/deals/new              Create wizard (3 steps)
/deals/[id]             Deal detail with timeline (primary screen)
/settings/policy        Spend policy and approval thresholds
/trust/[userId]         Public trust summary (non-sensitive)
```

## Screens

### Landing
- Hero: "AI escrow that pays on proof."
- Three-step strip: Lock, Verify, Release.
- Live demo button pre-fills a sample deal.

### Create deal wizard
**Step 1: Describe**: textarea "What do you need done?", seller selector (email or agent id), budget and currency. Example chips.
**Step 2: Contract**: Negotiator output rendered as editable criteria list with weights; ambiguities shown as yellow callouts; deadline picker; partial-pay minimum slider.
**Step 3: Guard and fund**:
- Risk banner (see below).
- Summary card: amount, seller, criteria count.
- Primary CTA depends on risk: LOW "Lock funds with PayPal"; MEDIUM "Review and approve"; HIGH "Do not fund" (primary, cancels) with secondary "Override anyway" requiring reason.
- The PayPal button renders only after approval (or for LOW risk), using **JS SDK v6**: load `https://www.sandbox.paypal.com/web-sdk/v6/core` with `async`, `createInstance({ clientId, components: ["paypal-payments"] })` with the `clientId` from `/api/config/paypal`, check `findEligibleMethods()`, render a `<paypal-button>` web component, and on click call `session.start({ presentationMode: "auto" }, fundDeal())` with the invoked Promise. `onApprove` sends `data.orderId` to `/api/deals/:id/authorize` (the server ignores it and uses the stored order). `onCancel` and `onError` show toasts. Never load v5 (`sdk/js`) on the same page.

### Risk banner (component)
- Left: shield icon colored by level. Title: "Risk: Low / Medium / High".
- Body: Guardian `summary`.
- Expandable "See signals": list of signals with evidence and source tag (Rule / AI).
- Footer: recommended action, "Report this account" link.
- aria-live="polite"; role="status" for LOW, role="alert" for HIGH.

### Deal detail
- Header: title, amount, money-state badge, parties.
- Left column (2/3): **Timeline** of DealEvents, newest at bottom, auto-scroll on update. Each item: icon, actor chip (You / Seller / Paylock AI / PayPal), title, timestamp, expandable payload (decision details, PayPal ids).
- Right column (1/3): Contract card with criteria and status ticks; Risk card; Payment card (order id, auth id, capture id, payout batch, deep links to sandbox dashboard).
- Seller view: "Submit deliverable" card (URL / text / file / repo) when LOCKED.
- Buyer view: "Review decision" card when NEEDS_REVIEW with Approve release / Reject buttons.

### Decision panel (component)
- Outcome badge, score ring.
- Table: criterion, met tick, confidence bar, evidence excerpt.
- Reasoning paragraph.
- Override button (buyer) opens dialog with reason field.

### Spend policy settings
- Max per deal, daily cap, approval threshold, allow medium risk toggle.
- Preview sentence: "Your agent can fund deals up to $200 automatically when risk is Low; anything above or Medium risk needs your tap."

## States and empty states
- Deal list empty: illustration plus "Create your first deal".
- Agent working: skeleton plus "Paylock AI is reviewing..." with elapsed time.
- PayPal popup closed: toast "Approval not completed. Funds were not reserved."
- Money states follow PayPal's synchronous response (ADR-009): "Funds reserved" after a successful authorization, "Funds returned" after a void. A payout shows "Confirming with PayPal..." with a spinner until the payout batch or webhook confirms; never show "released" before that. Webhook confirmations appear later on the timeline as "PayPal confirmed".
- Authorization declined: "PayPal declined the payment method. Funds were not reserved." plus PayPal's reason.
- Reservation expired: badge "Returned"; timeline item "Reservation expired".
- Settlement error: red alert card "PayPal could not complete this step" with the failed step, PayPal's error name, and a "Retry" button (buyer).

## Copy guidelines
- Say "risk signals", never "scammer".
- Say "funds reserved" for authorization, "released" for capture plus payout, "returned" for void.
- Active voice, under 15 words per line in banners.

## Accessibility checklist
- All interactive elements focusable, visible focus ring.
- Color never the only indicator: badges include text and icon.
- Contrast >= 4.5:1 for text.
- Timeline updates announced via aria-live region.
- PayPal button container labelled ("Reserve funds with PayPal").

## Demo mode
`?demo=1` enables persona picker (Honest Seller, Fresh Account Scammer, Off-Platform Pusher, Bad Deliverable) and speeds up agent steps with cached fixtures if LLM latency exceeds 10s.

