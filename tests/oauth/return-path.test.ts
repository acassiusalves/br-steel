import { expect, it } from 'vitest';
import { consentReturnPath, safeOAuthReturnPath } from '@/lib/oauth-return-path';
it('preserves only a canonical consent authorization ID', () => {
  const id = 'aaaa0000-0000-4000-8000-000000000001';
  expect(safeOAuthReturnPath(consentReturnPath(id))).toBe(`/oauth/consent?authorization_id=${id}`);
  for (const path of ['https://attacker.test', '//attacker.test', '/\\attacker.test', '/oauth/consent?authorization_id=bad', `/oauth/consent?authorization_id=${id}&redirect=https://attacker.test`, '/configuracoes', '%2f%2fattacker.test']) {
    expect(safeOAuthReturnPath(path)).toBeNull();
  }
});
it('accepts the opaque authorization IDs issued by GoTrue while refusing path syntax', () => {
  const id = 'sq3ajqf4ksqdun6yxstzoxwec5d7br2p';
  expect(safeOAuthReturnPath(`/oauth/consent?authorization_id=${id}`)).toBe(`/oauth/consent?authorization_id=${id}`);
  expect(() => consentReturnPath(`${id}/other`)).toThrow();
  expect(() => consentReturnPath('a'.repeat(129))).toThrow();
});
