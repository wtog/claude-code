/* eslint-disable custom-rules/no-process-exit -- CLI subcommand handlers intentionally exit */

import { openBrowser } from '../../utils/browser.js'
import { logForDebugging } from '../../utils/debug.js'
import { errorMessage } from '../../utils/errors.js'
import { logError } from '../../utils/log.js'
import { clearQwenClientCache } from '../../services/api/qwen/client.js'
import {
  clearQwenOAuthTokens,
  loadQwenOAuthTokens,
  loginQwen,
  resolveQwenBaseUrl,
  saveQwenOAuthTokens,
} from '../../services/api/qwen/oauth.js'

function printErr(message: string): void {
  process.stderr.write(`${message}\n`)
}

function printOut(message: string): void {
  process.stdout.write(`${message}\n`)
}

export async function qwenLogin(
  options: { noBrowser?: boolean } = {},
): Promise<void> {
  printOut('Starting Qwen OAuth device flow…')

  const controller = new AbortController()
  const onSigint = () => controller.abort()
  process.once('SIGINT', onSigint)

  try {
    const credentials = await loginQwen({
      signal: controller.signal,
      onAuth: ({ url, userCode, expiresIn }) => {
        printOut('')
        printOut('To authenticate, open the following URL in your browser:')
        printOut(`  ${url}`)
        printOut('')
        printOut(`User code: ${userCode}`)
        printOut(
          `This code expires in ${Math.round(expiresIn / 60)} minute(s).`,
        )
        printOut('Waiting for approval…')
        if (!options.noBrowser) {
          openBrowser(url).catch(err => {
            logForDebugging(
              `[Qwen OAuth] openBrowser failed: ${(err as Error).message}`,
              { level: 'error' },
            )
          })
        }
      },
    })

    const save = saveQwenOAuthTokens(credentials)
    if (!save.success) {
      printErr(save.warning || 'Failed to persist Qwen OAuth tokens.')
      process.exit(1)
    }
    if (save.warning) printErr(save.warning)

    clearQwenClientCache()
    printOut('')
    printOut('Qwen login successful.')
    printOut(`Base URL: ${resolveQwenBaseUrl(credentials.resourceUrl)}`)
    printOut(
      'Set CLAUDE_CODE_USE_QWEN=1 (or configure modelType=qwen) to route requests through Qwen.',
    )
    process.exit(0)
  } catch (err) {
    logError(err)
    printErr(`Qwen login failed: ${errorMessage(err)}`)
    process.exit(1)
  } finally {
    process.off('SIGINT', onSigint)
  }
}

export async function qwenLogout(): Promise<void> {
  const existing = loadQwenOAuthTokens()
  if (!existing) {
    printOut('Not logged in to Qwen.')
    process.exit(0)
  }
  const ok = clearQwenOAuthTokens()
  clearQwenClientCache()
  if (!ok) {
    printErr('Failed to remove Qwen OAuth tokens from secure storage.')
    process.exit(1)
  }
  printOut('Logged out of Qwen.')
  process.exit(0)
}

export async function qwenStatus(opts: { json?: boolean } = {}): Promise<void> {
  const tokens = loadQwenOAuthTokens()
  const envApiKey =
    process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || ''
  const envBaseUrl = process.env.QWEN_BASE_URL

  const baseURL = tokens
    ? (envBaseUrl ?? resolveQwenBaseUrl(tokens.resourceUrl))
    : (envBaseUrl ?? resolveQwenBaseUrl())

  const source: 'oauth' | 'env' | 'none' = tokens
    ? 'oauth'
    : envApiKey
      ? 'env'
      : 'none'

  const expiresAtIso = tokens ? new Date(tokens.expiresAt).toISOString() : null
  const expired = tokens ? Date.now() >= tokens.expiresAt : null

  if (opts.json) {
    const payload = {
      loggedIn: !!tokens,
      source,
      baseURL,
      expiresAt: expiresAtIso,
      expired,
      hasRefreshToken: !!tokens?.refreshToken,
    }
    printOut(JSON.stringify(payload, null, 2))
    process.exit(0)
  }

  if (source === 'none') {
    printOut('Qwen: not configured.')
    printOut(
      '  Run `claude qwen login` to authenticate, or set QWEN_API_KEY / DASHSCOPE_API_KEY.',
    )
    process.exit(0)
  }

  printOut(
    `Qwen: ${source === 'oauth' ? 'logged in via OAuth' : 'using env API key'}`,
  )
  printOut(`  Base URL: ${baseURL}`)
  if (tokens) {
    printOut(
      `  Access token expires: ${expiresAtIso}${expired ? ' (EXPIRED — will refresh on next call)' : ''}`,
    )
    printOut(`  Refresh token: ${tokens.refreshToken ? 'present' : 'missing'}`)
  }
  process.exit(0)
}
