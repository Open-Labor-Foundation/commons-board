type AlertPayload = {
  kind: string;
  severity: "info" | "warning" | "critical";
  message: string;
  workspaceId?: string;
  correlationId?: string;
  details?: Record<string, unknown>;
  ts: string;
};

export async function sendOperationalAlert(input: Omit<AlertPayload, "ts">): Promise<void> {
  const webhook = process.env.ALERT_WEBHOOK_URL;
  const payload: AlertPayload = { ...input, ts: new Date().toISOString() };

  if (!webhook) return;

  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.warn(`alert webhook failed: ${res.status}`);
    }
  } catch (error) {
    console.warn(`alert webhook error: ${error instanceof Error ? error.message : String(error)}`);
  }
}
