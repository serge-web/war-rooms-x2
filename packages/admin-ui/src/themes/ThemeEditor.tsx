// The theme editor (WP 2.8, ADM-18–21), filling `AdminApp`'s `themes` slot: choose the game, a
// force or a room theme; set each colour token (picker plus hex), the font, and the logo and
// icon; see the result live beside the controls; and get contrast warnings that never block
// saving. Uploads are checked, sanitised and hashed by @wrx/theme, stored in `design.assets`
// and referenced by id (§3 rule 12).
import type { Asset } from '@wrx/schemas'
import {
  ASSET_ACCEPT,
  BUNDLED_FONT_INFO,
  COLOUR_TOKENS,
  DEFAULT_TOKENS,
  assetFromFile,
  contrastFailures,
  formatRatio,
  isEmptyTheme,
} from '@wrx/theme'
import type { AssetOptions, ColourToken, ResolvedTheme, TokenSource } from '@wrx/theme'
import { AssetImageCore } from '@wrx/theme/react'
import { useEffect, useId, useRef, useState } from 'react'
import { Button, ColourField, IssueList, Notice, SelectField } from '../components/index.ts'
import type { Draft } from '../draft/index.ts'
import type { SectionProps } from '../sections/common.tsx'
import { ThemePreview } from './ThemePreview.tsx'
import {
  GAME_TARGET,
  assetById,
  copyTheme,
  newAssetId,
  putAsset,
  resetTheme,
  resolvedThemeOf,
  setThemeImage,
  setThemeToken,
  targetFromKey,
  targetKey,
  themeOf,
  themePath,
  themeTargets,
} from './themeDraft.ts'
import type { ThemeImage, ThemeTarget } from './themeDraft.ts'
import './themes.css'

const TOKEN_LABEL: Readonly<Record<ColourToken, string>> = Object.freeze({
  primary: 'Primary',
  secondary: 'Secondary',
  background: 'Background',
  surface: 'Surface',
  text: 'Text',
})

const TOKEN_USE: Readonly<Record<ColourToken, string>> = Object.freeze({
  primary: 'Headers, primary buttons and accents.',
  secondary: 'Secondary accents.',
  background: 'The page behind panels; also the text colour on primary.',
  surface: 'Panels and cards.',
  text: 'Body text.',
})

export interface ThemeEditorProps extends SectionProps {
  /** The admin's asset limit and the server's item limit (§3 rule 12); defaults apply otherwise. */
  readonly assetOptions?: AssetOptions
  /** The theme shown first, as a `targetKey`; the game theme by default. */
  readonly initialTarget?: string
}

