# Homologação pública do MCP

Situação em 11/09/2026: acesso restabelecido pelo dashboard e CLI oficiais do Supabase. Recursos dedicados criados, configuração OAuth aplicada e primeira publicação concluída. A prova HTTPS com o SDK oficial passou; o aceite pelo Claude hospedado continua pendente. A escrita pelo MCP permanece desabilitada.

## Recursos e isolamento verificados

| Recurso | Configuração efetiva |
| --- | --- |
| Aplicação | `https://br-steel-mcp-staging.vercel.app`, projeto Vercel `br-steel-mcp-staging`, ID `prj_YD3ATzBPFQo4bD1ZlojrDTigUZp8` |
| Vercel | Equipe `team_AnjWj22RX6qtosCjGldryHxb`, Node 22.x, 24 variáveis criptografadas no destino `production` do projeto dedicado, build com verificação de isolamento |
| Firebase | Projeto novo `brsteel-mcp-staging`, número `630645228381`, app web `1:630645228381:web:86595a74e18a064824deb4` |
| Firestore | Banco `(default)`, modo nativo, edição Standard, região `southamerica-east1`; regras publicadas e 11 índices compostos confirmados `READY` |
| Conta de serviço | `mcp-staging-server@brsteel-mcp-staging.iam.gserviceaccount.com`, somente `roles/datastore.user` no novo projeto |
| Supabase | Projeto existente escolhido pelo usuário: `mlumbvxpaqfzpdjnvzxc`, nome `BR Stell MCP / Sistema`, organização Lunneta Ads, região São Paulo |
| MCP | Recurso `https://br-steel-mcp-staging.vercel.app/api/mcp`, escrita desligada e lista restrita a um usuário sintético temporário |

O destino `production` da Vercel pertence ao novo projeto de homologação. O projeto principal `br-steel`, seu domínio e seu Firebase não foram alterados. Previews do projeto principal compartilham integrações de produção e não são usados nesta prova. A proteção padrão de previews foi preservada.

