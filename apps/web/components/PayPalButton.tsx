"use client";

import { createElement, useEffect, useRef, useState } from "react";
import { api, post } from "@/lib/api";

/**
 * Buyer approval with the PayPal JS SDK v6 (UI_UX "Create deal wizard" step 3).
 * - async load of https://www.sandbox.paypal.com/web-sdk/v6/core (never v5 sdk/js)
 * - createInstance({ clientId, components: ["paypal-payments"] }) with the
 *   clientId from GET /api/config/paypal (decision K)
 * - findEligibleMethods() before rendering <paypal-button>
 * - session.start({ presentationMode: "auto" }, fundDeal()) with the invoked
 *   Promise (the toolkit notes the runtime rejects a function reference)
 * - onApprove posts to /api/deals/:id/authorize; the server ignores the order
 *   id it receives and uses the stored one.
 */
const SDK_URL = "https://www.sandbox.paypal.com/web-sdk/v6/core";

interface PayPalSdk {
  createInstance(o: { clientId: string; components: string[]; pageType?: string }): Promise<{
    findEligibleMethods(o: {
      currencyCode: string;
      amount?: string;
    }): Promise<{ isEligible(m: string): boolean }>;
    createPayPalOneTimePaymentSession(o: {
      onApprove: (data: { orderId: string }) => Promise<void>;
      onCancel: () => void;
      onError: (e: { code?: string; message?: string }) => void;
    }): {
      start(opts: { presentationMode: string }, order: Promise<{ orderId: string }>): Promise<void>;
    };
  }>;
}
declare global {
  interface Window {
    paypal?: PayPalSdk;
  }
}

let sdkPromise: Promise<PayPalSdk> | undefined;
function loadSdk(): Promise<PayPalSdk> {
  sdkPromise ??= new Promise((resolve, reject) => {
    if (window.paypal) return resolve(window.paypal);
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.async = true;
    s.onload = () =>
      window.paypal ? resolve(window.paypal) : reject(new Error("PayPal SDK did not load"));
    s.onerror = () => reject(new Error("PayPal SDK could not be loaded"));
    document.head.appendChild(s);
  });
  return sdkPromise;
}

export function PayPalButton({
  dealId,
  amount,
  onDone,
  onMessage,
}: {
  dealId: string;
  amount: string;
  onDone: () => void;
  onMessage: (m: string) => void;
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "ineligible" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    (async () => {
      try {
        const { clientId } = await api<{ clientId: string }>("/config/paypal");
        const sdk = await loadSdk();
        const instance = await sdk.createInstance({
          clientId,
          components: ["paypal-payments"],
          pageType: "checkout",
        });
        const methods = await instance.findEligibleMethods({ currencyCode: "USD", amount });
        if (cancelled) return;
        if (!methods.isEligible("paypal")) return setStatus("ineligible");
        const session = instance.createPayPalOneTimePaymentSession({
          onApprove: async () => {
            try {
              // Sent for logging only; /authorize uses the stored order.
              await post(`/deals/${dealId}/authorize`, {});
              onDone();
            } catch (e) {
              onMessage((e as Error).message);
              onDone();
            }
          },
          onCancel: () => onMessage("Approval not completed. Funds were not reserved."),
          onError: (e) =>
            onMessage(`PayPal error${e.code ? ` (${e.code})` : ""}. Funds were not reserved.`),
        });
        const fundDeal = async () => {
          const r = await post<{ orderId: string }>(`/deals/${dealId}/fund`);
          return { orderId: r.orderId };
        };
        const onClick = () => {
          session
            .start({ presentationMode: "auto" }, fundDeal())
            .catch((e: Error) => onMessage(e.message));
        };
        ref.current?.addEventListener("click", onClick);
        cleanup = () => ref.current?.removeEventListener("click", onClick);
        setStatus("ready");
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          onMessage((e as Error).message);
        }
      }
    })();
    return () => {
      cancelled = true;
      cleanup();
    };
  }, [dealId, amount, onDone, onMessage]);

  return (
    <div aria-label="Reserve funds with PayPal" role="group" className="paypal-box">
      {status === "loading" && <p className="muted">Loading PayPal…</p>}
      {status === "ineligible" && (
        <p className="muted">PayPal is not available for this payment.</p>
      )}
      {createElement("paypal-button", {
        ref,
        type: "pay",
        hidden: status !== "ready",
        "data-testid": "paypal-button",
      })}
    </div>
  );
}
