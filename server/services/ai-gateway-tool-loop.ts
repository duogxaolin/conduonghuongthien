/**
 * `callAi`'s multi-step tool-calling loop — part of the `ai-gateway.ts` family (the split of
 * `callAi`, wave3 follow-up to 4.3). Moved out of the function as it was; the steps:
 *
 *   1. ask the model, with the tools on, whether a tool is needed — streamed when the
 *      caller streams, buffered otherwise;
 *   2. if it called tools: run them (`ai-gateway-tools.ts`), replay call + results, and ask
 *      again with the tools off for the final answer;
 *      if it answered directly: that answer, plus — only when a streamed step 1 showed the
 *      visitor nothing — one follow-up request as a safety net.
 *
 * Three of the gateway's four SSE readings are here, each through `readChatSse`
 * (`ai-sse.ts`, the ONE reader — `tests/ai-gateway-one-sse-reader.test.ts`). Any throw
 * inside the loop — a body that is not JSON, a stream that breaks, an `onToolCall` that
 * throws — ends the call as `provider_error`.
 */
import { cleanAiContent } from './ai-text-cleaner'
import { extractToolCallsFromMessage } from './ai-response-parse'
import { readChatSse, type ToolCallAccumulator } from './ai-sse'
import { isSuccess, parseUpToLastBrace, responseText, type ProviderSender } from './ai-gateway-send'
import { createToolLoopTokens } from './ai-gateway-tokens'
import { assistantToolCallMessage, formatToolDefinitions, runToolCalls } from './ai-gateway-tools'
import type { AiCallInput, AiPathOutcome, AiToolDefinition, ExecutedToolCall, PreparedAiCall } from './ai-gateway-types'

/** The last resort for a final answer that cleans to nothing: the raw text minus `<|channel>` spans only. */
function withoutChannelSpans(text: string): string {
  return text.replace(/<\|channel>[\s\S]*?<channel\|>/gi, '').trim()
}

/** The step-2 / follow-up request: the step-1 body with the tools off and the same `max_tokens`. */
function toolsOff(reqBodyObj: Record<string, unknown>, originalMaxTokens: unknown, stream: boolean): string {
  delete reqBodyObj.tools
  delete reqBodyObj.tool_choice
  reqBodyObj.max_tokens = originalMaxTokens
  reqBodyObj.stream = stream
  return JSON.stringify(reqBodyObj)
}

