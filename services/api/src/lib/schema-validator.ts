/**
 * Artifact schema validation. Loads the JSON Schemas shipped by
 * @commons-board/shared for the 6 core platform artifact types, and falls
 * back to an installed addin's own on-disk schema (board-addins/<pack>/
 * schemas/<type>.schema.json, via ADDINS_DIR) for any other declared
 * artifact type. Addin types reach here as ArtifactType via the same
 * runtime-checked cast routes/artifacts.ts's parseType() already uses --
 * the static union stays closed, the schema lookup is what widens.
 *
 * Invariant: an artifact that fails schema validation is never persisted.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { Ajv2020, type ValidateFunction } from "ajv/dist/2020.js";
import type { ArtifactType } from "@commons-board/shared";
import { getAddinDir, getInstalledAddins } from "./addin-registry.js";

const require = createRequire(import.meta.url);
const ajv = new Ajv2020({ allErrors: true, strict: false });

const SCHEMA_FILES: Partial<Record<ArtifactType, string>> = {
  business_profile: "business_profile.schema.json",
  objective_config: "objective_config.schema.json",
  autonomy_policy: "autonomy_policy.schema.json",
  cadence_protocol: "cadence_protocol.schema.json",
  agent_blueprint: "agent_blueprint.schema.json",
  collective_config: "collective_config.schema.json",
};

const validators = new Map<ArtifactType, ValidateFunction>();

/** Resolve the schema file for a type: the 6 core types ship in @commons-board/shared; anything else must belong to an installed addin. */
function resolveSchemaPath(type: ArtifactType): string {
  const coreFile = SCHEMA_FILES[type];
  if (coreFile) {
    return require.resolve(`@commons-board/shared/schemas/${coreFile}`);
  }

  const owner = getInstalledAddins().find((pack) => pack.artifact_types.includes(type));
  if (!owner) {
    throw new Error(
      `no schema found for artifact type "${type}" -- not a core platform type and no installed addin declares it`
    );
  }
  return path.join(getAddinDir(), owner.id, "schemas", `${type}.schema.json`);
}

function loadValidator(type: ArtifactType): ValidateFunction {
  const cached = validators.get(type);
  if (cached) return cached;

  const schemaPath = resolveSchemaPath(type);
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
  let validate: ValidateFunction;
  try {
    validate = loadValidator(type);
  } catch (err) {
    return { valid: false, errors: [err instanceof Error ? err.message : String(err)] };
  }
  const valid = validate(payload) as boolean;
  if (valid) return { valid: true, errors: [] };
  const errors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`
  );
  return { valid: false, errors };
}
