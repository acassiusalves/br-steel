# MCP de leitura — etapa 4

Implementação local do endpoint `/api/mcp`, ligada ao OAuth da etapa 2 e aos serviços protegidos da etapa 3. A homologação no Claude hospedado ainda depende de uma URL pública de teste e permanece pendente no plano. Escrita fica para a próxima etapa.

## Contrato implementado

O SDK MCP 1.29.0 usa `WebStandardStreamableHTTPServerTransport`, runtime Node, JSON e uma instância de servidor/transporte por requisição, sem sessões em memória. `POST` negocia o protocolo pelo SDK, `OPTIONS` responde ao preflight e `GET` autenticado retorna 405 porque não há stream persistente. Sem Bearer válido, métodos protegidos retornam 401 com `WWW-Authenticate` apontando os metadados. Cookies de login não autenticam o MCP.

A descoberta pública está em `/.well-known/oauth-protected-resource/api/mcp`; o recurso e emissor vêm da configuração canônica, nunca de `Host`. Token precisa de assinatura válida, issuer, audiência do recurso, validade e `client_id` vinculado ao usuário/concessão local. Cada requisição recarrega concessão, papel, usuário ativo e módulos habilitados. O catálogo filtra ferramentas, e as chamadas repetem a autorização na operação.

| Ferramentas | Acesso |
| --- | --- |
| `consultar_meu_acesso` | Nome e leituras efetivamente permitidas |
| `listar_pedidos`, `consultar_pedido`, `resumir_vendas` | Vendas |
| `consultar_estoque_produtos` | Estoque |
| `listar_insumos`, `listar_movimentacoes_insumo` | Insumos |
| `consultar_demanda_producao` | Produção |
| `listar_pedidos_para_producao`, `listar_colunas_producao`, `listar_lotes_producao`, `consultar_lote_producao` | Kanban de produção |

Apenas capacidades consentidas e permitidas pelo papel aparecem. Concessão válida sem capacidades ainda permite consultar o próprio acesso. Não há ferramentas de escrita registradas nesta etapa, mesmo se a flag de escrita for ativada por engano.

Schemas estritos recusam parâmetros extras, IDs/caminhos livres e autoria forjada. Consultas paginadas usam 50 itens por padrão e no máximo 100. Detalhes de pedido paginam itens; Operadores podem informar `orderId` em `listar_pedidos_para_producao` e seguir `itemsNextCursor` para continuar itens sem acesso comercial. Detalhes de lote paginam itens separadamente dos metadados do lote. Arrays auxiliares possuem limites com aviso quando truncados. Histórico de insumos aceita dias civis de `America/Sao_Paulo`, inclusive transições históricas de horário de verão. Colunas/lotes/projeções operacionais não retornam documentos de cliente, XML ou valores comerciais. Pedidos comerciais usam projeção explícita com nome de cliente e campos mínimos, sem documentos fiscais brutos.

Respostas preservam `source`, `asOf`, `warnings` e `nextCursor`. Saldo desconhecido é `null`, zero real permanece zero, e indisponibilidade do Bling aparece como aviso. Resumos e demanda continuam usando as regras dos serviços compartilhados, incluindo a seleção de pedidos faturados para demanda.

## Limites e auditoria

- Corpo máximo de 64 KiB verificado durante a leitura; saída máxima de 256 KiB contando texto e dados estruturados. Resposta grande orienta reduzir página/período.
- Limite durável em transação Firestore de 60 chamadas de ferramenta por minuto por usuário+cliente; inicialização/listagem/notificações têm contador separado de 240 por minuto. Chamadas inválidas também consomem limite. Excesso retorna HTTP 429 e `Retry-After`.
- `mcpAuditLogs` guarda request ID, usuário, cliente, ferramenta, entidade consultada quando individual, resultado, duração e hash canônico dos argumentos; nunca token, senha ou pedido integral. `lastSeenAt` da conexão é atualizado junto ao registro. Falha de auditoria de leitura gera telemetria sanitizada; o modelo de escrita atômica será implementado na etapa 5.
- Respostas usam `Cache-Control: no-store`. Quando `Origin` está presente, é validado contra a origem do sistema e a lista configurada; clientes de servidor podem não enviar esse header.
- `firestore.indexes.json` configura TTL de 90 dias para auditoria e limpeza dos contadores expirados, sem índices nesses campos. As políticas só passam a valer no ambiente público após implantação. O emulador verifica acesso negado, não execução do serviço TTL em nuvem.

## Configuração do piloto

As configurações OAuth da etapa 2 continuam necessárias. Acrescentar:

