import 'server-only';
import { cookies } from 'next/headers';
import { AUTH_COOKIE_NAME, getSessionFromToken, loadAppAccessSettings } from '@/lib/server-auth';
import { canAccessPage } from './policy';

export async function requireCurrentUser() {
  const cookieStore = await cookies();
  const session = await getSessionFromToken(cookieStore.get(AUTH_COOKIE_NAME)?.value);
  if (!session) throw new Error('Sessão expirada. Faça login novamente.');
  return session.user;
}
export async function requireActionPage(page: string) {
  const user = await requireCurrentUser();
  if (!canAccessPage(user, await loadAppAccessSettings(), page)) throw new Error('Sem permissão para esta operação.');
  return user;
}
export async function requireAdministrator() {
  const user = await requireActionPage('/configuracoes');
  if (user.role !== 'Administrador') throw new Error('Apenas administradores podem gerenciar usuários e permissões.');
  return user;
}
