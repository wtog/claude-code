import chalk from 'chalk'
import * as React from 'react'
import type { CommandResultDisplay } from '../../commands.js'
import { ModelPicker } from '../../components/ModelPicker.js'
import { COMMON_HELP_ARGS, COMMON_INFO_ARGS } from '../../constants/xml.js'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '../../services/analytics/index.js'
import { useAppState, useSetAppState } from '../../state/AppState.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import type { EffortLevel } from '../../utils/effort.js'
import { isBilledAsExtraUsage } from '../../utils/extraUsage.js'
import {
  clearFastModeCooldown,
  isFastModeAvailable,
  isFastModeEnabled,
  isFastModeSupportedByModel,
} from '../../utils/fastMode.js'
import { MODEL_ALIASES } from '../../utils/model/aliases.js'
import {
  checkOpus1mAccess,
  checkSonnet1mAccess,
} from '../../utils/model/check1mAccess.js'
import {
  getDefaultMainLoopModelSetting,
  isOpus1mMergeEnabled,
  renderDefaultModelSetting,
} from '../../utils/model/model.js'
import { isModelAllowed } from '../../utils/model/modelAllowlist.js'
import {
  isDeepSeekModelId,
  isKimiModelId,
  SWITCH_PROVIDER_ANTHROPIC,
  SWITCH_PROVIDER_DEEPSEEK,
  SWITCH_PROVIDER_KIMI,
  SWITCH_PROVIDER_QWEN,
} from '../../utils/model/modelOptions.js'
import { getAPIProvider } from '../../utils/model/providers.js'
import { validateModel } from '../../utils/model/validateModel.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'
import { clearDeepSeekClientCache } from '../../services/api/deepseek/client.js'
import { clearKimiClientCache } from '../../services/api/kimi/client.js'
import { clearQwenClientCache } from '../../services/api/qwen/client.js'
import { loadQwenOAuthTokens } from '../../services/api/qwen/oauth.js'
import {
  DeepSeekLoginFlow,
  KimiLoginFlow,
  QwenLoginFlow,
} from './providerLoginFlow.js'

type ProviderSwitchKind = 'anthropic' | 'qwen' | 'deepseek' | 'kimi'

function parseProviderSwitch(
  model: string | null | undefined,
): ProviderSwitchKind | null {
  if (!model) return null
  // Tolerate the [1m] suffix that ModelPicker may append if the user toggles it.
  const bare = model.replace(/\[1m\]$/i, '')
  if (bare === SWITCH_PROVIDER_ANTHROPIC) return 'anthropic'
  if (bare === SWITCH_PROVIDER_QWEN) return 'qwen'
  if (bare === SWITCH_PROVIDER_DEEPSEEK) return 'deepseek'
  if (bare === SWITCH_PROVIDER_KIMI) return 'kimi'
  return null
}

function clearProviderEnvOverrides(): void {
  delete process.env.CLAUDE_CODE_USE_BEDROCK
  delete process.env.CLAUDE_CODE_USE_VERTEX
  delete process.env.CLAUDE_CODE_USE_FOUNDRY
  delete process.env.CLAUDE_CODE_USE_OPENAI
  delete process.env.CLAUDE_CODE_USE_GEMINI
  delete process.env.CLAUDE_CODE_USE_GROK
  delete process.env.CLAUDE_CODE_USE_DEEPSEEK
  delete process.env.CLAUDE_CODE_USE_QWEN
  delete process.env.CLAUDE_CODE_USE_KIMI
}

type LoginCapableProvider = 'qwen' | 'deepseek' | 'kimi'
type ProviderSwitchResult =
  | { outcome: 'switched'; message: string }
  | { outcome: 'needs-login'; provider: LoginCapableProvider }

