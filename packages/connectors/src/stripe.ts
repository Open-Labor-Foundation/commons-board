/**
 * Stripe connector — direct REST API, no SDK dependency.
 * Reads credentials from env vars — never stores keys in code.
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY — Stripe secret key (sk_live_* or sk_test_*)
 */

async function stripeFetch<T>(path: string, body?: Record<string, string>): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY env var is not set");

  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body ? new URLSearchParams(body).toString() : undefined
  });

  const data = (await res.json()) as { error?: { message: string } } & Record<string, unknown>;
  if (!res.ok || data.error) {
    throw new Error(`Stripe API error: ${data.error?.message ?? res.statusText}`);
  }
  return data as T;
}

export type StripeProduct = { id: string; name: string; active: boolean };
export type StripePrice = { id: string; product: string; unit_amount: number; currency: string; type: string };
export type StripeSession = { id: string; url: string };

export async function stripeCreateProduct(name: string, description?: string): Promise<StripeProduct> {
  return stripeFetch<StripeProduct>("/products", {
    name,
    ...(description ? { description } : {})
  });
}

export async function stripeCreatePrice(opts: {
  productId: string;
  unitAmount: number;
  currency: string;
  recurring?: { interval: "month" | "year" };
}): Promise<StripePrice> {
  const params: Record<string, string> = {
    product: opts.productId,
    unit_amount: String(opts.unitAmount),
    currency: opts.currency.toLowerCase()
  };
  if (opts.recurring) {
    params["recurring[interval]"] = opts.recurring.interval;
  }
  return stripeFetch<StripePrice>("/prices", params);
}

export async function stripeCreateCheckoutSession(opts: {
  priceId: string;
  successUrl: string;
  cancelUrl: string;
  mode?: "payment" | "subscription";
  quantity?: number;
}): Promise<StripeSession> {
  return stripeFetch<StripeSession>("/checkout/sessions", {
    "line_items[0][price]": opts.priceId,
    "line_items[0][quantity]": String(opts.quantity ?? 1),
    mode: opts.mode ?? "payment",
    success_url: opts.successUrl,
    cancel_url: opts.cancelUrl
  });
}
