/**
 * Slack connector — posts messages to channels via Slack Web API.
 * Reads credentials from env vars — never stores keys in code.
 *
 * Required env vars:
 *   SLACK_BOT_TOKEN  — Slack bot token (xoxb-*)
 *
 * Optional:
 *   SLACK_DEFAULT_CHANNEL  — fallback channel when none specified in opts
 */

export type SlackMessageResult = {
  ok: boolean;
  channel: string;
  ts: string;
  messageTs?: string;
};

export type SlackAttachment = {
  fallback?: string;
  color?: string;
  pretext?: string;
  text: string;
  fields?: Array<{ title: string; value: string; short?: boolean }>;
};

export async function slackPostMessage(opts: {
  channel?: string;
  text: string;
  blocks?: unknown[];
  attachments?: SlackAttachment[];
  threadTs?: string;
  unfurlLinks?: boolean;
}): Promise<SlackMessageResult> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN env var is not set");

  const channel = opts.channel ?? process.env.SLACK_DEFAULT_CHANNEL;
  if (!channel) throw new Error("channel is required (or set SLACK_DEFAULT_CHANNEL)");

  const body: Record<string, unknown> = {
    channel,
    text: opts.text
  };
  if (opts.blocks) body.blocks = opts.blocks;
  if (opts.attachments) body.attachments = opts.attachments;
  if (opts.threadTs) body.thread_ts = opts.threadTs;
  if (opts.unfurlLinks !== undefined) body.unfurl_links = opts.unfurlLinks;

  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const data = (await res.json()) as {
    ok: boolean;
    error?: string;
    channel?: string;
    ts?: string;
    message?: { ts?: string };
  };

  if (!res.ok || !data.ok) {
    throw new Error(`Slack API error: ${data.error ?? res.statusText}`);
  }

  return {
    ok: true,
    channel: data.channel ?? channel,
    ts: data.ts ?? "",
    messageTs: data.message?.ts
  };
}

export type SlackChannelInfo = {
  id: string;
  name: string;
  is_channel: boolean;
  num_members?: number;
};

export async function slackListChannels(opts?: {
  types?: string;
  limit?: number;
}): Promise<SlackChannelInfo[]> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN env var is not set");

  const params = new URLSearchParams({
    types: opts?.types ?? "public_channel,private_channel",
    limit: String(opts?.limit ?? 200)
  });

  const res = await fetch(`https://slack.com/api/conversations.list?${params}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` }
  });

  const data = (await res.json()) as {
    ok: boolean;
    error?: string;
    channels?: Array<{
      id: string;
      name: string;
      is_channel: boolean;
      num_members?: number;
    }>;
  };

  if (!res.ok || !data.ok) {
    throw new Error(`Slack API error: ${data.error ?? res.statusText}`);
  }

  return (data.channels ?? []).map((c) => ({
    id: c.id,
    name: c.name,
    is_channel: c.is_channel,
    num_members: c.num_members
  }));
}