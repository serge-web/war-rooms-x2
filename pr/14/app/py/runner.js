// The Python runner was left out of this build (WRX_PY_RUNNER=off).
export const unavailable = "This build of the app was made without Python, to keep it small: a pull request preview includes it only when the pull request changes the Python runner or the SDK, and a blog post's snapshot only when the post is about Python. The demo on the main site has it."
export function createRunner() {
  throw new Error(unavailable)
}
