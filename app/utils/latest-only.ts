/**
 * Only the newest call's answer counts. `latestOnly(read)` wraps a request so that, of the calls
 * still in flight, only the most recently STARTED one settles: an older call whose answer
 * arrives after a newer call began never resolves nor rejects, so the code awaiting it never
 * resumes — no assignment, no error branch, no `finally`. The newer call's own code does all of
 * that once.
 *
 * Why: `AiDashboardTab.vue` re-reads usage after every budget save (`loadUsage({ refresh: true })`).
 * Two saves inside one round trip start two reads; the server answers the first with the cap it
 * held BEFORE the second save. Answered last, that stale read used to overwrite the card and the
 * next form with the first cap — and saving that form put it back (verifier, Chromium: card at
 * 1.111.111 while the row held 2.222.222).
 *
 * The superseded promise is simply dropped (nothing references it once its `.then` handlers ran),
 * so nothing leaks; a caller that must observe every call should not use this.
 */
export function latestOnly<A extends unknown[], T>(call: (...args: A) => Promise<T>): (...args: A) => Promise<T> {
  let newest = 0
  return (...args: A) => {
    const mine = ++newest
    return new Promise<T>((resolve, reject) => {
      call(...args).then(
        (value) => { if (mine === newest) resolve(value) },
        (err: unknown) => { if (mine === newest) reject(err) },
      )
    })
  }
}
