// What went wrong calling a provider. unauthorized and forbidden mark the
// connection broken (the owner is told); gone means our app was removed.
export type tConnectionFailure =
  | 'unauthorized'
  | 'forbidden'
  | 'gone'
  | 'rateLimited'
  | 'unavailable'
  | 'rejected'

export class ConnectionError extends Error {
  constructor(
    message: string,
    public failure: tConnectionFailure,
  ) {
    super(message)
    this.name = 'ConnectionError'
  }

  get breaksConnection() {
    return this.failure === 'unauthorized' || this.failure === 'forbidden'
  }
}
