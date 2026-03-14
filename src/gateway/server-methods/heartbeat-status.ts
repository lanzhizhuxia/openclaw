import { loadConfig } from "../../config/config.js";
/**
 * fork: heartbeat-status-rpc
 *
 * RPC handler for `heartbeat.status` — returns per-agent heartbeat scheduling
 * state and the last UI-facing status derived from heartbeat events.
 *
 * Interval changes are handled by the existing `config.apply` RPC flow, which
 * triggers a hot-reload that calls `heartbeatRunner.updateConfig(nextConfig)`.
 * After saving config, the UI re-fetches `heartbeat.status` for the updated snapshot.
 *
 * ## Status mapping (contract — shared with UI):
 *
 * | emitHeartbeatEvent status   | UI status  | Meaning                          |
 * |-----------------------------|------------|----------------------------------|
 * | ok-empty / ok-token         | ok         | Heartbeat normal, no notification|
 * | skipped                     | ok         | Skipped = normal behaviour       |
 * | sent                        | notified   | Notification sent to user        |
 * | failed                      | failed     | Heartbeat run failed             |
 * | (no record)                 | never      | Never ran since this startup     |
 */
import { onHeartbeatEvent, type HeartbeatEventPayload } from "../../infra/heartbeat-events.js";
import { resolveHeartbeatSummaryForAgent } from "../../infra/heartbeat-runner.js";
import type { GatewayRequestHandlers } from "./types.js";

/** UI status contract */
export type HeartbeatUiStatus = "ok" | "notified" | "failed" | "never";

export function mapEventStatusToUiStatus(
  status: HeartbeatEventPayload["status"],
): HeartbeatUiStatus {
  switch (status) {
    case "ok-empty":
    case "ok-token":
    case "skipped":
      return "ok";
    case "sent":
      return "notified";
    case "failed":
      return "failed";
  }
}

// Per-agent last event tracker (in-memory, reset on gateway restart)
const agentLastEvent = new Map<string, HeartbeatEventPayload>();
let eventListenerInstalled = false;

function ensureEventListener() {
  if (eventListenerInstalled) {
    return;
  }
  eventListenerInstalled = true;
  onHeartbeatEvent((evt) => {
    if (evt.agentId) {
      agentLastEvent.set(evt.agentId, evt);
    }
  });
}

const gatewayStartMs = Date.now();

export type HeartbeatStatusAgent = {
  agentId: string;
  enabled: boolean;
  every: string;
  intervalMs: number;
  lastRunMs?: number;
  nextDueMs: number;
  lastUiStatus: HeartbeatUiStatus;
};

export type HeartbeatStatusResponse = {
  agents: HeartbeatStatusAgent[];
  uptimeSinceMs: number;
};

export const heartbeatStatusHandlers: GatewayRequestHandlers = {
  "heartbeat.status": (opts) => {
    ensureEventListener();
    const { respond, context, params } = opts;
    const runner = context.heartbeatRunner;
    if (!runner) {
      respond(false, undefined, {
        code: "UNAVAILABLE",
        message: "heartbeat runner not available",
      });
      return;
    }

    const filterAgentId =
      typeof params.agentId === "string" ? params.agentId.trim() || undefined : undefined;

    const agentStates = runner.getAgentStates();
    const cfg = loadConfig();
    const agents: HeartbeatStatusAgent[] = [];

    for (const [id, state] of agentStates) {
      if (filterAgentId && id !== filterAgentId) {
        continue;
      }
      const summary = resolveHeartbeatSummaryForAgent(cfg, id);
      const lastEvt = agentLastEvent.get(id);
      const lastUiStatus: HeartbeatUiStatus = lastEvt
        ? mapEventStatusToUiStatus(lastEvt.status)
        : "never";

      agents.push({
        agentId: id,
        enabled: summary.enabled,
        every: summary.every,
        intervalMs: state.intervalMs,
        lastRunMs: state.lastRunMs,
        nextDueMs: state.nextDueMs,
        lastUiStatus,
      });
    }

    respond(true, { agents, uptimeSinceMs: gatewayStartMs } satisfies HeartbeatStatusResponse);
  },
};
