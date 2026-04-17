import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'

import {
  clearQwenOAuthTokens,
  generatePKCE,
  loadQwenOAuthTokens,
  resolveQwenBaseUrl,
  saveQwenOAuthTokens,
} from '../oauth.js'

// In-memory secure-storage mock shared across tests.
const memory: { current: Record<string, unknown> } = { current: {} }

await mock.module('../../../../utils/secureStorage/index.js', () => ({
  getSecureStorage: () => ({
    name: 'memory',
    read: () => ({ ...memory.current }),
    readAsync: async () => ({ ...memory.current }),
    update: (data: Record<string, unknown>) => {
      memory.current = { ...data }
      return { success: true }
    },
    delete: () => {
      memory.current = {}
      return true
    },
  }),
}))

describe('resolveQwenBaseUrl', () => {
  test('returns default DashScope URL when no resource_url is provided', () => {
    expect(resolveQwenBaseUrl()).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    )
  })

  test('prepends https:// and appends /v1 to bare hostnames', () => {
    expect(resolveQwenBaseUrl('dashscope.aliyuncs.com/compatible-mode')).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    )
  })

  test('leaves fully-qualified URLs alone when they already end in /v1', () => {
    expect(resolveQwenBaseUrl('https://custom.qwen.example/api/v1')).toBe(
      'https://custom.qwen.example/api/v1',
    )
  })

  test('appends /v1 to fully-qualified URLs without /v1 suffix', () => {
    expect(resolveQwenBaseUrl('https://custom.qwen.example/api')).toBe(
      'https://custom.qwen.example/api/v1',
    )
  })
})

describe('generatePKCE', () => {
  test('returns url-safe verifier and challenge without padding', async () => {
    const { verifier, challenge } = await generatePKCE()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(verifier.length).toBeGreaterThanOrEqual(43)
    expect(challenge.length).toBeGreaterThanOrEqual(43)
  })

  test('produces different verifiers on each call', async () => {
    const a = await generatePKCE()
    const b = await generatePKCE()
    expect(a.verifier).not.toBe(b.verifier)
  })
})

describe('qwen oauth token storage', () => {
  beforeEach(() => {
    memory.current = {}
  })

  afterEach(() => {
    memory.current = {}
  })

  test('saves, loads, and clears credentials', () => {
    expect(loadQwenOAuthTokens()).toBeNull()

    const result = saveQwenOAuthTokens({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: Date.now() + 3600_000,
      resourceUrl: 'dashscope.aliyuncs.com/compatible-mode',
    })
    expect(result.success).toBe(true)

    const loaded = loadQwenOAuthTokens()
    expect(loaded?.accessToken).toBe('access')
    expect(loaded?.refreshToken).toBe('refresh')
    expect(loaded?.resourceUrl).toBe('dashscope.aliyuncs.com/compatible-mode')

    expect(clearQwenOAuthTokens()).toBe(true)
    expect(loadQwenOAuthTokens()).toBeNull()
  })

  test('clear is a no-op when no tokens exist', () => {
    expect(clearQwenOAuthTokens()).toBe(true)
  })

  test('does not clobber unrelated keys in secure storage', () => {
    memory.current = { claudeAiOauth: { accessToken: 'preserve' } }

    saveQwenOAuthTokens({
      accessToken: 'qwen',
      refreshToken: 'qwen-refresh',
      expiresAt: Date.now() + 3600_000,
    })
    expect(
      (memory.current.claudeAiOauth as { accessToken: string }).accessToken,
    ).toBe('preserve')

    clearQwenOAuthTokens()
    expect(
      (memory.current.claudeAiOauth as { accessToken: string }).accessToken,
    ).toBe('preserve')
  })
})
