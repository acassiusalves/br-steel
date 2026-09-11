#!/usr/bin/env node
// The server-only marker is a bundler guard; this runner already executes only in Node on the demo emulator.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST, '127.0.0.1:8188');
assert.equal(process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID, 'demo-brsteel-auth');
registerHooks({ resolve(specifier, context, nextResolve) {
  return specifier === 'server-only' ? { url: new URL('../node_modules/server-only/empty.js', import.meta.url).href, shortCircuit: true } : nextResolve(specifier, context);
} });
await import('./oauth-app-verify.ts');
