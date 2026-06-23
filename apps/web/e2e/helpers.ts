import type { Page, Route } from "@playwright/test";

export const SETTINGS = {
  workspace_id: "default",
  org_name: "Test Workspace",
  governance_mode: "collective",
  active_provider_id: "featherless",
  providers: [{ provider_id: "featherless", kind: "hosted_api", display_name: "Featherless AI", model: "Qwen/Qwen3-32B", api_key_env: "FEATHERLESS_API_KEY", endpoint: null, options: {} }],
  rbac: { grants: { admin: ["*"], operator: ["approve", "trigger_cadence", "manage_settings"], member: ["vote", "view"], observer: ["view"] } },
  feature_toggles: {},
  updated_at: "2026-06-22T12:00:00Z",
};

export async function mockCommon(page: Page) {
  await page.route("/api/v1/settings", (r: Route) => r.fulfill({ json: SETTINGS }));
  await page.route("/api/v1/approvals?status=pending&limit=50", (r: Route) => r.fulfill({ json: { approvals: [] } }));
  await page.route("/api/v1/level4/actions?status=pending&limit=50", (r: Route) => r.fulfill({ json: { actions: [] } }));
}

export async function mockMethod(page: Page, url: string, method: string, json: unknown) {
  await page.route(url, (r: Route) => {
    if (r.request().method() === method) return r.fulfill({ json });
    return r.continue();
  });
}
