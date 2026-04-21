import type { BetaToolUnion } from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { SystemPrompt } from '../../../utils/systemPromptType.js'
import type { Message, StreamEvent, SystemAPIErrorMessage, AssistantMessage } from '../../../types/message.js'
import type { Tools } from '../../../Tool.js'
import type {
  ChatCompletionChunk,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions/completions.mjs'
import { getDeepSeekClient } from './client.js'
import {
  anthropicMessagesToOpenAI,
  anthropicToolsToOpenAI,
  anthropicToolChoiceToOpenAI,
  adaptOpenAIStreamToAnthropic,
} from '@ant/model-provider'
import { resolveDeepSeekModel } from './modelMapping.js'
import { normalizeMessagesForAPI } from '../../../utils/messages.js'
import type { SDKAssistantMessageError } from '../../../entrypoints/agentSdkTypes.js'
import { toolToAPISchema } from '../../../utils/api.js'
import { logForDebugging } from '../../../utils/debug.js'
import { addToTotalSessionCost } from '../../../cost-tracker.js'
import { calculateUSDCost } from '../../../utils/modelCost.js'
import type { Options } from '../claude.js'
import { randomUUID } from 'crypto'
import {
  createAssistantAPIErrorMessage,
  normalizeContentFromAPI,
} from '../../../utils/messages.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '../../../utils/envUtils.js'

/**
 * Check whether DeepSeek thinking mode should be enabled.
 *
 * Enabled when:
 * 1. DEEPSEEK_ENABLE_THINKING=1 is set, OR
 * 2. Model name contains "reasoner" or "r1" (auto-detect)
 *
 * Disabled when DEEPSEEK_ENABLE_THINKING=0/false/no/off.
 */
function isDeepSeekThinkingEnabled(model: string): boolean {
  if (isEnvDefinedFalsy(process.env.DEEPSEEK_ENABLE_THINKING)) return false
  if (isEnvTruthy(process.env.DEEPSEEK_ENABLE_THINKING)) return true
  const modelLower = model.toLowerCase()
  return modelLower.includes('reasoner') || /\br1\b/.test(modelLower)
}

/**
 * DeepSeek query path. DeepSeek uses an OpenAI-compatible API, so we reuse
 * the OpenAI message/tool converters and stream adapter. Only the client
 * (different base URL + API key), model mapping, and thinking mode are
 * DeepSeek-specific.
 */
export async function* queryModelDeepSeek(
  messages: Message[],
  systemPrompt: SystemPrompt,
  tools: Tools,
  signal: AbortSignal,
  options: Options,
): AsyncGenerator<
  StreamEvent | AssistantMessage | SystemAPIErrorMessage,
  void
> {
  try {
    const deepseekModel = resolveDeepSeekModel(options.model)
    const messagesForAPI = normalizeMessagesForAPI(messages, tools)
    const enableThinking = isDeepSeekThinkingEnabled(deepseekModel)

    const toolSchemas = await Promise.all(
      tools.map(tool =>
        toolToAPISchema(tool, {
          getToolPermissionContext: options.getToolPermissionContext,
          tools,
          agents: options.agents,
          allowedAgentTypes: options.allowedAgentTypes,
          model: options.model,
        }),
      ),
    )
    const standardTools = toolSchemas.filter(
      (t): t is BetaToolUnion & { type: string } => {
        const anyT = t as unknown as Record<string, unknown>
        return anyT.type !== 'advisor_20260301' && anyT.type !== 'computer_20250124'
      },
    )

    const openaiMessages = anthropicMessagesToOpenAI(messagesForAPI, systemPrompt, {
      enableThinking,
    })
    const openaiTools = anthropicToolsToOpenAI(standardTools)
    const openaiToolChoice = anthropicToolChoiceToOpenAI(options.toolChoice)

    const client = getDeepSeekClient({
      maxRetries: 0,
      fetchOverride: options.fetchOverride as typeof fetch | undefined,
      source: options.querySource,
    })

    logForDebugging(`[DeepSeek] Calling model=${deepseekModel}, messages=${openaiMessages.length}, tools=${openaiTools.length}, thinking=${enableThinking}`)

    const stream = await client.chat.completions.create(
      {
        model: deepseekModel,
        messages: openaiMessages,
        ...(openaiTools.length > 0 && {
          tools: openaiTools,
          ...(openaiToolChoice && { tool_choice: openaiToolChoice }),
        }),
        stream: true,
        stream_options: { include_usage: true },
        ...(enableThinking && {
          thinking: { type: 'enabled' },
          enable_thinking: true,
          chat_template_kwargs: { thinking: true },
        }),
        ...(!enableThinking && options.temperatureOverride !== undefined && {
          temperature: options.temperatureOverride,
        }),
      } as ChatCompletionCreateParamsStreaming,
      { signal },
    )

    const adaptedStream = adaptOpenAIStreamToAnthropic(stream as AsyncIterable<ChatCompletionChunk>, deepseekModel)

    const contentBlocks: Record<number, any> = {}
    let partialMessage: any = undefined
    let usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    }
    let ttftMs = 0
    const start = Date.now()

    for await (const event of adaptedStream) {
      switch (event.type) {
        case 'message_start': {
          partialMessage = (event as any).message
          ttftMs = Date.now() - start
          if ((event as any).message?.usage) {
            usage = { ...usage, ...((event as any).message.usage) }
          }
          break
        }
        case 'content_block_start': {
          const idx = (event as any).index
          const cb = (event as any).content_block
          if (cb.type === 'tool_use') {
            contentBlocks[idx] = { ...cb, input: '' }
          } else if (cb.type === 'text') {
            contentBlocks[idx] = { ...cb, text: '' }
          } else if (cb.type === 'thinking') {
            contentBlocks[idx] = { ...cb, thinking: '', signature: '' }
          } else {
            contentBlocks[idx] = { ...cb }
          }
          break
        }
        case 'content_block_delta': {
          const idx = (event as any).index
          const delta = (event as any).delta
          const block = contentBlocks[idx]
          if (!block) break
          if (delta.type === 'text_delta') {
            block.text = (block.text || '') + delta.text
          } else if (delta.type === 'input_json_delta') {
            block.input = (block.input || '') + delta.partial_json
          } else if (delta.type === 'thinking_delta') {
            block.thinking = (block.thinking || '') + delta.thinking
          } else if (delta.type === 'signature_delta') {
            block.signature = delta.signature
          }
          break
        }
        case 'content_block_stop': {
          const idx = (event as any).index
          const block = contentBlocks[idx]
          if (!block || !partialMessage) break

          const m: AssistantMessage = {
            message: {
              ...partialMessage,
              content: normalizeContentFromAPI([block], tools, options.agentId),
            },
            requestId: undefined,
            type: 'assistant',
            uuid: randomUUID(),
            timestamp: new Date().toISOString(),
          }
          yield m
          break
        }
        case 'message_delta': {
          const deltaUsage = (event as any).usage
          if (deltaUsage) {
            usage = { ...usage, ...deltaUsage }
          }
          break
        }
        case 'message_stop':
          break
      }

      if (event.type === 'message_stop' && usage.input_tokens + usage.output_tokens > 0) {
        const costUSD = calculateUSDCost(deepseekModel, usage as any)
        addToTotalSessionCost(costUSD, usage as any, options.model)
      }

      yield {
        type: 'stream_event',
        event,
        ...(event.type === 'message_start' ? { ttftMs } : undefined),
      } as StreamEvent
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logForDebugging(`[DeepSeek] Error: ${errorMessage}`, { level: 'error' })
    yield createAssistantAPIErrorMessage({
      content: `API Error: ${errorMessage}`,
      apiError: 'api_error',
      error: (error instanceof Error ? error : new Error(String(error))) as unknown as SDKAssistantMessageError,
    })
  }
}
