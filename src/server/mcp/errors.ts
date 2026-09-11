import 'server-only';
import { OperationError } from '@/server/operations/common';
import { ZodError } from 'zod';
export class McpHttpError extends Error {
  constructor(public code: string, message: string, public status: number, public retryAfter?: number) { super(message); }
}
export function toolError(error: unknown) {
  const detail = error instanceof OperationError ? { code: error.code, message: error.message }
    : error instanceof ZodError ? { code: 'INVALID_ARGUMENTS', message: 'Verifique os argumentos da ferramenta.' }
    : { code: 'UNAVAILABLE', message: 'Não foi possível concluir a consulta. Tente novamente.' };
  return { isError: true as const, content: [{ type: 'text' as const, text: JSON.stringify(detail) }] };
}
