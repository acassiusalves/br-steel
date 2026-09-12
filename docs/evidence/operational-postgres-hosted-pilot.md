# Piloto hospedado de leitura — 12/09/2026

A cópia operacional foi criada e conferida no Supabase `mlumbvxpaqfzpdjnvzxc`. **A aplicação e o MCP continuam usando o Firestore** `marketflow-9h4tg`. Esta entrega mede os leitores por um cliente PostgreSQL neste computador; a etapa de leitura hospedada ainda precisa validar endpoints na Vercel e usuários restritos.

## Dados e conferência

Exportação nova iniciada em **12/09/2026 às 14:41:15 BRT**, concluída em 34,9 s: **12.967 registros, 26.080.327 bytes de JSON**. O exportador verificou os tipos originais antes da normalização. A leitura paginada não congela a origem e não representa um corte transacional.

Foram copiados 12.538 pedidos, 361 observações de estoque, 54 insumos, 3 colunas, 3 lotes, 7 itens de lote e 1 movimento. As coleções de códigos de insumos, comentários e contadores anuais estavam vazias e constam do manifesto.

A carga levou **345.3 s** e terminou às 14:54:50 BRT. O importador releu conteúdo, versões, hashes, itens e projeções antes de marcar a cópia como pronta. Uma segunda conferência independente levou **2.85 s**, confirmou 12967 registros e 12999 itens de pedidos e encontrou **zero divergências em relação ao arquivo exportado**. Isso não afirma que o Firestore permaneceu sem alterações depois da captura.

Hash do snapshot: `8a783d1454afcb13a045545de0dbdf7d2d4af000998c05bae5d09fe4f9faeae9`. Dados reais e credenciais não foram versionados. Arquivo de origem com permissão 0600 em diretório privado local; nenhuma sincronização automática foi criada.

## Armazenamento e consultas

`pg_database_size` após a carga: **50.38 MB**; antes: **10,87 MB**. As 13 tabelas operacionais, incluindo índices/TOAST, ocupam **38.85 MB**. O banco está abaixo do teto de planejamento de 400 MB e usa cerca de 10.1% da quota nominal de 500 MB por projeto. O tamanho é do schema real, incluindo pedidos integrais e projeção dos itens.

Foram executadas cinco amostras sequenciais de cada consulta, com login restrito pelo pooler transacional em São Paulo, TLS com certificado e nome do servidor verificados, pool de uma conexão. Resumos: 01/09 a 12/09/2026. Páginas: limite 50. Detalhes: um registro de origem por tipo. A medição rejeita uma mudança da cópia durante as amostras.

| Consulta | Mediana (ms) | Máximo (ms) | Bytes recebidos do protocolo (máx.) | JSON de resposta (máx.) |
| --- | ---: | ---: | ---: | ---: |
| Resumo de vendas | 62.07 | 143.22 | 2,324 | 2,230 |
| Página de vendas (50) | 61.76 | 190.71 | 115,515 | 102,295 |
| Página de estoque (50) | 56.71 | 73.66 | 19,320 | 17,091 |
| Demanda de produção | 80.13 | 154.59 | 24,757 | 16,954 |
| Lotes de produção | 46.84 | 123.19 | 1,688 | 1,396 |
| Pedidos para produção (50) | 48.23 | 127.57 | 11,022 | 8,765 |
| Página de insumos (50 examinados) | 44.42 | 48.34 | 1,521 | 218 |
| Detalhe de pedido para produção | 74.18 | 149.85 | 385 | 239 |
| Detalhe de lote | 54.12 | 56.91 | 1,792 | 1,455 |
| Movimentos de um insumo | 42.03 | 130.35 | 186 | 97 |

Latências incluem rede deste computador e transações dos repositórios. A conexão inicial não está nas amostras individuais. Não medem o percurso Claude → MCP → Vercel → Supabase, nem carga simultânea, p95 ou p99 de produção. Páginas de insumos mantêm o contrato legado de avançar pelos documentos examinados, mesmo quando registros sem nome são omitidos.

