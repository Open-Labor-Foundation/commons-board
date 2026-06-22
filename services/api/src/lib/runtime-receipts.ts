/**
 * Runtime execution receipts — hash-chained, tamper-evident records of runtime
 * operations (child-runtime start/stop/status). Ported near-verbatim from
 * mother-board lib/runtime-receipts.ts; consumed fully in Phase 6.
 *
 * Kept in-session (not a lane task) because hash-chain integrity is an
 * invariant: a subtle change here silently breaks the audit guarantee.
 */
import { createHash, randomUUID } from "node:crypto";

export type RuntimeReceiptInput = {
  workspaceId: string;
  childId: string;
  childWorkspaceId: string;
  command: "status" | "start" | "stop";
  dryRun: boolean;
  containerRef: string;
  runtimeStatus?: string;
  shellCommand?: string;
  shellResult?: string;
  adapter?: string;
  runtimeType?: string;
  executionContext?: Record<string, unknown>;
  environmentMetadata?: Record<string, unknown>;
  executionStatus?: "completed" | "failed";
  actor: string;
  previousHash: string;
};

export type RuntimeExecutionReceipt = {
  receipt_id: string;
  workspace_id: string;
  child_id: string;
  child_workspace_id: string;
  command: "status" | "start" | "stop";
  dry_run: boolean;
  container_ref: string;
  runtime_status?: string;
  shell_command?: string;
  shell_result?: string;
  runtime_adapter?: string;
  actor: string;
  ts: string;
  executionId: string;
  timestamp: string;
  operation_type: "status" | "start" | "stop";
  runtime_environment: {
    runtime_type: string;
    execution_context: Record<string, unknown>;
    environment_metadata: Record<string, unknown>;
    execution_status: "completed" | "failed";
  };
  previous_hash: string;
  verification_hash: string;
  receipt_hash: string;
};

function receiptHash(payload: Omit<RuntimeExecutionReceipt, "receipt_hash" | "verification_hash">): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function createRuntimeExecutionReceipt(input: RuntimeReceiptInput): RuntimeExecutionReceipt {
  const runtimeEnvironment = {
    runtime_type: String(input.runtimeType ?? input.adapter ?? "unknown"),
    execution_context: input.executionContext ?? {},
    environment_metadata: input.environmentMetadata ?? {},
    execution_status: input.executionStatus ?? "completed"
  } as const;
  const timestamp = new Date().toISOString();
  const base: Omit<RuntimeExecutionReceipt, "receipt_hash" | "verification_hash"> = {
    receipt_id: randomUUID(),
    workspace_id: input.workspaceId,
    child_id: input.childId,
    child_workspace_id: input.childWorkspaceId,
    command: input.command,
    dry_run: input.dryRun,
    container_ref: input.containerRef,
    runtime_status: input.runtimeStatus,
    shell_command: input.shellCommand,
    shell_result: input.shellResult,
    runtime_adapter: input.adapter,
    actor: input.actor,
    ts: timestamp,
    executionId: randomUUID(),
    timestamp,
    operation_type: input.command,
    runtime_environment: runtimeEnvironment,
    previous_hash: input.previousHash
  };
  const hash = receiptHash(base);

  return {
    ...base,
    verification_hash: hash,
    receipt_hash: hash
  };
}

export function verifyRuntimeExecutionReceipt(receipt: RuntimeExecutionReceipt): {
  valid: boolean;
  recalculated_hash: string;
} {
  const { receipt_hash, verification_hash: _verificationHash, ...rest } = receipt;
  const recalculated = receiptHash(rest);
  return {
    valid: receipt_hash === recalculated,
    recalculated_hash: recalculated
  };
}