function tryProviderSwitch(kind: ProviderSwitchKind): ProviderSwitchResult {
  if (kind === 'anthropic') {
    updateSettingsForSource('userSettings', {
      modelType: 'anthropic',
    } as Record<string, unknown>)
    clearProviderEnvOverrides()
    clearQwenClientCache()
    clearDeepSeekClientCache()
    clearKimiClientCache()
    return {
      outcome: 'switched',
      message: `Switched API provider to ${chalk.bold('Anthropic Claude')}`,
    }
  }

  if (kind === 'qwen') {
    const tokens = loadQwenOAuthTokens()
    const envKey = process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY
    if (!tokens?.accessToken && !envKey) {
      return { outcome: 'needs-login', provider: 'qwen' }
    }
    updateSettingsForSource('userSettings', {
      modelType: 'qwen',
    } as Record<string, unknown>)
    clearProviderEnvOverrides()
    process.env.CLAUDE_CODE_USE_QWEN = '1'
    clearQwenClientCache()
    return {
      outcome: 'switched',
      message: `Switched API provider to ${chalk.bold('Qwen (通义千问)')}${
        tokens?.accessToken ? ' · OAuth' : ' · API key'
      }`,
    }
  }

  if (kind === 'deepseek') {
    if (!process.env.DEEPSEEK_API_KEY) {
      return { outcome: 'needs-login', provider: 'deepseek' }
    }
    updateSettingsForSource('userSettings', {
      modelType: 'deepseek',
    } as Record<string, unknown>)
    clearProviderEnvOverrides()
    process.env.CLAUDE_CODE_USE_DEEPSEEK = '1'
    clearDeepSeekClientCache()
    return {
      outcome: 'switched',
      message: `Switched API provider to ${chalk.bold('DeepSeek')}`,
    }
  }

  // kimi
  if (!process.env.KIMI_API_KEY && !process.env.MOONSHOT_API_KEY) {
    return { outcome: 'needs-login', provider: 'kimi' }
  }
  updateSettingsForSource('userSettings', {
    modelType: 'kimi',
  } as Record<string, unknown>)
  clearProviderEnvOverrides()
  process.env.CLAUDE_CODE_USE_KIMI = '1'
  clearKimiClientCache()
  return {
    outcome: 'switched',
    message: `Switched API provider to ${chalk.bold('Kimi (月之暗面)')}`,
  }
}

