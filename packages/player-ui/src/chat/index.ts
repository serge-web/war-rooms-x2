// The chat room panel (WP 2.6), also importable alone as `@wrx/player-ui/chat` (the admin's
// theme preview renders ChatPanelCore without the workspace). Importing it loads its stylesheet.
import './chat.css'

export { ChatPanel, ChatPanelCore, readOnlyExplanation, refusalText } from './chat-panel.tsx'
export type { ChatPanelCoreProps } from './chat-panel.tsx'
export { ComposerCore } from './composer.tsx'
export type { ComposerCoreProps, SendOutcome } from './composer.tsx'
export { chatClock, chatRows, linkify, messageSize, safeHref, sizeNote } from './format.ts'
export type {
  ChatClock,
  ChatMessage,
  ChatRow,
  MessageSize,
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
