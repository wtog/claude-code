import OpenAI from 'openai'
import { getProxyFetchOptions } from 'src/utils/proxy.js'

/**
 * Kimi (Moonshot AI) OpenAI-compatible client.
 *
 * Environment variables:
 *
 * KIMI_API_KEY / MOONSHOT_API_KEY: Required.
 * KIMI_BASE_URL / MOONSHOT_BASE_URL: Optional. Defaults to
 *   https://api.moonshot.cn/v1 (CN endpoint; international users can switch
 *   to https://api.moonshot.ai/v1).
 */

const DEFAULT_BASE_URL = 'https://api.moonshot.cn/v1'

let cachedClient: OpenAI | null = null

export function getKimiClient(options?: {
  maxRetries?: number
  fetchOverride?: typeof fetch
  source?: string
}): OpenAI {
  if (cachedClient && !options?.fetchOverride) return cachedClient

  const apiKey = process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY || ''
  const baseURL =
    process.env.KIMI_BASE_URL || process.env.MOONSHOT_BASE_URL || DEFAULT_BASE_URL

  const client = new OpenAI({
    apiKey,
    baseURL,
    maxRetries: options?.maxRetries ?? 0,
    timeout: parseInt(process.env.API_TIMEOUT_MS || String(600 * 1000), 10),
    dangerouslyAllowBrowser: true,
    fetchOptions: getProxyFetchOptions({ forAnthropicAPI: false }),
    ...(options?.fetchOverride && { fetch: options.fetchOverride }),
  })

  if (!options?.fetchOverride) {
    cachedClient = client
  }

  return client
}

export function clearKimiClientCache(): void {
  cachedClient = null
}
