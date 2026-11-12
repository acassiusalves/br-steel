import { expect, it } from 'vitest';
import { parseCoreWriteMode, parseOperationalSource } from '@/server/operations/switch-values';

it.each([
  [undefined, 'firestore'],
  ['postgres', 'postgres'],
  ['firestore', 'firestore'],
  ['POSTGRES', 'firestore'],
  [1, 'firestore'],
] as [unknown, string][])('reads the stored source %j as %s', (stored, expected) => {
  expect(parseOperationalSource(stored)).toBe(expected);
});

it.each([
  [undefined, 'open'],
  ['draining', 'draining'],
  ['blocked', 'blocked'],
  ['x', 'open'],
] as [unknown, string][])('reads the stored write mode %j as %s', (stored, expected) => {
  expect(parseCoreWriteMode(stored)).toBe(expected);
});
