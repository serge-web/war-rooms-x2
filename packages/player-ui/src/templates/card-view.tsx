// A templated message's card (TD7, TPL-5): the template's name, then each field's label and
// value as a description list, all React text (PLY-14).
import { useMemo } from 'react'
import { cardClock, cardValueText } from './card.ts'
import type { CardClock, TemplateCardView } from './card.ts'

export interface TemplateCardProps {
  readonly card: TemplateCardView
  /** Shared date formatters, one per list; the browser's locale and zone if left out. */
  readonly clock?: CardClock | undefined
}

export function TemplateCard({ card, clock }: TemplateCardProps) {
  const own = useMemo(() => clock ?? cardClock(), [clock])
  return (
    <div className="wrx-tcard" data-template={card.templateId}>
      <p className="wrx-tcard__name">{card.templateName}</p>
      {card.fields.length === 0 ? (
        <p className="wrx-tcard__empty">No fields filled in.</p>
      ) : (
        <dl className="wrx-tcard__fields">
          {card.fields.map((field) => (
            <div key={field.name} className="wrx-tcard__field" data-field={field.name}>
              <dt className="wrx-tcard__label">{field.label}</dt>
              <dd className="wrx-tcard__value">
                {field.value.kind === 'entity' && field.value.deleted ? (
                  <>
                    {field.value.name} <span className="wrx-tcard__deleted">(deleted)</span>
                  </>
                ) : (
                  cardValueText(field.value, own)
                )}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
}
