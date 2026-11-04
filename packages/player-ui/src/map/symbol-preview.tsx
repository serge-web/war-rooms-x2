// A symbol code drawn as the map draws it (PLY-57), for the admin's asset form (ADM-44, WP 5.6).
// Loaded lazily with milsymbol, like the map. The image is milsymbol's SVG as a `data:` URL, so no
// symbol markup enters the DOM (symbols.ts).
import { useMemo } from 'react'
import { drawSymbol } from './symbols.ts'

/** Preview size: larger than the map's, so the frame and icon are easy to check. */
const PREVIEW_SIZE = 40

export interface SymbolPreviewProps {
  /** A code `sidcSchema` accepts; anything else shows no symbol. */
  readonly sidc: string | undefined
  /** The image's accessible name. */
  readonly label: string
}

export function SymbolPreview({ sidc, label }: SymbolPreviewProps) {
  const image = useMemo(
    () => (sidc === undefined ? undefined : drawSymbol(sidc, PREVIEW_SIZE)),
    [sidc],
  )
  if (image === undefined) {
    return <span className="wrx-asset-form__no-symbol">No symbol: the code is not valid.</span>
  }
  return (
    <span className="wrx-asset-form__symbol">
      <img src={image.url} width={image.width} height={image.height} alt={label} />
      {image.valid ? null : (
        <span className="wrx-asset-form__symbol-note">
          The symbol library does not know this code: only its frame is drawn.
        </span>
      )}
    </span>
  )
}

export default SymbolPreview
