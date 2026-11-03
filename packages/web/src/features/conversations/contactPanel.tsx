import { ArrowUpRight, Mail, MessageCircle, Phone } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Skeleton } from '#/components/ui/skeleton'
import { getContact } from '../contacts/api'
import { DealRow } from '../contacts/dealRow'
import type { iContactDetail } from '../contacts/types'
import { contactLabel } from '../contacts/types'
import { problem } from '../workspace/api'

const identityIcons = { email: Mail, phone: Phone, whatsapp: MessageCircle }

// Who the visitor is, beside the conversation: ways to reach them, what the
// business remembers and their deals. Owner-facing only.
export function ContactPanel(props: {
  organizationId: string
  contactId: string | null
  leadIds: string[]
  onOpenContact: (id: string) => void
  onOpenLead: (id: string) => void
}) {
  const { organizationId, contactId } = props
  const [detail, setDetail] = useState<iContactDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!contactId) return
    let live = true
    setDetail(null)
    void getContact(organizationId, contactId)
      .then((value) => live && setDetail(value))
      .catch(
        (cause: unknown) =>
          live && setError(problem(cause, 'Couldn’t load this contact.')),
      )
    return () => {
      live = false
    }
  }, [organizationId, contactId])

  if (!contactId)
    return (
      <div className="leadDetail">
        <h3 className="contactPanelName">Visitor</h3>
        <p className="mutedLine">
          They haven’t left an email or phone yet. Once they do, you’ll see who
          they are here.
        </p>
        {props.leadIds.map((id) => (
          <Button
            key={id}
            size="sm"
            variant="outline"
            onClick={() => props.onOpenLead(id)}
          >
            Open the enquiry
          </Button>
        ))}
      </div>
    )
  if (!detail)
    return (
      <div className="leadDetail">
        {error ? (
          <p className="inlineError">{error}</p>
        ) : (
          <>
            <Skeleton className="h-6 w-1/2" />
            <Skeleton className="h-20 w-full" />
          </>
        )}
      </div>
    )
  const person = detail.contact
  return (
    <div className="leadDetail">
      <div>
        <h3 className="contactPanelName">{contactLabel(person)}</h3>
      </div>
      <div className="contactCard">
        {detail.identities.map((item) => {
          const Icon = identityIcons[item.kind]
          return item.kind === 'email' ? (
            <a key={item.id} href={`mailto:${item.value}`}>
              <Icon size={14} /> {item.value}
            </a>
          ) : (
            <a key={item.id} href={`tel:${item.value}`}>
              <Icon size={14} /> {item.value}
            </a>
          )
        })}
      </div>
      {detail.facts.length > 0 && (
        <section className="detailSection">
          <h4>What I remember</h4>
          <ul className="contactPanelFacts">
            {detail.facts.slice(0, 8).map((fact) => (
              <li key={fact.id}>{fact.text}</li>
            ))}
          </ul>
        </section>
      )}
      {detail.deals.length > 0 && (
        <section className="detailSection">
          <h4>Deals</h4>
          {detail.deals.slice(0, 5).map((deal) => (
            <DealRow
              key={deal.id}
              deal={deal}
              onOpen={() => props.onOpenLead(deal.id)}
            />
          ))}
        </section>
      )}
      <Button
        variant="outline"
        size="sm"
        className="justify-self-start"
        onClick={() => props.onOpenContact(person.id)}
      >
        Open contact <ArrowUpRight />
      </Button>
    </div>
  )
}
