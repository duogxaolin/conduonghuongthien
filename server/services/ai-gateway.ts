/**
 * AI Gateway — unified entry point for all AI calls (spec R10, design.md D3).
 *
 * Barrel since wave3-long-term 4.3 (D-SPLIT). Every caller imports THIS path — the
 * endpoints, the chatbot, translation, moderation — and ten test files `mock.module`
 * exactly this path; a caller that imported a part directly would slip past those mocks
 * (`tests/service-split-boundaries.test.ts`, rule 6). The code lives in:
 *
 *   - ai-gateway-call.ts       `callAi`, the single choke-point: its prelude (config, budget,
 *                              key, prompt, URL policy, request) and the choice of path
 *   - ai-gateway-send.ts       the one caller of `outbound.ts`: deadline + byte cap per path
 *   - ai-gateway-tool-loop.ts  the multi-step tool-calling loop
 *   - ai-gateway-tools.ts      tool list, replayed tool-call turn, running the tools
 *   - ai-gateway-no-tools.ts   the streamed and the buffered answer without tools
 *   - ai-gateway-tokens.ts     token accounting per path (pure)
 *   - ai-gateway-record.ts     cost, the usage row, the success line, the result
 *   - ai-gateway-config.ts     service config / provider / pricing reads, the two 60 s caches,
 *                              the provider→wire-format map (the one owner of that state)
 *   - ai-gateway-types.ts      `callAi`'s input and result types (+ what the parts hand each other)
 *   - ai-sse.ts                `readChatSse`, the ONE reader of a provider's SSE stream
 *   - ai-text-cleaner.ts       strips the model's "reasoning" from answers and streams
 *   - ai-response-parse.ts     answer, usage and tool-call parsing
 *
 * (the last three were moved out of this file earlier; `callAi` itself was split along its
 * steps after 4.3). Parts import each other, never this barrel.
 */

export { callAi } from './ai-gateway-call'
export { substituteVariables } from './ai-gateway-config'
export type { AiToolDefinition, AiCallInput, AiTransportOverrides, AiCallResult } from './ai-gateway-types'
export { createStreamingCleaner } from './ai-text-cleaner'
export { extractToolCallsFromMessage, parseToolArguments } from './ai-response-parse'
