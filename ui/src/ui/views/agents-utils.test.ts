import { describe, expect, it } from "vitest";
import {
  agentLogoUrl,
  FEATURE_MODEL_SPECS,
  resolveConfiguredCronModelSuggestions,
  resolveAgentAvatarUrl,
  resolveEffectiveModelFallbacks,
  resolveFeatureDefaultsLabel,
  resolveFeatureModelValue,
  resolveFeaturePerAgentValue,
  sortLocaleStrings,
} from "./agents-utils.ts";

describe("resolveEffectiveModelFallbacks", () => {
  it("inherits defaults when no entry fallbacks are configured", () => {
    const entryModel = undefined;
    const defaultModel = {
      primary: "openai/gpt-5-nano",
      fallbacks: ["google/gemini-2.0-flash"],
    };

    expect(resolveEffectiveModelFallbacks(entryModel, defaultModel)).toEqual([
      "google/gemini-2.0-flash",
    ]);
  });

  it("prefers entry fallbacks over defaults", () => {
    const entryModel = {
      primary: "openai/gpt-5-mini",
      fallbacks: ["openai/gpt-5-nano"],
    };
    const defaultModel = {
      primary: "openai/gpt-5",
      fallbacks: ["google/gemini-2.0-flash"],
    };

    expect(resolveEffectiveModelFallbacks(entryModel, defaultModel)).toEqual(["openai/gpt-5-nano"]);
  });

  it("keeps explicit empty entry fallback lists", () => {
    const entryModel = {
      primary: "openai/gpt-5-mini",
      fallbacks: [],
    };
    const defaultModel = {
      primary: "openai/gpt-5",
      fallbacks: ["google/gemini-2.0-flash"],
    };

    expect(resolveEffectiveModelFallbacks(entryModel, defaultModel)).toEqual([]);
  });
});

describe("resolveConfiguredCronModelSuggestions", () => {
  it("collects defaults primary/fallbacks, alias map keys, and per-agent model entries", () => {
    const result = resolveConfiguredCronModelSuggestions({
      agents: {
        defaults: {
          model: {
            primary: "openai/gpt-5.2",
            fallbacks: ["google/gemini-2.5-pro", "openai/gpt-5.2-mini"],
          },
          models: {
            "anthropic/claude-sonnet-4-5": { alias: "smart" },
            "openai/gpt-5.2": { alias: "main" },
          },
        },
        list: {
          writer: {
            model: { primary: "xai/grok-4", fallbacks: ["openai/gpt-5.2-mini"] },
          },
          planner: {
            model: "google/gemini-2.5-flash",
          },
        },
      },
    });

    expect(result).toEqual([
      "anthropic/claude-sonnet-4-5",
      "google/gemini-2.5-flash",
      "google/gemini-2.5-pro",
      "openai/gpt-5.2",
      "openai/gpt-5.2-mini",
      "xai/grok-4",
    ]);
  });

  it("returns empty array for invalid or missing config shape", () => {
    expect(resolveConfiguredCronModelSuggestions(null)).toEqual([]);
    expect(resolveConfiguredCronModelSuggestions({})).toEqual([]);
    expect(resolveConfiguredCronModelSuggestions({ agents: { defaults: { model: "" } } })).toEqual(
      [],
    );
  });
});

describe("sortLocaleStrings", () => {
  it("sorts values using localeCompare without relying on Array.prototype.toSorted", () => {
    expect(sortLocaleStrings(["z", "b", "a"])).toEqual(["a", "b", "z"]);
  });

  it("accepts any iterable input, including sets", () => {
    expect(sortLocaleStrings(new Set(["beta", "alpha"]))).toEqual(["alpha", "beta"]);
  });
});

