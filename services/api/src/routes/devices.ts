/**
 * Device (site controller) registration -- v0 groundwork for restaurant-
 * platform-style addins. An admin, already authenticated by one of the
 * three human-identity modes, registers a device once and receives a raw
 * secret shown exactly one time; the device then authenticates every
 * subsequent request as itself via lib/device-auth.ts's bearer-token check
 * in requireContext, never via the admin's own credentials.
 *
 * Same-host-only for v0: this endpoint doesn't change docker-compose.yml's
 * localhost-only binding. Whether/how a controller reaches commons-board
 * from off-host is a separate, undecided infrastructure choice.
 */
import { Router, type Request, type Response } from "express";
import { requireContext, requireRole } from "../lib/auth.js";
import { registerDevice, listDevices, revokeDevice } from "../lib/device-auth.js";

export const devicesRouter = Router();

devicesRouter.use(requireContext);

/** POST /api/v1/devices/register — mint a new device credential (admin only). */
devicesRouter.post("/register", requireRole(["admin"]), (req: Request, res: Response) => {
  const { device_name } = req.body as { device_name?: string };
  if (!device_name || typeof device_name !== "string") {
    res.status(400).json({ error: "device_name is required" });
    return;
  }
  const result = registerDevice(req.ctx!.workspaceId, device_name);
  res.status(201).json(result);
});

/** GET /api/v1/devices — list this workspace's registered devices (never includes secrets). */
devicesRouter.get("/", requireRole(["admin", "operator"]), (req: Request, res: Response) => {
  res.status(200).json({ devices: listDevices(req.ctx!.workspaceId) });
});

/** DELETE /api/v1/devices/:deviceId — revoke a device's credential. */
devicesRouter.delete("/:deviceId", requireRole(["admin"]), (req: Request, res: Response) => {
  const revoked = revokeDevice(req.ctx!.workspaceId, req.params.deviceId);
  if (!revoked) {
    res.status(404).json({ error: "device not found" });
    return;
  }
  res.status(204).send();
});
