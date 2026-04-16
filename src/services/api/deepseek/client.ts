import OpenAI from 'openai'
import { getProxyFetchOptions } from 'src/utils/proxy.js'

/**
 * Environment variables:
 *
 * DEEPSEEK_API_KEY: Required. API key for the DeepSeek endpoint.
 * DEEPSEEK_BASE_URL: Optional. Defaults to https://api.deepseek.com/v1.
 */

const DEFAULT_BASE_URL = 'https://api.deepseek.com/v1'

let cachedClient: OpenAI | null = null

export function getDeepSeekClient(options?: {
  maxRetries?: number
  fetchOverride?: typeof fetch
  source?: string
}): OpenAI {
  if (cachedClient) return cachedClient

  const apiKey = process.env.DEEPSEEK_API_KEY || ''
  const baseURL = process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL

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

export function clearDeepSeekClientCache(): void {
  cachedClient = null
}
