import { Input } from '#/components/ui/input'
import { Button } from '#/components/ui/button'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { authClient } from './authClient'

type tAuthMode = 'login' | 'register'

interface iAuthPageProps {
  mode: tAuthMode
  callbackError?: boolean
  invitationId?: string
  /** Back to a "Link your account" page after signing in. */
  linkToken?: string
}

export function AuthPage({
  mode,
  callbackError = false,
  invitationId,
  linkToken,
}: iAuthPageProps) {
  const isRegister = mode === 'register'
  const callbackPath = invitationId
    ? `/accept-invitation/${encodeURIComponent(invitationId)}`
    : linkToken
      ? `/link/${encodeURIComponent(linkToken)}`
      : '/'
  const loginPath = invitationId
    ? `/login?invitationId=${encodeURIComponent(invitationId)}`
    : linkToken
      ? `/login?linkToken=${encodeURIComponent(linkToken)}`
      : '/login'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(
    callbackError ? 'Sign-in could not be completed. Please try again.' : '',
  )

  async function sendMagicLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setPending(true)
    setError('')

    try {
      const result = await authClient.signIn.magicLink({
        email: email.trim(),
        ...(isRegister ? { name: name.trim() } : {}),
        callbackURL: `${window.location.origin}${callbackPath}`,
        errorCallbackURL: `${window.location.origin}${loginPath}`,
      })

      if (result.error) throw new Error(result.error.message)
      setSent(true)
    } catch (cause) {
      // A failed send can come back without a message; never show nothing.
      setError(
        (cause instanceof Error && cause.message) ||
          'Failed to send the sign-in email. Please try again.',
      )
    } finally {
      setPending(false)
    }
  }

  async function continueWithGoogle() {
    setPending(true)
    setError('')

    try {
      const result = await authClient.signIn.social({
        provider: 'google',
        callbackURL: `${window.location.origin}${callbackPath}`,
        errorCallbackURL: `${window.location.origin}${loginPath}`,
      })
      if (result.error) throw new Error(result.error.message)
    } catch (cause) {
      setError(
        (cause instanceof Error && cause.message) ||
          'Could not connect to Google.',
      )
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

      <section className="authPanel" aria-labelledby="authHeading">
        {sent ? (
          <>
            <div className="messageIcon" aria-hidden="true">
              ✉
            </div>
            <h1 id="authHeading">Check your inbox</h1>
            <p className="authIntro">
              We sent a sign-in link to <strong>{email}</strong>.
            </p>
            <p className="authHint">Open the link to continue.</p>
            <Button
              variant="link"
              className="mt-5 px-0"
              onClick={() => setSent(false)}
              type="button"
            >
              Use a different email
            </Button>
          </>
        ) : (
          <>
            <p className="eyebrow">
              {isRegister ? 'GET STARTED' : 'WELCOME BACK'}
            </p>
            <h1 id="authHeading">
              {isRegister ? 'Create your account' : 'Sign in to Anyhour'}
            </h1>
            <p className="authIntro">
              {isRegister
                ? 'Answer every customer on your website and WhatsApp, and catch every lead.'
                : 'See who your AI answered and the leads it caught.'}
            </p>

            <Button
              variant="outline"
              size="lg"
              className="w-full"
              disabled={pending}
              onClick={continueWithGoogle}
              type="button"
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                width="20"
                height="20"
              >
                <path
                  fill="#4285F4"
                  d="M21.35 12.23c0-.7-.06-1.37-.18-2.02H12v3.83h5.24a4.48 4.48 0 0 1-1.94 2.94v2.44h3.14c1.84-1.7 2.91-4.2 2.91-7.19Z"
                />
                <path
                  fill="#34A853"
                  d="M12 21.75c2.63 0 4.84-.87 6.45-2.33l-3.14-2.44c-.87.58-1.98.94-3.31.94-2.54 0-4.69-1.72-5.46-4.03H3.3v2.51A9.75 9.75 0 0 0 12 21.75Z"
                />
                <path
                  fill="#FBBC05"
                  d="M6.54 13.89a5.86 5.86 0 0 1 0-3.78V7.6H3.3a9.75 9.75 0 0 0 0 8.8l3.24-2.51Z"
                />
                <path
                  fill="#EA4335"
                  d="M12 6.08c1.43 0 2.71.49 3.72 1.45l2.79-2.79A9.37 9.37 0 0 0 12 2.25 9.75 9.75 0 0 0 3.3 7.6l3.24 2.51C7.31 7.8 9.46 6.08 12 6.08Z"
                />
              </svg>
              Continue with Google
            </Button>

            <div className="separator">
              <span>or continue with email</span>
            </div>

            <form onSubmit={sendMagicLink}>
              {isRegister && (
                <label className="field">
                  <span>Your name</span>
                  <Input
                    autoComplete="name"
                    required
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder="Alex Morgan"
                  />
                </label>
              )}
              <label className="field">
                <span>Email address</span>
                <Input
                  autoComplete="email"
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                />
              </label>
              {error && (
                <p className="formError" role="alert">
                  {error}
                </p>
              )}
              <Button
                size="lg"
                className="mt-5 w-full"
                disabled={pending}
                type="submit"
              >
                {pending ? 'Please wait…' : 'Continue with email'}
              </Button>
            </form>
            <p className="authSwitch">
              {isRegister ? 'Already have an account?' : 'New to Anyhour?'}{' '}
              <Link
                to={isRegister ? '/login' : '/register'}
                search={invitationId ? { invitationId } : {}}
              >
                {isRegister ? 'Sign in' : 'Create an account'}
              </Link>
            </p>
          </>
        )}
      </section>
      <p className="authFooter">Anyhour</p>
    </main>
  )
}
