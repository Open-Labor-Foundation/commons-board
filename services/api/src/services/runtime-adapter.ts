/**
 * Runtime adapter — Docker / noop / SIM runtime abstraction.
 *
 * Ported from mother-board services/runtime-adapter.ts.
 * Sanitized: MB_RUNTIME_ADAPTER → CB_RUNTIME_ADAPTER env var.
 *
 * SIM mode: always uses noop adapter; no external writes occur.
 * LIVE mode: uses adapter selected by CB_RUNTIME_ADAPTER (default: docker).
 */
import { execFileSync } from "node:child_process";

export type RuntimeCommand = "status" | "start" | "stop";

export type RuntimeExecutionInput = {
  command: RuntimeCommand;
  containerRef: string;
  dryRun: boolean;
  workspaceId?: string;
  childId?: string;
};

export type RuntimeAdapterResult = {
  ok: boolean;
  output: string;
  adapter: string;
  status: "completed" | "failed";
  runtime_type: string;
  execution_context: {
    command: RuntimeCommand;
    container_ref: string;
    dry_run: boolean;
    workspace_id?: string;
    child_id?: string;
  };
  environment_metadata: {
    adapter_mode: string;
    node_env: string;
    sim_mode: boolean;
  };
  execution_status: "completed" | "failed";
};

export type RuntimeAdapter = {
  name: string;
  execute(input: RuntimeExecutionInput): RuntimeAdapterResult;
  run(command: RuntimeCommand, containerRef: string, dryRun: boolean): RuntimeAdapterResult;
};

function runtimeContext(
  adapterMode: string,
  input: RuntimeExecutionInput,
  status: "completed" | "failed",
  simMode = false
): Pick<RuntimeAdapterResult, "status" | "runtime_type" | "execution_context" | "environment_metadata" | "execution_status"> {
  return {
    status,
    runtime_type: simMode ? "sim" : adapterMode,
    execution_context: {
      command: input.command,
      container_ref: input.containerRef,
      dry_run: input.dryRun,
      workspace_id: input.workspaceId,
      child_id: input.childId
    },
    environment_metadata: {
      adapter_mode: adapterMode,
      node_env: String(process.env.NODE_ENV ?? "development"),
      sim_mode: simMode
    },
    execution_status: status
  };
}

function dockerRun(input: RuntimeExecutionInput): RuntimeAdapterResult {
  try {
    if (input.command === "status") {
      const output = execFileSync("docker", ["inspect", "-f", "{{.State.Status}}", input.containerRef], { encoding: "utf8" });
      return { ok: true, output: output.trim(), adapter: "docker", ...runtimeContext("docker", input, "completed") };
    }
    if (input.command === "start") {
      const output = execFileSync("docker", ["start", input.containerRef], { encoding: "utf8" });
      return { ok: true, output: output.trim(), adapter: "docker", ...runtimeContext("docker", input, "completed") };
    }
    const output = execFileSync("docker", ["stop", input.containerRef], { encoding: "utf8" });
    return { ok: true, output: output.trim(), adapter: "docker", ...runtimeContext("docker", input, "completed") };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, output: message, adapter: "docker", ...runtimeContext("docker", input, "failed") };
  }
}

function noopRun(input: RuntimeExecutionInput, simMode = false): RuntimeAdapterResult {
  if (input.command === "status") return { ok: true, output: simMode ? "sim-active" : "noop-active", adapter: "noop", ...runtimeContext("noop", input, "completed", simMode) };
  if (input.command === "start") return { ok: true, output: simMode ? "sim-started" : "noop-started", adapter: "noop", ...runtimeContext("noop", input, "completed", simMode) };
  return { ok: true, output: simMode ? "sim-stopped" : "noop-stopped", adapter: "noop", ...runtimeContext("noop", input, "completed", simMode) };
}

function adapterMode(): "docker" | "noop" {
  const raw = String(process.env.CB_RUNTIME_ADAPTER ?? "docker").trim().toLowerCase();
  return raw === "noop" ? "noop" : "docker";
}

export function runtimeAdapter(simMode = false): RuntimeAdapter {
  const mode = simMode ? "noop" : adapterMode();
  if (mode === "noop") {
    return {
      name: simMode ? "sim" : "noop",
      execute(input: RuntimeExecutionInput): RuntimeAdapterResult {
        if (input.dryRun) return { ok: true, output: "dry_run", adapter: "noop", ...runtimeContext("noop", input, "completed", simMode) };
        return noopRun(input, simMode);
      },
      run(command: RuntimeCommand, containerRef: string, dryRun: boolean): RuntimeAdapterResult {
        return this.execute({ command, containerRef, dryRun });
      }
    };
  }
  return {
    name: "docker",
    execute(input: RuntimeExecutionInput): RuntimeAdapterResult {
      if (input.dryRun) return { ok: true, output: "dry_run", adapter: "docker", ...runtimeContext("docker", input, "completed") };
      return dockerRun(input);
    },
    run(command: RuntimeCommand, containerRef: string, dryRun: boolean): RuntimeAdapterResult {
      return this.execute({ command, containerRef, dryRun });
    }
  };
}
