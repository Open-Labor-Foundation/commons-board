/**
 * Calendar connector — creates events via Google Calendar API v3.
 * Reads credentials from env vars — never stores keys in code.
 *
 * Required env vars:
 *   GOOGLE_CALENDAR_ID     — target calendar ID (e.g., primary or team@group.calendar.google.com)
 *   GOOGLE_SERVICE_ACCOUNT_JSON — JSON key file contents for a service account
 *                                 with calendar.events scope
 *
 * The service account JSON is parsed for client_email and private_key to
 * mint a self-signed JWT (RS256) and exchange it for an access token.
 */

import { createSign } from "node:crypto";

export type CalendarEventResult = {
  id: string;
  htmlLink: string;
  hangoutLink?: string;
  status: string;
};

export type CalendarAttendee = {
  email: string;
  displayName?: string;
  optional?: boolean;
};

type ServiceAccountKey = {
  client_email: string;
  private_key: string;
  token_uri: string;
};

function parseServiceAccount(): ServiceAccountKey {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON env var is not set");

  try {
    const parsed = JSON.parse(raw) as ServiceAccountKey;
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error("missing client_email or private_key");
    }
    return parsed;
  } catch (err) {
    throw new Error(
      `GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64url");
}

async function getGoogleAccessToken(scope: string): Promise<string> {
  const sa = parseServiceAccount();
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope,
    aud: sa.token_uri,
    iat: now,
    exp: now + 3600
  };

  const unsigned = `${base64UrlEncode(JSON.stringify(header))}.${base64UrlEncode(JSON.stringify(payload))}`;
  const sign = createSign("RSA-SHA256");
  sign.update(unsigned);
  const signature = sign.sign(sa.private_key);

  const jwt = `${unsigned}.${base64UrlEncode(signature)}`;

  const res = await fetch(sa.token_uri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });

  const data = (await res.json()) as { access_token?: string; error?: string };
  if (!res.ok || !data.access_token) {
    throw new Error(`Google token error: ${data.error ?? res.statusText}`);
  }

  return data.access_token;
}

export async function calendarCreateEvent(opts: {
  summary: string;
  description?: string;
  start: string; // ISO 8601
  end: string;   // ISO 8601
  attendees?: CalendarAttendee[];
  location?: string;
  conferenceData?: boolean;
  reminders?: { minutes: number; method: string }[];
  calendarId?: string;
}): Promise<CalendarEventResult> {
  const calendarId = opts.calendarId ?? process.env.GOOGLE_CALENDAR_ID;
  if (!calendarId) throw new Error("calendarId is required (or set GOOGLE_CALENDAR_ID)");

  const token = await getGoogleAccessToken("https://www.googleapis.com/auth/calendar.events");

  const body: Record<string, unknown> = {
    summary: opts.summary,
    start: { dateTime: opts.start },
    end: { dateTime: opts.end }
  };

  if (opts.description) body.description = opts.description;
  if (opts.location) body.location = opts.location;

  if (opts.attendees && opts.attendees.length > 0) {
    body.attendees = opts.attendees.map((a) => ({
      email: a.email,
      ...(a.displayName ? { displayName: a.displayName } : {}),
      ...(a.optional !== undefined ? { optional: a.optional } : {})
    }));
  }

  if (opts.conferenceData) {
    body.conferenceData = {
      createRequest: { requestId: `${Date.now()}-${Math.random().toString(36).slice(2)}` }
    };
  }

  if (opts.reminders && opts.reminders.length > 0) {
    body.reminders = {
      useDefault: false,
      overrides: opts.reminders.map((r) => ({ minutes: r.minutes, method: r.method }))
    };
  }

  const params = new URLSearchParams();
  if (opts.conferenceData) params.set("conferenceDataVersion", "1");
  const qs = params.toString();

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events${qs ? `?${qs}` : ""}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    }
  );

  const data = (await res.json()) as {
    id?: string;
    htmlLink?: string;
    hangoutLink?: string;
    status?: string;
    error?: { message?: string };
  };

  if (!res.ok || data.error) {
    throw new Error(`Google Calendar API error: ${data.error?.message ?? res.statusText}`);
  }

  return {
    id: data.id ?? "",
    htmlLink: data.htmlLink ?? "",
    hangoutLink: data.hangoutLink,
    status: data.status ?? "confirmed"
  };
}