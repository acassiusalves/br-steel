# Piloto MCP PostgreSQL pela Vercel — 12/09/2026

**Resultado: aprovado e encerrado.** O SDK oficial MCP executou leituras da cópia real no Supabase pela Vercel de homologação, autenticado com OAuth. O acesso temporário foi revogado e a homologação voltou ao deployment anterior. A produção continua no mesmo deployment, usando Firestore.

[Dados estruturados](operational-postgres-endpoint-pilot.json). Este ensaio complementa o [piloto de cópia e consultas diretas](operational-postgres-hosted-pilot.md).

## O que foi validado

- Discovery, registro do cliente, login, primeiro acesso, consentimento e código OAuth com PKCE S256 por HTTPS. JWTs ES256 verificados independentemente: emissor, audiência, usuário, cliente e validade de 900 segundos. Token comum do provedor recusado pelo MCP.
- As 11 ferramentas de negócio retornaram `source: postgres`, o hash esperado, data de captura e aviso explícito de cópia. Listas, detalhes e continuações passaram. `consultar_meu_acesso` continuou consultando o cadastro atual no Firebase.
- Permissões do perfil vigente aplicadas a cada requisição; chamadas diretas a ferramentas proibidas recusadas; usuário inativo recusado. Projeções de produção sem dados de clientes ou valores comerciais; o campo legado `customerName`, quando presente, ficou vazio.
- Renovação do token aceita, revogação com HTTP 401, refresh revogado recusado pelo provedor, reconexão aceita e tokens antigos ainda recusados. Negativa explícita de consentimento também validada.
- Auditoria sem tokens ou payloads de negócio. A prova removeu cliente OAuth, usuário e demais registros sintéticos sob sua responsabilidade, sem pendências ou requisições ambíguas.

| Perfil testado | Ferramentas disponíveis |
|---|---:|
| Administrador | 12 |
| Vendedor | 5 |
| Operador | 9 |

As contagens incluem a ferramenta de consulta do próprio acesso. O perfil de operador manteve o acesso a estoque/insumos previsto no sistema; a restrição de campos financeiros descrita acima refere-se às ferramentas de produção.

## Medições

A execução completa começou às **16:19:09 BRT** e durou **126 segundos**, incluindo OAuth, consultas, revogação, reconexão e limpeza. A amostra HTTP abaixo contém 31 leituras de negócio PostgreSQL, três consultas de acesso no Firebase e duas chamadas proibidas. Requisições auxiliares GET e outras mensagens de protocolo ficam fora dela.

| Medida | Resultado |
|---|---:|
| Chamadas de ferramentas medidas | 36 |
| Maior quantidade em janela de 60 segundos | 36 |
| Latência HTTP média | 1.648 ms |
| Menor / maior latência HTTP | 1.140 / 2.452 ms |
| Bytes de resposta HTTP decodificada | 69.720 bytes |
| Média por chamada | 1.937 bytes |
| Menor / maior resposta | 136 / 5.683 bytes |

Esses bytes incluem o conteúdo textual e estruturado duplicado do envelope MCP. **Não são egress faturado pelo Supabase** nem a medida do protocolo PostgreSQL apresentada no ensaio anterior. As latências incluem o caminho cliente/Vercel e a autorização da aplicação. A amostra é sequencial, com uma conta, e não comprova capacidade concorrente nem economia mensal.

## Cópia e isolamento

- Banco: `mlumbvxpaqfzpdjnvzxc`; origem: `marketflow-9h4tg`.
- Captura: **12/09/2026, 14:41:15 BRT**; importação concluída às **14:54:50 BRT**. Hash: `8a783d1454afcb13a045545de0dbdf7d2d4af000998c05bae5d09fe4f9faeae9`.
- A migration local `20260912184709_operational_copy_metadata.sql` foi aplicada no histórico hospedado como `20260912190102`. Datas do singleton conferidas contra a execução de importação já existente.
- Seleção exclusiva do MCP por flag, IDs explícitos, hash e prazo. Transação de leitura confere prontidão, origem e datas antes dos dados; cópias com 24 horas ou mais são recusadas. Não há fallback para Firestore/Bling se a leitura selecionada falhar.
- Login PostgreSQL de leitura, TLS verificado, pool de uma conexão por instância e limite de 30 segundos por consulta. Tentativas de gravação, acesso a `auth.users` e mudança para o papel de importação foram negadas.
- Schemas operacionais continuam sem acesso para `anon` e `authenticated`. Autorizações individuais são aplicadas pelo backend; o papel PostgreSQL compartilhado não representa uma política RLS individual por usuário.

## Publicação e encerramento

| Ambiente | Deployment |
|---|---|
| Candidato ensaiado na homologação | `dpl_GpYYyAWxWYW7NKun2roNMZt2AxTz` |
| Homologação restaurada ao final | `dpl_3K3Xt92mbCFYSdNUsiPBRswE5kqk` |
| Produção antes e depois, sem mudança | `dpl_5j2BBDFg73UAnkiYywsEEL3UxTuj` |

Upload verificado: 489 arquivos regulares, sem caminhos privados ou segredos detectados. Os 334 arquivos `src/` finais conferem com os hashes enviados ao deployment. Homologação foi publicada sem crons.

No encerramento: ambos os logins de piloto ficaram sem login, senha ou associação aos papéis operacionais; zero sessões PostgreSQL ativas. As oito variáveis alteradas no projeto de homologação foram restauradas e nenhuma variável `MCP_PG_PILOT_*` permaneceu. A cópia continuou pronta, com o mesmo hash, e as credenciais temporárias locais foram removidas após a conferência final.

## Verificação local e revisão

- 226 testes Vitest em 38 arquivos e 18 testes de integração com PostgreSQL descartável passaram.
- Build local e build Vercel passaram. Typecheck: os mesmos 25 diagnósticos preexistentes, sem novos erros.
- Revisões de runtime e roteiro concluídas; correções verificadas com testes e revisão específica.
- Advisor de segurança manteve o aviso anterior de proteção contra senhas vazadas; sem novo acesso público aos schemas operacionais. Observações de desempenho sobre índices continuam para avaliação na etapa de gravação.

Duas tentativas anteriores identificaram problemas no roteiro, com limpeza concluída em ambas: uma contava o GET auxiliar do SDK como resposta de ferramenta; outra usava páginas pequenas demais para alcançar o cadastro de insumo nomeado. A coleção contém 54 registros, dos quais 53 não têm nome e 52 desses possuem limites de estoque; a listagem atual do sistema já omite esses registros. O ensaio passou a examinar dez por página, alcançando o cadastro na sexta requisição. Nenhum desses ajustes alterou dados de negócio ou o runtime publicado.

## Limites e próximo passo

O provedor OAuth compartilhado indicou a tela de consentimento de produção. O roteiro reconheceu somente essa URL conhecida e submeteu a autorização à sessão de homologação, preservando a configuração global. **Esta prova pelo SDK não valida a navegação completa dentro do Claude.**

A cópia não tem sincronização contínua; a exportação por páginas também não congela a origem. A etapa 3 ainda requer backup/restauração do schema final, teste direto no Claude e observação de consumo durante uso controlado antes de ampliar o piloto ou trocar a fonte oficial.
