/**
 * Artifact schema validation. Loads the JSON Schemas shipped by
 * @commons-board/shared and validates artifact payloads on write.
 *
 * Invariant: an artifact that fails schema validation is never persisted.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import type { ArtifactType } from "@commons-board/shared";

const require = createRequire(import.meta.url);
const ajv = new Ajv2020({ allErrors: true, strict: false });

const SCHEMA_FILES: Record<ArtifactType, string> = {
  business_profile: "business_profile.schema.json",
  objective_config: "objective_config.schema.json",
  autonomy_policy: "autonomy_policy.schema.json",
  cadence_protocol: "cadence_protocol.schema.json",
  agent_blueprint: "agent_blueprint.schema.json",
  collective_config: "collective_config.schema.json",
  venture_profile: "venture_profile.schema.json",
  launch_plan: "launch_plan.schema.json",
  tooling_plan: "tooling_plan.schema.json",
  financial_policy: "financial_policy.schema.json"
};

const validators = new Map<ArtifactType, ValidateFunction>();

function loadValidator(type: ArtifactType): ValidateFunction {
  const cached = validators.get(type);
  if (cached) return cached;

  // Resolve the schema file from the shared package's exported schemas dir.
  const schemaPath = require.resolve(`@commons-board/shared/schemas/${SCHEMA_FILES[type]}`);
  const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object;
  const validate = ajv.compile(schema);
  validators.set(type, validate);
  return validate;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validateArtifact(type: ArtifactType, payload: unknown): ValidationResult {
  const validate = loadValidator(type);
  const valid = validate(payload) as boolean;
  if (valid) return { valid: true, errors: [] };
  const errors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`
  );
  return { valid: false, errors };
}
