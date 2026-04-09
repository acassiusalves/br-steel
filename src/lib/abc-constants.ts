// src/lib/abc-constants.ts
//
// Plain constants shared between the Curva ABC client component and the
// server actions. Lives outside `abc-actions.ts` because files with
// `'use server'` can only export async functions.

/**
 * Max products per single Gemini call. The client splits large lists into
 * chunks of this size and invokes the server action once per chunk, so each
 * call stays short and survives Next.js request timeouts.
 */
export const MAX_PRODUCTS_PER_CHUNK = 30;
