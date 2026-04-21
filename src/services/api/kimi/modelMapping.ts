/**
 * Default mapping from Anthropic model names to Moonshot Kimi model names.
 *
 * Users can override via:
 * - KIMI_MODEL / MOONSHOT_MODEL: override all (highest priority)
 * - KIMI_DEFAULT_{FAMILY}_MODEL: per-family override
 */
const DEFAULT_MODEL_MAP: Record<string, string> = {
  'claude-sonnet-4-20250514': 'kimi-k2.6',
  'claude-sonnet-4-5-20250929': 'kimi-k2.6',
  'claude-sonnet-4-6': 'kimi-k2.6',
  'claude-opus-4-20250514': 'kimi-k2.6',
  'claude-opus-4-1-20250805': 'kimi-k2.6',
  'claude-opus-4-5-20251101': 'kimi-k2.6',
  'claude-opus-4-6': 'kimi-k2.6',
  'claude-haiku-4-5-20251001': 'kimi-k2.5',
  'claude-3-5-haiku-20241022': 'kimi-k2.5',
  'claude-3-7-sonnet-20250219': 'kimi-k2.6',
  'claude-3-5-sonnet-20241022': 'kimi-k2.6',
}

const DEFAULT_FAMILY_MAP: Record<string, string> = {
  opus: 'kimi-k2.6',
  sonnet: 'kimi-k2.6',
  haiku: 'kimi-k2.5',
}

function getModelFamily(model: string): 'haiku' | 'sonnet' | 'opus' | null {
  if (/haiku/i.test(model)) return 'haiku'
  if (/opus/i.test(model)) return 'opus'
  if (/sonnet/i.test(model)) return 'sonnet'
  return null
}

/**
 * Resolve the Kimi model name for a given Anthropic model.
 *
 * Priority:
 * 1. KIMI_MODEL / MOONSHOT_MODEL env var (override all)
 * 2. KIMI_DEFAULT_{FAMILY}_MODEL / MOONSHOT_DEFAULT_{FAMILY}_MODEL
 * 3. ANTHROPIC_DEFAULT_{FAMILY}_MODEL (backward compat)
 * 4. DEFAULT_MODEL_MAP lookup
 * 5. Family-level default
 * 6. Pass through original model name
 */
export function resolveKimiModel(anthropicModel: string): string {
  const override = process.env.KIMI_MODEL || process.env.MOONSHOT_MODEL
  if (override) return override

  const cleanModel = anthropicModel.replace(/\[1m\]$/, '')
  const family = getModelFamily(cleanModel)

  if (family) {
    const kimiOverride =
      process.env[`KIMI_DEFAULT_${family.toUpperCase()}_MODEL`] ||
      process.env[`MOONSHOT_DEFAULT_${family.toUpperCase()}_MODEL`]
    if (kimiOverride) return kimiOverride

    const anthropicOverride =
      process.env[`ANTHROPIC_DEFAULT_${family.toUpperCase()}_MODEL`]
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
