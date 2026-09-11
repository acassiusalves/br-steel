# Homologação pública do MCP

Situação: código de leitura validado localmente no commit `9eb8144`; configuração de isolamento preparada e validada localmente. Nenhum novo projeto ou deploy foi criado nesta verificação. O provisionamento e o aceite pelo Claude hospedado continuam pendentes.

## Inventário verificado

- Vercel: projeto `br-steel`, equipe `team_AnjWj22RX6qtosCjGldryHxb`, ligado ao GitHub `acassiusalves/br-steel`. Domínio principal `br-steel.vercel.app`. Não há projeto identificado como homologação BR Steel na equipe consultada.
- Preview do projeto atual compartilha variáveis de Bling e Firebase com produção. Não será utilizado como ambiente isolado.
- Firebase: dois projetos chamados MarketFlow foram encontrados; nenhum identificado como homologação do MCP. Não assumir que o segundo é descartável ou reutilizável.
- Supabase conectado: organização **Lunneta Ads**, com projetos de outro sistema. A organização para o novo projeto BR Steel precisa ser indicada pelo usuário. O conector exige consultar o custo e confirmar seu entendimento antes de criar um projeto.

## Recursos propostos

| Recurso | Preparação |
| --- | --- |
| Vercel | Novo projeto `br-steel-mcp-staging` na equipe já usada pelo BR Steel, Node 22.x, domínio próprio gerado pela Vercel |
| Firestore | Novo projeto `brsteel-mcp-staging` ou variante com sufixo disponível, sem dados reais; app web e conta de serviço pertencentes a esse projeto |
| Supabase | Novo projeto `brsteel-mcp-oauth-staging`, região São Paulo, organização a indicar; somente identidades OAuth de teste |
| Usuários | Três usuários sintéticos com papéis Administrador, Vendedor e Operador e senhas individuais; lista explícita de IDs no piloto |

Os nomes são propostas, não recursos criados. Confirmar disponibilidade e custos nas contas escolhidas. O projeto Vercel separado pode usar seu domínio canônico de deployment `production`; isso é o ambiente de homologação do BR Steel e não altera o projeto Vercel `br-steel`. Confirmar que os caminhos MCP/OAuth são alcançáveis pela infraestrutura Claude. Não remover a proteção de previews do projeto atual. [Deploy pela CLI Vercel](https://vercel.com/docs/cli/deploy).

## Isolamento preparado no código

O navegador usava configuração Firebase fixa de produção fora do emulador. Agora uma seleção explícita de outro projeto exige um conjunto completo de configuração pública pertencente a esse projeto. Configurações parciais ou misturadas com os valores legados são recusadas; projetos sem override mantêm o comportamento anterior. Os acessos `NEXT_PUBLIC_*` são individuais para permitir a inclusão correta pelo build Next.js. [Configuração Firebase](https://firebase.google.com/docs/web/setup), [variáveis públicas no Next.js](https://nextjs.org/docs/app/guides/environment-variables).

`config/mcp-staging.env.example` lista as variáveis, sem valores secretos. `config/vercel.mcp-staging.json` desativa os agendamentos e executa `npm run verify:mcp-staging` antes do build. A verificação offline recusa projeto Vercel de produção, Firebase fora da homologação, conta de serviço de outro projeto, referências divergentes, credenciais de Bling/Mercado Livre, emuladores, escrita habilitada, lista de usuários vazia, URLs inadequadas e chaves de servidor em variáveis públicas. Ela não consulta a nuvem nem comprova permissões da conta de serviço ou propriedade das chaves Supabase; essas verificações ocorrem após provisionamento.

O build usa exclusivamente as variáveis configuradas no projeto novo. Não copiar `.env.local`, configurações privadas do emulador, variáveis do preview atual, `service-account.json` de produção ou o vínculo `.vercel` do checkout principal.

## Sequência de execução após definição da organização

1. Consultar o custo do projeto Supabase na organização indicada e obter a confirmação exigida pelo conector antes de criá-lo.
2. Criar os projetos dedicados, registrar o app web Firebase e provisionar Firestore. Criar credencial de servidor restrita ao projeto de teste e guardar diretamente no ambiente privado. Não versionar chave privada.
3. Publicar as regras e índices Firestore usando explicitamente o ID de homologação; o `.firebaserc` existente ainda aponta produção e não deve ser usado implicitamente. Verificar as políticas TTL de auditoria/contadores.
4. Configurar Supabase Auth com cadastro público/anônimo desligado, OAuth server e DCR, consentimento em `/oauth/consent`, tokens de 15 minutos e assinatura assimétrica. Aplicar o hook de audiência usando a URL pública definitiva. A migration local atual contém `http://localhost:9003/api/mcp`: não copiar essa audiência para a nuvem. Registrar a adaptação como migration de homologação e verificar issuer/JWKS/audience com token emitido nesse projeto.
5. Preencher as variáveis do template no projeto Vercel dedicado, incluindo os IDs esperados de cada recurso, origem canônica e IDs sintéticos permitidos. Usar segredo de sessão exclusivo. Manter `MCP_WRITES_ENABLED=false`.
6. Vincular explicitamente um checkout de publicação ao novo projeto Vercel. Usar `vercel deploy --prod --local-config config/vercel.mcp-staging.json` somente depois de confirmar o vínculo e configurar as variáveis. Não executar esse comando no projeto `br-steel`.
7. Validar metadados públicos, 401 + challenge sem Bearer, OAuth/PKCE/refresh, catálogos por papel e três leituras pelo Claude. Comparar valores com fixtures e registros de auditoria. Revogar e confirmar bloqueio imediato.
8. Registrar URLs, IDs dos recursos, commit implantado e evidências antes de concluir a etapa 4. A escrita segue para a etapa 5.

Ao repetir apenas verificações locais, `npm run verify:mcp-staging` sem variáveis deve falhar. O template vazio não permite publicação. Custos, recursos em nuvem, IAM e conexão Claude não foram validados por esse teste offline.

## Verificação local em 11/09/2026

- Suíte completa: 139 testes aprovados em 24 arquivos, incluindo configurações Firebase e bloqueios de homologação.
- Build Next.js aprovado. Typecheck mantém exatamente os 25 diagnósticos preexistentes, sem novos erros.
- Execução real da CLI de verificação testada com configuração sintética válida e ambiente incompleto. Após o ajuste de tipagem do ambiente desse teste, os quatro testes de homologação foram executados novamente e aprovados.
- Revisão independente não encontrou problemas bloqueantes. A revisão foi estática e não substitui a validação da infraestrutura criada.
- Diff verificado sem erros de whitespace ou valores secretos locais. Nenhuma publicação, alteração em produção ou envio ao GitHub.
