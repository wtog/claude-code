import { afterEach, beforeEach, describe, expect, test } from 'bun:test'

import { resolveQwenModel } from '../modelMapping.js'

describe('resolveQwenModel', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('QWEN_') || key.startsWith('ANTHROPIC_DEFAULT_')) {
        delete process.env[key]
      }
    }
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  test('QWEN_MODEL overrides everything', () => {
    process.env.QWEN_MODEL = 'anything-goes'
    expect(
      resolveQwenModel('claude-opus-4-6', { preferCoderModels: true }),
    ).toBe('anything-goes')
  })

  test('falls back to DashScope family default for opus', () => {
    expect(resolveQwenModel('claude-opus-4-6')).toBe('qwen-max')
  })

  test('uses coder catalog when preferCoderModels is true', () => {
    expect(
      resolveQwenModel('claude-opus-4-6', { preferCoderModels: true }),
    ).toBe('qwen3-coder-plus')
    expect(
      resolveQwenModel('claude-sonnet-4-6', { preferCoderModels: true }),
    ).toBe('qwen3-coder-plus')
    expect(
      resolveQwenModel('claude-haiku-4-5-20251001', {
        preferCoderModels: true,
      }),
    ).toBe('qwen3-coder-flash')
  })

  test('QWEN_DEFAULT_OPUS_MODEL wins over preferCoderModels hint', () => {
    process.env.QWEN_DEFAULT_OPUS_MODEL = 'user-override'
    expect(
      resolveQwenModel('claude-opus-4-6', { preferCoderModels: true }),
    ).toBe('user-override')
  })

  test('strips [1m] context-window suffix before lookup', () => {
    expect(resolveQwenModel('claude-opus-4-6[1m]')).toBe('qwen-max')
  })

  test('passes through unknown model names', () => {
    expect(resolveQwenModel('custom-model')).toBe('custom-model')
  })
})
