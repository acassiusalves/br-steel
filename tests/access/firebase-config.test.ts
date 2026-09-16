import { describe, expect, it } from 'vitest';
import { legacyFirebaseConfig, resolveAdminProjectId, resolveFirebaseConfig } from '@/lib/firebase-config';

const staging = {
  projectId: 'brsteel-staging', apiKey: 'staging-public-key',
  appId: '1:123456789:web:staging', messagingSenderId: '123456789',
  authDomain: 'brsteel-staging.firebaseapp.com',
  storageBucket: 'brsteel-staging.firebasestorage.app',
};

describe('Firebase client environment isolation', () => {
  it('preserves the legacy deployment without an explicit project override', () => {
    expect(resolveFirebaseConfig({})).toMatchObject({
      projectId: 'marketflow-9h4tg', authDomain: 'marketflow-9h4tg.firebaseapp.com',
    });
    expect(resolveFirebaseConfig({ projectId: 'marketflow-9h4tg' })).toEqual(resolveFirebaseConfig({}));
  });

  it('uses the complete staging configuration without production fallbacks', () => {
    expect(resolveFirebaseConfig(staging)).toEqual({ ...staging, measurementId: '' });
  });

  it('accepts the older standard bucket suffix and an explicit measurement ID', () => {
    expect(resolveFirebaseConfig({ ...staging, storageBucket: 'brsteel-staging.appspot.com', measurementId: 'G-STAGING' }))
      .toMatchObject({ storageBucket: 'brsteel-staging.appspot.com', measurementId: 'G-STAGING' });
  });

  it.each(['apiKey', 'appId', 'authDomain', 'storageBucket', 'messagingSenderId'] as const)(
    'rejects missing or blank staging %s', (field) => {
      for (const value of [undefined, '', '  ']) {
        expect(() => resolveFirebaseConfig({ ...staging, [field]: value })).toThrow(field);
      }
    },
  );

  it.each(['apiKey', 'appId', 'authDomain', 'storageBucket', 'messagingSenderId'] as const)(
    'rejects legacy %s mixed into staging without printing its value', (field) => {
      const attempt = () => resolveFirebaseConfig({ ...staging, [field]: legacyFirebaseConfig[field] });
      expect(attempt).toThrow(field);
      try { attempt(); } catch (error) {
        expect((error as Error).message).not.toContain(legacyFirebaseConfig[field]);
      }
    },
  );

  it.each([
    ['authDomain', 'another-project.firebaseapp.com'],
    ['storageBucket', 'another-project.appspot.com'],
    ['appId', '1:987654321:web:staging'],
  ])('rejects inconsistent staging %s', (field, value) => {
    expect(() => resolveFirebaseConfig({ ...staging, [field]: value })).toThrow(field);
  });

  it.each(['localhost:8080', '127.0.0.1:8080'])('supports demo projects at %s without cloud fields', (emulatorHost) => {
    expect(resolveFirebaseConfig({ emulatorHost, projectId: 'demo-brsteel' }))
      .toEqual({ projectId: 'demo-brsteel', apiKey: 'demo-key', appId: 'demo-brsteel' });
  });

  it.each([
    { emulatorHost: 'remote.example:8080', projectId: 'demo-brsteel' },
    { emulatorHost: 'localhost:8080', projectId: 'brsteel-staging' },
    { emulatorHost: 'localhost:8080' },
  ])('rejects unsafe emulator configuration %j', (env) => {
    expect(() => resolveFirebaseConfig(env)).toThrow(/loopback.*demo-/);
  });
});

/**
 * O lado admin resolvia o projeto por conta própria e caía num `marketflow-9h4tg` fixo quando a
 * variável estava ausente — mesmo carregando credencial de outro projeto. Um script local que
 * esquecesse a variável apontaria para produção por omissão, e a discordância entre credencial e
 * projeto não dizia nada: seguia em silêncio.
 *
 * Aconteceu de verdade em 16/09/2026, na prova de reversibilidade. Só não escreveu em produção
 * porque o script tinha uma verificação própria — que nenhum outro script é obrigado a ter.
 */
describe('Firebase admin project resolution', () => {
  it('usa o projeto da credencial quando a variável está ausente, em vez do padrão de produção', () => {
    expect(resolveAdminProjectId({ credentialProjectId: 'brsteel-mcp-staging' })).toBe('brsteel-mcp-staging');
    expect(resolveAdminProjectId({ credentialProjectId: 'brsteel-mcp-staging' })).not.toBe(legacyFirebaseConfig.projectId);
  });

  it('recusa credencial e projeto discordantes em vez de escolher um dos dois', () => {
    expect(() => resolveAdminProjectId({ projectId: 'marketflow-9h4tg', credentialProjectId: 'brsteel-mcp-staging' }))
      .toThrow(/credencial/i);
  });

  it('aceita credencial e projeto coincidentes', () => {
    expect(resolveAdminProjectId({ projectId: 'brsteel-mcp-staging', credentialProjectId: 'brsteel-mcp-staging' }))
      .toBe('brsteel-mcp-staging');
  });

  it('preserva o comportamento atual quando não há credencial nem variável', () => {
    expect(resolveAdminProjectId({})).toBe(legacyFirebaseConfig.projectId);
    expect(resolveAdminProjectId({ projectId: 'marketflow-9h4tg' })).toBe('marketflow-9h4tg');
  });
});
