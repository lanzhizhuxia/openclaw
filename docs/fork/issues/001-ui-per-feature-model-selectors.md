# UI: add per-feature model selectors in Agents panel

## Summary

The Agents panel in the Control UI currently only exposes a primary model dropdown and fallbacks input. Other features that support per-feature model overrides (heartbeat, compaction, subagents) are only configurable through the generic config form editor, which is hard to discover and use.

For users who frequently switch models or want to optimize token costs by routing different features to different providers (e.g., Claude for primary conversations, Haiku for heartbeat/compaction, Qwen for subagents), dedicated model selectors in the Agents panel would significantly improve the experience.

## Requested Changes

Add dedicated model selection dropdowns in the Agents panel for:

| Feature                    | Config Key                         | Current UI               |
| -------------------------- | ---------------------------------- | ------------------------ |
| Heartbeat                  | `agents.defaults.heartbeat.model`  | Generic config form only |
| Compaction / Summarization | `agents.defaults.compaction.model` | Generic config form only |
| Subagents                  | `agents.defaults.subagents.model`  | Generic config form only |
| Image Understanding        | `agents.defaults.imageModel`       | Generic config form only |

Each selector should:

- Reuse the existing `buildModelOptions()` helper from `ui/src/ui/views/agents-utils.ts`
- Support "Inherit default" option for non-default agents
- Save via the standard `config.set` RPC flow
- Be grouped in a collapsible "Per-Feature Model Overrides" section below the primary model selector

## Context

- Config-level support already exists for all these fields; this is purely a UI enhancement
- Reference implementation: primary model dropdown in `ui/src/ui/views/agents.ts:447-496`
- Reference implementation: cron job model input in `ui/src/ui/views/cron.ts:1148-1175`
- Estimated effort: ~150-200 lines of Lit template code in `agents.ts`
- No gateway changes needed; UI-only change

## Motivation

Frequent model switching for cost optimization -- different features have very different token profiles:

- Heartbeat: runs every N minutes automatically, can use a cheap model
- Compaction: heavy but infrequent, benefits from a capable-but-cheap model
- Subagents: spawned by the primary agent, can use a lighter model
- Primary conversation: needs the most capable model
