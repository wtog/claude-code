import OpenAI from 'openai'
import { getProxyFetchOptions } from 'src/utils/proxy.js'

/**
 * Environment variables:
 *
 * QWEN_API_KEY (or DASHSCOPE_API_KEY): Required. API key for the Qwen endpoint.
 * QWEN_BASE_URL: Optional. Defaults to https://dashscope.aliyuncs.com/compatible-mode/v1.
 */

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

let cachedClient: OpenAI | null = null

export function getQwenClient(options?: {
  maxRetries?: number
  fetchOverride?: typeof fetch
  source?: string
}): OpenAI {
  if (cachedClient) return cachedClient

  const apiKey = process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || ''
  const baseURL = process.env.QWEN_BASE_URL || DEFAULT_BASE_URL

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

export function clearQwenClientCache(): void {
  cachedClient = null
}