describe("agentLogoUrl", () => {
  it("keeps base-mounted control UI logo paths absolute to the mount", () => {
    expect(agentLogoUrl("/ui")).toBe("/ui/favicon.svg");
    expect(agentLogoUrl("/apps/openclaw/")).toBe("/apps/openclaw/favicon.svg");
  });

  it("uses a route-relative fallback before basePath bootstrap finishes", () => {
    expect(agentLogoUrl("")).toBe("favicon.svg");
  });
});

describe("resolveAgentAvatarUrl", () => {
  it("prefers a runtime avatar URL over non-URL identity avatars", () => {
    expect(
      resolveAgentAvatarUrl(
        { identity: { avatar: "A", avatarUrl: "/avatar/main" } },
        {
          agentId: "main",
          avatar: "A",
          name: "Main",
        },
      ),
    ).toBe("/avatar/main");
  });

  it("returns null for initials or emoji avatar values without a URL", () => {
    expect(resolveAgentAvatarUrl({ identity: { avatar: "A" } })).toBeNull();
    expect(resolveAgentAvatarUrl({ identity: { avatar: "\uD83E\uDD9E" } })).toBeNull();
  });
});

// fork: feature-model-overrides tests

const heartbeatSpec = FEATURE_MODEL_SPECS.find((s) => s.key === "heartbeat")!;
const compactionSpec = FEATURE_MODEL_SPECS.find((s) => s.key === "compaction")!;
const subagentsSpec = FEATURE_MODEL_SPECS.find((s) => s.key === "subagents")!;
const imageModelSpec = FEATURE_MODEL_SPECS.find((s) => s.key === "imageModel")!;

describe("resolveFeatureModelValue", () => {
  it("returns null when configForm is null", () => {
    expect(resolveFeatureModelValue(null, heartbeatSpec, null, true)).toBeNull();
  });

  it("reads defaults-level plain string for default agent", () => {
    const config = { agents: { defaults: { heartbeat: { model: "openai/gpt-5-nano" } } } };
    expect(resolveFeatureModelValue(config, heartbeatSpec, null, true)).toBe("openai/gpt-5-nano");
  });

  it("reads defaults-level AgentModelConfig (object with primary) for subagents", () => {
    const config = {
      agents: {
        defaults: {
          subagents: {
            model: { primary: "anthropic/claude-sonnet-4-5", fallbacks: ["openai/gpt-5"] },
          },
        },
      },
    };
    expect(resolveFeatureModelValue(config, subagentsSpec, null, true)).toBe(
      "anthropic/claude-sonnet-4-5",
    );
  });

  it("reads per-agent override for non-default agent", () => {
    const config = {
      agents: {
        defaults: { heartbeat: { model: "openai/gpt-5-nano" } },
        list: [{ id: "writer", heartbeat: { model: "google/gemini-2.0-flash" } }],
      },
    };
    expect(resolveFeatureModelValue(config, heartbeatSpec, 0, false)).toBe(
      "google/gemini-2.0-flash",
    );
  });

  it("falls back to defaults when per-agent override is not set", () => {
    const config = {
      agents: {
        defaults: { heartbeat: { model: "openai/gpt-5-nano" } },
        list: [{ id: "writer" }],
      },
    };
    expect(resolveFeatureModelValue(config, heartbeatSpec, 0, false)).toBe("openai/gpt-5-nano");
  });

  it("returns null when neither per-agent nor defaults are set", () => {
    const config = { agents: { defaults: {}, list: [{ id: "writer" }] } };
    expect(resolveFeatureModelValue(config, heartbeatSpec, 0, false)).toBeNull();
  });

  it("skips per-agent lookup when agentIndex is negative", () => {
    const config = {
      agents: {
        defaults: { heartbeat: { model: "openai/gpt-5-nano" } },
        list: [{ id: "writer", heartbeat: { model: "google/gemini-2.0-flash" } }],
      },
    };
    // agentIndex -1 means agent not found in list — should fall back to defaults
    expect(resolveFeatureModelValue(config, heartbeatSpec, -1, false)).toBe("openai/gpt-5-nano");
  });

  it("skips per-agent lookup for specs without perAgentPath (compaction)", () => {
    const config = {
      agents: { defaults: { compaction: { model: "openai/gpt-5-nano" } } },
    };
    expect(resolveFeatureModelValue(config, compactionSpec, 0, false)).toBe("openai/gpt-5-nano");
  });

  it("handles imageModel as a direct string at defaults level", () => {
    const config = { agents: { defaults: { imageModel: "openai/gpt-5" } } };
    expect(resolveFeatureModelValue(config, imageModelSpec, null, true)).toBe("openai/gpt-5");
  });
});

