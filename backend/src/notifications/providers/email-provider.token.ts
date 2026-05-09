// ---------------------------------------------------------------------------
// EMAIL_PROVIDER injection token.
//
// Kept in its own file so both the channel (consumer) and the module
// (binder) can import it without pulling in the implementations.
// Avoids a cycle:
//   email.channel.ts  →  email-provider.token.ts
//   notifications.module.ts → email-provider.ts (impls) + token
// ---------------------------------------------------------------------------

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');

// Re-export the type interface for consumers — the implementations
// live in `./email-provider.ts`. Keeping the token + type co-located
// is convenient for callers.
export type { EmailProvider, RenderedEmailEnvelope } from './email-provider';
