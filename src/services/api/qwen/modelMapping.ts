/**
 * Default mapping from Anthropic model names to Qwen model names.
 *
 * Users can override via:
 * - QWEN_MODEL: override all (highest priority)
 * - QWEN_DEFAULT_{FAMILY}_MODEL: per-family override
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
 * 4. DEFAULT_MODEL_MAP lookup
 * 5. Family-level default
 * 6. Pass through original model name
 */
export function resolveQwenModel(anthropicModel: string): string {
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

  if (DEFAULT_MODEL_MAP[cleanModel]) {
    return DEFAULT_MODEL_MAP[cleanModel]
  }

  if (family && DEFAULT_FAMILY_MAP[family]) {
    return DEFAULT_FAMILY_MAP[family]
  }

  return cleanModel
}
