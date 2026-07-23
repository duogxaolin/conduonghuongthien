import { resolve4, resolve6 } from 'node:dns/promises'
import { request as httpsRequest, type RequestOptions } from 'node:https'
import { isIP } from 'node:net'
import type { IncomingMessage } from 'node:http'

const DEFAULT_TIMEOUT_MS = 8_000
const DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024
const SAFE_PORT = '443'
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308])

export type OutboundErrorCode =
  | 'INVALID_URL'
  | 'DESTINATION_NOT_ALLOWED'
  | 'DESTINATION_UNSAFE'
  | 'DNS_UNAVAILABLE'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_REDIRECT'
  | 'UPSTREAM_TOO_LARGE'
  | 'UPSTREAM_FAILURE'

export class ChatbotOutboundError extends Error {
  readonly code: OutboundErrorCode

  constructor(code: OutboundErrorCode) {
    super(publicMessageFor(code))
    this.name = 'ChatbotOutboundError'
    this.code = code
  }
}

export interface ResolvedAddress {
  address: string
  family: 4 | 6
}

export type ResolveProviderHost = (hostname: string) => Promise<ResolvedAddress[]>

export interface ProviderUrlPolicy {
  allowedHosts: readonly string[]
}

export interface SafeProviderRequestOptions {
  url: string | URL
  allowedHosts: readonly string[]
  method?: string
  headers?: Readonly<Record<string, string>>
  body?: string | Uint8Array
  timeoutMs?: number
  maxResponseBytes?: number
  resolveHost?: ResolveProviderHost
  request?: ProviderRequest
}

export interface SafeProviderResponse {
  status: number
  headers: Readonly<Record<string, string | string[] | undefined>>
  body: Uint8Array
}

export type ProviderRequest = (
  options: RequestOptions,
  onResponse: (response: IncomingMessage) => void,
) => ReturnType<typeof httpsRequest>

export function normalizeProviderUrl(input: string | URL, policy: ProviderUrlPolicy): URL {
  let url: URL
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input)
  } catch {
    throw new ChatbotOutboundError('INVALID_URL')
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new ChatbotOutboundError('INVALID_URL')
  }
  if (url.port && url.port !== SAFE_PORT) {
    throw new ChatbotOutboundError('INVALID_URL')
  }
  if (url.search) {
    throw new ChatbotOutboundError('INVALID_URL')
  }

  const hostname = normalizeHostname(url.hostname)
  const allowedHosts = new Set(policy.allowedHosts.map(normalizeAllowedHost))
  if (!hostname || isIP(hostname) !== 0 || !allowedHosts.has(hostname)) {
    throw new ChatbotOutboundError('DESTINATION_NOT_ALLOWED')
  }

  url.hostname = hostname
  url.port = ''
  url.pathname = normalizeBasePath(url.pathname)
  return url
}

export function isPublicIpAddress(input: string): boolean {
  const unwrapped = input.startsWith('[') && input.endsWith(']') ? input.slice(1, -1) : input
  const zoneIndex = unwrapped.indexOf('%')
  const address = zoneIndex === -1 ? unwrapped : unwrapped.slice(0, zoneIndex)
  const family = isIP(address)

  if (family === 4) return isPublicIpv4(address)
  if (family !== 6) return false

  const value = parseIpv6(address)
  if (value === null) return false

  const mappedPrefix = value >> 32n
  if (mappedPrefix === 0xffffn) {
    return isPublicIpv4(bigIntToIpv4(value & 0xffffffffn))
  }

  const blocked: Array<[bigint, number]> = [
    [0n, 128],
    [1n, 128],
    [0n, 96],
    [ipv6('64:ff9b:1::'), 48],
    [ipv6('100::'), 64],
    [ipv6('2001::'), 23],
    [ipv6('2001:db8::'), 32],
    [ipv6('2002::'), 16],
    [ipv6('fc00::'), 7],
    [ipv6('fe80::'), 10],
    [ipv6('ff00::'), 8],
  ]

  return !blocked.some(([network, prefix]) => inCidr(value, network, prefix, 128))
}

