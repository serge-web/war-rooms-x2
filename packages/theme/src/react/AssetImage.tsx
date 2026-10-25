// Theme images (§3 rule 12): always an `<img>` from a data URL, never inlined markup, so even an
// SVG that got past the sanitiser cannot run script or reach the page's DOM.
import { useAsset } from '@wrx/hooks'
import type { Asset } from '@wrx/schemas'
import { useMemo } from 'react'
import type { ImgHTMLAttributes } from 'react'
import { assetDataUrl } from '../assets.ts'

export interface AssetImageCoreProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> {
  readonly asset: Pick<Asset, 'mimeType' | 'data'> | undefined
  /** Required: describe the image, or pass '' when it is decorative. */
  readonly alt: string
}

/** Renders an asset document that the caller already has (the admin's draft, say). */
export function AssetImageCore({ asset, alt, ...rest }: AssetImageCoreProps) {
  const src = useMemo(() => (asset === undefined ? undefined : assetDataUrl(asset)), [asset])
  if (src === undefined) return null
  return <img src={src} alt={alt} {...rest} />
}

export interface AssetImageProps extends Omit<AssetImageCoreProps, 'asset'> {
  /** The asset to show; nothing is rendered when undefined (a theme with no logo). */
  readonly assetId: string | undefined
}

/** Fetches `assets:<id>` from the pane's store while mounted, and renders it once loaded. */
export function AssetImage({ assetId, ...rest }: AssetImageProps) {
  if (assetId === undefined) return null
  return <LoadedAssetImage assetId={assetId} {...rest} />
}

function LoadedAssetImage({ assetId, ...rest }: AssetImageProps & { readonly assetId: string }) {
  const asset = useAsset(assetId)
  return <AssetImageCore asset={asset.data} {...rest} />
}
