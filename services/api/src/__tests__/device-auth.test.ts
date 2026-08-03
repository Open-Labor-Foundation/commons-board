import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { Server } from "node:http";
import { createTestDataDir, removeTestDataDir } from "./helpers.js";
import { registerDevice, verifyDeviceToken, listDevices, revokeDevice } from "../lib/device-auth.js";
import { requireContext } from "../lib/auth.js";

describe("device-auth", () => {
  let dir: string;

  beforeEach(() => {
    dir = createTestDataDir();
  });

  afterEach(() => {
    removeTestDataDir(dir);
  });

  test("registerDevice returns a secret that verifyDeviceToken accepts, and never stores it in plaintext", () => {
    const { device_id, secret } = registerDevice("org-1", "kitchen-controller");
    assert.ok(device_id);
    assert.ok(secret);

    const verified = verifyDeviceToken(secret);
    assert.ok(verified);
    assert.equal(verified!.device_id, device_id);
    assert.equal(verified!.workspace_id, "org-1");
    assert.notEqual((verified as unknown as { secret_hash: string }).secret_hash, secret);
  });

  test("verifyDeviceToken rejects an unknown or empty token", () => {
    registerDevice("org-1", "kitchen-controller");
    assert.equal(verifyDeviceToken("not-a-real-token"), null);
    assert.equal(verifyDeviceToken(""), null);
  });

  test("listDevices scopes by workspace and never exposes secret_hash", () => {
    registerDevice("org-1", "controller-a");
    registerDevice("org-2", "controller-b");

    const org1Devices = listDevices("org-1");
    assert.equal(org1Devices.length, 1);
    assert.equal(org1Devices[0].device_name, "controller-a");
    assert.equal("secret_hash" in org1Devices[0], false);

    assert.equal(listDevices("org-2").length, 1);
    assert.equal(listDevices("org-3").length, 0);
  });

  test("revokeDevice removes only the targeted device, scoped to its workspace", () => {
    const { device_id, secret } = registerDevice("org-1", "controller-a");
    registerDevice("org-1", "controller-b");

    assert.equal(revokeDevice("org-2", device_id), false, "wrong workspace should not revoke");
    assert.ok(verifyDeviceToken(secret), "device should still be valid after a wrong-workspace revoke attempt");

    assert.equal(revokeDevice("org-1", device_id), true);
    assert.equal(verifyDeviceToken(secret), null);
    assert.equal(listDevices("org-1").length, 1, "the other device in the workspace should be untouched");
  });
});

describe("requireContext with device auth", () => {
  let dir: string;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    dir = createTestDataDir();
    delete process.env.CB_API_TOKEN;
    delete process.env.CB_JWT_SECRET;
    delete process.env.CB_OIDC_JWKS_URL;
    delete process.env.CB_INSECURE_HEADER_AUTH;

    const app = express();
    app.use(express.json());
    app.use(requireContext);
    app.get("/whoami", (req, res) => {
      res.status(200).json(req.ctx);
    });
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("expected a network address");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterEach(async () => {
    removeTestDataDir(dir);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  test("a valid device bearer token authenticates, even with no other auth mode configured", async () => {
    const { secret, device_id } = registerDevice("org-1", "kitchen-controller");

    const resp = await fetch(`${baseUrl}/whoami`, {
      headers: { authorization: `Bearer ${secret}` },
    });
    assert.equal(resp.status, 200);
    const ctx = await resp.json();
    assert.equal(ctx.workspaceId, "org-1");
    assert.equal(ctx.deviceId, device_id);
    assert.equal(ctx.role, "operator");
  });

  test("an unrecognized bearer token falls through to the normal 500 (no auth method configured), not a silent device match", async () => {
    const resp = await fetch(`${baseUrl}/whoami`, {
      headers: { authorization: "Bearer not-a-registered-device-secret" },
    });
    assert.equal(resp.status, 500);
  });

  test("a device token scoped to org-1 is rejected if the caller names a different target workspace", async () => {
    const { secret } = registerDevice("org-1", "kitchen-controller");
    const resp = await fetch(`${baseUrl}/whoami`, {
      headers: { authorization: `Bearer ${secret}`, "x-target-workspace-id": "org-2" },
    });
    assert.equal(resp.status, 403);
  });
});
