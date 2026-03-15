import { html, nothing } from "lit";
import type { AgentIdentityResult, AgentsFilesListResult, AgentsListResult } from "../types.ts";
import {
  buildModelOptions,
  FEATURE_MODEL_SPECS,
  normalizeModelValue,
  parseFallbackList,
  resolveAgentConfig,
  resolveFeatureDefaultsLabel,
  resolveFeaturePerAgentValue,
  resolveModelFallbacks,
  resolveModelLabel,
  resolveModelPrimary,
} from "./agents-utils.ts";
import type { AgentsPanel } from "./agents.ts";

export function renderAgentOverview(params: {
  agent: AgentsListResult["agents"][number];
  basePath: string;
  defaultId: string | null;
  configForm: Record<string, unknown> | null;
  agentFilesList: AgentsFilesListResult | null;
  agentIdentity: AgentIdentityResult | null;
  agentIdentityLoading: boolean;
  agentIdentityError: string | null;
  configLoading: boolean;
  configSaving: boolean;
  configDirty: boolean;
  onConfigReload: () => void;
  onConfigSave: () => void;
  onModelChange: (agentId: string, modelId: string | null) => void;
  onModelFallbacksChange: (agentId: string, fallbacks: string[]) => void;
  onSelectPanel: (panel: AgentsPanel) => void;
  // fork: feature-model-overrides
  onFeatureModelChange: (agentId: string, feature: string, modelId: string | null) => void;
}) {
  const {
    agent,
    configForm,
    agentFilesList,
    configLoading,
    configSaving,
    configDirty,
    onConfigReload,
    onConfigSave,
    onModelChange,
    onModelFallbacksChange,
    onSelectPanel,
  } = params;
  const { onFeatureModelChange } = params;
  const config = resolveAgentConfig(configForm, agent.id);
  const workspaceFromFiles =
    agentFilesList && agentFilesList.agentId === agent.id ? agentFilesList.workspace : null;
  const workspace =
    workspaceFromFiles || config.entry?.workspace || config.defaults?.workspace || "default";
  const model = config.entry?.model
    ? resolveModelLabel(config.entry?.model)
    : resolveModelLabel(config.defaults?.model);
  const defaultModel = resolveModelLabel(config.defaults?.model);
  const entryPrimary = resolveModelPrimary(config.entry?.model);
  const defaultPrimary =
    resolveModelPrimary(config.defaults?.model) ||
    (defaultModel !== "-" ? normalizeModelValue(defaultModel) : null);
  const effectivePrimary = entryPrimary ?? defaultPrimary ?? null;
  const modelFallbacks = resolveModelFallbacks(config.entry?.model);
  const fallbackChips = modelFallbacks ?? [];
  const skillFilter = Array.isArray(config.entry?.skills) ? config.entry?.skills : null;
  const skillCount = skillFilter?.length ?? null;
  const isDefault = Boolean(params.defaultId && agent.id === params.defaultId);
  const disabled = !configForm || configLoading || configSaving;

  const removeChip = (index: number) => {
    const next = fallbackChips.filter((_, i) => i !== index);
    onModelFallbacksChange(agent.id, next);
  };

  const handleChipKeydown = (e: KeyboardEvent) => {
    const input = e.target as HTMLInputElement;
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      const parsed = parseFallbackList(input.value);
      if (parsed.length > 0) {
        onModelFallbacksChange(agent.id, [...fallbackChips, ...parsed]);
        input.value = "";
      }
    }
  };

  return html`
    <section class="card">
      <div class="card-title">Overview</div>
      <div class="card-sub">Workspace paths and identity metadata.</div>

      <div class="agents-overview-grid" style="margin-top: 16px;">
        <div class="agent-kv">
          <div class="label">Workspace</div>
          <div>
            <button
              type="button"
              class="workspace-link mono"
              @click=${() => onSelectPanel("files")}
              title="Open Files tab"
            >${workspace}</button>
          </div>
        </div>
        <div class="agent-kv">
          <div class="label">Primary Model</div>
          <div class="mono">${model}</div>
        </div>
        <div class="agent-kv">
          <div class="label">Skills Filter</div>
          <div>${skillFilter ? `${skillCount} selected` : "all skills"}</div>
        </div>
      </div>

      ${
        configDirty
          ? html`
              <div class="callout warn" style="margin-top: 16px">You have unsaved config changes.</div>
            `
          : nothing
      }

      <div class="agent-model-select" style="margin-top: 20px;">
        <div class="label">Model Selection</div>
        <div class="agent-model-fields">
          <label class="field">
            <span>Primary model${isDefault ? " (default)" : ""}</span>
            <datalist id="primary-model-list-${agent.id}">
              ${buildModelOptions(configForm, effectivePrimary ?? undefined)}
            </datalist>
            <input
              list="primary-model-list-${agent.id}"
              .value=${isDefault ? (effectivePrimary ?? "") : (entryPrimary ?? "")}
              ?disabled=${disabled}
              placeholder=${isDefault ? "provider/model" : defaultPrimary ? `Inherit default (${defaultPrimary})` : "Inherit default"}
              @change=${(e: Event) =>
                onModelChange(agent.id, (e.target as HTMLInputElement).value.trim() || null)}
            />
          </label>
          <div class="field">
            <span>Fallbacks</span>
            <div class="agent-chip-input" @click=${(e: Event) => {
              const container = e.currentTarget as HTMLElement;
              const input = container.querySelector("input");
              if (input) {
                input.focus();
              }
            }}>
              ${fallbackChips.map(
                (chip, i) => html`
                  <span class="chip">
                    ${chip}
                    <button
                      type="button"
                      class="chip-remove"
                      ?disabled=${disabled}
                      @click=${() => removeChip(i)}
                    >&times;</button>
                  </span>
                `,
              )}
              <input
                ?disabled=${disabled}
                placeholder=${fallbackChips.length === 0 ? "provider/model" : ""}
                @keydown=${handleChipKeydown}
                @blur=${(e: Event) => {
                  const input = e.target as HTMLInputElement;
                  const parsed = parseFallbackList(input.value);
                  if (parsed.length > 0) {
                    onModelFallbacksChange(agent.id, [...fallbackChips, ...parsed]);
                    input.value = "";
                  }
                }}
              />
            </div>
          </div>
        </div>

        ${renderFeatureModelOverrides({
          agent,
          configForm,
          isDefault,
          configLoading,
          configSaving,
          onFeatureModelChange,
        })}

        <div class="agent-model-actions">
          <button type="button" class="btn btn--sm" ?disabled=${configLoading} @click=${onConfigReload}>
            Reload Config
          </button>
          <button
            type="button"
            class="btn btn--sm primary"
            ?disabled=${configSaving || !configDirty}
            @click=${onConfigSave}
          >
            ${configSaving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </section>
  `;
}