function ModelPickerWrapper({
  onDone,
}: {
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}): React.ReactNode {
  const mainLoopModel = useAppState(s => s.mainLoopModel)
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession)
  const isFastMode = useAppState(s => s.fastMode)
  const setAppState = useSetAppState()
  const [loginStage, setLoginStage] = React.useState<
    'qwen' | 'deepseek' | 'kimi' | null
  >(null)
  const [pendingKimiModel, setPendingKimiModel] = React.useState<
    string | undefined
  >(undefined)
  const [pendingDeepSeekModel, setPendingDeepSeekModel] = React.useState<
    string | undefined
  >(undefined)

  if (loginStage === 'qwen') return <QwenLoginFlow onDone={onDone} />
  if (loginStage === 'deepseek')
    return (
      <DeepSeekLoginFlow onDone={onDone} targetModel={pendingDeepSeekModel} />
    )
  if (loginStage === 'kimi')
    return <KimiLoginFlow onDone={onDone} targetModel={pendingKimiModel} />

  function handleCancel(): void {
    logEvent('tengu_model_command_menu', {
      action:
        'cancel' as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    const displayModel = renderModelLabel(mainLoopModel)
    onDone(`Kept model as ${chalk.bold(displayModel)}`, {
      display: 'system',
    })
  }

  function handleSelect(
    model: string | null,
    effort: EffortLevel | undefined,
  ): void {
    logEvent('tengu_model_command_menu', {
      action:
        model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      from_model:
        mainLoopModel as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      to_model:
        model as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })

    const providerKind = parseProviderSwitch(model)
    if (providerKind) {
      const result = tryProviderSwitch(providerKind)
      if (result.outcome === 'switched') {
        // Switching back to Anthropic also clears any third-party model
        // pin so /model re-converges on the Claude family default.
        if (providerKind === 'anthropic') {
          setAppState(prev => ({
            ...prev,
            mainLoopModel: null,
            mainLoopModelForSession: null,
          }))
        }
        onDone(result.message)
      } else {
        // Pivot this component to the appropriate inline login flow.
        // `tryProviderSwitch` only returns `needs-login` for Qwen/DeepSeek/Kimi.
        setLoginStage(result.provider)
      }
      return
    }

    // Explicit Kimi model selection (e.g. `kimi-k2.6`). Ensure the Kimi
    // provider is active — if creds are missing, pivot to the inline Kimi
    // login flow and carry the target model through it.
    if (model && isKimiModelId(model)) {
      const onKimi = getAPIProvider() === 'kimi'
      const hasCreds = !!(
        process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY
      )
      if (!hasCreds) {
        setPendingKimiModel(model)
        setLoginStage('kimi')
        return
      }
      if (!onKimi) {
        updateSettingsForSource('userSettings', {
          modelType: 'kimi',
        } as Record<string, unknown>)
        clearProviderEnvOverrides()
        process.env.CLAUDE_CODE_USE_KIMI = '1'
        clearKimiClientCache()
      }
      setAppState(prev => ({
        ...prev,
        mainLoopModel: model,
        mainLoopModelForSession: null,
      }))
      onDone(
        `Set model to ${chalk.bold(model)} on ${chalk.bold('Kimi (月之暗面)')}`,
      )
      return
    }

    // Explicit DeepSeek model selection (e.g. `deepseek-chat`). Same
    // logic as Kimi: auto-switch provider, log in inline if no creds.
    if (model && isDeepSeekModelId(model)) {
      const onDeepSeek = getAPIProvider() === 'deepseek'
      if (!process.env.DEEPSEEK_API_KEY) {
        setPendingDeepSeekModel(model)
        setLoginStage('deepseek')
        return
      }
      if (!onDeepSeek) {
        updateSettingsForSource('userSettings', {
          modelType: 'deepseek',
        } as Record<string, unknown>)
        clearProviderEnvOverrides()
        process.env.CLAUDE_CODE_USE_DEEPSEEK = '1'
        clearDeepSeekClientCache()
      }
      setAppState(prev => ({
        ...prev,
        mainLoopModel: model,
        mainLoopModelForSession: null,
      }))
      onDone(
        `Set model to ${chalk.bold(model)} on ${chalk.bold('DeepSeek')}`,
      )
      return
    }

    setAppState(prev => ({
      ...prev,
      mainLoopModel: model,
      mainLoopModelForSession: null,
    }))

    let message = `Set model to ${chalk.bold(renderModelLabel(model))}`
    if (effort !== undefined) {
      message += ` with ${chalk.bold(effort)} effort`
    }

    // Turn off fast mode if switching to unsupported model
    let wasFastModeToggledOn = undefined
    if (isFastModeEnabled()) {
      clearFastModeCooldown()
      if (!isFastModeSupportedByModel(model) && isFastMode) {
        setAppState(prev => ({
          ...prev,
          fastMode: false,
        }))
        wasFastModeToggledOn = false
        // Do not update fast mode in settings since this is an automatic downgrade
      } else if (
        isFastModeSupportedByModel(model) &&
        isFastModeAvailable() &&
        isFastMode
      ) {
        message += ` · Fast mode ON`
        wasFastModeToggledOn = true
      }
    }

    if (
      isBilledAsExtraUsage(
        model,
        wasFastModeToggledOn === true,
        isOpus1mMergeEnabled(),
      )
    ) {
      message += ` · Billed as extra usage`
    }

    if (wasFastModeToggledOn === false) {
      // Fast mode was toggled off, show suffix after extra usage billing
      message += ` · Fast mode OFF`
    }

    onDone(message)
  }

  return (
    <ModelPicker
      initial={mainLoopModel}
      sessionModel={mainLoopModelForSession}
      onSelect={handleSelect}
      onCancel={handleCancel}
      isStandaloneCommand
      showFastModeNotice={
        isFastModeEnabled() &&
        isFastMode &&
        isFastModeSupportedByModel(mainLoopModel) &&
        isFastModeAvailable()
      }
    />
  )
}

function SetModelAndClose({
  args,
  onDone,
}: {
  args: string
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}): React.ReactNode {
  const isFastMode = useAppState(s => s.fastMode)
  const setAppState = useSetAppState()
  const model = args === 'default' ? null : args
  const [loginStage, setLoginStage] = React.useState<
    LoginCapableProvider | null
  >(null)
  const [pendingKimiModel, setPendingKimiModel] = React.useState<
    string | undefined
  >(undefined)
  const [pendingDeepSeekModel, setPendingDeepSeekModel] = React.useState<
    string | undefined
  >(undefined)

  React.useEffect(() => {
    async function handleModelChange(): Promise<void> {
      const providerKind = parseProviderSwitch(model)
      if (providerKind) {
        const result = tryProviderSwitch(providerKind)
        if (result.outcome === 'switched') {
          if (providerKind === 'anthropic') {
            setAppState(prev => ({
              ...prev,
              mainLoopModel: null,
              mainLoopModelForSession: null,
            }))
          }
          onDone(result.message)
        } else {
          setLoginStage(result.provider)
        }
        return
      }

      if (model && isKimiModelId(model)) {
        const hasCreds = !!(
          process.env.KIMI_API_KEY || process.env.MOONSHOT_API_KEY
        )
        if (!hasCreds) {
          setPendingKimiModel(model)
          setLoginStage('kimi')
          return
        }
        if (getAPIProvider() !== 'kimi') {
          updateSettingsForSource('userSettings', {
            modelType: 'kimi',
          } as Record<string, unknown>)
          clearProviderEnvOverrides()
          process.env.CLAUDE_CODE_USE_KIMI = '1'
          clearKimiClientCache()
        }
        setAppState(prev => ({
          ...prev,
          mainLoopModel: model,
          mainLoopModelForSession: null,
        }))
        onDone(
          `Set model to ${chalk.bold(model)} on ${chalk.bold('Kimi (月之暗面)')}`,
        )
        return
      }

      if (model && isDeepSeekModelId(model)) {
        if (!process.env.DEEPSEEK_API_KEY) {
          setPendingDeepSeekModel(model)
          setLoginStage('deepseek')
          return
        }
        if (getAPIProvider() !== 'deepseek') {
          updateSettingsForSource('userSettings', {
            modelType: 'deepseek',
          } as Record<string, unknown>)
          clearProviderEnvOverrides()
          process.env.CLAUDE_CODE_USE_DEEPSEEK = '1'
          clearDeepSeekClientCache()
        }
        setAppState(prev => ({
          ...prev,
          mainLoopModel: model,
          mainLoopModelForSession: null,
        }))
        onDone(
          `Set model to ${chalk.bold(model)} on ${chalk.bold('DeepSeek')}`,
        )
        return
      }

      if (model && !isModelAllowed(model)) {
        onDone(
          `Model '${model}' is not available. Your organization restricts model selection.`,
          { display: 'system' },
        )
        return
      }

      // @[MODEL LAUNCH]: Update check for 1M access.
      if (model && isOpus1mUnavailable(model)) {
        onDone(
          `Opus 4.6 with 1M context is not available for your account. Learn more: https://code.claude.com/docs/en/model-config#extended-context-with-1m`,
          { display: 'system' },
        )
        return
      }

      if (model && isSonnet1mUnavailable(model)) {
        onDone(
          `Sonnet 4.6 with 1M context is not available for your account. Learn more: https://code.claude.com/docs/en/model-config#extended-context-with-1m`,
          { display: 'system' },
        )
        return
      }

      // Skip validation for default model
      if (!model) {
        setModel(null)
        return
      }

      // Skip validation for known aliases - they're predefined and should work
      if (isKnownAlias(model)) {
        setModel(model)
        return
      }

      // Validate and set custom model
      try {
        // Don't use parseUserSpecifiedModel for non-aliases since it lowercases the input
        // and model names are case-sensitive
        const { valid, error } = await validateModel(model)

        if (valid) {
          setModel(model)
        } else {
          onDone(error || `Model '${model}' not found`, {
            display: 'system',
          })
        }
      } catch (error) {
        onDone(`Failed to validate model: ${(error as Error).message}`, {
          display: 'system',
        })
      }
    }

    function setModel(modelValue: string | null): void {
      setAppState(prev => ({
        ...prev,
        mainLoopModel: modelValue,
        mainLoopModelForSession: null,
      }))
      let message = `Set model to ${chalk.bold(renderModelLabel(modelValue))}`

      let wasFastModeToggledOn = undefined
      if (isFastModeEnabled()) {
        clearFastModeCooldown()
        if (!isFastModeSupportedByModel(modelValue) && isFastMode) {
          setAppState(prev => ({
            ...prev,
            fastMode: false,
          }))
          wasFastModeToggledOn = false
          // Do not update fast mode in settings since this is an automatic downgrade
        } else if (isFastModeSupportedByModel(modelValue) && isFastMode) {
          message += ` · Fast mode ON`
          wasFastModeToggledOn = true
        }
      }

      if (
        isBilledAsExtraUsage(
          modelValue,
          wasFastModeToggledOn === true,
          isOpus1mMergeEnabled(),
        )
      ) {
        message += ` · Billed as extra usage`
      }

      if (wasFastModeToggledOn === false) {
        // Fast mode was toggled off, show suffix after extra usage billing
        message += ` · Fast mode OFF`
      }

      onDone(message)
    }

    void handleModelChange()
  }, [model, onDone, setAppState])

  if (loginStage === 'qwen') return <QwenLoginFlow onDone={onDone} />
  if (loginStage === 'deepseek')
    return (
      <DeepSeekLoginFlow onDone={onDone} targetModel={pendingDeepSeekModel} />
    )
  if (loginStage === 'kimi')
    return <KimiLoginFlow onDone={onDone} targetModel={pendingKimiModel} />
  return null
}

function isKnownAlias(model: string): boolean {
  return (MODEL_ALIASES as readonly string[]).includes(
    model.toLowerCase().trim(),
  )
}

function isOpus1mUnavailable(model: string): boolean {
  const m = model.toLowerCase()
  return (
    !checkOpus1mAccess() &&
    !isOpus1mMergeEnabled() &&
    m.includes('opus') &&
    m.includes('[1m]')
  )
}

function isSonnet1mUnavailable(model: string): boolean {
  const m = model.toLowerCase()
  // Warn about Sonnet and Sonnet 4.6, but not Sonnet 4.5 since that had
  // a different access criteria.
  return (
    !checkSonnet1mAccess() &&
    (m.includes('sonnet[1m]') || m.includes('sonnet-4-6[1m]'))
  )
}

function ShowModelAndClose({
  onDone,
}: {
  onDone: (result?: string) => void
}): React.ReactNode {
  const mainLoopModel = useAppState(s => s.mainLoopModel)
  const mainLoopModelForSession = useAppState(s => s.mainLoopModelForSession)
  const effortValue = useAppState(s => s.effortValue)
  const displayModel = renderModelLabel(mainLoopModel)
  const effortInfo =
    effortValue !== undefined ? ` (effort: ${effortValue})` : ''

  if (mainLoopModelForSession) {
    onDone(
      `Current model: ${chalk.bold(renderModelLabel(mainLoopModelForSession))} (session override from plan mode)\nBase model: ${displayModel}${effortInfo}`,
    )
  } else {
    onDone(`Current model: ${displayModel}${effortInfo}`)
  }

  return null
}

export const call: LocalJSXCommandCall = async (onDone, _context, args) => {
  args = args?.trim() || ''
  if (COMMON_INFO_ARGS.includes(args)) {
    logEvent('tengu_model_command_inline_help', {
      args: args as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    return <ShowModelAndClose onDone={onDone} />
  }
  if (COMMON_HELP_ARGS.includes(args)) {
    onDone(
      'Run /model to open the model selection menu, or /model [modelName] to set the model.',
      { display: 'system' },
    )
    return
  }

  if (args) {
    logEvent('tengu_model_command_inline', {
      args: args as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    })
    // Shorthand: `/model qwen` / `/model deepseek` / `/model kimi` switches
    // provider.
    const lowered = args.toLowerCase()
    const resolved =
      lowered === 'qwen'
        ? SWITCH_PROVIDER_QWEN
        : lowered === 'deepseek'
        ? SWITCH_PROVIDER_DEEPSEEK
        : lowered === 'kimi' || lowered === 'moonshot'
        ? SWITCH_PROVIDER_KIMI
        : args
    return <SetModelAndClose args={resolved} onDone={onDone} />
  }

  return <ModelPickerWrapper onDone={onDone} />
}

function renderModelLabel(model: string | null): string {
  const rendered = renderDefaultModelSetting(
    model ?? getDefaultMainLoopModelSetting(),
  )
  return model === null ? `${rendered} (default)` : rendered
}
