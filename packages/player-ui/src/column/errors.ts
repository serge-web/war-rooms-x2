// User-facing words for a domain error in the out-of-game column. `message` is developer-facing
// (errors.ts in @wrx/domain), so only `code` is used here.
import type { DomainError } from '@wrx/domain'

export function errorText(error: DomainError | undefined): string {
  switch (error?.code) {
    case 'access-withdrawn':
    case 'not-permitted':
      return 'your role is not allowed to do this.'
    case 'not-found':
      return 'it has not been published.'
    case 'invalid':
      return 'the text is not valid.'
    case 'too-large':
      return 'the text is too long.'
    case 'session-ended':
      return 'the session has ended.'
    case 'not-joined':
    case 'transport':
    case undefined:
      return 'the server did not answer. Try again.'
  }
}