## Tráfego e Free

Carga + conferência independente + 50 consultas receberam **69.17 MB** pelo contador do protocolo PostgreSQL. Só as 50 consultas receberam **0.894 MB**. O contador usa `TLSSocket.bytesRead`: inclui mensagens do protocolo, mas não equivale ao tráfego faturado, ao transporte TLS/TCP ou aos bytes das chamadas administrativas.

No painel, a organização `Lunneta Ads` estava em **2,222/5 GB de egress não cacheado** no ciclo **07/09–07/10**, compartilhado entre projetos. O painel informa atraso de atualização de até uma hora. Não atribuí a diferença em relação à medição anterior ao BR Steel. [Consumo da organização](https://supabase.com/dashboard/org/xhdvfwtxqlllntebykda/usage).

Para dimensionar a frequência, um par de consultas (resumo de vendas + demanda) recebeu até **27,081 bytes** no ensaio. A hipótese de cinco usuários repetindo o par a cada minuto, oito horas por dia, 22 dias, daria **1.430 GB** de protocolo; a cada cinco minutos, **0.286 GB**. São cenários sem cache, não previsão de uso. Ainda é necessário somar tráfego real do sistema, outros projetos e backup. O armazenamento cabe; a viabilidade mensal do Free não está concluída.

## Acesso e encerramento

13 tabelas com RLS, 18 FKs e 25 índices. `anon` e `authenticated` não têm acesso ao schema operacional. No Supabase, o login de leitura passou por consultas reais e recebeu `42501` ao tentar gravar, ler usuários de Auth, consultar o histórico interno de cargas ou assumir o papel de importação. As políticas são para o backend; a autorização individual continuará nas operações do sistema.

Encerrado o ensaio, os dois logins de piloto foram desativados, suas senhas removidas e associações aos papéis de acesso revogadas; sessões foram encerradas. A conferência final encontrou **zero sessões de piloto**. A cópia permanece privada. Nenhuma credencial de piloto foi publicada na Vercel, e o OAuth existente foi preservado (1 usuário e 8 clientes antes/depois).

O advisor de segurança não indicou exposição das tabelas operacionais. Retornou um alerta de Auth sobre proteção contra senhas vazadas, fora das mudanças deste piloto. [Orientação do Supabase](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

O advisor de desempenho listou 12 FKs sem índice completo e 5 índices ainda sem uso. São avisos informativos: 11 FKs se referem ao histórico de importações/singleton, sem exclusão ou troca de chave de importações neste piloto; a restante é `supply_codes.supply_id`. Revisar esses índices ao portar gravações/manutenção; não remover índices por um ensaio curto. [FKs sem índice](https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys), [índices sem uso](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

## Verificação e continuação

**194 testes Vitest em 36 arquivos e 17 testes de integração PostgreSQL/Firestore passaram.** Typecheck manteve os mesmos 25 diagnósticos preexistentes, sem novos. Revisão independente encerrada após corrigir a identificação do snapshot nas métricas e o estado do relatório em falhas. Build de aplicação não foi repetido nesta entrega de ferramentas administrativas; os seletores ativos não foram alterados. Código mantido em commit local, sem push, merge ou deploy de aplicação nesta etapa.

As migrations foram aplicadas pelo conector, que gerou versões próprias no histórico hospedado: `operational_core` = `20260912174636`, `operational_read_models` = `20260912174651`, `operational_pilot_roles` = `20260912174831`. Os arquivos de origem continuam na cadeia separada `supabase/operational/migrations`; não executar `db push` misturando essa cadeia com OAuth.

Próxima entrega: seletor de leitura restrito a usuários autorizados, indicação da data da cópia, endpoints do MCP na Vercel, testes de administrador/vendedor/operador/inativo/revogado e medição do tráfego completo. Depois, medir backup/restauração do schema final e adaptar todos os escritores antes de qualquer troca da fonte oficial.

[Evidência estruturada](operational-postgres-hosted-pilot.json).
