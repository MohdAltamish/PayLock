import { z } from "zod";

/**
 * Zod shapes for the PayPal response fields Paylock relies on (BUILD_PLAN 3.4).
 * Unknown fields pass through untouched; the raw body is kept separately.
 * Field names and enums checked against paypal/paypal-rest-api-specifications.
 */

const Amount = z.looseObject({ currency_code: z.string(), value: z.string() });
const PayoutAmount = z.looseObject({ currency: z.string(), value: z.string() });
const Link = z.looseObject({ href: z.string(), rel: z.string(), method: z.string().optional() });

export const OrderStatus = z.enum([
  "CREATED",
  "SAVED",
  "APPROVED",
  "VOIDED",
  "COMPLETED",
  "PAYER_ACTION_REQUIRED",
]);
export const AuthorizationStatus = z.enum([
  "CREATED",
  "CAPTURED",
  "DENIED",
  "PARTIALLY_CAPTURED",
  "VOIDED",
  "PENDING",
]);
export const CaptureStatus = z.enum([
  "COMPLETED",
  "DECLINED",
  "PARTIALLY_REFUNDED",
  "PENDING",
  "REFUNDED",
  "FAILED",
]);
export const RefundStatus = z.enum(["CANCELLED", "FAILED", "PENDING", "COMPLETED"]);
export const PayoutBatchStatus = z.enum(["DENIED", "PENDING", "PROCESSING", "SUCCESS", "CANCELED"]);
export const PayoutItemStatus = z.enum([
  "SUCCESS",
  "FAILED",
  "PENDING",
  "UNCLAIMED",
  "RETURNED",
  "ONHOLD",
  "BLOCKED",
  "REFUNDED",
  "REVERSED",
]);

export const Authorization = z.looseObject({
  id: z.string(),
  status: AuthorizationStatus,
  status_details: z.looseObject({ reason: z.string().optional() }).optional(),
  amount: Amount.optional(),
  custom_id: z.string().optional(),
  create_time: z.string().optional(),
  expiration_time: z.string().optional(),
  update_time: z.string().optional(),
});
export type Authorization = z.infer<typeof Authorization>;

export const Capture = z.looseObject({
  id: z.string(),
  status: CaptureStatus,
  status_details: z.looseObject({ reason: z.string().optional() }).optional(),
  amount: Amount.optional(),
  final_capture: z.boolean().optional(),
  seller_receivable_breakdown: z
    .looseObject({
      gross_amount: Amount.optional(),
      paypal_fee: Amount.optional(),
      net_amount: Amount.optional(),
    })
    .optional(),
  create_time: z.string().optional(),
});
export type Capture = z.infer<typeof Capture>;

export const Refund = z.looseObject({
  id: z.string(),
  status: RefundStatus,
  amount: Amount.optional(),
});
export type Refund = z.infer<typeof Refund>;

export const Order = z.looseObject({
  id: z.string(),
  status: OrderStatus,
  intent: z.string().optional(),
  links: z.array(Link).optional(),
  payment_source: z
    .looseObject({
      paypal: z
        .looseObject({
          account_status: z.enum(["VERIFIED", "UNVERIFIED"]).optional(),
          email_address: z.string().optional(),
        })
        .optional(),
      card: z.looseObject({}).optional(),
    })
    .optional(),
  purchase_units: z
    .array(
      z.looseObject({
        custom_id: z.string().optional(),
        amount: Amount.optional(),
        payee: z
          .looseObject({ email_address: z.string().optional(), merchant_id: z.string().optional() })
          .optional(),
        payments: z
          .looseObject({
            authorizations: z.array(Authorization).optional(),
            captures: z.array(Capture).optional(),
          })
          .optional(),
      }),
    )
    .optional(),
});
export type Order = z.infer<typeof Order>;

export const PayoutItem = z.looseObject({
  payout_item_id: z.string(),
  transaction_id: z.string().optional(),
  transaction_status: PayoutItemStatus.optional(),
  payout_item: z
    .looseObject({ sender_item_id: z.string().optional(), amount: PayoutAmount.optional() })
    .optional(),
  errors: z.looseObject({ name: z.string().optional(), message: z.string().optional() }).optional(),
});

export const PayoutBatch = z.looseObject({
  batch_header: z.looseObject({
    payout_batch_id: z.string(),
    batch_status: PayoutBatchStatus,
    sender_batch_header: z.looseObject({ sender_batch_id: z.string().optional() }).optional(),
  }),
  items: z.array(PayoutItem).optional(),
  links: z.array(Link).optional(),
});
export type PayoutBatch = z.infer<typeof PayoutBatch>;

export const Balances = z.looseObject({
  balances: z
    .array(
      z.looseObject({
        currency: z.string(),
        primary: z.boolean().optional(),
        available_balance: z
          .looseObject({ currency_code: z.string(), value: z.string() })
          .optional(),
        total_balance: z.looseObject({ currency_code: z.string(), value: z.string() }).optional(),
      }),
    )
    .default([]),
});
