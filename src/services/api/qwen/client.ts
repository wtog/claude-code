import OpenAI from 'openai'
import { getProxyFetchOptions } from 'src/utils/proxy.js'

/**
 * Qwen (DashScope / chat.qwen.ai) OpenAI-compatible client.
 *
 * Credential resolution priority (handled by `resolveQwenAuth()` in ./oauth.ts):
 *   1. OAuth access token stored via `claude qwen login`
 *   2. QWEN_API_KEY env var
 *   3. DASHSCOPE_API_KEY env var
 *
 * Base URL priority:
 *   1. QWEN_BASE_URL env var (always wins, for enterprise/proxy setups)
 *   2. `resource_url` from the OAuth token response (if present)
 *   3. https://dashscope.aliyuncs.com/compatible-mode/v1
 *
 * Callers should pre-resolve credentials via `resolveQwenAuth()` and pass
 * them in as `credentials`. Omitting `credentials` falls back to reading
 * env vars synchronously — preserved for the small number of legacy call
 * sites that can't easily become async.
 */

const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

export interface QwenClientCredentials {
  apiKey: string
  baseURL: string
}

interface CachedClient {
  apiKey: string
  baseURL: string
  client: OpenAI
}

let cachedClient: CachedClient | null = null

export function getQwenClient(options?: {
  maxRetries?: number
  fetchOverride?: typeof fetch
  source?: string
  credentials?: QwenClientCredentials
}): OpenAI {
  const apiKey =
    options?.credentials?.apiKey ??
    process.env.QWEN_API_KEY ??
    process.env.DASHSCOPE_API_KEY ??
    ''
  const baseURL =
    options?.credentials?.baseURL ??
    process.env.QWEN_BASE_URL ??
    DEFAULT_BASE_URL

  if (
    cachedClient &&
    !options?.fetchOverride &&
    cachedClient.apiKey === apiKey &&
    cachedClient.baseURL === baseURL
  ) {
    return cachedClient.client
  }

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
    cachedClient = { apiKey, baseURL, client }
  }

  return client
}

export function clearQwenClientCache(): void {
  cachedClient = null
}
