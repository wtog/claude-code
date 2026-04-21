import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Box, Link, Text } from '@anthropic/ink'
import type { CommandResultDisplay } from '../../commands.js'
import TextInput from '../../components/TextInput.js'
import { Spinner } from '../../components/Spinner.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import { useTerminalSize } from '../../hooks/useTerminalSize.js'
import { clearDeepSeekClientCache } from '../../services/api/deepseek/client.js'
import { clearQwenClientCache } from '../../services/api/qwen/client.js'
import {
  loginQwen,
  resolveQwenBaseUrl,
  saveQwenOAuthTokens,
} from '../../services/api/qwen/oauth.js'
import { openBrowser } from '../../utils/browser.js'
import {
  getSettingsForSource,
  updateSettingsForSource,
} from '../../utils/settings/settings.js'

type OnDone = (
  result?: string,
  options?: { display?: CommandResultDisplay },
) => void

function clearProviderEnvOverrides(): void {
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_GROK
  delete process.env.CLAUDE_CODE_USE_DEEPSEEK
  delete process.env.CLAUDE_CODE_USE_QWEN
}

// ---------------------------------------------------------------------------
// Qwen OAuth login flow
// ---------------------------------------------------------------------------

type QwenState =
  | { kind: 'starting' }
  | {
      kind: 'awaiting'
      url: string
      userCode: string
      expiresIn: number
    }
  | { kind: 'success'; baseURL: string }
  | { kind: 'error'; message: string }
  | { kind: 'cancelled' }

