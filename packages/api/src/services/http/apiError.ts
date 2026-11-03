export class ApiError extends Error {
  constructor(
    public status: 400 | 401 | 403 | 404 | 409 | 422 | 429 | 503,
    public code: string,
    message: string,
    // Extra fields for the error body, such as the contact that owns an identity.
    public details?: Record<string, unknown>,
  ) {
    super(message)
  }
}
