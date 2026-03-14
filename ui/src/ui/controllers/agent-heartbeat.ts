/**
 * fork: heartbeat-status-rpc
 *
 * Controller for heartbeat status data (RPC: heartbeat.status).
 * Follows the same pattern as agent-skills.ts / agents.ts controllers.
 */
import type { GatewayBrowserClient } from "../gateway.ts";

/** Mirrors HeartbeatUiStatus from server-methods/heartbeat-status.ts */
export type HeartbeatUiStatus = "ok" | "notified" | "failed" | "never";

export type HeartbeatAgentStatus = {
  agentId: string;
  enabled: boolean;
  every: string;
  intervalMs: number;
  lastRunMs?: number;
  nextDueMs: number;
  lastUiStatus: HeartbeatUiStatus;
};

export type HeartbeatStatusResult = {
  agents: HeartbeatAgentStatus[];
  uptimeSinceMs: number;
};

export type AgentHeartbeatState = {
  client: GatewayBrowserClient | null;
  connected: boolean;
  heartbeatLoading: boolean;
  heartbeatError: string | null;
  heartbeatStatus: HeartbeatStatusResult | null;
  heartbeatPollingTimer: ReturnType<typeof setInterval> | null;
};

export async function loadHeartbeatStatus(state: AgentHeartbeatState, agentId?: string) {
  if (!state.client || !state.connected) {
    return;
  }
  if (state.heartbeatLoading) {
    return;
  }
  state.heartbeatLoading = true;
  state.heartbeatError = null;
  try {
    const params = agentId ? { agentId } : {};
    const res = await state.client.request("heartbeat.status", params);
    if (res) {
      state.heartbeatStatus = res as HeartbeatStatusResult;
    }
  } catch (err) {
    state.heartbeatError = String(err);
  } finally {
    state.heartbeatLoading = false;
  }
}

/** Start 30s polling fallback (call once when heartbeat tab is opened) */
export function startHeartbeatPolling(state: AgentHeartbeatState, agentId?: string) {
  stopHeartbeatPolling(state);
  state.heartbeatPollingTimer = setInterval(() => {
    void loadHeartbeatStatus(state, agentId);
  }, 30_000);
}

export function stopHeartbeatPolling(state: AgentHeartbeatState) {
  if (state.heartbeatPollingTimer) {
    clearInterval(state.heartbeatPollingTimer);
    state.heartbeatPollingTimer = null;
  }
}
