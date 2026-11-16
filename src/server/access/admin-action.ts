import 'server-only';
import { z } from 'zod';
import { AccessError } from './errors';

/**
 * Resultado das ações de administração. Em produção, o Next.js esconde a mensagem de qualquer erro lançado por
 * uma server action; por isso os erros esperados voltam como dado, com a mensagem para o administrador.
 */
export type AdminActionResult<T = null> = { ok: true; data: T } | { ok: false; error: string };

export async function adminAction<T>(run: () => Promise<T>): Promise<AdminActionResult<T>> {
  try {
    return { ok: true, data: await run() };
  } catch (error) {
    if (error instanceof AccessError) return { ok: false, error: error.message };
    if (error instanceof z.ZodError) return { ok: false, error: 'Dados inválidos. Confira os campos e tente novamente.' };
    console.error('Falha na administração de usuários:', error);
    return { ok: false, error: 'Não foi possível concluir a operação. Tente novamente.' };
  }
}
