/**
 * Specialist resolver — maps chair functions to labor-commons specialists.
 *
 * For each chair in an org's agent_blueprint, the resolver:
 *   1. Queries the labor-commons client with the chair's function description
 *   2. Scores candidates and selects primary + supporting specialists
 *   3. Records a gap when no adequate match is found
 *
 * Labor-commons specialist matching runs at onboarding and when an operator
 * explicitly triggers re-resolution. Phase 3 resolves from the local catalog;
 * Phase 5 will rewire chair reasoning to load operating context from the refs.
 */
import { randomUUID } from "node:crypto";
import type { SpecialistMatch, SpecialistQuery, SpecialistResolution } from "@commons-board/shared";
import { searchSpecialists, reportGap } from "../lib/labor-commons-client.js";

const GAP_SCORE_THRESHOLD = 15;
const PRIMARY_SCORE_THRESHOLD = 20;

export async function resolveChair(
  orgId: string,
  chairId: string,
  chairDomain: string,
  functionDescription: string,
  industry: string,
  requiredTasks: string[] = []
): Promise<SpecialistResolution> {
  const query: SpecialistQuery = {
    function_description: functionDescription,
    industry,
    domain_hint: chairDomain,
    required_tasks: requiredTasks
  };

  const matches = await searchSpecialists(query);

  if (matches.length === 0 || matches[0].match_score < GAP_SCORE_THRESHOLD) {
    const gapId = `gap-${randomUUID().slice(0, 8)}`;
    await reportGap({
      gap_id: gapId,
      org_id: orgId,
      function_description: functionDescription,
      domain_hint: chairDomain,
      submitted_to_labor_commons: false,
      created_at: new Date().toISOString(),
      resolved_at: null
    });
    return {
      chair_function: functionDescription,
      primary: null,
      supporting: [],
      unresolved_tasks: requiredTasks,
      catalog_gap: true
    };
  }

  const primary = matches[0];
  const supporting: SpecialistMatch[] = [];

  // Include supporting specialists if they cover tasks the primary misses
  const primaryGapTasks = primary.gap_tasks;
  if (primaryGapTasks.length > 0 && matches.length > 1) {
    for (const candidate of matches.slice(1, 4)) {
      if (candidate.match_score >= PRIMARY_SCORE_THRESHOLD) {
        const coversSomePrimaryGaps = primaryGapTasks.some((_gt: string) =>
          candidate.specialist_slug !== primary.specialist_slug
        );
        if (coversSomePrimaryGaps) {
          supporting.push(candidate);
          if (supporting.length >= 2) break;
        }
      }
    }
  }

  const unresolved = requiredTasks.filter((task) => {
    const covered = [primary, ...supporting].some((m) => m.task_coverage > 0);
    return !covered;
  });

  return {
    chair_function: functionDescription,
    primary,
    supporting,
    unresolved_tasks: unresolved,
    catalog_gap: false
  };
}

export interface BlueprintResolution {
  chair_id: string;
  chair_name: string;
  resolution: SpecialistResolution;
}

export async function resolveAllChairs(
  orgId: string,
  blueprint: Record<string, unknown>,
  businessProfile: Record<string, unknown>
): Promise<BlueprintResolution[]> {
  const chairs = (blueprint.chairs as Array<Record<string, unknown>>) ?? [];
  const industry = String(businessProfile.industry ?? "general");

  const resolutions: BlueprintResolution[] = [];
  for (const chair of chairs) {
    const chairId = String(chair.chair_id ?? "");
    const chairName = String(chair.name ?? "");
    const domain = String(chair.domain ?? "");
    const description = chair.description ? String(chair.description) : `${chairName} operations`;
    const scope = (chair.scope as Record<string, string[]> | null) ?? {};
    const requiredTasks = scope.owns ?? [];

    const resolution = await resolveChair(orgId, chairId, domain, description, industry, requiredTasks);
    resolutions.push({ chair_id: chairId, chair_name: chairName, resolution });
  }
  return resolutions;
}

export function applyResolutionsToBlueprint(
  blueprint: Record<string, unknown>,
  resolutions: BlueprintResolution[]
): Record<string, unknown> {
  const chairs = [...((blueprint.chairs as Array<Record<string, unknown>>) ?? [])];

  for (const res of resolutions) {
    const idx = chairs.findIndex((c) => c.chair_id === res.chair_id);
    if (idx < 0) continue;

    const chair = { ...chairs[idx] };
    const { primary, supporting } = res.resolution;

    chair.labor_commons_refs = [
      ...(primary
        ? [{ specialist_slug: primary.specialist_slug, catalog_path: primary.catalog_path, role: "primary", pinned_ref: null }]
        : []),
      ...supporting.map((s: SpecialistMatch) => ({
        specialist_slug: s.specialist_slug,
        catalog_path: s.catalog_path,
        role: "supporting",
        pinned_ref: null
      }))
    ];

    if (res.resolution.catalog_gap) {
      chair.catalog_gap = {
        function_description: res.resolution.chair_function,
        gap_id: `gap-${randomUUID().slice(0, 8)}`,
        submitted_to_labor_commons: false
      };
    } else {
      delete chair.catalog_gap;
    }

    chairs[idx] = chair;
  }

  return { ...blueprint, chairs };
}
