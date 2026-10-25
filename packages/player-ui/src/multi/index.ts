// The multi-client view (WP 2.9, PLY-16–19): panes, presets and the mock's database controls
// (PLY-21). Importing this module loads its stylesheet.
import './multi.css'

export { MockControlsCore } from './mock-controls.tsx'
export type { MockControlsCoreProps } from './mock-controls.tsx'
export { MultiClientView } from './multi-client.tsx'
export type { MultiClientViewProps } from './multi-client.tsx'
export { ClientPane } from './pane.tsx'
export type { ClientPaneProps } from './pane.tsx'
export {
  isPaneCount,
  memoryPresetStorage,
  parsePreset,
  parsePresets,
  serialisePresets,
  webPresetStorage,
  withPreset,
} from './presets.ts'
export type {
  MultiPreset,
  PaneArrangement,
  PaneCount,
  PaneKind,
  PanePreset,
  PresetStorage,
} from './presets.ts'
