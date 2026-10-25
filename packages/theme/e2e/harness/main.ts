// Test-only page: exposes the asset functions to Playwright, so the sanitiser runs with
// Chromium's real DOM (DOMPurify does not sanitise under happy-dom or Node).
import { assetDataUrl, createAsset, sanitizeSvg } from '../../src/index.ts'
import '../../src/fonts.css'

declare global {
  interface Window {
    wrxTheme: {
      readonly sanitizeSvg: typeof sanitizeSvg
      readonly createAsset: typeof createAsset
      readonly assetDataUrl: typeof assetDataUrl
    }
  }
}

window.wrxTheme = { sanitizeSvg, createAsset, assetDataUrl }
document.body.dataset.ready = 'true'
