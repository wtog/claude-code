/**
 * Qwen OAuth device-code flow with PKCE.
 *
 * Authenticates against chat.qwen.ai and stores the resulting tokens in the
 * shared Claude Code secure storage (macOS Keychain or ~/.claude/.credentials.json
 * plaintext fallback) under the `qwenOauth` key.
 *
 * Runtime callers should use `resolveQwenAuth()` to get a `{ apiKey, baseURL }`
 * pair — it transparently refreshes near-expiry OAuth tokens and falls back to
 * `QWEN_API_KEY` / `DASHSCOPE_API_KEY` env vars when no OAuth session exists.
 */

import { getSecureStorage } from '../../../utils/secureStorage/index.js'
import { logForDebugging } from '../../../utils/debug.js'

const QWEN_DEVICE_CODE_ENDPOINT =
  'https://chat.qwen.ai/api/v1/oauth2/device/code'
const QWEN_TOKEN_ENDPOINT = 'https://chat.qwen.ai/api/v1/oauth2/token'
const QWEN_CLIENT_ID = 'f0304373b74a44d2b584a3fb70ca9e56'
const QWEN_SCOPE = 'openid profile email model.completion'
const QWEN_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code'
const QWEN_DEFAULT_BASE_URL =
  'https://dashscope.aliyuncs.com/compatible-mode/v1'
const QWEN_DEFAULT_POLL_INTERVAL_MS = 2000
// Refresh slightly before actual expiry so in-flight requests don't race a 401.
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000

export interface QwenOAuthCredentials {
  accessToken: string
  refreshToken: string
  expiresAt: number
  resourceUrl?: string
}

export interface DeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval?: number
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  token_type?: string
  expires_in: number
  resource_url?: string
  error?: string
  error_description?: string
}

export interface DeviceFlowStart {
  deviceCode: DeviceCodeResponse
  verifier: string
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function generatePKCE(): Promise<{
  verifier: string
  challenge: string
}> {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  const verifier = base64UrlEncode(array)

  const encoded = new TextEncoder().encode(verifier)
  const hash = await crypto.subtle.digest('SHA-256', encoded)
  const challenge = base64UrlEncode(new Uint8Array(hash))
  return { verifier, challenge }
}

/**
 * Compute the DashScope OpenAI-compatible base URL from an optional
 * `resource_url` returned by the OAuth token response. Falls back to the
 * public DashScope URL when the token endpoint doesn't provide one.
 */
export function resolveQwenBaseUrl(resourceUrl?: string): string {
  if (!resourceUrl) return QWEN_DEFAULT_BASE_URL
  let url = resourceUrl.startsWith('http')
    ? resourceUrl
    : `https://${resourceUrl}`
  if (!url.endsWith('/v1')) url = `${url}/v1`
  return url
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Login cancelled'))
      return
    }
    const timeout = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timeout)
        reject(new Error('Login cancelled'))
      },
      { once: true },
    )
  })
}