export async function resolvePublicProviderAddresses(
  hostname: string,
  resolver: ResolveProviderHost = defaultResolveProviderHost,
): Promise<ResolvedAddress[]> {
  let answers: ResolvedAddress[]
  try {
    answers = await resolver(hostname)
  } catch {
    throw new ChatbotOutboundError('DNS_UNAVAILABLE')
  }

  if (answers.length === 0) throw new ChatbotOutboundError('DNS_UNAVAILABLE')

  const normalized = answers.map((answer) => {
    const family = isIP(answer.address)
    if (family !== answer.family || !isPublicIpAddress(answer.address)) {
      throw new ChatbotOutboundError('DESTINATION_UNSAFE')
    }
    return { address: answer.address, family: answer.family }
  })

  return deduplicateAddresses(normalized)
}

export async function safeProviderRequest(options: SafeProviderRequestOptions): Promise<SafeProviderResponse> {
  const url = normalizeProviderUrl(options.url, { allowedHosts: options.allowedHosts })
  const addresses = await resolvePublicProviderAddresses(url.hostname, options.resolveHost)
  const timeoutMs = boundedPositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS)
  const maxResponseBytes = boundedPositiveInteger(options.maxResponseBytes, DEFAULT_MAX_RESPONSE_BYTES)
  const request = options.request ?? httpsRequest

  try {
    return await executeRequest(request, url, addresses, options, timeoutMs, maxResponseBytes)
  } catch (error) {
    if (error instanceof ChatbotOutboundError) throw error
    throw new ChatbotOutboundError('UPSTREAM_FAILURE')
  }
}

export function redactOutboundError(error: unknown): ChatbotOutboundError {
  return error instanceof ChatbotOutboundError
    ? new ChatbotOutboundError(error.code)
    : new ChatbotOutboundError('UPSTREAM_FAILURE')
}

function executeRequest(
  request: ProviderRequest,
  url: URL,
  addresses: ResolvedAddress[],
  input: SafeProviderRequestOptions,
  timeoutMs: number,
  maxResponseBytes: number,
): Promise<SafeProviderResponse> {
  return new Promise((resolve, reject) => {
    let settled = false
    let deadline: ReturnType<typeof setTimeout> | undefined
    const finish = (error?: ChatbotOutboundError, response?: SafeProviderResponse) => {
      if (settled) return
      settled = true
      if (deadline) clearTimeout(deadline)
      if (error) reject(error)
      else resolve(response!)
    }

    const req = request({
      protocol: 'https:',
      hostname: url.hostname,
      port: 443,
      path: `${url.pathname}${url.search}`,
      method: input.method ?? 'GET',
      headers: input.headers,
      servername: url.hostname,
      timeout: timeoutMs,
      lookup: createPinnedLookup(addresses),
      agent: false,
    }, (response) => {
      const status = response.statusCode ?? 0
      if (REDIRECT_CODES.has(status)) {
        response.resume()
        finish(new ChatbotOutboundError('UPSTREAM_REDIRECT'))
        return
      }

      const declaredLength = Number(response.headers['content-length'])
      if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
        response.destroy()
        finish(new ChatbotOutboundError('UPSTREAM_TOO_LARGE'))
        return
      }

      const chunks: Buffer[] = []
      let bytes = 0
      response.on('data', (chunk: Buffer | string) => {
        if (settled) return
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        bytes += buffer.byteLength
        if (bytes > maxResponseBytes) {
          response.destroy()
          finish(new ChatbotOutboundError('UPSTREAM_TOO_LARGE'))
          return
        }
        chunks.push(buffer)
      })
      response.on('end', () => finish(undefined, {
        status,
        headers: response.headers,
        body: Buffer.concat(chunks, bytes),
      }))
      response.on('error', () => finish(new ChatbotOutboundError('UPSTREAM_FAILURE')))
    })

    const abortForTimeout = () => {
      req.destroy()
      finish(new ChatbotOutboundError('UPSTREAM_TIMEOUT'))
    }
    req.once('timeout', abortForTimeout)
    req.once('error', () => finish(new ChatbotOutboundError('UPSTREAM_FAILURE')))
    deadline = setTimeout(abortForTimeout, timeoutMs)
    deadline.unref?.()

    if (input.body !== undefined) req.write(input.body)
    req.end()
  })
}

function createPinnedLookup(addresses: ResolvedAddress[]): NonNullable<RequestOptions['lookup']> {
  return ((_: string, options: unknown, callback: (...args: unknown[]) => void) => {
    const settings = typeof options === 'object' && options !== null
      ? options as { all?: boolean, family?: number }
      : {}
    const candidates = settings.family === 4 || settings.family === 6
      ? addresses.filter(item => item.family === settings.family)
      : addresses

    if (candidates.length === 0) {
      callback(new Error('No validated address for requested family'))
      return
    }
    if (settings.all) {
      callback(null, candidates.map(item => ({ ...item })))
      return
    }
    callback(null, candidates[0]!.address, candidates[0]!.family)
  }) as NonNullable<RequestOptions['lookup']>
}

