/**
 * AI Gateway — unified entry point for all AI calls (spec R10, design.md D3).
 *
 * Barrel since wave3-long-term 4.3 (D-SPLIT). Every caller imports THIS path — the
 * endpoints, the chatbot, translation, moderation — and ten test files `mock.module`
 * exactly this path; a caller that imported a part directly would slip past those mocks
 * (`tests/service-split-boundaries.test.ts`, rule 6). The code lives in:
 *
 *   - ai-gateway-call.ts     `callAi`, the single choke-point (whole, byte for byte)
 *   - ai-gateway-config.ts   service config / provider / pricing reads, the two 60 s caches,
 *                            the provider→wire-format map (the one owner of that state)
 *   - ai-gateway-types.ts    `callAi`'s input and result types
 *   - ai-sse.ts              `readChatSse`, the ONE reader of a provider's SSE stream
 *   - ai-text-cleaner.ts     strips the model's "reasoning" from answers and streams
 *   - ai-response-parse.ts   answer, usage and tool-call parsing
 *
 * (the last three were moved out of this file earlier). Parts import each other, never
 * this barrel.
 */

export { callAi } from './ai-gateway-call'
export { substituteVariables } from './ai-gateway-config'
export type { AiToolDefinition, AiCallInput, AiTransportOverrides, AiCallResult } from './ai-gateway-types'
export { createStreamingCleaner } from './ai-text-cleaner'
export { extractToolCallsFromMessage, parseToolArguments } from './ai-response-parse'
