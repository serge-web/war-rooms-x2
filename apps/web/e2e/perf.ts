// Measuring in the page (WP 3.2, NFR-11, NFR-12): times from an action to the frame that shows
// its result, frame intervals while scrolling, and input-to-paint from the Event Timing API.
// Every number is taken in the browser with `performance.now()`, so Playwright's own round trips
// are not counted. Each timed span is also left as a `performance.measure`, named `wrx:<name>`,
// so a trace shows it. The numbers are printed and attached to the test's report.
import type { Page, TestInfo } from '@playwright/test'

/**
 * The CI guard: a measurement fails the test only past `target × MARGIN`. Shared runners are
 * slower and noisier than a laptop, and the guard is there to catch a regression of several
 * times (an O(n²) render, a lost virtualisation), not to re-measure the target.
 */
export const MARGIN = 3

export interface Measurement {
  readonly name: string
  readonly value: number
  readonly unit: 'ms' | 'count'
  /** The SRD target, where there is one. */
  readonly target?: number
}

/** Prints and attaches the measurements, so a CI run records its numbers. */
export async function record(testInfo: TestInfo, measurements: readonly Measurement[]) {
  const lines = measurements.map(
    (m) =>
      `${m.name}: ${Math.round(m.value * 10) / 10} ${m.unit}` +
      (m.target === undefined ? '' : ` (target ${m.target} ${m.unit})`),
  )
  console.log(`[perf] ${testInfo.title}\n  ${lines.join('\n  ')}`)
  await testInfo.attach('performance', {
    body: JSON.stringify(measurements, null, 2),
    contentType: 'application/json',
  })
}

/** What to do: click the first visible element matching a CSS selector (and holding `text`). */
export interface Act {
  readonly click: string
  readonly text?: string
}

/** When it is done: `count` (default 1) visible elements match `selector`, holding `text`. */
export interface Until {
  readonly selector: string
  readonly text?: string
  readonly count?: number
}

/**
 * Does `act` in the page, then waits for a frame in which `until` holds and for that frame to be
 * painted (the next animation frame), and returns the milliseconds from just before `act`.
 */
export async function timeToFrame(
  page: Page,
  name: string,
  act: Act,
  until: Until,
  timeoutMs = 20_000,
): Promise<number> {
  return page.evaluate(
    async ({ name, act, until, timeoutMs }) => {
      const frame = () =>
        new Promise<number>((resolve) => {
          requestAnimationFrame(resolve)
        })
      const done = () => {
        let found = 0
        for (const el of document.querySelectorAll(until.selector)) {
          if (!(el instanceof HTMLElement) || el.offsetParent === null) continue
          if (until.text !== undefined && !el.textContent.includes(until.text)) continue
          found++
        }
        return found >= (until.count ?? 1)
      }
      const target = [...document.querySelectorAll(act.click)].find(
        (el) =>
          el instanceof HTMLElement &&
          el.offsetParent !== null &&
          (act.text === undefined || el.textContent.includes(act.text)),
      )
      if (!(target instanceof HTMLElement)) throw new Error(`${name}: no ${act.click}`)
      performance.mark(`wrx:${name}:start`)
      const start = performance.now()
      target.click()
      for (;;) {
        await frame()
        if (done()) break
        if (performance.now() - start > timeoutMs) throw new Error(`${name}: timed out`)
      }
      // The frame after the one in which the result was in the DOM: it has been painted.
      await frame()
      const elapsed = performance.now() - start
      performance.measure(`wrx:${name}`, `wrx:${name}:start`)
      return elapsed
    },
    { name, act, until, timeoutMs },
  )
}

export interface FrameStats {
  readonly frames: number
  readonly p50: number
  readonly p95: number
  readonly max: number
  /** Frames over 50 ms: visible jank. */
  readonly long: number
  /**
   * The longest script time in any one long animation frame (Chromium's Long Animation Frames
   * API), so a long frame can be told apart: the page's own work, or the machine (GC, a busy
   * runner, the compositor).
   */
  readonly longestScript: number
}

/**
 * Scrolls `selector`'s element by `step` pixels a frame for `frames` frames (negative is up)
 * and reports the intervals between frames. Each step waits for the browser's own frame, so a
 * slow render shows as a long interval.
 */
export async function scrollFrames(
  page: Page,
  selector: string,
  step: number,
  frames: number,
): Promise<FrameStats> {
  return page.evaluate(
    async ({ selector, step, frames }) => {
      const el = document.querySelector(selector)
      if (!(el instanceof HTMLElement)) throw new Error(`no ${selector}`)
      const frame = () =>
        new Promise<number>((resolve) => {
          requestAnimationFrame(resolve)
        })
      let longestScript = 0
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const scripts = (entry as unknown as { scripts?: { duration: number }[] }).scripts ?? []
          for (const script of scripts) longestScript = Math.max(longestScript, script.duration)
        }
      })
      if (PerformanceObserver.supportedEntryTypes.includes('long-animation-frame')) {
        observer.observe({ type: 'long-animation-frame', buffered: false })
      }
      const intervals: number[] = []
      let last = await frame()
      for (let i = 0; i < frames; i++) {
        el.scrollTop += step
        // Scroll events and the list's own work run before the next frame.
        const now = await frame()
        intervals.push(now - last)
        last = now
      }
      // Entries for the last frames arrive after them.
      await frame()
      observer.disconnect()
      const sorted = [...intervals].sort((a, b) => a - b)
      const at = (q: number) =>
        sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0
      return {
        frames: intervals.length,
        p50: at(0.5),
        p95: at(0.95),
        max: sorted.at(-1) ?? 0,
        long: intervals.filter((t) => t > 50).length,
        longestScript,
      }
    },
    { selector, step, frames },
  )
}

/** Starts collecting Event Timing entries (input to the next paint) for keyboard input. */
export async function watchInput(page: Page): Promise<void> {
  await page.evaluate(() => {
    const seen: { name: string; duration: number; processing: number }[] = []
    Object.assign(window, { wrxInputTimings: seen })
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!(entry instanceof PerformanceEventTiming)) continue
        if (!['keydown', 'keypress', 'keyup', 'input', 'beforeinput'].includes(entry.name)) continue
        seen.push({
          name: entry.name,
          duration: entry.duration,
          processing: entry.processingEnd - entry.processingStart,
        })
      }
      // 16 ms is the smallest threshold the API allows; shorter events are under a frame.
    }).observe({ type: 'event', buffered: false, ...{ durationThreshold: 16 } })
  })
}

export interface InputStats {
  /**
   * Keyboard and input events the API reported. It reports only those of 16 ms or more (its
   * smallest threshold), so at 60 Hz nearly every one: input waits for the next frame.
   */
  readonly events: number
  /** The longest input-to-paint, or 16 when none was reported. */
  readonly max: number
}

/** The input timings since `watchInput`. */
export async function inputStats(page: Page): Promise<InputStats> {
  // Event Timing entries are delivered after the paint they measure.
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => setTimeout(resolve, 100))
      }),
  )
  return page.evaluate(() => {
    const seen = (window as unknown as { wrxInputTimings?: { duration: number }[] }).wrxInputTimings
    const durations = (seen ?? []).map((e) => e.duration)
    return { events: durations.length, max: Math.max(16, ...durations) }
  })
}
