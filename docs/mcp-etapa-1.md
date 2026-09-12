# MCP BR Steel — etapa 1

Implementada em 11/09/2026 na branch `codex/mcp-auth-foundation`, a partir de `main` em `412f5e4`. Esta entrega prepara a identidade e as permissões para a próxima etapa de OAuth. Não inclui endpoint MCP, conexão com Claude, recursos Supabase ou implantação.

## Comportamento entregue

- Sessão HttpOnly assinada com duração de oito horas. Cada operação protegida consulta novamente o usuário pelo ID persistente, papel, estado ativo e versão de autenticação.
- Exclusão e desativação bloqueiam o próximo acesso. Desativar/reativar ou trocar a senha invalida as sessões anteriores; uma conta nova com o mesmo e-mail não recupera a identidade removida.
- Administração de usuários e permissões usa Admin SDK no servidor e exige administrador atual. Listagem pública tem campos explícitos, sem hash, salt ou campos arbitrários do banco.
- Novos usuários recebem uma senha aleatória individual, mostrada uma única vez ao administrador e armazenada somente como hash/salt. O primeiro acesso exige uma senha pessoal de pelo menos 12 caracteres.
- Último administrador ativo não pode ser excluído, rebaixado ou desativado; a verificação ocorre em transação, inclusive sob concorrência.
- Rotas de login, perfil e logout validam a origem. Alterações do perfil não aceitam identidade ou papel como autoridade.
- Políticas compartilhadas avaliam papel atual, página ativa, primeiro acesso e capacidades concedidas à futura conexão MCP. O contexto MCP real será construído no servidor na etapa 4.
- Kanban obtém somente ID, nome e função dos responsáveis ativos por uma ação autorizada. Configurações de preço têm uma projeção própria, separada da administração.
- `firestore.rules` fecha acesso direto a `users` e `appSettings`, inclusive subcoleções. Essas regras foram verificadas no emulador e ainda não foram publicadas.

## Evidências

| Verificação | Resultado |
| --- | --- |
| Falhas antes da correção | Testes reproduziram acesso administrativo anônimo, exposição de campos e privilégios antigos em sessão. |
| Testes automatizados | 40 aprovados em cinco arquivos; Firestore real emulado com dados sintéticos e chamadas externas bloqueadas pelo setup. |
| Build Next.js | Aprovado; permanecem avisos de dependências Genkit/OpenTelemetry/Handlebars. |
| TypeScript | 25 diagnósticos, exatamente os mesmos da execução anterior às alterações; nenhum novo. O build do projeto ignora erros de tipos/lint, por isso foi conferido separadamente. |
| Administrador no navegador | Login, perfil, criação de usuário e diálogo de senha temporária aprovados. |
| Operador no navegador | Primeiro acesso direcionado ao perfil; troca de senha concluída; administração recusada. |
| Vendedor no navegador | Login aprovado; administração recusada, sem lista de usuários. |
| Revisão independente | Nenhum problema crítico ou importante; observações menores abaixo. |

Os erros TypeScript anteriores estão em `api-settings/page.tsx` (3), `components/icons.tsx` (8), `components/ml-results-table.tsx` (4), `lib/authenticated-fetch.ts` (1) e `services/ml-enrichment.ts` (9).

## Reproduzir localmente

Requer Node.js 22+, Java no PATH e dependências instaladas com `npm ci`. Nenhuma credencial real é necessária. Os testes usam exclusivamente `demo-brsteel-auth` em `127.0.0.1:8188` e limpam os dados desse projeto de emulação.

```sh
npx --yes firebase-tools@14.16.0 emulators:exec \
  --only firestore --project demo-brsteel-auth \
  --config firebase.test.json 'npm run test:access'
```

Para verificar o navegador, inicie o emulador e mantenha-o aberto:

```sh
npx --yes firebase-tools@14.16.0 emulators:start \
  --only firestore --project demo-brsteel-auth --config firebase.test.json
```

Em outro terminal:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8188 \
GCLOUD_PROJECT=demo-brsteel-auth node tests/seed-local.cjs

FIRESTORE_EMULATOR_HOST=127.0.0.1:8188 \
NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST=127.0.0.1:8188 \
NEXT_PUBLIC_FIREBASE_PROJECT_ID=demo-brsteel-auth \
AUTH_SESSION_SECRET=local-fixture-only-session-secret-2026 \
APP_ORIGIN=http://localhost:9003 npm run dev
```

Contas exclusivamente fictícias: `admin@example.test`, `seller@example.test` e `operator@example.test`, senha inicial de fixture `Local-test-only-2026`. O operador exige troca no primeiro acesso. Executar novamente o seed redefine somente essas três fixtures; o script recusa outro host/projeto. A configuração de emulação dos SDKs também recusa projetos que não comecem por `demo-` e hosts que não sejam locais.

O comando `npm run build` pode usar as mesmas variáveis locais acima. Elas são embutidas no bundle de navegador: esse build é somente para teste. A implantação precisa gerar um novo build com a configuração correta do ambiente de destino. Nunca copiar essas senhas/segredo de fixture para produção.

## Condições para a futura implantação

1. Configurar `AUTH_SESSION_SECRET` forte e exclusivo da sessão e `APP_ORIGIN` com a origem canônica. O código aceita `NEXTAUTH_SECRET` para compatibilidade; não usa segredo de webhook ou valor fixo em produção. Mudança do segredo exige novo login.
2. Conferir a credencial Firebase Admin já gerenciada pelo ambiente. Nenhuma chave foi copiada para esta branch.
3. Publicar primeiro o aplicativo com os consumidores migrados e então as regras Firestore. O arquivo local de regras não altera as regras do projeto remoto.
4. Conferir os administradores existentes e concluir primeiro acesso das contas legadas antes do piloto OAuth. Contas sem `active` permanecem ativas; senhas antigas não são redefinidas automaticamente. A compatibilidade de primeiro acesso com a senha antiga compartilhada continua restrita ao perfil e precisa ser encerrada antes do piloto.

## Limites e próximas etapas

- `appConfig` e as coleções operacionais legadas continuam com as regras anteriores. Seus dados não são usados como autoridade de identidade/permissão. A migração das coleções de vendas, estoque e produção é a etapa 3; não se deve expor o MCP antes dela.
- O consentimento OAuth ainda não existe. A etapa 2 deve chamar a política de primeiro acesso antes de autorizar uma conexão, provisionar o ambiente Supabase dedicado e verificar PKCE, audiência, refresh e revogação.
- A detecção de senha inicial legada usa scrypt também ao montar o perfil público. Isso mantém a verificação correta, mas merece otimização em listas grandes após uma migração explícita das credenciais antigas.
- `getCatalogPriceHistory`, `saveCatalogPriceHistoryBatch` e `loadProducts` de `services/ml-firestore.ts` não têm consumidores ativos no repositório. Os caminhos antigos sob `users/default-user` serão recusados pelas regras novas; migrá-los para serviço autorizado antes de reutilizá-los.

Próxima entrega: fluxo OAuth completo em ambiente de teste, mantendo Firestore como banco operacional e vinculando o usuário autenticado ao seu próprio Claude.
