// Storybook (NFR-18): the shared components here, and the *Core components of the UI packages
// that use them. It builds offline: no telemetry, no remote fonts or addons.
import type { StorybookConfig } from '@storybook/react-vite'

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.tsx', '../../player-ui/src/**/*.stories.tsx'],
  core: { disableTelemetry: true, disableWhatsNewNotifications: true },
  typescript: { reactDocgen: false },
}

export default config
