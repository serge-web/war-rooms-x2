// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Suspense } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChunkBoundary, failedModuleUrl, lazyChunk, retryingImport } from './chunk.tsx'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('retryingImport', () => {
  it('tries again after a failure, then resolves', async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error('timed out'))
      .mockResolvedValueOnce('ok')
    await expect(retryingImport(load, 3, 1)).resolves.toBe('ok')
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('gives up after the last attempt', async () => {
    const load = vi.fn<() => Promise<string>>().mockRejectedValue(new Error('offline'))
    await expect(retryingImport(load, 3, 1)).rejects.toThrow('offline')
    expect(load).toHaveBeenCalledTimes(3)
  })
})

describe('ChunkBoundary and lazyChunk', () => {
  it('contains a failed load and loads afresh on Try again', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let fail = true
    const View = () => <p>Loaded view</p>
    const Chunk = lazyChunk<object>(() =>
      fail ? Promise.reject(new Error('net::ERR_TIMED_OUT')) : Promise.resolve({ default: View }),
    )
    render(
      <main>
        <p>Rest of the page</p>
        <ChunkBoundary what="the symbol preview" onRetry={Chunk.reset}>
          <Suspense fallback={<p>Loading</p>}>
            <Chunk />
          </Suspense>
        </ChunkBoundary>
      </main>,
    )
    expect(
      await screen.findByText('The symbol preview could not be loaded', {}, { timeout: 5000 }),
    ).toBeTruthy()
    expect(screen.getByText('Rest of the page')).toBeTruthy()
    fail = false
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    })
    expect(await screen.findByText('Loaded view')).toBeTruthy()
  })
})

describe('failedModuleUrl', () => {
  it('reads the module from a Chromium or Firefox import error on this origin', () => {
    const here = globalThis.location.origin
    expect(
      failedModuleUrl(
        new TypeError(`Failed to fetch dynamically imported module: ${here}/app/assets/a-B1.js`),
      ),
    ).toBe(`${here}/app/assets/a-B1.js`)
    expect(
      failedModuleUrl(new TypeError(`error loading dynamically imported module: ${here}/x.mjs`)),
    ).toBe(`${here}/x.mjs`)
  })

  it('gives nothing for another origin or a message without a URL', () => {
    expect(
      failedModuleUrl(
        new TypeError('Failed to fetch dynamically imported module: https://evil.test/a.js'),
      ),
    ).toBeUndefined()
    expect(failedModuleUrl(new TypeError('Importing a module script failed.'))).toBeUndefined()
  })
})
