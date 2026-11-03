import { Button } from '#/components/ui/button'
import { useState } from 'react'
import { authClient } from './authClient'

interface iInvitationPageProps {
  invitationId: string
  email: string
}

export function InvitationPage({ invitationId, email }: iInvitationPageProps) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function acceptInvitation() {
    setPending(true)
    setError('')
    try {
      const result = await authClient.organization.acceptInvitation({
        invitationId,
      })
      if (result.error) throw new Error(result.error.message)
      window.location.assign('/')
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Could not accept this invitation.',
      )
      setPending(false)
    }
  }

  async function switchAccount() {
    setPending(true)
    setError('')
    try {
      const result = await authClient.signOut()
      if (result.error) throw new Error(result.error.message)
      window.location.assign(
        `/login?invitationId=${encodeURIComponent(invitationId)}`,
      )
    } catch {
      setError('Could not sign out. Please try again.')
      setPending(false)
    }
  }

  return (
    <main className="authLayout">
      <div className="authBrand" aria-label="Anyhour">
        <span className="brandMark" aria-hidden="true">
          W<span>+</span>
        </span>
        <span>Anyhour</span>
      </div>
      <section className="authPanel" aria-labelledby="invitationHeading">
        <h1 id="invitationHeading">Join this workspace</h1>
        <p className="authIntro">
          Accept the invitation as <strong>{email}</strong>.
        </p>
        {error && (
          <p className="formError" role="alert">
            {error}
          </p>
        )}
        <Button
          size="lg"
          className="mt-5 w-full"
          disabled={pending}
          onClick={acceptInvitation}
          type="button"
        >
          {pending ? 'Please wait…' : 'Accept invitation'}
        </Button>
        <Button
          variant="link"
          className="mt-5 px-0"
          disabled={pending}
          onClick={switchAccount}
          type="button"
        >
          Use a different account
        </Button>
      </section>
    </main>
  )
}
