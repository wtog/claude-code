/**
 * Default mapping from Anthropic model names to Qwen model names.
 *
 * Users can override via:
 * - QWEN_MODEL: override all (highest priority)
 * - QWEN_DEFAULT_{FAMILY}_MODEL: per-family override
 *
 * There are two distinct Qwen deployments with different model catalogs:
 *
 *   1. DashScope (dashscope.aliyuncs.com/compatible-mode/v1) — API key auth.
 *      Accepts `qwen-max`, `qwen-plus`, `qwen-turbo`, etc.
 *
 *   2. Qwen Code portal (portal.qwen.ai/v1) — OAuth via `claude qwen login`.
 *      Only accepts the `qwen3-coder-*` family and `vision-model`. Sending
 *      `qwen-max` here produces a 401 "invalid access token" (misleading — the
 *      token is fine; the model name is rejected).
 *
 * When the caller knows OAuth is active (`preferCoderModels: true`) we map
 * to the coder catalog so users don't need to hand-set QWEN_MODEL.
 */
const DEFAULT_MODEL_MAP: Record<string, string> = {
  'claude-sonnet-4-20250514': 'qwen-plus',
  'claude-sonnet-4-5-20250929': 'qwen-plus',
  'claude-sonnet-4-6': 'qwen-plus',
  'claude-opus-4-20250514': 'qwen-max',
  'claude-opus-4-1-20250805': 'qwen-max',
  'claude-opus-4-5-20251101': 'qwen-max',
  'claude-opus-4-6': 'qwen-max',
  'claude-haiku-4-5-20251001': 'qwen-turbo',
  'claude-3-5-haiku-20241022': 'qwen-turbo',
  'claude-3-7-sonnet-20250219': 'qwen-plus',
  'claude-3-5-sonnet-20241022': 'qwen-plus',
}

const DEFAULT_FAMILY_MAP: Record<string, string> = {
  opus: 'qwen-max',
  sonnet: 'qwen-plus',
  haiku: 'qwen-turbo',
}

const CODER_FAMILY_MAP: Record<string, string> = {
  opus: 'qwen3-coder-plus',
  sonnet: 'qwen3-coder-plus',
  haiku: 'qwen3-coder-flash',
}

function getModelFamily(model: string): 'haiku' | 'sonnet' | 'opus' | null {
  if (/haiku/i.test(model)) return 'haiku'
  if (/opus/i.test(model)) return 'opus'
  if (/sonnet/i.test(model)) return 'sonnet'
  return null
}

/**
 * Resolve the Qwen model name for a given Anthropic model.
 *
 * Priority:
 * 1. QWEN_MODEL env var (override all)
 * 2. QWEN_DEFAULT_{FAMILY}_MODEL env var
 * 3. ANTHROPIC_DEFAULT_{FAMILY}_MODEL env var (backward compat)
 * 4. DEFAULT_MODEL_MAP / coder map lookup
 * 5. Family-level default (coder map when preferCoderModels)
 * 6. Pass through original model name
 */
export function resolveQwenModel(
  anthropicModel: string,
  options?: { preferCoderModels?: boolean },
): string {
  if (process.env.QWEN_MODEL) {
    return process.env.QWEN_MODEL
  }

  const cleanModel = anthropicModel.replace(/\[1m\]$/, '')
  const family = getModelFamily(cleanModel)

  if (family) {
    const qwenEnvVar = `QWEN_DEFAULT_${family.toUpperCase()}_MODEL`
    const qwenOverride = process.env[qwenEnvVar]
    if (qwenOverride) return qwenOverride

    const anthropicEnvVar = `ANTHROPIC_DEFAULT_${family.toUpperCase()}_MODEL`
    const anthropicOverride = process.env[anthropicEnvVar]
    if (anthropicOverride) return anthropicOverride
  }

  if (options?.preferCoderModels && family && CODER_FAMILY_MAP[family]) {
    return CODER_FAMILY_MAP[family]
  }

  if (DEFAULT_MODEL_MAP[cleanModel]) {
    return DEFAULT_MODEL_MAP[cleanModel]
  }

  if (family && DEFAULT_FAMILY_MAP[family]) {
    return DEFAULT_FAMILY_MAP[family]
  }

  return cleanModel
}