// fork: feature-model-overrides
function renderFeatureModelOverrides(params: {
  agent: AgentsListResult["agents"][number];
  configForm: Record<string, unknown> | null;
  isDefault: boolean;
  configLoading: boolean;
  configSaving: boolean;
  onFeatureModelChange: (agentId: string, feature: string, modelId: string | null) => void;
}) {
  const { agent, configForm, isDefault, configLoading, configSaving, onFeatureModelChange } =
    params;
  const specs = isDefault
    ? FEATURE_MODEL_SPECS
    : FEATURE_MODEL_SPECS.filter((s) => s.perAgentPath !== null);

  if (specs.length === 0) {
    return nothing;
  }

  // Find agent index in config list for per-agent value lookups
  const cfgList = (configForm as { agents?: { list?: Array<{ id?: string }> } } | null)?.agents
    ?.list;
  const agentIndex = Array.isArray(cfgList)
    ? cfgList.findIndex((entry) => entry?.id === agent.id)
    : -1;

  const disabled = !configForm || configLoading || configSaving;

  return html`
    <details class="agent-feature-models">
      <summary class="agent-feature-models__summary">Feature Model Overrides</summary>
      <div class="row" style="gap: 12px; flex-wrap: wrap;">
        ${specs.map((spec) => {
          const defaultsLabel = resolveFeatureDefaultsLabel(configForm, spec);
          // For default agent: show the defaults-level value as selected
          // For non-default agent: show per-agent override if set
          const currentValue = isDefault
            ? defaultsLabel
            : agentIndex >= 0
              ? resolveFeaturePerAgentValue(configForm, spec, agentIndex)
              : null;
          const emptyLabel = isDefault
            ? "Not set"
            : defaultsLabel
              ? `Inherit default (${defaultsLabel})`
              : "Inherit default";

          return html`
            <label class="field" style="min-width: 220px; flex: 1;">
              <span>${spec.label}</span>
              <datalist id="feature-model-list-${agent.id}-${spec.key}">
                ${buildModelOptions(configForm, currentValue ?? undefined)}
              </datalist>
              <input
                list="feature-model-list-${agent.id}-${spec.key}"
                .value=${currentValue ?? ""}
                ?disabled=${disabled}
                placeholder=${emptyLabel}
                @change=${(e: Event) =>
                  onFeatureModelChange(
                    agent.id,
                    spec.key,
                    (e.target as HTMLInputElement).value.trim() || null,
                  )}
              />
            </label>
          `;
        })}
      </div>
    </details>
  `;
}