export function ThemeEditor({
  draft,
  validation,
  onChange,
  assetOptions,
  initialTarget,
}: ThemeEditorProps) {
  const design = draft.design
  const [key, setKey] = useState(initialTarget ?? 'game')
  const target = targetFromKey(design, key) ?? GAME_TARGET
  const own = themeOf(design, target)
  const resolved = resolvedThemeOf(design, target)
  const isGame = target.kind === 'game'
  const path = themePath(design, target)
  const targets = themeTargets(design)
  const inheritedFont = isGame
    ? DEFAULT_TOKENS.fontFamily
    : (design.game.theme.tokens.fontFamily ?? DEFAULT_TOKENS.fontFamily)

  // An upload finishes after an await; it must build on the draft as it is then.
  const latest = useRef<Draft>(draft)
  useEffect(() => {
    latest.current = draft
  }, [draft])

  const commit = (change: (d: Draft) => Draft) => {
    const next = change(latest.current)
    latest.current = next
    onChange(next)
  }

  return (
    <div className="wrx-theme-editor">
      <div className="wrx-theme-controls">
        <SelectField
          label="Theme for"
          value={targetKey(target)}
          options={targets.map((t) => ({ value: t.key, label: t.label }))}
          onChange={setKey}
        />
        {isGame ? (
          <Notice tone="warning" title="The game theme is public.">
            It styles the welcome page, which anyone can open without logging in, so its logo and
            icon can be read by anyone (§3 rule 15). Use nothing confidential here.
          </Notice>
        ) : (
          <p className="wrx-admin-muted">
            Anything not set here is inherited from the game theme, then the built-in default.
          </p>
        )}

        <fieldset className="wrx-theme-fieldset">
          <legend>Colours</legend>
          {COLOUR_TOKENS.map((token) => (
            <TokenField
              key={`${key}:${token}`}
              token={token}
              resolved={resolved}
              isGame={isGame}
              onChange={(value) => {
                commit((d) => setThemeToken(d, target, token, value))
              }}
            />
          ))}
        </fieldset>

        <SelectField
          label="Font"
          value={own?.tokens.fontFamily ?? ''}
          hint={sourceText(resolved.sources.fontFamily, isGame)}
          options={[
            {
              value: '',
              label: `${isGame ? 'Default' : 'Inherit'}: ${BUNDLED_FONT_INFO[inheritedFont].label}`,
            },
            ...Object.values(BUNDLED_FONT_INFO).map((f) => ({ value: f.id, label: f.label })),
          ]}
          onChange={(value) => {
            commit((d) => setThemeToken(d, target, 'fontFamily', value === '' ? undefined : value))
          }}
        />

        <fieldset className="wrx-theme-fieldset">
          <legend>Images</legend>
          {(['logo', 'icon'] as const).map((image) => (
            <ImageField
              key={`${key}:${image}`}
              image={image}
              resolved={resolved}
              isGame={isGame}
              asset={assetById(
                design,
                image === 'logo' ? resolved.logoAssetId : resolved.iconAssetId,
              )}
              onUpload={async (file) => {
                const id = newAssetId(latest.current.design, target, image)
                const result = await assetFromFile(file, id, assetOptions)
                if (!result.ok) return result.error.message
                const asset = result.value
                commit((d) => setThemeImage(putAsset(d, asset), target, image, asset.id))
                return undefined
              }}
              onRemove={() => {
                commit((d) => setThemeImage(d, target, image, undefined))
              }}
            />
          ))}
          {path !== undefined && <IssueList issues={validation.at(path)} />}
        </fieldset>

        <ContrastReport resolved={resolved} />

        <CopyAndReset
          target={target}
          targets={targets}
          draft={draft}
          canReset={!isEmptyTheme(own)}
          onCopy={(from) => {
            commit((d) => copyTheme(d, from, target))
          }}
          onReset={() => {
            commit((d) => resetTheme(d, target))
          }}
        />
      </div>
      <ThemePreview design={design} target={target} />
    </div>
  )
}

function sourceText(source: TokenSource, isGame: boolean): string {
  if (source === 'own') return 'Set on this theme.'
  if (source === 'game') return 'Inherited from the game theme.'
  return isGame ? 'The built-in default.' : 'Inherited from the built-in default.'
}

function TokenField({
  token,
  resolved,
  isGame,
  onChange,
}: {
  readonly token: ColourToken
  readonly resolved: ResolvedTheme
  readonly isGame: boolean
  readonly onChange: (value: string | undefined) => void
}) {
  const label = TOKEN_LABEL[token]
  const source = resolved.sources[token]
  return (
    <div className="wrx-theme-token">
      <ColourField
        label={label}
        value={resolved.tokens[token]}
        hint={`${TOKEN_USE[token]} ${sourceText(source, isGame)}`}
        onChange={onChange}
      />
      {source === 'own' && (
        <Button
          variant="quiet"
          aria-label={`${isGame ? 'Use the default' : 'Inherit'} for ${label}`}
          onClick={() => {
            onChange(undefined)
          }}
        >
          {isGame ? 'Use default' : 'Inherit'}
        </Button>
      )}
    </div>
  )
}

