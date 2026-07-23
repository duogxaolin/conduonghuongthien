export const ANALYTICS_MIN_POLL_SECONDS = 15
export const ANALYTICS_MAX_BACKOFF_SECONDS = 60
export const ANALYTICS_DISCONNECTED_AFTER_FAILURES = 3

export type AnalyticsConnectionState = 'loading' | 'connected' | 'partial-error' | 'disconnected' | 'access-denied' | 'paused'

export type AnalyticsPanelPollingState = {
  loading: boolean
  inFlight: boolean
  paused: boolean
  denied: boolean
  stale: boolean
  consecutiveFailures: number
  hasSuccessfulData: boolean
  lastSuccessfulAt: number | null
  nextPollAt: number | null
  countdownSeconds: number | null
  connectionState: AnalyticsConnectionState
  error: string | null
}

type MutableAnalyticsPanelPollingState = Omit<AnalyticsPanelPollingState, 'countdownSeconds' | 'connectionState'>

type AnalyticsPanelResponse = { nextPollAfterSeconds?: unknown }
type AnalyticsPanelPollingOptions<T extends AnalyticsPanelResponse> = {
  request: (signal: AbortSignal) => Promise<T>
  onSuccess: (response: T) => void
  onDenied?: () => void
  isStale?: (response: T) => boolean
  onStateChange?: (state: AnalyticsPanelPollingState) => void
  errorMessage?: (error: unknown) => string
  now?: () => number
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void
}

export type AnalyticsPanelPoller = {
  start: () => void
  refresh: () => void
  retry: () => void
  restart: (clearLastGood?: boolean) => void
  pause: () => void
  resume: () => void
  stop: () => void
  snapshot: () => AnalyticsPanelPollingState
}

export function normalizeAnalyticsPollSeconds(value: unknown) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return ANALYTICS_MIN_POLL_SECONDS
  return Math.min(ANALYTICS_MAX_BACKOFF_SECONDS, Math.max(ANALYTICS_MIN_POLL_SECONDS, Math.ceil(parsed)))
}

export function analyticsPollDelaySeconds(serverHintSeconds: unknown, consecutiveFailures: number) {
  const base = normalizeAnalyticsPollSeconds(serverHintSeconds)
  const failures = Math.max(0, Math.floor(consecutiveFailures))
  return Math.min(ANALYTICS_MAX_BACKOFF_SECONDS, base * (2 ** Math.min(failures, 8)))
}

export function analyticsConnectionState(options: {
  hasSuccessfulData: boolean
  loading: boolean
  consecutiveFailures: number
  denied?: boolean
  paused?: boolean
}): AnalyticsConnectionState {
  if (options.denied) return 'access-denied'
  if (options.paused) return 'paused'
  if (!options.hasSuccessfulData && options.loading) return 'loading'
  if (options.consecutiveFailures >= ANALYTICS_DISCONNECTED_AFTER_FAILURES) return 'disconnected'
  if (options.consecutiveFailures > 0) return 'partial-error'
  return 'connected'
}

export function analyticsCountdownSeconds(nextPollAt: number | null, now = Date.now()) {
  if (nextPollAt === null) return null
  return Math.max(0, Math.ceil((nextPollAt - now) / 1000))
}

export function isAnalyticsAccessDenied(error: unknown) {
  const candidate = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown }; data?: { statusCode?: unknown } } | null
  const status = Number(candidate?.status || candidate?.statusCode || candidate?.response?.status || candidate?.data?.statusCode || 0)
  return status === 401 || status === 403
}

export function isAnalyticsAbort(error: unknown) {
  return (error as { name?: unknown } | null)?.name === 'AbortError'
}

function defaultErrorMessage(error: unknown) {
  const candidate = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown }; data?: { statusCode?: unknown } } | null
  const status = Number(candidate?.status || candidate?.statusCode || candidate?.response?.status || candidate?.data?.statusCode || 0)
  return status ? `Yêu cầu thất bại (${status})` : 'Không thể tải dữ liệu'
}

