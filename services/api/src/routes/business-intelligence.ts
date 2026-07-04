/**
 * Business intelligence routes — capability and dashboard evaluation.
 *
 * Ported from mother-board routes/business-intelligence.ts.
 * Sanitized:
 *   - store.* → evaluateCapability / evaluateDashboard from services/business-intelligence.ts
 *   - "cio" domain removed (maps to "it")
 *   - Level4 context removed (Phase 9)
 *
 * Routes:
 *   GET /api/v1/bi/capabilities              — all capability evaluations
 *   GET /api/v1/bi/capabilities/:key         — single capability
 *   GET /api/v1/bi/dashboards                — all dashboard evaluations
 *   GET /api/v1/bi/dashboards/:key           — single dashboard
 *   GET /api/v1/bi/health                    — org health score
 */
import { Router, type Request, type Response } from "express";
import { requireContext } from "../lib/auth.js";
import {
  evaluateCapabilities,
  evaluateCapabilityByKey,
  evaluateDashboardByKey,
  capabilityCatalog,
  dashboardCatalog
} from "../services/business-intelligence.js";

export const businessIntelligenceRouter = Router();
businessIntelligenceRouter.use(requireContext);

/** GET /api/v1/bi/capabilities */
businessIntelligenceRouter.get("/capabilities", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const domain = req.query.domain as string | undefined;
  const all = evaluateCapabilities(workspaceId);
  const filtered = domain ? all.filter((c) => c.capability.domain === domain) : all;
  res.status(200).json({ capabilities: filtered, total: filtered.length });
});

/** GET /api/v1/bi/capabilities/:key */
businessIntelligenceRouter.get("/capabilities/:key", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const result = evaluateCapabilityByKey(workspaceId, req.params.key);
  if (!result) {
    res.status(404).json({ error: "capability not found" });
    return;
  }
  res.status(200).json(result);
});

/** GET /api/v1/bi/dashboards */
businessIntelligenceRouter.get("/dashboards", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const domain = req.query.domain as string | undefined;
  const catalog = domain ? dashboardCatalog.filter((d) => d.domain === domain) : dashboardCatalog;
  const results = catalog.map((dashboard) => {
    const evals = evaluateCapabilities(workspaceId).filter((c) => dashboard.capabilityIds.includes(c.capability.id));
    const score = Number((evals.reduce((s, e) => s + e.value, 0) / Math.max(1, evals.length)).toFixed(1));
    return { dashboard, score, trend: score >= 67 ? "up" : score >= 45 ? "flat" : "down" };
  });
  res.status(200).json({ dashboards: results, total: results.length });
});

/** GET /api/v1/bi/dashboards/:key */
businessIntelligenceRouter.get("/dashboards/:key", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const result = evaluateDashboardByKey(workspaceId, req.params.key);
  if (!result) {
    res.status(404).json({ error: "dashboard not found" });
    return;
  }
  res.status(200).json(result);
});

/** GET /api/v1/bi/health */
businessIntelligenceRouter.get("/health", (req: Request, res: Response) => {
  const { workspaceId } = req.ctx!;
  const capabilities = evaluateCapabilities(workspaceId);
  const overall = Number((capabilities.reduce((s, c) => s + c.value, 0) / Math.max(1, capabilities.length)).toFixed(1));
  const trend = overall >= 67 ? "up" : overall >= 45 ? "flat" : "down";
  const byDomain: Record<string, number> = {};
  for (const c of capabilities) {
    byDomain[c.capability.domain] = byDomain[c.capability.domain]
      ? Number(((byDomain[c.capability.domain] + c.value) / 2).toFixed(1))
      : c.value;
  }
  const domainCount = Object.keys(byDomain).length;
  res.status(200).json({
    overall_score: overall,
    trend,
    domain_scores: byDomain,
    capability_count: capabilities.length,
    dashboard_count: dashboardCatalog.length,
    domain_count: domainCount
  });
});
