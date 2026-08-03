/**
 * POST /api/v1/inference/broker — the addin app inference lane. See
 * lib/inference-broker.ts for why this exists: no addin ever holds a
 * provider key, every request goes through commons-board's already-
 * configured provider and is logged under one governance surface.
 */
import { Router, type Request, type Response } from "express";
import { requireContext } from "../lib/auth.js";
import { brokerInferenceRequest } from "../lib/inference-broker.js";

export const inferenceBrokerRouter = Router();

inferenceBrokerRouter.use(requireContext);

interface BrokerRequestBody {
  source?: string;
  system?: string;
  prompt?: string;
  max_tokens?: number;
  temperature?: number;
}

inferenceBrokerRouter.post("/broker", async (req: Request, res: Response) => {
  const body = req.body as BrokerRequestBody;
  if (!body.source || !body.system || !body.prompt) {
    res.status(400).json({ error: "source, system, and prompt are required" });
    return;
  }

  try {
    const result = await brokerInferenceRequest(req.ctx!.workspaceId, req.ctx!.userId, {
      source: body.source,
      system: body.system,
      prompt: body.prompt,
      max_tokens: body.max_tokens,
      temperature: body.temperature,
    });
    res.status(200).json(result);
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "inference failed" });
  }
});