export function createAnalyticsPanelPoller<T extends AnalyticsPanelResponse>(options: AnalyticsPanelPollingOptions<T>): AnalyticsPanelPoller {
  const now = options.now || Date.now
  const setTimer = options.setTimer || ((callback, delayMs) => setTimeout(callback, delayMs))
  const clearTimer = options.clearTimer || (timer => clearTimeout(timer))
  let timer: ReturnType<typeof setTimeout> | null = null
  let controller: AbortController | null = null
  let generation = 0
  let stopped = false
  let lastServerHint: unknown = ANALYTICS_MIN_POLL_SECONDS
  const state: MutableAnalyticsPanelPollingState = {
    loading: false,
    inFlight: false,
    paused: true,
    denied: false,
    stale: false,
    consecutiveFailures: 0,
    hasSuccessfulData: false,
    lastSuccessfulAt: null,
    nextPollAt: null,
    error: null,
  }

  const snapshot = (): AnalyticsPanelPollingState => ({
    ...state,
    countdownSeconds: analyticsCountdownSeconds(state.nextPollAt, now()),
    connectionState: analyticsConnectionState(state),
  })
  const emit = () => options.onStateChange?.(snapshot())
  const clearScheduled = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
    state.nextPollAt = null
  }
  const cancelInFlight = () => {
    generation += 1
    controller?.abort()
    controller = null
    state.inFlight = false
    state.loading = false
  }
  const schedule = () => {
    clearScheduled()
    if (stopped || state.paused || state.denied) return
    const delaySeconds = analyticsPollDelaySeconds(lastServerHint, state.consecutiveFailures)
    state.nextPollAt = now() + delaySeconds * 1000
    timer = setTimer(() => {
      timer = null
      state.nextPollAt = null
      void run()
    }, delaySeconds * 1000)
    emit()
  }
  const run = async () => {
    if (stopped || state.paused || state.denied || state.inFlight) return
    clearScheduled()
    const requestGeneration = ++generation
    const requestController = new AbortController()
    controller = requestController
    state.inFlight = true
    state.loading = true
    emit()
    try {
      const response = await options.request(requestController.signal)
      if (requestGeneration !== generation || stopped || state.paused) return
      options.onSuccess(response)
      lastServerHint = response.nextPollAfterSeconds
      state.hasSuccessfulData = true
      state.lastSuccessfulAt = now()
      state.stale = options.isStale?.(response) || false
      state.consecutiveFailures = 0
      state.error = null
    } catch (error) {
      if (requestGeneration !== generation || stopped || state.paused || isAnalyticsAbort(error)) return
      if (isAnalyticsAccessDenied(error)) {
        state.denied = true
        state.hasSuccessfulData = false
        state.lastSuccessfulAt = null
        state.error = 'Từ chối truy cập (401/403). Đã dừng cập nhật.'
        options.onDenied?.()
      } else {
        state.consecutiveFailures += 1
        state.error = (options.errorMessage || defaultErrorMessage)(error)
      }
    } finally {
      if (requestGeneration !== generation) return
      controller = null
      state.inFlight = false
      state.loading = false
      emit()
      schedule()
    }
  }
  const refresh = () => { void run() }
  const retry = () => {
    if (stopped || state.paused || state.denied || state.inFlight) return
    clearScheduled()
    void run()
  }
  const restart = (clearLastGood = false) => {
    if (stopped) return
    clearScheduled()
    cancelInFlight()
    state.denied = false
    state.consecutiveFailures = 0
    state.error = null
    if (clearLastGood) {
      state.hasSuccessfulData = false
      state.lastSuccessfulAt = null
      state.stale = false
    }
    emit()
    if (!state.paused) void run()
  }
  const pause = () => {
    if (stopped) return
    state.paused = true
    clearScheduled()
    cancelInFlight()
    emit()
  }
  const resume = () => {
    if (stopped || !state.paused) return
    state.paused = false
    emit()
    void run()
  }
  const start = resume
  const stop = () => {
    if (stopped) return
    stopped = true
    state.paused = true
    clearScheduled()
    cancelInFlight()
    emit()
  }

  emit()
  return { start, refresh, retry, restart, pause, resume, stop, snapshot }
}