async function defaultResolveProviderHost(hostname: string): Promise<ResolvedAddress[]> {
  const [ipv4, ipv6] = await Promise.all([
    resolve4(hostname).catch(() => []),
    resolve6(hostname).catch(() => []),
  ])
  return [
    ...ipv4.map(address => ({ address, family: 4 as const })),
    ...ipv6.map(address => ({ address, family: 6 as const })),
  ]
}

function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '')
}

function normalizeAllowedHost(hostname: string): string {
  const normalized = normalizeHostname(hostname.trim())
  if (!normalized || isIP(normalized) !== 0 || normalized.includes('/') || normalized.includes(':')) {
    throw new ChatbotOutboundError('DESTINATION_NOT_ALLOWED')
  }
  return normalized
}

function normalizeBasePath(pathname: string): string {
  if (pathname === '/') return ''
  return pathname.replace(/\/+$/, '')
}

function boundedPositiveInteger(value: number | undefined, fallback: number): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result <= 0) throw new ChatbotOutboundError('INVALID_URL')
  return result
}

function deduplicateAddresses(addresses: ResolvedAddress[]): ResolvedAddress[] {
  const seen = new Set<string>()
  return addresses.filter(({ address, family }) => {
    const key = `${family}:${address.toLowerCase()}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function isPublicIpv4(address: string): boolean {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false
  const value = parts.reduce((result, part) => (result << 8n) | BigInt(part), 0n)
  const blocked: Array<[string, number]> = [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
    ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24],
    ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
    ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ]
  return !blocked.some(([network, prefix]) => inCidr(value, ipv4ToBigInt(network), prefix, 32))
}

function ipv4ToBigInt(address: string): bigint {
  return address.split('.').reduce((result, part) => (result << 8n) | BigInt(part), 0n)
}

function bigIntToIpv4(value: bigint): string {
  return [24n, 16n, 8n, 0n].map(shift => Number((value >> shift) & 0xffn)).join('.')
}

function ipv6(address: string): bigint {
  const parsed = parseIpv6(address)
  if (parsed === null) throw new Error('Invalid internal IPv6 constant')
  return parsed
}

function parseIpv6(address: string): bigint | null {
  let source = address.toLowerCase()
  if (source.includes('.')) {
    const lastColon = source.lastIndexOf(':')
    if (lastColon < 0) return null
    const ipv4 = source.slice(lastColon + 1)
    if (isIP(ipv4) !== 4) return null
    const value = ipv4ToBigInt(ipv4)
    source = `${source.slice(0, lastColon)}:${((value >> 16n) & 0xffffn).toString(16)}:${(value & 0xffffn).toString(16)}`
  }

  const halves = source.split('::')
  if (halves.length > 2) return null
  const left = halves[0] ? halves[0].split(':') : []
  const right = halves[1] ? halves[1].split(':') : []
  const missing = 8 - left.length - right.length
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return null
  const groups = [...left, ...Array(missing).fill('0'), ...right]
  if (groups.length !== 8 || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return null
  return groups.reduce((result, group) => (result << 16n) | BigInt(`0x${group}`), 0n)
}

function inCidr(value: bigint, network: bigint, prefix: number, width: number): boolean {
  if (prefix === 0) return true
  const shift = BigInt(width - prefix)
  return (value >> shift) === (network >> shift)
}

function publicMessageFor(code: OutboundErrorCode): string {
  switch (code) {
    case 'INVALID_URL': return 'Provider configuration is invalid.'
    case 'DESTINATION_NOT_ALLOWED': return 'Provider destination is not approved.'
    case 'DESTINATION_UNSAFE': return 'Provider destination is unavailable.'
    case 'DNS_UNAVAILABLE': return 'Provider destination could not be verified.'
    case 'UPSTREAM_TIMEOUT': return 'Provider request timed out.'
    case 'UPSTREAM_REDIRECT': return 'Provider redirect was rejected.'
    case 'UPSTREAM_TOO_LARGE': return 'Provider response exceeded the allowed size.'
    default: return 'Provider request failed.'
  }
}
