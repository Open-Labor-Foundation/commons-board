import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { assertSafeWebhookUrl } from "../lib/webhook-delivery.js";

// Regression coverage for CodeQL/commons-keeper's SSRF finding on
// dispatchWebhookEvent: it fetched sub.url with no host validation at all,
// so an admin-created (or DNS-rebound) subscription could target internal
// services or the cloud metadata endpoint. assertSafeWebhookUrl is checked
// both at subscription-create time and again on every dispatch.
describe("assertSafeWebhookUrl", () => {
  test("rejects loopback IPs", async () => {
    await assert.rejects(assertSafeWebhookUrl("http://127.0.0.1/internal"));
    await assert.rejects(assertSafeWebhookUrl("http://127.0.0.1:6379/"));
  });

  test("rejects localhost by hostname", async () => {
    await assert.rejects(assertSafeWebhookUrl("http://localhost:3000/internal-api"));
  });

  test("rejects the cloud metadata link-local range", async () => {
    await assert.rejects(assertSafeWebhookUrl("http://169.254.169.254/latest/meta-data/"));
  });

  test("rejects RFC1918 private ranges", async () => {
    await assert.rejects(assertSafeWebhookUrl("http://10.0.0.5/"));
    await assert.rejects(assertSafeWebhookUrl("http://172.16.0.5/"));
    await assert.rejects(assertSafeWebhookUrl("http://192.168.1.5/"));
  });

  test("rejects IPv6 loopback and link-local", async () => {
    await assert.rejects(assertSafeWebhookUrl("http://[::1]/"));
    await assert.rejects(assertSafeWebhookUrl("http://[fe80::1]/"));
  });

  test("rejects non-http(s) protocols", async () => {
    await assert.rejects(assertSafeWebhookUrl("file:///etc/passwd"));
  });

  test("accepts a real public hostname", async () => {
    await assert.doesNotReject(assertSafeWebhookUrl("https://example.com/webhook"));
  });

  test("accepts a public IP given directly", async () => {
    await assert.doesNotReject(assertSafeWebhookUrl("http://93.184.216.34/webhook"));
  });
});