export async function startDeviceFlow(): Promise<DeviceFlowStart> {
  const { verifier, challenge } = await generatePKCE()

  const body = new URLSearchParams({
    client_id: QWEN_CLIENT_ID,
    scope: QWEN_SCOPE,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  })

  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  }
  const requestId = globalThis.crypto?.randomUUID?.()
  if (requestId) headers['x-request-id'] = requestId

  const response = await fetch(QWEN_DEVICE_CODE_ENDPOINT, {
    method: 'POST',
    headers,
    body: body.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Device code request failed: ${response.status} ${text}`)
  }

  const data = (await response.json()) as DeviceCodeResponse
  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error('Invalid device code response: missing required fields')
  }
  return { deviceCode: data, verifier }
}

export async function pollForToken(
  deviceCode: string,
  verifier: string,
  intervalSeconds: number | undefined,
  expiresIn: number,
  signal?: AbortSignal,
): Promise<TokenResponse> {
  const deadline = Date.now() + expiresIn * 1000
  const resolvedIntervalSeconds =
    typeof intervalSeconds === 'number' &&
    Number.isFinite(intervalSeconds) &&
    intervalSeconds > 0
      ? intervalSeconds
      : QWEN_DEFAULT_POLL_INTERVAL_MS / 1000
  let intervalMs = Math.max(1000, Math.floor(resolvedIntervalSeconds * 1000))

  const handleTokenError = async (
    error: string,
    description?: string,
  ): Promise<boolean> => {
    switch (error) {
      case 'authorization_pending':
        await abortableSleep(intervalMs, signal)
        return true
      case 'slow_down':
        intervalMs = Math.min(intervalMs + 5000, 10000)
        await abortableSleep(intervalMs, signal)
        return true
      case 'expired_token':
        throw new Error('Device code expired. Please restart authentication.')
      case 'access_denied':
        throw new Error('Authorization denied by user.')
      default:
        throw new Error(`Token request failed: ${error} - ${description || ''}`)
    }
  }

  while (Date.now() < deadline) {
    if (signal?.aborted) throw new Error('Login cancelled')

    const body = new URLSearchParams({
      grant_type: QWEN_GRANT_TYPE,
      client_id: QWEN_CLIENT_ID,
      device_code: deviceCode,
      code_verifier: verifier,
    })

    const response = await fetch(QWEN_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: body.toString(),
    })

    const responseText = await response.text()
    let data: TokenResponse | null = null
    if (responseText) {
      try {
        data = JSON.parse(responseText) as TokenResponse
      } catch {
        data = null
      }
    }

    const error = data?.error
    const errorDescription = data?.error_description

    if (!response.ok) {
      if (error && (await handleTokenError(error, errorDescription))) continue
      throw new Error(
        `Token request failed: ${response.status} ${response.statusText}. Response: ${responseText}`,
      )
    }

    if (data?.access_token) return data

    if (error && (await handleTokenError(error, errorDescription))) continue

    throw new Error('Token request failed: missing access token in response')
  }

  throw new Error('Authentication timed out. Please try again.')
}

function tokenResponseToCredentials(
  data: TokenResponse,
  existing?: QwenOAuthCredentials,
): QwenOAuthCredentials {
  const expiresAt =
    Date.now() + data.expires_in * 1000 - TOKEN_REFRESH_BUFFER_MS
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || existing?.refreshToken || '',
    expiresAt,
    resourceUrl: data.resource_url ?? existing?.resourceUrl,
  }
}

export interface OAuthLoginCallbacks {
  onAuth: (info: { url: string; userCode: string; expiresIn: number }) => void
  signal?: AbortSignal
}

export async function loginQwen(
  callbacks: OAuthLoginCallbacks,
): Promise<QwenOAuthCredentials> {
  const { deviceCode, verifier } = await startDeviceFlow()

  const authUrl =
    deviceCode.verification_uri_complete || deviceCode.verification_uri
  callbacks.onAuth({
    url: authUrl,
    userCode: deviceCode.user_code,
    expiresIn: deviceCode.expires_in,
  })

  const tokenResponse = await pollForToken(
    deviceCode.device_code,
    verifier,
    deviceCode.interval,
    deviceCode.expires_in,
    callbacks.signal,
  )

  return tokenResponseToCredentials(tokenResponse)
}

export async function refreshQwenToken(
  credentials: QwenOAuthCredentials,
): Promise<QwenOAuthCredentials> {
  if (!credentials.refreshToken) {
    throw new Error(
      'No refresh token available; please run `claude qwen login`',
    )
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: credentials.refreshToken,
    client_id: QWEN_CLIENT_ID,
  })

  const response = await fetch(QWEN_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token refresh failed: ${response.status} ${text}`)
  }

  const data = (await response.json()) as TokenResponse
  if (!data.access_token) {
    throw new Error('Token refresh failed: no access token in response')
  }

  return tokenResponseToCredentials(data, credentials)
}