| Variável | Comportamento |
| --- | --- |
| `MCP_ENABLED` | `false` por padrão; `true` habilita o endpoint |
| `MCP_WRITES_ENABLED` | Manter `false` |
| `MCP_ALLOWED_USER_IDS` | IDs locais separados por vírgula; vazio bloqueia todos |
| `MCP_ALLOWED_ORIGINS` | Origens HTTPS adicionais exatas, separadas por vírgula; sem wildcard. Ex.: `https://claude.ai` |

`APP_ORIGIN` é a raiz do sistema e `MCP_PUBLIC_URL` deve ser exatamente `APP_ORIGIN/api/mcp`. URLs públicas exigem HTTPS; HTTP só é aceito para localhost/127.0.0.1. `SUPABASE_URL` continua a raiz da API; o issuer inclui `/auth/v1`. Chaves de servidor ficam somente no ambiente privado.

## Verificação local

Testes automatizados usam somente Firestore Emulator em `127.0.0.1:8188`, projeto `demo-brsteel-auth`. Testes de autenticação usam JWTs assinados e um servidor JWKS local real, sem mock do validador. O teste de protocolo usa `Client` e `StreamableHTTPClientTransport` oficiais para inicialização, listagem, chamadas e notificações. Cobre assinatura/issuer/audiência/cliente/expiração, revogação, papel/módulo atualizado, nomes ocultos, schemas, limites de tamanho, corrida pelo último slot do contador e regras Firestore.

A prova integrada `npm run test:mcp-app` rodou em **2026-09-11T20:31:01Z**, com Next em localhost:9003 e Supabase dedicado em 127.0.0.1:55321. Ela passa `resource` também na autorização, troca e renovação, descobre os metadados com o SDK e usa o token real contra `/api/mcp`.

- Login, primeiro acesso, consentimento, DCR/PKCE, troca, refresh e revogação passaram.
- Vendas: R$ 300 no período, anterior R$ 150, variação 100%.
- Estoque: zero virtual de fixture de webhook, físico desconhecido (`null`) e origem preservada.
- Administrador, Vendedor e Operador receberam catálogos distintos. A prova consentiu vendas/estoque/produção; insumos não apareceram nesse grant. A suíte com grant completo cobre as 12 ferramentas.
- Operador consultou demanda sem dados comerciais e foi recusado ao chamar vendas pelo nome. Vendedor foi recusado ao chamar lotes.
- Tokens revogados foram rejeitados também pelo HTTP; tokens anteriores continuaram inválidos após reconexão.
- Dados e identidades sintéticos foram removidos pelo runner; nenhuma chamada ao Bling externo ocorreu.

Suíte final: **114 testes aprovados em 22 arquivos**. Build final aprovado; execução de `next start` confirmou metadados públicos canônicos (200) e recusa MCP sem Bearer (401), com `no-store` e challenge OAuth. Revisão independente de código encerrada após corrigir a continuação dos itens de produção e a identificação de SKUs com barra na auditoria. A checagem TypeScript mantém exatamente os mesmos **25 erros preexistentes** da base, sem novos diagnósticos desta etapa. Uma execução anterior concorrente ao build encontrou erro transitório de transação no emulador; o teste de criação concorrente de lotes passou novamente isolado e nas duas execuções completas subsequentes, sem alterar as mutações.

Para repetir: iniciar o emulador e `node scripts/oauth-provider-local.mjs`, configurar `.env.local` privado conforme etapa 2, gerar `MCP_LOCAL_VERIFY_USER_ID=mcp-e2e-<UUID>` e colocar esse mesmo ID em `MCP_ALLOWED_USER_IDS`; iniciar `npm run dev`; executar `npm run test:mcp-app`. O runner recusa ambiente fora dos hosts/projeto locais fixados e limpa apenas suas fixtures. `npm run test:mcp` executa a suíte unitária/integrada de MCP.

## Homologação no Claude

Ainda não concluída. O conector remoto do Claude é executado pela infraestrutura Anthropic e precisa alcançar o endpoint público; o teste SDK local não substitui esse aceite. [Requisito oficial de conectores remotos](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

Para finalizar esta etapa: definir a URL de homologação com Firestore isolado e provedor OAuth dedicado, implantar o mesmo commit e regras/índices/TTL, configurar audiência/issuer/retorno para as URLs HTTPS reais, habilitar somente os usuários de teste, adicionar a URL `/api/mcp` no Claude e executar login/consentimento/leituras nos três papéis. Verificar revogação e conferir os resultados/auditoria antes da escrita. Não reutilizar um projeto Supabase ou banco de produção do Calculaqui.

Referências técnicas verificadas: [SDK TypeScript v1](https://ts.sdk.modelcontextprotocol.io/server), [autorização MCP](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization), [transporte MCP](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports), [prefixo /auth/v1 no Supabase](https://supabase.com/changelog/47093-self-hosted-supabase-api-external-url-to-include-auth-v1).
