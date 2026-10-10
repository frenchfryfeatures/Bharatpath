import { baseApi } from "@/store/api/base-api";

export type PaymentStatus = {
  id: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED";
  purpose: string;
  item_code: string;
  amount_minor: number;
  currency: string;
  failure_code: string | null;
  created_at: string;
  settled_at: string | null;
};

export const paymentApi = baseApi.injectEndpoints({
  endpoints: (builder) => ({
    simulatePayment: builder.mutation<
      PaymentStatus,
      { paymentId: string; outcome?: "SUCCEEDED" | "FAILED" }
    >({
      query: ({ paymentId, outcome = "SUCCEEDED" }) => ({
        url: `/billing/dev/payments/${paymentId}/simulate`,
        method: "POST",
        body: { outcome },
      }),
      invalidatesTags: ["Billing"],
    }),
  }),
  // This shared endpoint can be re-evaluated during Next.js Fast Refresh.
  // Replacing its identical registration avoids a stale development overlay.
  overrideExisting: true,
});

export const { useSimulatePaymentMutation } = paymentApi;

/**
 * A 100% discount code takes a checkout to zero. There is no gateway to send
 * the payer to, so the backend settles it on the spot: no `redirect_url`, and
 * `status` is already SUCCEEDED.
 */
export function isCompleteWithoutPayment(result: {
  status: string;
  redirect_url?: string | null;
  redirectUrl?: string | null;
}): boolean {
  return result.status === "SUCCEEDED" && !(result.redirect_url ?? result.redirectUrl);
}

export function isStubPaymentUrl(url: string | null): boolean {
  if (!url) return false;

  try {
    return new URL(url).hostname === "stub-payments.invalid";
  } catch {
    return false;
  }
}
