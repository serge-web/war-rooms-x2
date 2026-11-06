// The chat room panel (WP 2.6), also importable alone as `@wrx/player-ui/chat` (the admin's
// theme preview renders ChatPanelCore without the workspace). Importing it loads its stylesheet.
import './chat.css'
// The card and the form's styles: eager, though the form is not, so a popout copies them.
import '../templates/templates.css'

export {
  ChatPanel,
  ChatPanelCore,
  PAUSED_NOTE,
  PAUSED_REASON,
  readOnlyExplanation,
  refusalText,
  templateRefusal,
} from './chat-panel.tsx'
export type { ChatPanelCoreProps, ProposalActions } from './chat-panel.tsx'
export {
  ChatComposerCore,
  NO_TEMPLATES_REASON,
  initialValues,
  sendableValues,
} from './chat-composer.tsx'
export type {
  ChatComposerCoreProps,
  TemplateSendOutcome,
  UnsentTemplate,
} from './chat-composer.tsx'
export { ComposerCore } from './composer.tsx'
export type { ComposerCoreProps, SendOutcome } from './composer.tsx'
export {
  chatClock,
  chatRows,
  linkify,
  messageSize,
  safeHref,
  sizeNote,
  templateMessageSize,
} from './format.ts'
export type {
  ChatClock,
  ChatMessage,
  ChatRow,
  MessageSize,
  ProposalView,
  TextPart,
  TimeFormat,
} from './format.ts'
export { MessageListCore } from './message-list.tsx'
export type { MessageListCoreProps } from './message-list.tsx'
export {
  ChatUnreadBadge,
  NOTHING_READ,
  ReadMarkers,
  UnreadProvider,
  countUnread,
  markerOf,
  useMarkRead,
  useReadMarkers,
  useUnreadCount,
} from './unread.tsx'
export type { ReadMarker } from './unread.tsx'
