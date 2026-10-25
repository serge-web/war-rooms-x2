// Game properties (ADM-3): name, description and the public briefing (PLY-46–48). The game
// theme is edited in Themes (WP 2.8).
import { LIMITS } from '@wrx/schemas'
import { EditForm, MarkdownEditor, Notice, SectionFrame, TextField } from '../components/index.ts'
import { updateGame } from '../draft/index.ts'
import type { SectionProps } from './common.tsx'

export function GameSectionCore({ draft, validation, onChange }: SectionProps) {
  const game = draft.design.game
  return (
    <SectionFrame title="Game">
      <EditForm title="Game properties">
        <TextField
          label="Name"
          value={game.name}
          maxLength={LIMITS.nameChars}
          issues={validation.at('game.name')}
          onChange={(name) => {
            onChange(updateGame(draft, { name }))
          }}
        />
        <TextField
          label="Description"
          multiline
          value={game.description}
          maxLength={LIMITS.descriptionChars}
          issues={validation.at('game.description')}
          onChange={(description) => {
            onChange(updateGame(draft, { description }))
          }}
        />
        <Notice tone="warning" title="The briefing is public.">
          Anyone can read it on the welcome page without logging in. It must contain nothing
          confidential; put force-only material in each force&rsquo;s objectives.
        </Notice>
        <MarkdownEditor
          label="Briefing"
          hint="Markdown. Shown on the welcome page before login."
          value={game.briefing}
          maxLength={LIMITS.briefingChars}
          issues={validation.at('game.briefing')}
          onChange={(briefing) => {
            onChange(updateGame(draft, { briefing }))
          }}
        />
      </EditForm>
    </SectionFrame>
  )
}