export async function runToolLoop(call: PreparedAiCall, sender: ProviderSender, input: AiCallInput,
  toolDefs: AiToolDefinition[], onChunk: AiCallInput['onChunk']): Promise<AiPathOutcome> {
  const tokens = createToolLoopTokens(call.provider)
  const toolCallsExecuted: ExecutedToolCall[] = []
  let answerText = ''
  try {
    const reqBodyObj = JSON.parse(call.providerCall.body ?? '{}') as Record<string, unknown>
    const originalMaxTokens = reqBodyObj.max_tokens ?? 1024
    const formattedTools = formatToolDefinitions(toolDefs)
    const messages = (reqBodyObj.messages as Array<unknown>) || []

    // Step 1: Non-streaming call to evaluate tool choice.
    // `tool_choice: 'auto'` lets the model reason and decide for itself
    // whether a tool call is warranted — this is the right default for a
    // reasoning-capable model. Previously 'required' forced a tool call on
    // every question including openers ("tôi vừa đi tù về") where the model
    // should answer directly from the knowledge bank. With 'auto', the
    // model can think ("câu này cần dẫn chứng bài viết → gọi
    // search_c11_articles") or answer straight. The grounded system prompt
    // (chat-policy.ts buildGroundedSystemPrompt) strongly instructs tool
    // use for evidence; a model that answers without a tool simply answers.
    // `max_tokens` matches the service config (default 4096): 300 was too
    // tight — the model spent its budget on the reasoning prefix and never
    // reached the tool_call block.
    reqBodyObj.messages = messages
    reqBodyObj.tools = formattedTools
    reqBodyObj.tool_choice = 'auto'
    reqBodyObj.max_tokens = originalMaxTokens

    // Step 1: Ask the model to decide whether a tool call is needed.
    // When the caller provides `onChunk`, we stream this step so the
    // visitor sees the model's answer tokens in real time instead of
    // waiting 20-30 s for a reasoning model's first token (TTFT ~30 s →
    // ~1-2 s). Tool-call deltas arriving in the SSE stream are accumulated
    // into the same structure the non-streaming path produces, so
    // `extractToolCallsFromMessage` and the Step 2 branch work unchanged.
    let msg1: Record<string, unknown> | undefined
    if (onChunk) {
      reqBodyObj.stream = true
      const resp1 = await sender.postStream(JSON.stringify(reqBodyObj))
      if (!resp1.body) return { ok: false, error: 'provider_error' }
      const toolCallAccum: ToolCallAccumulator = {}
      const step1 = await readChatSse(resp1.body, { emit: onChunk, onUsage: tokens.addStreamed, toolCalls: toolCallAccum })
      answerText += step1.relayed
      // Object.values on numeric keys returns ascending index order in V8.
      const accumulatedToolCalls = Object.values(toolCallAccum)
      msg1 = {
        role: 'assistant',
        content: step1.streamText || null,
        tool_calls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
      }
    } else {
      reqBodyObj.stream = false
      const resp1 = await sender.postToolStep(JSON.stringify(reqBodyObj))
      if (!isSuccess(resp1.status)) return { ok: false, error: 'provider_error' }
      const json1 = parseUpToLastBrace(responseText(resp1)) as Record<string, unknown>
      const choice1 = (json1.choices as Array<{ message?: Record<string, unknown>; finish_reason?: string }>)?.[0]
      msg1 = choice1?.message
      tokens.addBuffered(json1.usage)
    }

    const toolCalls = extractToolCallsFromMessage(msg1, toolDefs)

    if (toolCalls.length > 0) {
      messages.push(assistantToolCallMessage(toolCalls))
      await runToolCalls(toolCalls, toolDefs, input, messages, toolCallsExecuted)

      // Step 2: Final response with tool results (remove tools and stream response in real-time)
      if (onChunk) {
        const resp2 = await sender.postStream(toolsOff(reqBodyObj, originalMaxTokens, true))
        if (!resp2.body) return { ok: false, error: 'provider_error' }
        const step2 = await readChatSse(resp2.body, { emit: onChunk, onUsage: tokens.addStreamed })
        answerText += step2.relayed
        if (!answerText.trim()) answerText = step2.finalText()
        if (!answerText) answerText = withoutChannelSpans(step2.streamText)
      } else {
        const resp2 = await sender.postToolStep(toolsOff(reqBodyObj, originalMaxTokens, false))
        if (!isSuccess(resp2.status)) return { ok: false, error: 'provider_error' }
        const json2 = parseUpToLastBrace(responseText(resp2)) as Record<string, unknown>
        const choice2 = (json2.choices as Array<{ message?: { content?: string } }>)?.[0]
        const raw2Content = choice2?.message?.content || ''
        answerText = cleanAiContent(raw2Content).trim()
        if (!answerText) answerText = withoutChannelSpans(raw2Content)
        tokens.addBuffered(json2.usage)
      }
    } else {
      // Model answered directly without tool calls.
      //
      // When step 1 was streamed (`onChunk`), that stream already carried the
      // answer to the visitor — `answerText` holds it. Asking the provider again
      // here appended a SECOND, different answer to the first ("…ạ?Chào
      // anh/chị…") and billed the call twice. The follow-up request is only the
      // safety net for a step 1 that produced nothing visible (all reasoning).
      const answeredInStep1 = Boolean(onChunk) && answerText.trim() !== ''
      if (onChunk && !answeredInStep1) {
        const respDirect = await sender.postStream(toolsOff(reqBodyObj, originalMaxTokens, true))
        if (respDirect.body) {
          const direct = await readChatSse(respDirect.body, { emit: onChunk, onUsage: tokens.addStreamed })
          answerText += direct.relayed
          if (!answerText.trim()) answerText = direct.finalText()
        }
      }
      if (!answerText) {
        answerText = cleanAiContent((msg1?.content as string) || '')
      }
    }
    const { promptTokens, completionTokens } = tokens.totals
    const totalTokens = promptTokens + completionTokens
    if (!answerText) return { ok: false, error: 'parse_error' }
    return { ok: true, answerText, promptTokens, completionTokens, totalTokens, toolCallsExecuted }
  } catch {
    return { ok: false, error: 'provider_error' }
  }
}
