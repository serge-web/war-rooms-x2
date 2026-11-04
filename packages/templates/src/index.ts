// Message templates (Annex A), framework-free: the validator the composer and the receiver
// share, the receiver's check (TPL-6) and who may use which template (TD4). The RJSF adapter is
// the separate entry `@wrx/templates/rjsf`, since it imports `@rjsf/utils` and so React.
export * from './validate.ts'
export * from './permissions.ts'
export * from './check.ts'
