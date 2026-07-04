import { Router } from "express";
import { requireRole } from "../lib/auth.js";
import { resolveSemanticJudge } from "../services/model-native-semantic-judge.js";

export const evalsRouter = Router();

evalsRouter.post("/semantic-judge", requireRole(["admin", "operator"]), async (req, res) => {
  const expectedAction = String(req.body?.expected_action ?? "").trim();
  const observedAction = String(req.body?.observed_action ?? "").trim();
  if (!expectedAction || !observedAction) {
    res.status(400).json({ error: "expected_action and observed_action are required" });
    return;
  }
  const result = await resolveSemanticJudge({
    expectedAction,
    observedAction,
    context: typeof req.body?.context === "object" && req.body?.context ? req.body.context : {}
  });
  res.status(200).json(result);
});
