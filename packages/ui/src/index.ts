// @wrx/ui (WP 2.4, D24): shared presentational components, over Radix where a primitive helps.
// Every component is styled only by the --wrx-* custom properties, has an accessible name, and
// works from the keyboard (NFR-14). Importing this module loads its stylesheet.
//
//   Button          native button; variant primary | secondary | danger | ghost; size; busy
//   TextField       labelled input with hint and error (aria-describedby, aria-invalid)
//   PasswordField   TextField with a show/hide toggle
//   Dialog          modal over Radix Dialog: title, description, actions, dismissible
//   DialogClose     wraps a button that closes the enclosing Dialog
//   ToastProvider   holds toasts for everything inside it; useToast().show({ title, tone })
//   Banner          inline status (role=status) or warning/danger (role=alert) message
//   MarkdownView    sanitised Markdown (marked + DOMPurify, raw HTML escaped, no images)
//   ThemeScope      sets --wrx-* on its own root element (PLY-26) through @wrx/theme, with
//                   partial tokens inherited from the enclosing scope; `root` for the outermost
//   Spinner         loading indicator in a live region
//
// Storybook (`pnpm storybook:build`) has a story for each.
import './ui.css'

export { Banner } from './banner.tsx'
export type { BannerProps } from './banner.tsx'
export { Button } from './button.tsx'
export type { ButtonProps, ButtonVariant } from './button.tsx'
export { Dialog, DialogClose } from './dialog.tsx'
export type { DialogProps } from './dialog.tsx'
export { PasswordField, TextField } from './fields.tsx'
export type { PasswordFieldProps, TextFieldProps } from './fields.tsx'
export { MarkdownView, renderMarkdown } from './markdown.tsx'
export type { MarkdownViewProps } from './markdown.tsx'
export { Spinner } from './spinner.tsx'
export type { SpinnerProps } from './spinner.tsx'
export { DEFAULT_THEME, FONT_STACKS, ThemeScope, themeStyle } from './theme.tsx'
export type { FontId, ThemeScopeProps, ThemeTokens } from './theme.tsx'
export { ToastProvider, useToast } from './toast.tsx'
export type { Toaster, ToastOptions, ToastProviderProps, Tone } from './toast.tsx'
