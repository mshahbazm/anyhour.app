import { ArrowRight, Check, Code2, Copy, Globe } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { getConnections } from '../channels/api'
import { useWhatsappAgents, WhatsappLink } from '../channels/whatsappLink'
import { embedSnippet } from '../install/snippet'
import '../install/install.css'
import { problem } from '../workspace/api'
import { createWorkspace } from './api'
import { readDraft, saveDraft } from './draft'
import { normalizeWebsite } from './website'
import './onboarding.css'

const steps = ['name', 'website', 'whatsapp', 'install'] as const
type tStep = (typeof steps)[number]

interface iCreated {
  organizationId: string
  assistantId: string
}

// Shown once after sign-up, before the AI exists: name your AI, add your
// website (it starts reading), connect your WhatsApp for alerts, install the
// chat. The workspace and its AI are made when the website step is done;
// until then a reload resumes where it was.
export function OnboardingPage(props: {
  firstName: string
  /** Whose draft this is in this browser (their email). */
  account: string
  /** A workspace without its AI yet, filled in instead of a new one. */
  organizationId: string | null
  /** The workspace and its AI exist; the last steps follow. */
  onCreated: () => void
  /** Onboarding is over: the dashboard of this workspace. */
  onDone: (organizationId: string) => void
}) {
  const [draft] = useState(() => readDraft(props.account))
  const [step, setStep] = useState<tStep>(draft.step)
  const [aiName, setAiName] = useState(draft.aiName)
  const [website, setWebsite] = useState(draft.website)
  const [created, setCreated] = useState<iCreated | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const index = steps.indexOf(step)
  const name = aiName.trim()

  useEffect(() => {
    if (!created && (step === 'name' || step === 'website'))
      saveDraft(props.account, { step, aiName, website })
  }, [props.account, created, step, aiName, website])

  async function create(withWebsite: boolean) {
    const typed = website.trim()
    const websiteUrl = withWebsite && typed ? normalizeWebsite(typed) : null
    if (withWebsite && !websiteUrl) {
      setError('Enter your website address, like yourbusiness.com')
      return
    }
    setPending(true)
    setError('')
    try {
      const result = await createWorkspace({
        aiName: name,
        organizationId: props.organizationId ?? undefined,
        ...(websiteUrl && { websiteUrl }),
      })
      saveDraft(props.account, null)
      setCreated(result)
      props.onCreated()
      setStep('whatsapp')
    } catch (cause) {
      setError(problem(cause, 'Something went wrong. Please try again.'))
    } finally {
      setPending(false)
    }
  }

  const progress = (
    <ol className="onboardingProgress" aria-label="Progress">
      {steps.map((item, position) => (
        <li
          key={item}
          data-reached={position <= index || undefined}
          aria-current={position === index ? 'step' : undefined}
        >
          <span className="sr-only">
            Step {position + 1} of {steps.length}
          </span>
        </li>
      ))}
    </ol>
  )

  return (
    <div
      className="onboarding"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Anyhour"
    >
      <header className="onboardingTop">
        <span className="onboardingBrand">
          <span className="brandMark" aria-hidden="true">
            W<span>+</span>
          </span>
          Anyhour
        </span>
      </header>

      <main className="onboardingMain">
        {step === 'name' ? (
          <AskStep
            key={step}
            progress={progress}
            eyebrow={`Hi ${props.firstName || 'there'}, welcome to Anyhour`}
            title="Name your AI"
            text="Your customers see this name in the chat."
            onNext={() => {
              if (!name) setError('Give your AI a name.')
              else {
                setError('')
                setStep('website')
              }
            }}
            error={error}
          >
            <input
              className="askInput"
              type="text"
              autoFocus
              aria-label="Your AI’s name"
              maxLength={120}
              value={aiName}
              onChange={(event) => setAiName(event.target.value)}
            />
          </AskStep>
        ) : step === 'website' || !created ? (
          <AskStep
            key="website"
            progress={progress}
            title="Add your website"
            text={`${name} reads it to learn about your business.`}
            pending={pending}
            error={error}
            onBack={() => {
              setError('')
              setStep('name')
            }}
            onSkip={() => void create(false)}
            onNext={() => void create(true)}
          >
            <div className="onboardingUrl">
              <Globe size={18} aria-hidden="true" />
              <input
                className="askInput"
                type="text"
                inputMode="url"
                autoComplete="url"
                autoFocus
                aria-label="Your website"
                placeholder="yourbusiness.com"
                value={website}
                disabled={pending}
                aria-invalid={Boolean(error) || undefined}
                onChange={(event) => setWebsite(event.target.value)}
              />
            </div>
          </AskStep>
        ) : step === 'whatsapp' ? (
          <WhatsappStep
            key={step}
            progress={progress}
            organizationId={created.organizationId}
            name={name}
            onNext={() => setStep('install')}
          />
        ) : (
          <InstallStep
            key={step}
            progress={progress}
            created={created}
            name={name}
            onDone={() => props.onDone(created.organizationId)}
          />
        )}
      </main>
    </div>
  )
}

