/**
 * Curated per-provider model shortlist shown in the "regenerate with"
 * menu (v2.11.0). Not a definitive catalogue — we only need a handful
 * of sensible alternatives so the user can quickly retry with a
 * stronger / cheaper / faster peer without leaving the chat.
 *
 * Keep this list small on purpose. A full model catalogue belongs in
 * Settings; surfacing 30 openrouter variants here would be noise.
 */
export const PROVIDER_MODEL_SUGGESTIONS: Record<string, string[]> = {
  openai: [
    'gpt-4o',
    'gpt-4o-mini',
    'gpt-4-turbo',
    'o1-preview',
    'o1-mini',
  ],
  anthropic: [
    'claude-opus-4-8',
    'claude-sonnet-4-6',
    'claude-haiku-4-5',
  ],
  gemini: [
    'gemini-2.5-pro',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-pro',
    'gemini-1.5-flash',
  ],
  openrouter: [
    'anthropic/claude-sonnet-4-6',
    'openai/gpt-4o',
    'openai/gpt-4o-mini',
    'google/gemini-2.5-pro',
    'meta-llama/llama-3.1-405b-instruct',
    'deepseek/deepseek-chat',
    'qwen/qwen-2.5-72b-instruct',
  ],
  modal: [
    // Modal Research only exposes specific HuggingFace-style model ids
    // (see https://api.us-west-2.modal.direct/v1/models). The previous
    // "llama-3.1-70b" shortlist didn't match any real endpoint and every
    // regen attempt 404'd. Match the actual catalogue.
    'zai-org/GLM-5.1-FP8',
    'Qwen/Qwen2.5-Coder-32B-Instruct',
    'deepseek-ai/DeepSeek-V3',
  ],
}