O Firestore está sem conta de faturamento vinculada. A implantação encontrou seis índices de um único campo declarados indevidamente como compostos; foram removidos do arquivo, pois os índices automáticos desses campos continuam ativos. Os 11 compostos foram criados e estão prontos. A etapa seguinte de TTL foi recusada pelo provedor por exigir faturamento. A configuração TTL continua no arquivo para uma futura aplicação autorizada, mas **não está ativa na nuvem**. Não vincular uma conta paga implicitamente. A prova sintética remove seus próprios registros; o piloto contínuo ainda precisa resolver a retenção. [TTL no Firestore](https://firebase.google.com/docs/firestore/ttl).

## Supabase Auth

O inventário SQL anterior às alterações confirmou zero usuários, zero clientes OAuth, ausência do schema `private` e de tabelas/funções da aplicação. O hook hospedado foi aplicado atomicamente a esse projeto, sem usar a cadeia de migrations local, e habilitado no dashboard como `private.mcp_access_token_hook`. A seleção persistida foi conferida após recarregar a página.

Configuração aplicada:

- Site URL da homologação e retorno exato `/oauth/consent`.
- Servidor OAuth e registro dinâmico de clientes (DCR) habilitados.
- Cadastro público desabilitado; login anônimo permanece desabilitado.
- Expiração de token de acesso: 900 segundos; rotação/ detecção de comprometimento de refresh ativa e intervalo de reutilização zero.
- Chave assimétrica ES256 existente; descoberta OAuth pública respondendo 200, com issuer `https://mlumbvxpaqfzpdjnvzxc.supabase.co/auth/v1` e PKCE S256.
- Audiência do hook hospedado: URL pública do recurso MCP. Tokens comuns sem `claims.client_id` devem conservar sua audiência original.

Os artefatos e a recuperação estão em `supabase/hosted/README.md`. A verificação SQL pela CLI passou nas asserções funcionais e de permissões; advisors de segurança retornaram zero avisos. Essa execução usa o papel chamador. A tentativa separada de assumir `supabase_auth_admin` foi recusada pela conexão da CLI; não foram concedidas permissões extras para contornar a restrição. A emissão real de tokens comuns, de código, refresh e reconexão foi comprovada pelo fluxo HTTPS. A verificação independente pelo JWKS confirmou ES256, issuer, audiência, subject, client_id OAuth e validade de 900 segundos. A sessão comum conservou a audiência authenticated.

O conector MCP administrativo do Supabase continuou retornando erro de ferramenta; a execução usou CLI e dashboard já autorizados. Isso é independente do servidor MCP do BR Steel.

## Configuração de publicação

`config/mcp-staging.env.example` contém os IDs e URLs públicos e mantém segredos em branco. `config/vercel.mcp-staging.json` define uma publicação sem agendamentos e executa `npm run verify:mcp-staging` antes do build. O guard recusa projetos divergentes, credenciais de integrações comerciais, emuladores, escrita habilitada, lista de usuários vazia e configuração pública contendo chaves de servidor.

O navegador exige configuração Firebase pública completa ao selecionar outro projeto. Misturas com os valores legados são recusadas. [Configuração Firebase](https://firebase.google.com/docs/web/setup), [variáveis públicas Next.js](https://nextjs.org/docs/app/guides/environment-variables).

O checkout de trabalho foi vinculado explicitamente ao projeto dedicado. A configuração privada de homologação fica em arquivo ignorado, com modo 600, e foi enviada diretamente às variáveis criptografadas da Vercel. O ambiente local dos emuladores foi preservado. A simulação real de upload confirmou a exclusão de `.env*`, credenciais locais, `.superpowers`, arquivos temporários e caches; a varredura dos arquivos de origem não encontrou os segredos usados na homologação.

Na primeira publicação, `--local-config` não substituiu o arquivo raiz consumido pelo build remoto: os três crons do `vercel.json` principal apareceram no deployment. A conferência dos metadados identificou o problema, e os crons foram desabilitados no projeto dedicado. A prova não encontrou contas ou credenciais comerciais nesse Firestore. Uma credencial exclusiva `CRON_SECRET` foi configurada para proteger também chamadas diretas às rotas legadas.

A publicação de homologação precisa **materializar o conteúdo de `config/vercel.mcp-staging.json` como `vercel.json` na raiz enviada**, além de confirmar o vínculo dedicado. A verificação do build agora lê esse arquivo efetivo; o teste de regressão reproduziu a aceitação indevida e confirmou a recusa após a correção. Preservar o arquivo original do checkout e restaurá-lo ao terminar; não publicar com o arquivo de crons do sistema principal. Após a publicação, conferir `crons: []` nos metadados do deployment e `disabledAt` no projeto. [Gerenciar crons na Vercel](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

## Prova HTTPS e aceite

`scripts/mcp-staging-proof.ts` usa um ambiente limpo e explícito, sem carregar arquivos `.env` ou credenciais padrão. O preflight offline com os valores reais da homologação passou. O runner exige os IDs exatos dos três provedores e um único ID `staging-proof-<UUIDv4>` na lista permitida. Usa a conta de serviço explicitamente e recusa credenciais Bling salvas ou colisões com dados existentes.

Na execução ao vivo, cria um usuário temporário que passa pelos perfis Administrador, Vendedor e Operador, um cliente OAuth e fixtures próprias. Valida discovery, login, primeiro acesso, consentimento, PKCE, emissão/refresh, leituras pelo SDK oficial, mudança de permissões, revogação, reconexão e auditoria. A limpeza desativa e remove somente os registros identificados como pertencentes à prova. Falhas ou resultados ambíguos de limpeza geram saída diferente de zero e IDs para recuperação, sem tokens ou senhas.

Esse teste declara explicitamente `hostedClaude: false`: a aprovação depende também de conectar o Claude hospedado, autenticar um usuário autorizado, executar as três leituras e revogar a conexão. Não considerar o SDK um substituto desse aceite. Resolver retenção TTL antes de um piloto contínuo. A etapa de escrita continua posterior ao aceite de leitura.

## Evidências locais

- Checkpoint anterior: 139 testes em 24 arquivos aprovados e build Next.js aprovado; typecheck com exatamente os 25 diagnósticos preexistentes.
- Novos scripts: typecheck direcionado aprovado; verificações offline de isolamento recusaram configurações inadequadas.
- SQL do hook: sintaxe analisada, aplicação remota atômica e asserções CLI aprovadas; zero avisos do advisor de segurança.
- Infraestrutura: regras publicadas, 11 índices prontos, domínio e vínculo Vercel confirmados, 24 variáveis criptografadas verificadas e simulação de upload sem segredos locais.
- Publicação final sem crons e prova ao vivo registradas abaixo. Nenhum envio ao GitHub ou alteração no ambiente principal foi feito nesta etapa.

## Prova ao vivo em 11/09/2026

A primeira publicação `dpl_4L77G651mapH22RsvP5WZ3wyNdDa` ficou READY e o domínio canônico respondeu publicamente. O navegador exibiu a tela de login. A verificação completa iniciou em `2026-09-11T22:11:35Z`, terminou em 75 segundos com saída zero e está registrada em [evidência JSON](evidence/mcp-staging-https-2026-09-11.json).

- OAuth/PKCE, login e troca inicial de senha, consentimento, código, refresh, reconexão e recusa de consentimento passaram.
- Assinaturas ES256 e claims dos quatro tipos de token foram verificados independentemente; a audiência comum permaneceu authenticated e a OAuth correspondeu ao recurso MCP; todos tiveram 900 segundos de validade.
- SDK oficial: vendas sintéticas de R$300, crescimento de 100%, estoque zero preservado e projeção de produção restrita; catálogos e chamadas proibidas conferidos nos três perfis.
- Revogação produziu HTTP 401 imediatamente e rejeição de refresh; tokens antigos continuaram recusados após reconectar.
- Auditoria de 11 chamadas sem credenciais ou payload privado; limpeza completa e sem requisições ambíguas. Conferência posterior do Firestore encontrou zero registros nas coleções de usuário, vínculos, conexões, intents, auditoria, limites, vendas e estoque, além de zero configurações/contas/eventos comerciais.
- Data API recusou o schema private com HTTP 406/PGRST106; o dashboard mostrava zero funções expostas.

Na conclusão da prova automatizada, nenhum usuário foi mantido. Um acesso foi provisionado posteriormente para o aceite manual, conforme o registro abaixo. O aceite no Claude e a retenção TTL continuam pendentes; a escrita permanece desabilitada.

## Publicação final sem agendamentos

A republicação `dpl_9qZAbDyUqoxERyFrS7nRCGvnbpsd` ficou READY no mesmo domínio. O manifesto de homologação foi materializado na raiz enviada, o guard passou durante o build remoto e o arquivo principal do checkout foi restaurado ao término. Os metadados reais confirmaram `crons: []`, nenhuma definição no projeto e agendamentos desabilitados. As três rotas de cron responderam HTTP 401 sem credencial. Login e discovery responderam 200 e o MCP sem Bearer respondeu 401. A evidência está em [metadados de publicação](evidence/mcp-staging-deployment-2026-09-11.json).

O teste de regressão de configuração efetiva passou junto aos cinco testes de homologação. O typecheck direcionado passou e o projeto manteve os 25 diagnósticos anteriores. A configuração temporária da publicação não foi incorporada ao `vercel.json` principal.

A prova completa foi repetida na publicação final em `2026-09-11T22:18:42.095Z`, passou em 71 segundos e encerrou com limpeza completa, nenhuma ambiguidade e saída zero. Ver [evidência da versão final](evidence/mcp-staging-https-final-2026-09-11.json). O aceite no Claude permanece separado e pendente.

## Acesso manual preparado em 11/09/2026

O usuário relatou falha de credenciais no retorno do Claude. A consulta ao Firestore confirmou zero usuários; o único ID da lista permitida já havia sido removido ao concluir a prova automatizada. O login usa a coleção users da homologação, portanto credenciais do BR Steel principal ou do próprio Claude não poderiam autenticar nesse ambiente.

Foi criado o acesso `piloto-mcp@example.invalid`, perfil Administrador apenas nesta base de teste, usando o ID reservado que já constava na lista permitida do deployment. Não houve necessidade de alterar variáveis, publicar novamente, copiar usuários/senhas da produção ou modificar o OAuth. A senha inicial foi gerada aleatoriamente, armazenada no banco somente como scrypt com salt individual e entregue em arquivo local privado de modo 600, ignorado pelo Git e pelo upload Vercel.

A validação real confirmou login HTTP 401 antes do cadastro e 200 depois; senha incorreta continua produzindo 401. A conta exige troca de senha no primeiro acesso e o MCP recusou autorização com 403 enquanto essa troca está pendente. Ver [evidência de acesso](evidence/mcp-pilot-access-2026-09-11.json).

Este usuário foi **mantido para o teste do usuário**. Não executar a prova automatizada com esse mesmo ID enquanto o aceite estiver em andamento: o preflight recusa a colisão e o cleanup só pode remover objetos com o marcador próprio da execução. A ausência de `stagingProofRunId` nesta conta distingue o piloto da fixture descartável. Ao encerrar o piloto, revogar as conexões, desativar a conta e fazer a limpeza explícita dos seus registros. O conector dentro do Claude ainda não foi validado pela tarefa principal.

## Conexão real do Claude confirmada

Em 11/09/2026, o usuário confirmou que conseguiu conectar. A consulta ao servidor às 22:48:09 UTC confirmou a conta ativa, primeiro acesso concluído e uma conexão ativa com cliente **Claude**, autorizada para vendas, estoque, insumos e produção em leitura. A auditoria registrou `consultar_meu_acesso` com resultado `success`. Ver [evidência da conexão](evidence/mcp-claude-connected-2026-09-11.json).

Isso comprova a autorização real e uma ferramenta executada pelo Claude. Ainda não comprova o aceite completo das leituras de vendas/estoque/produção com valores conhecidos nem revogação/reconexão pelo cliente Claude. A validação anterior dessas operações pelo SDK permanece registrada separadamente. O piloto continua ativo; não revogar ou remover como parte da limpeza das fixtures automáticas. Escrita permanece desabilitada.