export function QwenLoginFlow({ onDone }: { onDone: OnDone }): React.ReactNode {
  const [state, setState] = useState<QwenState>({ kind: 'starting' })
  const controllerRef = useRef<AbortController | null>(null)
  const finalizedRef = useRef(false)

  useEffect(() => {
    const controller = new AbortController()
    controllerRef.current = controller
    let cancelled = false

    ;(async () => {
      try {
        const credentials = await loginQwen({
          signal: controller.signal,
          onAuth: ({ url, userCode, expiresIn }) => {
            if (cancelled) return
            setState({ kind: 'awaiting', url, userCode, expiresIn })
            openBrowser(url).catch(() => {})
          },
        })
        if (cancelled) return
        const save = saveQwenOAuthTokens(credentials)
        if (!save.success) {
          setState({
            kind: 'error',
            message: save.warning || 'Failed to save Qwen tokens.',
          })
          return
        }
        updateSettingsForSource('userSettings', {
          modelType: 'qwen',
        } as Record<string, unknown>)
        clearProviderEnvOverrides()
        process.env.CLAUDE_CODE_USE_QWEN = '1'
        clearQwenClientCache()
        setState({
          kind: 'success',
          baseURL: resolveQwenBaseUrl(credentials.resourceUrl),
        })
      } catch (err) {
        if (cancelled || controller.signal.aborted) {
          setState({ kind: 'cancelled' })
          return
        }
        setState({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    })()

    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  useEffect(() => {
    if (finalizedRef.current) return
    if (state.kind === 'success') {
      finalizedRef.current = true
      onDone(`Switched API provider to Qwen (通义千问) · OAuth`)
    } else if (state.kind === 'cancelled') {
      finalizedRef.current = true
      onDone('Qwen login cancelled', { display: 'system' })
    } else if (state.kind === 'error') {
      finalizedRef.current = true
      onDone(`Qwen login failed: ${state.message}`, { display: 'system' })
    }
  }, [state, onDone])

  useKeybinding(
    'select:cancel',
    () => {
      controllerRef.current?.abort()
      if (!finalizedRef.current) {
        finalizedRef.current = true
        onDone('Qwen login cancelled', { display: 'system' })
      }
    },
    {
      context: 'QwenLogin',
      isActive: state.kind === 'starting' || state.kind === 'awaiting',
    },
  )

  if (state.kind === 'starting') {
    return (
      <Box flexDirection="column">
        <Text bold color="remember">
          Qwen (通义千问) OAuth
        </Text>
        <Box marginTop={1}>
          <Spinner />
          <Text> Requesting device code…</Text>
        </Box>
      </Box>
    )
  }

  if (state.kind === 'awaiting') {
    const minutes = Math.max(1, Math.round(state.expiresIn / 60))
    return (
      <Box flexDirection="column">
        <Text bold color="remember">
          Qwen (通义千问) OAuth
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text>Open this URL in your browser to authenticate:</Text>
          <Box marginTop={1}>
            <Link url={state.url}>
              <Text color="claude">{state.url}</Text>
            </Link>
          </Box>
          <Box marginTop={1}>
            <Text>
              User code: <Text bold>{state.userCode}</Text>
            </Text>
          </Box>
          <Text dimColor>Code expires in {minutes} minute(s).</Text>
        </Box>
        <Box marginTop={1}>
          <Spinner />
          <Text> Waiting for approval…</Text>
        </Box>
        <Text dimColor italic>
          Esc to cancel
        </Text>
      </Box>
    )
  }

  // Terminal states render nothing; onDone has been called.
  return null
}

// ---------------------------------------------------------------------------
// DeepSeek API-key input
// ---------------------------------------------------------------------------

type DeepSeekState =
  | { kind: 'input'; error?: string }
  | { kind: 'saved' }
  | { kind: 'cancelled' }

export function DeepSeekLoginFlow({
  onDone,
}: {
  onDone: OnDone
}): React.ReactNode {
  const [apiKey, setApiKey] = useState('')
  const [cursorOffset, setCursorOffset] = useState(0)
  const [state, setState] = useState<DeepSeekState>({ kind: 'input' })
  const finalizedRef = useRef(false)
  const { columns } = useTerminalSize()

  const handleSubmit = useCallback(
    (value: string) => {
      const trimmed = value.trim()
      if (!trimmed) {
        setState({
          kind: 'input',
          error: 'API key cannot be empty.',
        })
        return
      }

      const existing = getSettingsForSource('userSettings') || {}
      const existingEnv =
        (existing.env as Record<string, string> | undefined) || {}
      const env: Record<string, string> = {
        ...existingEnv,
        DEEPSEEK_API_KEY: trimmed,
      }
      const { error } = updateSettingsForSource('userSettings', {
        modelType: 'deepseek',
        env,
      } as Record<string, unknown>)
      if (error) {
        setState({
          kind: 'input',
          error: `Failed to save settings: ${error.message}`,
        })
        return
      }

      process.env.DEEPSEEK_API_KEY = trimmed
      clearProviderEnvOverrides()
      process.env.CLAUDE_CODE_USE_DEEPSEEK = '1'
      clearDeepSeekClientCache()
      setState({ kind: 'saved' })
    },
    [],
  )

  useEffect(() => {
    if (finalizedRef.current) return
    if (state.kind === 'saved') {
      finalizedRef.current = true
      onDone('Switched API provider to DeepSeek · API key saved to userSettings')
    } else if (state.kind === 'cancelled') {
      finalizedRef.current = true
      onDone('DeepSeek setup cancelled', { display: 'system' })
    }
  }, [state, onDone])

  useKeybinding(
    'select:cancel',
    () => {
      if (!finalizedRef.current) setState({ kind: 'cancelled' })
    },
    {
      context: 'DeepSeekLogin',
      isActive: state.kind === 'input',
    },
  )

  if (state.kind !== 'input') return null

  return (
    <Box flexDirection="column">
      <Text bold color="remember">
        Configure DeepSeek
      </Text>
      <Text dimColor>
        Paste your API key from{' '}
        <Link url="https://platform.deepseek.com/api_keys">
          platform.deepseek.com/api_keys
        </Link>
        . It will be saved to ~/.claude/settings.json under the `env` field.
      </Text>
      <Box marginTop={1}>
        <Text>DEEPSEEK_API_KEY: </Text>
        <TextInput
          value={apiKey}
          onChange={setApiKey}
          onSubmit={handleSubmit}
          cursorOffset={cursorOffset}
          onChangeCursorOffset={setCursorOffset}
          mask="•"
          showCursor
          columns={Math.max(40, columns - 20)}
          multiline={false}
        />
      </Box>
      {state.error && (
        <Box marginTop={1}>
          <Text color="error">{state.error}</Text>
        </Box>
      )}
      <Text dimColor italic>
        Enter to save · Esc to cancel
      </Text>
    </Box>
  )
}
