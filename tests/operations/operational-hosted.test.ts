import { expect, it } from 'vitest';
import { createLocalImportPool } from '@/server/migration/operational-import';
import { hostedPoolConfig, assertHostedIdentity, assertHostedSource } from '@/server/migration/operational-hosted';

const direct = 'postgresql://brsteel_pilot_importer:secret@db.mlumbvxpaqfzpdjnvzxc.supabase.co:5432/postgres';
const session = 'postgresql://brsteel_pilot_importer.mlumbvxpaqfzpdjnvzxc:secret@aws-0-sa-east-1.pooler.supabase.com:5432/postgres';

it('requires the selected project and purpose-specific login with verified TLS', () => {
  for (const url of [direct, session]) {
    const config = hostedPoolConfig(url, 'importer');
    expect(config.ssl).toEqual({ rejectUnauthorized: true });
    expect(config.max).toBe(1);
    expect(config.connectionString).toBeUndefined(); // URL parameters cannot override TLS.
  }
  for (const url of [direct.replace('mlumbvxpaqfzpdjnvzxc','another-project'), direct.replace('brsteel_pilot_importer','postgres'),
    direct.replace('/postgres','/other'), direct+'?sslmode=disable', direct+'#fragment',direct.replace(':secret',''),
    session.replace(':5432',':6543'),session.replace('mlumbvxpaqfzpdjnvzxc','another-project')]) {
    expect(() => hostedPoolConfig(url,'importer')).toThrow();
  }
  expect(() => createLocalImportPool(direct)).toThrow();
});

it('allows transaction pooling only for the reader and cannot reuse importer credentials', () => {
  const url = session.replaceAll('brsteel_pilot_importer','brsteel_pilot_reader').replace(':5432',':6543');
  expect(hostedPoolConfig(url,'reader').port).toBe(6543);
  expect(() => hostedPoolConfig(direct,'reader')).toThrow();
});

it('rejects a different database, effective login, elevated role or source before import', () => {
  const row = { db:'postgres',actor:'brsteel_pilot_importer',login:'brsteel_pilot_importer',superuser:false,bypassrls:false };
  expect(() => assertHostedIdentity(row,'importer')).not.toThrow();
  for (const invalid of [{...row,db:'other'},{...row,actor:'postgres'},{...row,login:'postgres'},
    {...row,superuser:true},{...row,bypassrls:true}]) expect(() => assertHostedIdentity(invalid,'importer')).toThrow();
  expect(() => assertHostedSource('marketflow-9h4tg')).not.toThrow();
  expect(() => assertHostedSource('demo-brsteel-auth')).toThrow();
});