function ImageField({
  image,
  resolved,
  isGame,
  asset,
  onUpload,
  onRemove,
}: {
  readonly image: ThemeImage
  readonly resolved: ResolvedTheme
  readonly isGame: boolean
  readonly asset: Asset | undefined
  /** Resolves to an error message, or undefined once stored. */
  readonly onUpload: (file: File) => Promise<string | undefined>
  readonly onRemove: () => void
}) {
  const id = useId()
  const [error, setError] = useState<string | undefined>()
  const [busy, setBusy] = useState(false)
  const label = image === 'logo' ? 'Logo' : 'Icon'
  const source = image === 'logo' ? resolved.sources.logoAssetId : resolved.sources.iconAssetId
  const hasImage = asset !== undefined
  return (
    <div className="wrx-admin-field wrx-theme-image">
      <label htmlFor={id}>{label}</label>
      <div className="wrx-theme-image-row">
        <span className="wrx-theme-image-frame">
          {hasImage ? (
            <AssetImageCore asset={asset} alt={`Current ${image}`} />
          ) : (
            <span className="wrx-admin-muted">None</span>
          )}
        </span>
        <input
          id={id}
          type="file"
          accept={ASSET_ACCEPT}
          disabled={busy}
          aria-describedby={`${id}-hint`}
          onChange={(e) => {
            const input = e.currentTarget
            const file = input.files?.[0]
            if (file === undefined) return
            setBusy(true)
            setError(undefined)
            void onUpload(file).then((problem) => {
              setBusy(false)
              setError(problem)
              input.value = ''
            })
          }}
        />
        {source === 'own' && (
          <Button variant="quiet" onClick={onRemove}>
            Remove {image}
          </Button>
        )}
      </div>
      <div className="wrx-admin-hint" id={`${id}-hint`}>
        PNG, WebP or SVG. SVG is cleaned of scripts on upload.{' '}
        {source === 'own'
          ? 'Set on this theme.'
          : hasImage
            ? 'Inherited from the game theme.'
            : isGame
              ? ''
              : 'None set here or on the game theme.'}
      </div>
      {busy && <p role="status">Checking the image…</p>}
      {error !== undefined && (
        <Notice tone="error" title={`The ${image} was not uploaded.`}>
          {error}
        </Notice>
      )}
    </div>
  )
}

/** ADM-20: failing pairs are warnings only; the draft is saved regardless. */
function ContrastReport({ resolved }: { readonly resolved: ResolvedTheme }) {
  const id = useId()
  const failures = contrastFailures(resolved.tokens)
  return (
    <section className="wrx-theme-contrast" aria-labelledby={id}>
      <h3 id={id}>Contrast (WCAG 2.2 AA)</h3>
      <div role="status">
        {failures.length === 0 ? (
          <p className="wrx-admin-muted">Every checked colour pair passes.</p>
        ) : (
          <Notice
            tone="warning"
            title={`${failures.length} colour pair${failures.length === 1 ? '' : 's'} may be hard to read.`}
          >
            <ul className="wrx-theme-contrast-list">
              {failures.map((f) => (
                <li key={f.pair.id}>
                  {f.pair.use}: {f.foreground} on {f.background} is {formatRatio(f.ratio)}; AA needs{' '}
                  {f.pair.minimum}:1.
                </li>
              ))}
            </ul>
            The theme is still saved; you can publish it as it is.
          </Notice>
        )}
      </div>
    </section>
  )
}

function CopyAndReset({
  target,
  targets,
  draft,
  canReset,
  onCopy,
  onReset,
}: {
  readonly target: ThemeTarget
  readonly targets: ReturnType<typeof themeTargets>
  readonly draft: Draft
  readonly canReset: boolean
  readonly onCopy: (from: ThemeTarget) => void
  readonly onReset: () => void
}) {
  const sources = targets.filter(
    (t) =>
      t.target.kind !== 'game' &&
      t.key !== targetKey(target) &&
      !isEmptyTheme(themeOf(draft.design, t.target)),
  )
  const [from, setFrom] = useState('')
  const chosen = sources.find((s) => s.key === from) ?? sources[0]
  const isGame = target.kind === 'game'
  return (
    <fieldset className="wrx-theme-fieldset">
      <legend>Copy or reset</legend>
      {!isGame && (
        <div className="wrx-theme-copy">
          {sources.length === 0 ? (
            <p className="wrx-admin-muted">No other force or room has its own theme to copy.</p>
          ) : (
            <>
              <SelectField
                label="Copy theme from"
                value={chosen?.key ?? ''}
                options={sources.map((s) => ({ value: s.key, label: s.label }))}
                onChange={setFrom}
              />
              <Button
                onClick={() => {
                  if (chosen !== undefined) onCopy(chosen.target)
                }}
              >
                Copy theme
              </Button>
            </>
          )}
        </div>
      )}
      <Button variant="secondary" disabled={!canReset} onClick={onReset}>
        {isGame ? 'Reset to the default' : 'Reset to inherit'}
      </Button>
    </fieldset>
  )
}
