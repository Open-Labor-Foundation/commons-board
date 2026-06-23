import { test, expect } from "@playwright/test";
import { mockCommon } from "./helpers";

const LINKS = { links: [{ link_id: "lnk-1", peer_board_url: "https://board.partner.coop", peer_name: "Partner Board", status: "active", established_at: new Date().toISOString() }] };
const BRIDGE = { connected: true, crew_endpoint: "http://crew-api:4000", last_ping: new Date().toISOString(), readiness: "ready" };
const SUBS = { subscriptions: [{ subscription_id: "sub-1", event_name: "governance.decision_made", target_url: "https://hooks.example.com/cb", active: true, created_at: new Date().toISOString() }] };

test.describe("Federation page", () => {
  test.beforeEach(async ({ page }) => {
    await mockCommon(page);
    await page.route("/api/v1/federation/links", r => r.fulfill({ json: LINKS }));
    await page.route("/api/v1/crew-bridge/status", r => r.fulfill({ json: BRIDGE }));
    await page.route("/api/v1/webhooks/subscriptions", r => r.fulfill({ json: SUBS }));
  });

  test("shows Federation heading and description", async ({ page }) => {
    await page.goto("/federation");
    await expect(page.getByRole("heading", { name: "Federation" })).toBeVisible();
    await expect(page.getByText("Peer board links, crew-bridge connection")).toBeVisible();
  });

  test("shows crew bridge as Connected", async ({ page }) => {
    await page.goto("/federation");
    await expect(page.getByText("Connected")).toBeVisible();
    await expect(page.getByText("http://crew-api:4000")).toBeVisible();
    await expect(page.getByText("ready")).toBeVisible();
  });

  test("shows not connected state", async ({ page }) => {
    await page.route("/api/v1/crew-bridge/status", r => r.fulfill({ json: { connected: false } }));
    await page.goto("/federation");
    await expect(page.getByText("Not connected")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect" })).toBeVisible();
  });

  test("Connect sends POST to /crew-bridge/connect", async ({ page }) => {
    let body: Record<string, unknown> | null = null;
    await page.route("/api/v1/crew-bridge/connect", async r => { body = JSON.parse(r.request().postData() ?? "{}"); await r.fulfill({ json: { ok: true } }); });
    await page.route("/api/v1/crew-bridge/status", r => r.fulfill({ json: { connected: false } }));
    await page.goto("/federation");
    await page.getByPlaceholder("http://crew-api:4000").fill("http://crew:4001");
    await page.getByRole("button", { name: "Connect" }).click();
    expect(body!.crew_endpoint).toBe("http://crew:4001");
    await expect(page.getByText("Saved.")).toBeVisible();
  });

  test("shows peer board link", async ({ page }) => {
    await page.goto("/federation");
    await expect(page.getByText("Partner Board")).toBeVisible();
    await expect(page.getByText("https://board.partner.coop")).toBeVisible();
    await expect(page.getByText("active").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Remove" })).toBeVisible();
  });

  test("Add link sends POST with peer_board_url", async ({ page }) => {
    let body: Record<string, unknown> | null = null;
    await page.route("/api/v1/federation/links", async r => {
      if (r.request().method() === "POST") { body = JSON.parse(r.request().postData() ?? "{}"); await r.fulfill({ json: { link_id: "lnk-2" } }); }
      else await r.fulfill({ json: LINKS });
    });
    await page.goto("/federation");
    await page.getByPlaceholder("https://board.example.coop").fill("https://board.new.coop");
    await page.getByRole("button", { name: "Add link" }).click();
    expect(body!.peer_board_url).toBe("https://board.new.coop");
  });

  test("Remove link sends DELETE", async ({ page }) => {
    let deleted = false;
    await page.route("/api/v1/federation/links/lnk-1", async r => { deleted = true; await r.fulfill({ json: { ok: true } }); });
    await page.goto("/federation");
    await page.getByRole("button", { name: "Remove" }).click();
    expect(deleted).toBe(true);
  });

  test("webhook subscription listed with event name and target", async ({ page }) => {
    await page.goto("/federation");
    await expect(page.locator("span", { hasText: "governance.decision_made" })).toBeVisible();
    await expect(page.getByText("https://hooks.example.com/cb")).toBeVisible();
    await expect(page.getByText("active").first()).toBeVisible();
  });

  test("Subscribe sends POST to /webhooks/subscriptions", async ({ page }) => {
    let body: Record<string, unknown> | null = null;
    await page.route("/api/v1/webhooks/subscriptions", async r => {
      if (r.request().method() === "POST") { body = JSON.parse(r.request().postData() ?? "{}"); await r.fulfill({ json: { subscription_id: "sub-2" } }); }
      else await r.fulfill({ json: SUBS });
    });
    await page.goto("/federation");
    await page.getByPlaceholder("https://hooks.example.com/cb").fill("https://hooks.mine.com/x");
    await page.getByRole("button", { name: "Subscribe" }).click();
    expect(body!.target_url).toBe("https://hooks.mine.com/x");
  });

  test("Delete webhook sends DELETE", async ({ page }) => {
    let deleted = false;
    await page.route("/api/v1/webhooks/subscriptions/sub-1", async r => { deleted = true; await r.fulfill({ json: { ok: true } }); });
    await page.goto("/federation");
    await page.getByRole("button", { name: "Delete" }).click();
    expect(deleted).toBe(true);
  });
});
