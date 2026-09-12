'use server';

import { z } from 'zod';
import { adminDb } from '@/lib/firebase-admin';
import { pagePermissions } from '@/lib/permissions';
import { requireActionPage, requireAdministrator } from '@/server/access/current-user';
import { loadAppAccessSettings } from '@/lib/server-auth';
import type { AccessSettings } from '@/server/access/types';

const pageSchema = z.string().refine(p => Object.hasOwn(pagePermissions, p), 'Página inválida');
const settingsSchema = z.object({
  permissions: z.record(pageSchema, z.array(z.enum(['Administrador', 'Vendedor', 'Operador']))).optional(),
  inactivePages: z.array(pageSchema).refine(pages => !pages.includes('/configuracoes') && !pages.includes('/perfil'), 'Configurações e perfil devem permanecer ativos').optional(),
}).strict();
export async function loadAppSettings(): Promise<AccessSettings> {
  await requireAdministrator();
  return loadAppAccessSettings();
}
export async function saveAppSettings(settings: Partial<AccessSettings>): Promise<void> {
  await requireAdministrator();
  const validated = settingsSchema.parse(settings);
  await adminDb.collection('appSettings').doc('general').set(validated, { merge: true });
}
/** Exposes only the pricing field needed by the legacy catalog reader. */
export async function loadPricingSettings(): Promise<{ gordura_variable: number }> {
  await requireActionPage('/buscar-mercado-livre');
  const data = (await adminDb.collection('appSettings').doc('general').get()).data();
  const value = Number(data?.gordura_variable);
  return { gordura_variable: Number.isFinite(value) ? value : 0 };
}
