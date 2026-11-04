// The RJSF validator for the composer and the admin's preview (WP 4.2, 4.3): a `ValidatorType`
// over the same interpreter the receiver uses (`validate.ts`), so a form RJSF accepts is a message
// every receiver accepts. In place of `@rjsf/validator-ajv8`, which needs 'unsafe-eval' (F7).
//
//   import { Form } from '@rjsf/core'
//   import { createTemplateFormValidator } from '@wrx/templates/rjsf'
//   const validator = useMemo(() => createTemplateFormValidator(), [])
//   <Form schema={template.schema} uiSchema={template.uiSchema} validator={validator} … />
//
// Imports `@rjsf/utils`, which depends on React; the framework-free entry (`@wrx/templates`)
// does not.
import {
  createErrorHandler,
  getDefaultFormState,
  toErrorSchema,
  unwrapErrorHandler,
  validationDataMerge,
} from '@rjsf/utils'
import type {
  CustomValidator,
  ErrorTransformer,
  FormContextType,
  RJSFSchema,
  RJSFValidationError,
  UiSchema,
  ValidationData,
  ValidatorType,
} from '@rjsf/utils'
import type { Schema } from '@cfworker/json-schema'
import { createTemplateValidator } from './validate.ts'
import type { FormValues, TemplateError, TemplateValidator } from './validate.ts'

/** RJSF's error for one of ours. `property` is RJSF's dotted path, `.speed`. */
export function toRjsfError(error: TemplateError): RJSFValidationError {
  const property = error.field === undefined ? '' : `.${error.field}`
  return {
    name: error.keyword,
    property,
    message: error.message,
    params: {},
    stack: `${error.field ?? 'form'} ${error.message}`,
    schemaPath: error.schemaPath,
  }
}

/**
 * Whether the schema RJSF hands over is a whole template: RJSF validates the form with the
 * root schema, and checks sub-schemas (`if` conditions, `oneOf` branches) with `isValid`.
 */
function isTemplateRoot(schema: RJSFSchema): boolean {
  return schema.type === 'object' && typeof schema.properties === 'object'
}

export type TemplateFormValidator<F extends FormContextType = FormContextType> = ValidatorType<
  FormValues,
  RJSFSchema,
  F
>

/**
 * The validator to pass to RJSF's `Form` for a template. Validates the form with exactly the
 * schema the receiver uses (`validationSchemaOf`: no undeclared fields, picker values are
 * GUIDs). Picker values naming no known force or role, and template permissions, are the
 * receiver's further checks (`checkTemplatedMessage`); the composer's pickers offer only known
 * entities and its drop-down only permitted templates.
 */
export function createTemplateFormValidator<F extends FormContextType = FormContextType>(
  validator: TemplateValidator = createTemplateValidator(),
): TemplateFormValidator<F> {
  const self: TemplateFormValidator<F> = {
    validateFormData(
      formData: FormValues | undefined,
      schema: RJSFSchema,
      customValidate?: CustomValidator<FormValues, RJSFSchema, F>,
      transformErrors?: ErrorTransformer<FormValues, RJSFSchema, F>,
      uiSchema?: UiSchema<FormValues, RJSFSchema, F>,
    ): ValidationData<FormValues> {
      const values = formData ?? {}
      const result = isTemplateRoot(schema)
        ? validator.validate(schema, values)
        : validator.validateRaw(schema as Schema, values)
      let errors = result.errors.map(toRjsfError)
      if (typeof transformErrors === 'function') errors = transformErrors(errors, uiSchema)
      const errorSchema = toErrorSchema<FormValues>(errors)
      if (typeof customValidate !== 'function') return { errors, errorSchema }
      const state = getDefaultFormState<FormValues, RJSFSchema, F>(
        self,
        schema,
        formData,
        schema,
        true,
      )
      const filled: FormValues = state !== undefined && !Array.isArray(state) ? state : {}
      const handler = customValidate(
        filled,
        createErrorHandler<FormValues>(filled),
        uiSchema,
        errorSchema,
      )
      return validationDataMerge<FormValues>(
        { errors, errorSchema },
        unwrapErrorHandler<FormValues>(handler),
      )
    },
    isValid(schema: RJSFSchema, formData: FormValues | undefined): boolean {
      // Sub-schemas in the profile hold no `$ref`, so the root schema is not needed.
      return validator.validateRaw(schema as Schema, formData ?? {}).valid
    },
    // The interface's signature: RJSF's playground chooses the error type.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
    rawValidation<Result = unknown>(
      schema: RJSFSchema,
      formData?: FormValues,
    ): { errors?: Result[]; validationError?: Error } {
      const result = validator.validateRaw(schema as Schema, formData ?? {})
      return { errors: result.errors as unknown as Result[] }
    },
  }
  return self
}