// ---------------------------------------------------------------------------
// Secure storage helpers — all keyed under `qwenOauth`, isolated from
// Anthropic-account tokens (`claudeAiOauth`).
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'qwenOauth'

export function loadQwenOAuthTokens(): QwenOAuthCredentials | null {
  try {
    const storage = getSecureStorage()
    const data = storage.read() ?? {}
    const creds = data[STORAGE_KEY] as QwenOAuthCredentials | undefined
    if (!creds?.accessToken) return null
    return creds
  } catch (err) {
    logForDebugging(`[Qwen OAuth] read failed: ${(err as Error).message}`, {
      level: 'error',
    })
    return null
  }
}

export function saveQwenOAuthTokens(credentials: QwenOAuthCredentials): {
  success: boolean
  warning?: string
} {
  try {
    const storage = getSecureStorage()
    const data = storage.read() ?? {}
    data[STORAGE_KEY] = credentials
    return storage.update(data)
  } catch (err) {
    logForDebugging(`[Qwen OAuth] save failed: ${(err as Error).message}`, {
      level: 'error',
    })
    return { success: false, warning: 'Failed to save Qwen OAuth tokens' }
  }
}

export function clearQwenOAuthTokens(): boolean {
  try {
    const storage = getSecureStorage()
    const data = storage.read() ?? {}
    if (!(STORAGE_KEY in data)) return true
    delete data[STORAGE_KEY]
    const result = storage.update(data)
    return result.success
  } catch (err) {
    logForDebugging(`[Qwen OAuth] clear failed: ${(err as Error).message}`, {
      level: 'error',
    })
    return false
  }
}

/**
 * Refresh-in-flight dedup — multiple concurrent requests that all see a
 * near-expiry token should trigger a single refresh call.
 */
let pendingRefresh: Promise<QwenOAuthCredentials> | null = null

async function refreshAndPersist(
  credentials: QwenOAuthCredentials,
): Promise<QwenOAuthCredentials> {
  if (pendingRefresh) return pendingRefresh
  pendingRefresh = (async () => {
    try {
      const refreshed = await refreshQwenToken(credentials)
      saveQwenOAuthTokens(refreshed)
      return refreshed
    } finally {
      pendingRefresh = null
    }
  })()
  return pendingRefresh
}

export interface ResolvedQwenAuth {
  apiKey: string
  baseURL: string
  source: 'oauth' | 'env' | 'none'
}

/**
 * Resolve Qwen credentials for a request. Prefers a valid OAuth session
 * (auto-refreshing if near expiry), then falls back to the `QWEN_API_KEY`
 * / `DASHSCOPE_API_KEY` env vars. Returns `source: 'none'` with an empty
 * `apiKey` when nothing is configured — callers should let the downstream
 * API produce a 401 rather than throwing here, matching other providers.
 */
export async function resolveQwenAuth(): Promise<ResolvedQwenAuth> {
  const envBaseUrl = process.env.QWEN_BASE_URL
  const creds = loadQwenOAuthTokens()
  if (creds) {
    let active = creds
    if (Date.now() >= creds.expiresAt) {
      try {
        active = await refreshAndPersist(creds)
      } catch (err) {
        logForDebugging(
          `[Qwen OAuth] refresh failed, falling back to env: ${(err as Error).message}`,
          { level: 'error' },
        )
        active = creds
      }
    }
    return {
      apiKey: active.accessToken,
      baseURL: envBaseUrl ?? resolveQwenBaseUrl(active.resourceUrl),
      source: 'oauth',
    }
  }

  const envKey = process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || ''
  return {
    apiKey: envKey,
    baseURL: envBaseUrl ?? QWEN_DEFAULT_BASE_URL,
    source: envKey ? 'env' : 'none',
  }
}
