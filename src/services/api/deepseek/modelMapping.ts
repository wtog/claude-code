/**
 * Default mapping from Anthropic model names to DeepSeek model names.
 *
 * Users can override via:
 * - DEEPSEEK_MODEL: override all (highest priority)
 * - DEEPSEEK_DEFAULT_{FAMILY}_MODEL: per-family override
 */
const DEFAULT_MODEL_MAP: Record<string, string> = {
  'claude-sonnet-4-20250514': 'deepseek-chat',
  'claude-sonnet-4-5-20250929': 'deepseek-chat',
  'claude-sonnet-4-6': 'deepseek-chat',
  'claude-opus-4-20250514': 'deepseek-reasoner',
  'claude-opus-4-1-20250805': 'deepseek-reasoner',
  'claude-opus-4-5-20251101': 'deepseek-reasoner',
  'claude-opus-4-6': 'deepseek-reasoner',
  'claude-haiku-4-5-20251001': 'deepseek-chat',
  'claude-3-5-haiku-20241022': 'deepseek-chat',
  'claude-3-7-sonnet-20250219': 'deepseek-chat',
  'claude-3-5-sonnet-20241022': 'deepseek-chat',
}

const DEFAULT_FAMILY_MAP: Record<string, string> = {
  opus: 'deepseek-reasoner',
  sonnet: 'deepseek-chat',
  haiku: 'deepseek-chat',
}

function getModelFamily(model: string): 'haiku' | 'sonnet' | 'opus' | null {
  if (/haiku/i.test(model)) return 'haiku'
  if (/opus/i.test(model)) return 'opus'
  if (/sonnet/i.test(model)) return 'sonnet'
  return null
}

/**
 * Resolve the DeepSeek model name for a given Anthropic model.
 *
 * Priority:
 * 1. DEEPSEEK_MODEL env var (override all)
 * 2. DEEPSEEK_DEFAULT_{FAMILY}_MODEL env var
 * 3. ANTHROPIC_DEFAULT_{FAMILY}_MODEL env var (backward compat)
 * 4. DEFAULT_MODEL_MAP lookup
 * 5. Family-level default
 * 6. Pass through original model name
 */
export function resolveDeepSeekModel(anthropicModel: string): string {
  if (process.env.DEEPSEEK_MODEL) {
    return process.env.DEEPSEEK_MODEL
  }

  const cleanModel = anthropicModel.replace(/\[1m\]$/, '')
  const family = getModelFamily(cleanModel)

  if (family) {
    const dsEnvVar = `DEEPSEEK_DEFAULT_${family.toUpperCase()}_MODEL`
    const dsOverride = process.env[dsEnvVar]
    if (dsOverride) return dsOverride

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
