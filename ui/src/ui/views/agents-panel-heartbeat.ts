/**
 * fork: heartbeat-status-rpc
 *
 * Independent sub-component for the Heartbeat panel in the Agents view.
 * Displays per-agent heartbeat scheduling status and interval configuration.
 */
import { html, nothing } from "lit";
import { t } from "../../i18n/index.ts";
import type {
  HeartbeatAgentStatus,
  HeartbeatStatusResult,
} from "../controllers/agent-heartbeat.ts";
import { formatRelativeTimestamp } from "../format.ts";

const INTERVAL_REGEX = /^\d+[smhd]$/;

const PRESETS = ["30m", "1h", "4h", "12h"] as const;

type HeartbeatPanelParams = {
  agentId: string;
  heartbeatStatus: HeartbeatStatusResult | null;
  heartbeatLoading: boolean;
  heartbeatError: string | null;
  // Config form state for saving interval changes
  configForm: Record<string, unknown> | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  onRefresh: () => void;
  onConfigReload: () => void;
  onConfigSave: () => void;
  onHeartbeatIntervalChange: (agentId: string, every: string) => void;
};

function resolveAgentHeartbeat(
  status: HeartbeatStatusResult | null,
  agentId: string,
): HeartbeatAgentStatus | null {
  if (!status) {
    return null;
  }
  return status.agents.find((a) => a.agentId === agentId) ?? null;
}

function formatUiStatus(status: HeartbeatAgentStatus["lastUiStatus"]): string {
  switch (status) {
    case "ok":
      return t("heartbeat.status.ok");
    case "notified":
      return t("heartbeat.status.notified");
    case "failed":
      return t("heartbeat.status.failed");
    case "never":
      return t("heartbeat.status.never");
  }
}

function statusBadgeClass(status: HeartbeatAgentStatus["lastUiStatus"]): string {
  switch (status) {
    case "ok":
      return "heartbeat-badge--ok";
    case "notified":
      return "heartbeat-badge--notified";
    case "failed":
      return "heartbeat-badge--failed";
    case "never":
      return "heartbeat-badge--never";
  }
}

function formatFutureRelative(ms: number): string {
  const now = Date.now();
  const diff = ms - now;
  if (diff <= 0) {
    return "now";
  }
  if (diff < 60_000) {
    return `in ${Math.ceil(diff / 1000)}s`;
  }
  if (diff < 3_600_000) {
    return `in ${Math.ceil(diff / 60_000)}m`;
  }
  if (diff < 86_400_000) {
    const h = Math.floor(diff / 3_600_000);
    const m = Math.ceil((diff % 3_600_000) / 60_000);
    return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
  }
  return `in ${Math.ceil(diff / 86_400_000)}d`;
}

