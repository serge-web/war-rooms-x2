import type { Preview } from '@storybook/react-vite'
import { ThemeScope } from '../src/index.ts'

// Every story inside a root theme scope, as in the app.
const preview: Preview = {
  decorators: [
    (Story) => (
      <ThemeScope root>
        <div style={{ padding: '1rem' }}>
          <Story />
        </div>
      </ThemeScope>
    ),
  ],
  parameters: { layout: 'fullscreen' },
}

export default preview
