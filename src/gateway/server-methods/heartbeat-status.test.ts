/**
 * fork: heartbeat-status-rpc
 * Tests for heartbeat.status RPC handler — contract tests for field completeness,
 * status mapping correctness, and multi-agent scenarios.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { emitHeartbeatEvent } from "../../infra/heartbeat-events.js";
import { heartbeatStatusHandlers, mapEventStatusToUiStatus } from "./heartbeat-status.js";
import type { GatewayRequestHandlerOptions } from "./types.js";

// Mock resolveHeartbeatSummaryForAgent
vi.mock("../../infra/heartbeat-runner.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../infra/heartbeat-runner.js")>();
  return {
    ...original,
    resolveHeartbeatSummaryForAgent: vi.fn((_cfg, agentId: string) => ({
      enabled: true,
      every: agentId === "agent-a" ? "30m" : "1h",
      everyMs: agentId === "agent-a" ? 30 * 60_000 : 60 * 60_000,
      prompt: "check",
      target: "none",
      ackMaxChars: 300,
    })),
  };
});

// Mock loadConfig
vi.mock("../../config/config.js", () => ({
  loadConfig: vi.fn(() => ({
    agents: { defaults: { heartbeat: { every: "30m" } } },
  })),
}));

function createMockRunner(
  agents: Map<
    string,
    { agentId: string; intervalMs: number; lastRunMs?: number; nextDueMs: number }
  >,
) {
  return {
    stop: vi.fn(),
    updateConfig: vi.fn(),
    getAgentStates: () => agents,
  };
}

function createMockOpts(
  runner: ReturnType<typeof createMockRunner>,
  params: Record<string, unknown> = {},
): {
  opts: GatewayRequestHandlerOptions;
  respond: ReturnType<typeof vi.fn>;
} {
  const respond = vi.fn();
  return {
    opts: {
      req: { method: "heartbeat.status", id: "1", type: "req" as const },
      params,
      client: null,
      isWebchatConnect: () => false,
      respond,
      context: {
        heartbeatRunner: runner,
      } as unknown as GatewayRequestHandlerOptions["context"],
    },
    respond,
  };
}

const callHandler = (opts: GatewayRequestHandlerOptions) => {
  const handler = heartbeatStatusHandlers["heartbeat.status"];
  expect(handler).toBeDefined();
  void handler(opts);
};

describe("heartbeat.status RPC handler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns all agents with correct fields", () => {
    const agents = new Map([
      [
        "agent-a",
        { agentId: "agent-a", intervalMs: 30 * 60_000, lastRunMs: 1000, nextDueMs: 2000 },
      ],
      ["agent-b", { agentId: "agent-b", intervalMs: 60 * 60_000, nextDueMs: 5000 }],
    ]);
    const runner = createMockRunner(agents);
    const { opts, respond } = createMockOpts(runner);

    callHandler(opts);

    expect(respond).toHaveBeenCalledOnce();
    const [ok, payload] = respond.mock.calls[0];
    expect(ok).toBe(true);
    expect(payload.agents).toHaveLength(2);
    expect(payload.uptimeSinceMs).toBeTypeOf("number");

    // Agent A: has lastRunMs
    const a = payload.agents.find((x: { agentId: string }) => x.agentId === "agent-a");
    expect(a).toEqual(
      expect.objectContaining({
        agentId: "agent-a",
        enabled: true,
        every: "30m",
        intervalMs: 30 * 60_000,
        lastRunMs: 1000,
        nextDueMs: 2000,
        lastUiStatus: "never",
      }),
    );

    // Agent B: no lastRunMs
    const b = payload.agents.find((x: { agentId: string }) => x.agentId === "agent-b");
    expect(b).toEqual(
      expect.objectContaining({
        agentId: "agent-b",
        enabled: true,
        every: "1h",
        intervalMs: 60 * 60_000,
        nextDueMs: 5000,
        lastUiStatus: "never",
      }),
    );
    expect(b.lastRunMs).toBeUndefined();
  });

  it("returns empty agents when no heartbeat agents configured", () => {
    const runner = createMockRunner(new Map());
    const { opts, respond } = createMockOpts(runner);

    callHandler(opts);

    const [ok, payload] = respond.mock.calls[0];
    expect(ok).toBe(true);
    expect(payload.agents).toEqual([]);
  });

  it("filters by agentId when param is provided", () => {
    const agents = new Map([
      ["agent-a", { agentId: "agent-a", intervalMs: 30 * 60_000, nextDueMs: 2000 }],
      ["agent-b", { agentId: "agent-b", intervalMs: 60 * 60_000, nextDueMs: 5000 }],
    ]);
    const runner = createMockRunner(agents);
    const { opts, respond } = createMockOpts(runner, { agentId: "agent-b" });

    callHandler(opts);

    const [ok, payload] = respond.mock.calls[0];
    expect(ok).toBe(true);
    expect(payload.agents).toHaveLength(1);
    expect(payload.agents[0].agentId).toBe("agent-b");
  });

  it("returns error when heartbeatRunner is not available", () => {
    const respond = vi.fn();
    const opts: GatewayRequestHandlerOptions = {
      req: { method: "heartbeat.status", id: "1", type: "req" as const },
      params: {},
      client: null,
      isWebchatConnect: () => false,
      respond,
      context: {} as GatewayRequestHandlerOptions["context"],
    };

    callHandler(opts);

    expect(respond).toHaveBeenCalledWith(
      false,
      undefined,
      expect.objectContaining({
        code: "UNAVAILABLE",
      }),
    );
  });

  it("tracks per-agent event status via heartbeat events", () => {
    const agents = new Map([
      [
        "agent-a",
        { agentId: "agent-a", intervalMs: 30 * 60_000, lastRunMs: 1000, nextDueMs: 2000 },
      ],
    ]);
    const runner = createMockRunner(agents);

    // First call: no events yet → never
    const { opts: opts1, respond: respond1 } = createMockOpts(runner);
    callHandler(opts1);
    expect(respond1.mock.calls[0][1].agents[0].lastUiStatus).toBe("never");

    // Emit a "sent" event for agent-a
    emitHeartbeatEvent({ status: "sent", agentId: "agent-a", to: "user" });

    // Second call: should reflect "notified"
    const { opts: opts2, respond: respond2 } = createMockOpts(runner);
    callHandler(opts2);
    expect(respond2.mock.calls[0][1].agents[0].lastUiStatus).toBe("notified");

    // Emit an "ok-empty" event
    emitHeartbeatEvent({ status: "ok-empty", agentId: "agent-a" });

    const { opts: opts3, respond: respond3 } = createMockOpts(runner);
    callHandler(opts3);
    expect(respond3.mock.calls[0][1].agents[0].lastUiStatus).toBe("ok");

    // Emit a "failed" event
    emitHeartbeatEvent({ status: "failed", agentId: "agent-a", reason: "timeout" });

    const { opts: opts4, respond: respond4 } = createMockOpts(runner);
    callHandler(opts4);
    expect(respond4.mock.calls[0][1].agents[0].lastUiStatus).toBe("failed");
  });
});

describe("mapEventStatusToUiStatus", () => {
  it("maps ok-empty to ok", () => {
    expect(mapEventStatusToUiStatus("ok-empty")).toBe("ok");
  });

  it("maps ok-token to ok", () => {
    expect(mapEventStatusToUiStatus("ok-token")).toBe("ok");
  });

  it("maps skipped to ok", () => {
    expect(mapEventStatusToUiStatus("skipped")).toBe("ok");
  });

  it("maps sent to notified", () => {
    expect(mapEventStatusToUiStatus("sent")).toBe("notified");
  });

  it("maps failed to failed", () => {
    expect(mapEventStatusToUiStatus("failed")).toBe("failed");
  });
});