// Alerts on the owner's own WhatsApp, through the same link as Channels.
function WhatsappStep(props: {
  progress: ReactNode
  organizationId: string
  name: string
  onNext: () => void
}) {
  const agents = useWhatsappAgents(props.organizationId)
  const linked = agents.status === 'Connected'
  return (
    <AskStep
      progress={props.progress}
      title="Get alerts on WhatsApp"
      text={`${props.name} messages you there when someone wants to buy or needs you.`}
      form={false}
      onNext={linked ? props.onNext : undefined}
      onSkip={linked ? undefined : props.onNext}
    >
      <div className="onboardingPanel">
        <WhatsappLink
          organizationId={props.organizationId}
          agents={agents}
          name={props.name}
          canManage={false}
        />
      </div>
    </AskStep>
  )
}

// The install code, or the WordPress plugin with the AI's id.
function InstallStep(props: {
  progress: ReactNode
  created: iCreated
  name: string
  onDone: () => void
}) {
  const { organizationId, assistantId } = props.created
  const [siteId, setSiteId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    let current = true
    getConnections(organizationId)
      .then((list) => {
        const site = list.connections.find(
          (item) => item.provider === 'website',
        )
        if (current && site) setSiteId(site.id)
      })
      // Without it the code names the AI, which works the same.
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [organizationId])
  const snippet = embedSnippet({ botId: assistantId, siteId })
  return (
    <AskStep
      progress={props.progress}
      title="Put the chat on your website"
      text={`Paste this before </body> on every page, and ${props.name} answers your visitors and catches their details.`}
      form={false}
      primary="Go to your dashboard"
      onNext={props.onDone}
    >
      <div className="onboardingPanel">
        <div className="snippet">
          <div className="snippetBar">
            <span>
              <Code2 size={13} /> HTML
            </span>
            <Button
              type="button"
              size="sm"
              variant={copied ? 'default' : 'outline'}
              onClick={() => {
                void navigator.clipboard
                  .writeText(snippet)
                  .then(() => setCopied(true))
                  .catch(() => undefined)
              }}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? 'Copied' : 'Copy code'}
            </Button>
          </div>
          <textarea
            aria-label="Embed code"
            readOnly
            spellCheck={false}
            rows={snippet.split('\n').length}
            value={snippet}
            onFocus={(event) => event.currentTarget.select()}
          />
        </div>
        <p className="onboardingNote">
          On WordPress? Install the Anyhour plugin and enter your AI’s id:{' '}
          <code>{assistantId}</code>
        </p>
      </div>
    </AskStep>
  )
}

// One step: progress, heading, the answer, then the main button with Skip
// and Back beneath it. A form unless it holds its own, so Enter continues.
function AskStep(props: {
  progress: ReactNode
  eyebrow?: string
  title: string
  text?: string
  children: ReactNode
  primary?: string
  pending?: boolean
  error?: string
  /** False when the step holds its own form. */
  form?: boolean
  onBack?: () => void
  onSkip?: () => void
  onNext?: () => void
}) {
  function submit(event: FormEvent) {
    event.preventDefault()
    if (!props.pending) props.onNext?.()
  }
  const content = (
    <>
      {props.progress}
      <header className="onboardingHead">
        {props.eyebrow && <p>{props.eyebrow}</p>}
        <h1 id="askTitle">{props.title}</h1>
        {props.text && <p>{props.text}</p>}
      </header>
      <div className="onboardingBody">{props.children}</div>
      <div className="onboardingActions">
        {props.error && (
          <p className="inlineError" role="alert">
            {props.error}
          </p>
        )}
        {props.onNext && (
          <Button
            type={props.form === false ? 'button' : 'submit'}
            size="lg"
            className="onboardingNext"
            disabled={props.pending}
            onClick={props.form === false ? props.onNext : undefined}
          >
            {props.pending ? 'Setting up…' : (props.primary ?? 'Continue')}
            {!props.pending && <ArrowRight />}
          </Button>
        )}
        {props.onSkip && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="onboardingBack"
            disabled={props.pending}
            onClick={props.onSkip}
          >
            Skip for now
          </Button>
        )}
        {props.onBack && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="onboardingBack"
            disabled={props.pending}
            onClick={props.onBack}
          >
            Back
          </Button>
        )}
      </div>
    </>
  )
  return props.form === false ? (
    <section className="onboardingStep">{content}</section>
  ) : (
    <form className="onboardingStep" onSubmit={submit} noValidate>
      {content}
    </form>
  )
}
