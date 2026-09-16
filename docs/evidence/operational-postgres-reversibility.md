# Reversibilidade do corte de fonte

**Resultado: demonstrada em 16/09/2026, no Firestore da homologação.** A mesma chamada, pelo mesmo repositório, passou a responder do PostgreSQL quando o registro mudou e voltou ao estado anterior quando o registro saiu. Produção não foi tocada em nenhum momento.

Era o último item em aberto do ensaio da etapa 5. O [corte em si](operational-postgres-cutover-rehearsal.md) já havia sido executado com divergência zero, mas sem trocar a fonte — e um corte que não se provou reversível é uma aposta de mão única.

## Medição

Firestore de `brsteel-mcp-staging`, destino `mlumbvxpaqfzpdjnvzxc`, login de runtime `brsteel_ops_runtime`.

| Etapa | `operationalSource` | Fonte resolvida | Pedidos | Último pedido |
| --- | --- | --- | ---: | --- |
| Antes | ausente | `firestore` | 0 | — |
| Durante | `postgres` | **`postgres`** | **12.632** | 2026-09-15 |
| Depois | removido | `firestore` | 0 | — |

O Firestore da homologação tem zero pedidos por ser projeto separado, sem dados operacionais. É justamente isso que torna a diferença inequívoca: 12.632 e `2026-09-15` são exatamente a cópia hospedada, não um número plausível.

A restauração ficou num `finally`, como no roteiro do corte. Ao final, `appConfig/operationalSource` não existe nem em homologação nem em produção — conferido de forma independente nos dois projetos.

## O padrão de projeto que a prova revelou

A primeira execução foi **recusada pela verificação do próprio script**, e o motivo vale mais que a prova.

`src/lib/firebase-admin.ts` resolvia o projeto por conta própria e caía num `"marketflow-9h4tg"` fixo quando `NEXT_PUBLIC_FIREBASE_PROJECT_ID` estava ausente — **ignorando o `project_id` da credencial carregada**. Com a credencial de homologação e a variável esquecida, o Admin SDK apontava para o Firestore de produção.

Produção define a variável na Vercel, então o padrão só valia em execução local — que é exatamente onde o engano acontece, e onde ninguém revisa antes de rodar. Um script sem verificação própria teria escrito `operationalSource` em produção, e sem `BRSTEEL_OPERATIONAL_DATABASE_URL` lá o núcleo inteiro passaria a responder 503.

Corrigido: a credencial decide o projeto quando a configuração é omissa, e discordância entre as duas é recusada em vez de resolvida em silêncio.

```
recusou com: A credencial pertence ao projeto brsteel-mcp-staging e a configuração aponta marketflow-9h4tg.
```

## Limitações

- **A prova é da camada de repositórios, não do processo implantado.** Foi executada localmente contra o Firestore da homologação e o PostgreSQL hospedado — o mesmo código, o mesmo registro compartilhado e a mesma conexão que a aplicação usaria, mas não a instância da Vercel respondendo a uma requisição HTTP. Verificar isso exigiria sessão autenticada na homologação.
- **A troca durou segundos, não uma janela de operação.** Nada foi escrito enquanto a fonte estava em `postgres`, então a prova não cobre gravações oficiais na nova fonte nem o retorno depois delas.
- **`brsteel_write.audit` e `brsteel_write.idempotency` seguem vazias.** Nenhuma gravação de negócio real jamais chegou ao PostgreSQL hospedado.
- **Backups diários e armazenamento externo continuam pendentes**, e permanecem pré-requisito declarado para o corte de produção.
