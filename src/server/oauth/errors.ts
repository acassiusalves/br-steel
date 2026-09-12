import 'server-only';
export class OAuthError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message); }
}

/** Only use when the provider revocation request was never dispatched. */
export class RevocationNotSentError extends OAuthError {
  constructor() { super('REVOCATION_NOT_SENT', 'Não foi possível iniciar a revogação no provedor.', 503); }
}
