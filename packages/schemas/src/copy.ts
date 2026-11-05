/**
 * User-facing copy shared by the API timeline and the web UI (invariant 11).
 * Copy describes signals and money states, never people.
 */
export const COPY = {
  confirmingWithPayPal: "Confirming with PayPal…",
  fundsReserved: "Funds reserved",
  fundsReleased: "Funds released",
  fundsReturned: "Funds returned",
  fundsReturnedRefunded: "Funds returned (refunded)",
  reservationExpired: "Reservation expired",
  settlementNeedsAttention: "Settlement needs attention",
  paypalConfirmed: "PayPal confirmed",
} as const;
