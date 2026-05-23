import type { DeepSeekModel } from "./types.js";

export function buildModelsResponse(): { models: unknown[] } {
  return {
    models: [
      buildModelInfo("deepseek-v4-pro", "DeepSeek V4 Pro"),
      buildModelInfo("deepseek-v4-flash", "DeepSeek V4 Flash"),
    ],
  };
}

const BASE_INSTRUCTIONS =
  "You are Codex, a coding agent. Work in the user's local workspace, use tools when needed, and answer concisely.";

function buildModelInfo(slug: DeepSeekModel, displayName: string): unknown {
  return {
    slug,
    display_name: displayName,
    description: `${displayName} through the local DeepSeek Codex proxy.`,
    default_reasoning_level: "high",
    supported_reasoning_levels: [
      { effort: "high", description: "DeepSeek high reasoning effort" },
      { effort: "xhigh", description: "Mapped to DeepSeek max reasoning effort" },
    ],
    shell_type: "shell_command",
    visibility: "list",
    supported_in_api: true,
    priority: 0,
    additional_speed_tiers: [],
    service_tiers: [],
    availability_nux: null,
    upgrade: null,
    base_instructions: BASE_INSTRUCTIONS,
    model_messages: {
      instructions_template: "{{ personality }}",
      instructions_variables: {
        personality_default: BASE_INSTRUCTIONS,
        personality_friendly: BASE_INSTRUCTIONS,
        personality_pragmatic: BASE_INSTRUCTIONS,
      },
    },
    supports_reasoning_summaries: false,
    default_reasoning_summary: "none",
    support_verbosity: false,
    default_verbosity: "low",
    apply_patch_tool_type: "freeform",
    web_search_tool_type: "text_and_image",
    truncation_policy: { mode: "tokens", limit: 1000000 },
    supports_parallel_tool_calls: true,
    supports_image_detail_original: false,
    context_window: 1000000,
    max_context_window: 1000000,
    effective_context_window_percent: 95,
    experimental_supported_tools: [],
    input_modalities: ["text"],
    supports_search_tool: false,
  };
}