describe("resolveFeatureDefaultsLabel", () => {
  it("returns null when configForm is null", () => {
    expect(resolveFeatureDefaultsLabel(null, heartbeatSpec)).toBeNull();
  });

  it("returns the defaults-level model string", () => {
    const config = { agents: { defaults: { heartbeat: { model: "openai/gpt-5-nano" } } } };
    expect(resolveFeatureDefaultsLabel(config, heartbeatSpec)).toBe("openai/gpt-5-nano");
  });

  it("returns primary from an AgentModelConfig object", () => {
    const config = {
      agents: {
        defaults: {
          subagents: { model: { primary: "xai/grok-4", fallbacks: [] } },
        },
      },
    };
    expect(resolveFeatureDefaultsLabel(config, subagentsSpec)).toBe("xai/grok-4");
  });

  it("returns null when defaults key is absent", () => {
    const config = { agents: { defaults: {} } };
    expect(resolveFeatureDefaultsLabel(config, compactionSpec)).toBeNull();
  });

  it("returns null for empty-string model", () => {
    const config = { agents: { defaults: { heartbeat: { model: "  " } } } };
    expect(resolveFeatureDefaultsLabel(config, heartbeatSpec)).toBeNull();
  });
});

describe("resolveFeaturePerAgentValue", () => {
  it("returns null when configForm is null", () => {
    expect(resolveFeaturePerAgentValue(null, heartbeatSpec, 0)).toBeNull();
  });

  it("returns null for specs without perAgentPath", () => {
    const config = { agents: { defaults: { compaction: { model: "openai/gpt-5" } } } };
    expect(resolveFeaturePerAgentValue(config, compactionSpec, 0)).toBeNull();
    expect(resolveFeaturePerAgentValue(config, imageModelSpec, 0)).toBeNull();
  });

  it("returns per-agent override when set", () => {
    const config = {
      agents: {
        list: [{ id: "writer", heartbeat: { model: "google/gemini-2.0-flash" } }],
      },
    };
    expect(resolveFeaturePerAgentValue(config, heartbeatSpec, 0)).toBe("google/gemini-2.0-flash");
  });

  it("returns null when per-agent override is not set", () => {
    const config = { agents: { list: [{ id: "writer" }] } };
    expect(resolveFeaturePerAgentValue(config, heartbeatSpec, 0)).toBeNull();
  });

  it("extracts primary from AgentModelConfig at per-agent level", () => {
    const config = {
      agents: {
        list: [
          {
            id: "coder",
            subagents: { model: { primary: "anthropic/claude-sonnet-4-5", fallbacks: [] } },
          },
        ],
      },
    };
    expect(resolveFeaturePerAgentValue(config, subagentsSpec, 0)).toBe(
      "anthropic/claude-sonnet-4-5",
    );
  });

  it("returns correct value for second agent in list", () => {
    const config = {
      agents: {
        list: [{ id: "agent-a" }, { id: "agent-b", heartbeat: { model: "xai/grok-4" } }],
      },
    };
    expect(resolveFeaturePerAgentValue(config, heartbeatSpec, 0)).toBeNull();
    expect(resolveFeaturePerAgentValue(config, heartbeatSpec, 1)).toBe("xai/grok-4");
  });
});
