import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { clearQwenClientCache, getQwenClient } from '../client.js'

describe('getQwenClient', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    clearQwenClientCache()
    process.env.QWEN_API_KEY = 'test-key'
    delete process.env.QWEN_BASE_URL
    delete process.env.DASHSCOPE_API_KEY
  })

  afterEach(() => {
    clearQwenClientCache()
    process.env = { ...originalEnv }
  })

  test('creates client with default DashScope base URL', () => {
    const client = getQwenClient()
    expect(client).toBeDefined()
    expect(client.baseURL).toBe(
      'https://dashscope.aliyuncs.com/compatible-mode/v1',
    )
  })

  test('uses QWEN_BASE_URL when set', () => {
    process.env.QWEN_BASE_URL = 'https://custom.qwen.api/v1'
    clearQwenClientCache()
    const client = getQwenClient()
    expect(client.baseURL).toBe('https://custom.qwen.api/v1')
  })

  test('explicit credentials override env vars', () => {
    process.env.QWEN_API_KEY = 'env-key'
    const client = getQwenClient({
      credentials: {
        apiKey: 'oauth-access-token',
        baseURL: 'https://oauth.qwen.api/v1',
      },
    })
    expect(client.apiKey).toBe('oauth-access-token')
    expect(client.baseURL).toBe('https://oauth.qwen.api/v1')
  })

  test('returns same cached client for identical credentials', () => {
    const a = getQwenClient()
    const b = getQwenClient()
    expect(a).toBe(b)
  })

  test('returns a fresh client when credentials differ', () => {
    const a = getQwenClient({
      credentials: {
        apiKey: 'k1',
        baseURL: 'https://one.qwen.api/v1',
      },
    })
    const b = getQwenClient({
      credentials: {
        apiKey: 'k2',
        baseURL: 'https://two.qwen.api/v1',
      },
    })
    expect(a).not.toBe(b)
  })

  test('clearQwenClientCache resets cache', () => {
    const a = getQwenClient()
    clearQwenClientCache()
    process.env.QWEN_BASE_URL = 'https://other.api/v1'
    const b = getQwenClient()
    expect(a).not.toBe(b)
  })
})
