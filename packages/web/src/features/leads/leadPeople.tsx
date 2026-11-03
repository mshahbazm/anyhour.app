import { Plus, X } from 'lucide-react'
import { useCallback, useState } from 'react'
import { Button } from '#/components/ui/button'
import {
  addLeadContact,
  removeLeadContact,
  searchContacts,
  updateLeadContact,
} from '../contacts/api'
import { PickerDialog } from '../contacts/pickerDialog'
import type { iPickerOption } from '../contacts/pickerDialog'
import type { iLeadContact, tAddedRole } from '../contacts/types'
import { addedRoles, contactLabel, roleLabels } from '../contacts/types'
import { ApiError, problem } from '../workspace/api'
import '../contacts/contacts.css'

interface iLeadPeopleProps {
  organizationId: string
  leadId: string
  people: iLeadContact[]
  canWork: boolean
  onPeople: (people: iLeadContact[]) => void
  onOpenContact: (id: string) => void
}

// Who is on a lead: the person who asked, fixed, and anyone added with a role.
export function LeadPeople(props: iLeadPeopleProps) {
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const { organizationId, leadId, people } = props

  const find = useCallback(
    async (query: string): Promise<iPickerOption[]> =>
      (await searchContacts(organizationId, query))
        .filter((person) => !people.some((item) => item.id === person.id))
        .map((person) => ({
          id: person.id,
          label: contactLabel(person),
          detail:
            [person.email, person.phone].filter(Boolean).join(' · ') ||
            undefined,
        })),
    [organizationId, people],
  )

  async function run(action: () => Promise<iLeadContact[] | undefined>) {
    setBusy(true)
    setError('')
    try {
      const next = await action()
      if (next) props.onPeople(next)
      return true
    } catch (cause) {
      setError(
        cause instanceof ApiError && cause.code === 'requester_fixed'
          ? 'The person who made the lead always stays on it.'
          : cause instanceof ApiError && cause.code === 'contact_on_lead'
            ? 'They’re already on this lead.'
            : problem(cause, 'Couldn’t change the people. Try again.'),
      )
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="detailSection">
      <h4>People</h4>
      <ul className="personList">
        {people.map((person) => (
          <li key={person.id} className="personRow">
            <button
              type="button"
              className="personName"
              onClick={() => props.onOpenContact(person.id)}
            >
              <span className="listAvatar is-small" aria-hidden="true">
                {contactLabel(person).slice(0, 1).toUpperCase()}
              </span>
              <strong>{contactLabel(person)}</strong>
              {person.name && (person.email || person.phone) && (
                <small>{person.email || person.phone}</small>
              )}
            </button>
            {person.role === 'requester' ? (
              <span className="personFixed">{roleLabels.requester}</span>
            ) : (
              <>
                <select
                  className="textField personRole"
                  aria-label={`${contactLabel(person)}’s role`}
                  value={person.role}
                  disabled={!props.canWork || busy}
                  onChange={(event) =>
                    void run(() =>
                      updateLeadContact(
                        organizationId,
                        leadId,
                        person.id,
                        event.target.value as tAddedRole,
                      ),
                    )
                  }
                >
                  {addedRoles.map((role) => (
                    <option key={role} value={role}>
                      {roleLabels[role]}
                    </option>
                  ))}
                </select>
                {props.canWork && (
                  <button
                    type="button"
                    className="iconButton"
                    aria-label={`Remove ${contactLabel(person)}`}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await removeLeadContact(
                          organizationId,
                          leadId,
                          person.id,
                        )
                        return people.filter((item) => item.id !== person.id)
                      })
                    }
                  >
                    <X size={13} />
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
      {error && <p className="inlineError">{error}</p>}
      {props.canWork && (
        <Button
          variant="ghost"
          size="sm"
          className="justify-self-start"
          onClick={() => setPicking(true)}
        >
          <Plus /> Add a person
        </Button>
      )}
      <PickerDialog
        open={picking}
        onOpenChange={setPicking}
        title="Add a person"
        description="Someone else involved in this lead, like who decides or who pays. You can change their role after."
        placeholder="Search by name, email or phone"
        search={find}
        busy={busy}
        error={picking ? error : undefined}
        onPick={(option) =>
          void run(() =>
            addLeadContact(organizationId, leadId, {
              contactId: option.id,
              role: 'decision_maker',
            }),
          ).then((done) => done && setPicking(false))
        }
        empty="No other contacts yet."
      />
    </section>
  )
}