export function renderAgentHeartbeat(params: HeartbeatPanelParams) {
  const {
    agentId,
    heartbeatStatus,
    heartbeatLoading,
    heartbeatError,
    configForm,
    configLoading,
    configSaving,
    configDirty,
    onRefresh,
    onConfigReload,
    onConfigSave,
    onHeartbeatIntervalChange,
  } = params;

  if (heartbeatLoading && !heartbeatStatus) {
    return html`
      <section class="card">
        <div class="card-title">${t("heartbeat.title")}</div>
        <div class="card-sub">${t("heartbeat.loading")}</div>
      </section>
    `;
  }

  if (heartbeatError && !heartbeatStatus) {
    return html`
      <section class="card">
        <div class="card-title">${t("heartbeat.title")}</div>
        <div class="callout danger" style="margin-top: 8px;">${heartbeatError}</div>
        <button class="btn btn--sm" style="margin-top: 8px;" @click=${onRefresh}>${t("heartbeat.refresh")}</button>
      </section>
    `;
  }

  const agent = resolveAgentHeartbeat(heartbeatStatus, agentId);
  if (!agent) {
    return html`
      <section class="card">
        <div class="card-title">${t("heartbeat.title")}</div>
        <div class="card-sub muted" style="margin-top: 8px">${t("heartbeat.disabled")}</div>
      </section>
    `;
  }

  const uptimeSinceMs = heartbeatStatus?.uptimeSinceMs ?? 0;
  const currentEvery = resolveCurrentEvery(configForm, agentId) ?? agent.every;
  const isCustom = !PRESETS.includes(currentEvery as (typeof PRESETS)[number]);
  const disabled = !configForm || configLoading || configSaving;

  return html`
    <section class="card">
      <div class="row" style="justify-content: space-between; align-items: center;">
        <div>
          <div class="card-title">${t("heartbeat.title")}</div>
          <div class="card-sub">${t("heartbeat.subtitle")}</div>
        </div>
        <button class="btn btn--sm" ?disabled=${heartbeatLoading} @click=${onRefresh}>
          ${heartbeatLoading ? t("heartbeat.loading") : t("heartbeat.refresh")}
        </button>
      </div>

      ${heartbeatError ? html`<div class="callout danger" style="margin-top: 8px;">${heartbeatError}</div>` : nothing}

      <div class="agents-overview-grid" style="margin-top: 16px;">
        <div class="agent-kv">
          <div class="label">${t("heartbeat.lastStatus")}</div>
          <div>
            <span class="heartbeat-badge ${statusBadgeClass(agent.lastUiStatus)}">
              ${formatUiStatus(agent.lastUiStatus)}
            </span>
          </div>
        </div>
        <div class="agent-kv">
          <div class="label">${t("heartbeat.nextDue")}</div>
          <div>${formatFutureRelative(agent.nextDueMs)}</div>
        </div>
        <div class="agent-kv">
          <div class="label">${t("heartbeat.lastRun")}</div>
          <div>
            ${agent.lastRunMs ? formatRelativeTimestamp(agent.lastRunMs) : t("heartbeat.status.never")}
          </div>
        </div>
        <div class="agent-kv">
          <div class="label">${t("heartbeat.interval")}</div>
          <div class="mono">${agent.every} (${formatIntervalMs(agent.intervalMs)})</div>
        </div>
      </div>

      ${
        uptimeSinceMs
          ? html`
              <div class="muted" style="margin-top: 8px; font-size: 12px;">
                ${t("heartbeat.sinceStartup")} (${formatRelativeTimestamp(uptimeSinceMs)})
              </div>
            `
          : nothing
      }

      <div style="margin-top: 20px;">
        <div class="label">${t("heartbeat.interval")}</div>
        <div class="row" style="gap: 8px; flex-wrap: wrap; margin-top: 4px;">
          ${PRESETS.map(
            (preset) => html`
              <button
                type="button"
                class="btn btn--sm ${currentEvery === preset ? "primary" : ""}"
                ?disabled=${disabled}
                @click=${() => onHeartbeatIntervalChange(agentId, preset)}
              >
                ${preset}
              </button>
            `,
          )}
          <button
            type="button"
            class="btn btn--sm ${isCustom ? "primary" : ""}"
            ?disabled=${disabled}
            @click=${() => {
              // Focus the custom input when clicking "Custom"
              const input = document.querySelector<HTMLInputElement>("#heartbeat-custom-input");
              if (input) {
                input.focus();
              }
            }}
          >
            ${t("heartbeat.presets.custom")}
          </button>
        </div>
        <div style="margin-top: 8px;">
          <input
            id="heartbeat-custom-input"
            class="input"
            style="max-width: 200px;"
            placeholder=${t("heartbeat.customPlaceholder")}
            .value=${isCustom ? currentEvery : ""}
            ?disabled=${disabled}
            @input=${(e: Event) => {
              const val = (e.target as HTMLInputElement).value.trim();
              if (val && INTERVAL_REGEX.test(val)) {
                onHeartbeatIntervalChange(agentId, val);
              }
            }}
          />
          ${
            isCustom && !INTERVAL_REGEX.test(currentEvery)
              ? html`
                  <div class="callout danger" style="margin-top: 4px; font-size: 12px">
                    ${t("heartbeat.invalidFormat")}
                  </div>
                `
              : nothing
          }
        </div>
      </div>

      <div class="row" style="justify-content: flex-end; gap: 8px; margin-top: 16px;">
        <button class="btn btn--sm" ?disabled=${configLoading} @click=${onConfigReload}>
          Reload Config
        </button>
        <button
          class="btn btn--sm primary"
          ?disabled=${configSaving || !configDirty}
          @click=${onConfigSave}
        >
          ${configSaving ? t("heartbeat.saving") : t("heartbeat.save")}
        </button>
      </div>
    </section>
  `;
}

function formatIntervalMs(ms: number): string {
  if (ms < 60_000) {
    return `${Math.round(ms / 1000)}s`;
  }
  if (ms < 3_600_000) {
    return `${Math.round(ms / 60_000)}m`;
  }
  if (ms < 86_400_000) {
    const h = Math.floor(ms / 3_600_000);
    const m = Math.round((ms % 3_600_000) / 60_000);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${Math.round(ms / 86_400_000)}d`;
}

/**
 * Read the heartbeat `every` value from the config form for a given agent.
 * Checks per-agent override first, then defaults.
 */
function resolveCurrentEvery(
  configForm: Record<string, unknown> | null,
  agentId: string,
): string | null {
  if (!configForm) {
    return null;
  }
  const cfg = configForm as {
    agents?: {
      defaults?: { heartbeat?: { every?: string } };
      list?: Array<{ id?: string; heartbeat?: { every?: string } }>;
    };
  };
  // Per-agent override
  const entry = cfg.agents?.list?.find((e) => e?.id === agentId);
  if (entry?.heartbeat?.every) {
    return entry.heartbeat.every;
  }
  // Defaults
  return cfg.agents?.defaults?.heartbeat?.every ?? null;
}
