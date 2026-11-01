// What a browser reports as a page error that is not the app's: WebKit raises the ResizeObserver
// loop notice as an uncaught error event when an observer's callback changes the layout it
// observes (the shell switching the out-of-game column's form, the chat list following its
// rows). The spec delivers the remaining notifications in the next frame; nothing is lost, and
// Chromium and Firefox do not report it. Not an app error, so the e2e error watchers skip it.
const BROWSER_NOTICE =
  /^ResizeObserver loop (completed with undelivered notifications|limit exceeded)/

/** Whether a page error's message is a browser notice rather than an app error. */
export function isBrowserNotice(message: string): boolean {
  return BROWSER_NOTICE.test(message)
}
