/**
 * Erro esperado das regras de acesso e da administração de usuários. A mensagem é escrita para o usuário e
 * pode ser mostrada na tela. Qualquer outro erro vira uma mensagem genérica.
 */
export class AccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AccessError';
  }
}
