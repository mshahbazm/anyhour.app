import { useEffect, useState } from 'react'
import { Button } from '#/components/ui/button'
import { problem } from '../workspace/api'
import { getTeamChatLink, redeemTeamChatLink } from '../channels/api'
import type { iTeamChatLink } from '../channels/api'

// "Link your account": the AI sent this link in Slack.
// Opening it while signed in links that account to this member.
export function LinkPage(props: { token: string; email: string }) {
  const [link, setLink] = useState<iTeamChatLink | null>(null)
  const [done, setDone] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    getTeamChatLink(props.token)
      .then(setLink)
      .catch((cause: unknown) =>
        setError(problem(cause, 'This link doesn’t work any more.')),
      )
  }, [props.token])

  async function confirm() {
    setPending(true)
    setError('')
    try {
      setLink(await redeemTeamChatLink(props.token))
      setDone(true)
    } catch (cause) {
      setError(problem(cause, 'Couldn’t link your account. Try again.'))
    } finally {
      setPending(false)
    }
  }

  const employee = link?.employeeName ?? 'your AI'
  return (
    <main className="authLayout">
      <div className="authBrand" aria-label="Anyhour">
        <span className="brandMark" aria-hidden="true">
          W<span>+</span>
        </span>
        <span>Anyhour</span>
      </div>
      <section className="authPanel" aria-labelledby="linkHeading">
        <h1 id="linkHeading">{done ? 'You’re linked' : 'Link your account'}</h1>
        {link && !done && (
          <p className="authIntro">
            Talk to {employee} in {link.appName}
            {link.accountName ? ` (${link.accountName})` : ''} as{' '}
            <strong>{props.email}</strong>, with your access in{' '}
            {link.workspaceName}.
          </p>
        )}
        {done && link && (
          <p className="authIntro">
            Go back to {link.appName} and message {employee}.
          </p>
        )}
        {error && (
          <p className="formError" role="alert">
            {error}
          </p>
        )}
        {link && !done && (
          <Button
            size="lg"
            className="mt-5 w-full"
            disabled={pending}
            onClick={() => void confirm()}
            type="button"
          >
            {pending ? 'Linking…' : 'Link my account'}
          </Button>
        )}
      </section>
    </main>
  )
}
