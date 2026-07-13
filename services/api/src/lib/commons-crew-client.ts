/**
 * Registers a chair as a real commons-crew instance (pa.createChairRun,
 * exposed as POST /api/chairs) — the governance identity that gives a chair
 * an audit trail, autonomy tiers, and delegate_to_child capability. This is
 * independent of specialist resolution (see labor-commons-client.ts /
 * specialist-resolver.ts), which still picks which specialist to preview
 * for a chair; commons-crew is not guaranteed to be deployed alongside
 * every commons-board instance, so failures here must never block
 * onboarding.
 */

export type CommonsCrewChairRole =
  | "finance" | "legal" | "hr" | "marketing" | "operations" | "product" | "it" | "security";

export interface RegisterChairInput {
  orgContext: string;
  chairRole: CommonsCrewChairRole;
  surface: "cli" | "web";
  title: string;
}

export interface RegisteredChair {
  runId: string;
  sessionId: string;
}

export async function registerChair(input: RegisterChairInput): Promise<RegisteredChair | null> {
  const commonsCrewUrl = process.env.CB_COMMONS_CREW_URL;
  if (!commonsCrewUrl) return null;

  try {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const commonsCrewToken = process.env.CB_COMMONS_CREW_TOKEN;
    if (commonsCrewToken) headers.authorization = `Bearer ${commonsCrewToken}`;

    const resp = await fetch(`${commonsCrewUrl}/api/chairs`, {
      method: "POST",
      headers,
      body: JSON.stringify(input)
    });

    if (!resp.ok) {
      console.error(`[commons-crew-client] chair registration failed (${resp.status}) for ${input.chairRole}/${input.orgContext}`);
      return null;
    }

    const data = (await resp.json()) as { session?: { id?: string }; run?: { id?: string } };
    if (!data.run?.id || !data.session?.id) return null;

    return { runId: data.run.id, sessionId: data.session.id };
  } catch (err) {
    console.error(`[commons-crew-client] chair registration errored for ${input.chairRole}/${input.orgContext}:`, err instanceof Error ? err.message : err);
    return null;
  }
}
