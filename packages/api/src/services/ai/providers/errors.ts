// Errors any provider may throw. Base methods (services/ai/llm.ts,
// decisions.ts) turn them into what callers see.

/** The provider has no key in the environment. */
export class ProviderUnconfiguredError extends Error {
  constructor(readonly provider: string) {
    super(`${provider} is not configured`)
  }
}
