# Desenvolvimento local

Use um checkout limpo e terminais sem variáveis ou credenciais de ambientes compartilhados. O Firebase tem configuração legada como fallback, por isso o projeto de demonstração e os dois hosts de emulação precisam estar explícitos. Os comandos abaixo pressupõem um terminal compatível com POSIX e devem ser executados da raiz do projeto.

## Instalar as dependências

Tenha Node.js 22.13 ou superior na linha 22, Java 21 e Firebase CLI 14.11.1 no PATH. Confira com `node -v`, `java -version` e `firebase --version`. Para instalar a versão da CLI usada pelo CI, use `npm install --global firebase-tools@14.11.1`.

```sh
npm ci
```

## Iniciar o aplicativo com dados fictícios

Em um checkout sem `.env.local`, copie o [exemplo de ambiente](../.env.example). Se o arquivo já existir, use outro checkout limpo para o fluxo a seguir.

```sh
cp .env.example .env.local
firebase emulators:start --only firestore --project demo-brsteel-auth --config firebase.test.json
```

Mantenha o emulador em execução. Em outro terminal, carregue as fixtures e inicie o Next.js.

```sh
node --env-file=.env.local scripts/seed-operations-local.cjs
npm run dev -- --hostname 127.0.0.1
```

Abra [http://localhost:9003/login](http://localhost:9003/login). Use `admin@example.test`, `seller@example.test` ou `operator@example.test` com a senha de fixture `Local-test-only-2026`. A semente cria usuários, vendas, estoque e insumos fictícios. Cada execução limpa os dados do projeto de demonstração no emulador antes de repovoá-lo.

Em Vendas, selecione o período de 31/08/2026 a 02/09/2026 para ver os pedidos fictícios. Use as telas cobertas pelas fixtures para a verificação local. Recursos de IA, marketplace e OAuth hospedado têm configuração própria. Para verificar o MCP com um provedor local, siga o [guia do OAuth local](mcp-oauth-provider-local.md).

## Reproduzir o CI

Encerre o emulador usado na verificação manual antes de rodar as suítes. Ambas usam a porta 8188 e gerenciam o próprio emulador. Rode uma de cada vez. A integração PostgreSQL exige Docker em execução e a porta local 55436 livre.

```sh
npm run lint
npm run typecheck:ci
npm run test:vitest
npm run test:postgres
```

Para uma suíte Vitest específica, use o emulador dedicado. Exemplo para operações:

```sh
firebase emulators:exec --only firestore --project demo-brsteel-auth \
  --config firebase.test.json 'npm run test:operations'
```

Confira o [workflow de CI](../.github/workflows/ci.yml) e o [catálogo de scripts](../scripts/README.md) para as demais verificações.
