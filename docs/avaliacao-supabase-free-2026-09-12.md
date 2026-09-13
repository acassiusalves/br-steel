# Avaliação do Supabase Free para o BR Steel

Avaliação de capacidade em 12/09/2026. Nenhum dado, configuração ou plano de produção foi alterado. A evidência agregada está em `docs/evidence/supabase-free-capacity-2026-09-12.json`.

**Conclusão: o Free é uma opção plausível para começar por vendas, estoque e produção, desde que as consultas sejam adaptadas. Uma migração de todo o banco precisa de uma medição do esquema PostgreSQL antes de assumir que haverá margem para crescimento.** O consumo atual de leituras do Firestore, isoladamente, não justifica uma migração urgente por economia.

Foram lidos 152.651 documentos, em páginas de até 500 registros e com duas consultas simultâneas. A cobertura inclui 31 coleções principais e oito grupos de subcoleções referenciados pelo código. Os resultados abaixo são agregados; documentos, credenciais e dados de clientes não foram gravados nos artefatos. A medição não é um snapshot transacional: houve uma nova gravação de log entre a contagem e a leitura. Subcoleções desconhecidas pelo código não foram descobertas exaustivamente.

| Grupo medido | Registros | JSON normalizado, MB |
| --- | ---: | ---: |
| Pedidos de venda | 12.528 | 24,81 |
| Estoque, insumos, movimentações e produção | 429 | 0,11 |
| Logs de diagnóstico de webhooks | 82.138 | 52,78 |
| Histórico diário de anúncios patrocinados | 15.071 | 43,39 |
| Eventos do Mercado Livre | 39.798 | 15,94 |
| Demais dados medidos | 2.687 | 12,47 |
| **Total** | **152.651** | **149,52** |

MB nesta avaliação significa 1.000.000 de bytes. O JSON inclui os valores dos documentos e o identificador, com timestamps normalizados. Ele não equivale ao espaço físico de tabelas PostgreSQL, índices, TOAST ou backups.

O Google Monitoring registra **1.615.302.726 bytes de dados e índices no Firestore**, cerca de 1,62 GB. Isso não significa que a migração ocupará 1,62 GB no PostgreSQL. A estrutura e os índices dos dois bancos são diferentes. A métrica cresceu aproximadamente 135 MB entre 14/08 e 12/09; esse crescimento também inclui índices.

O projeto Supabase `mlumbvxpaqfzpdjnvzxc`, em São Paulo, está ativo em uma organização **Free**. A soma das bases PostgreSQL existentes, incluindo bases de sistema, foi de **26,14 MB**; a base principal `postgres` ocupa 10,87 MB. A organização também contém o projeto Lunneta Ads Sistema. Sua franquia de tráfego é compartilhada; o uso efetivo dessa franquia não foi medido nesta avaliação.

O Free oferece 500 MB de banco por projeto, CPU compartilhada, 500 MB de RAM e 5 GB mensais de saída não cacheada por organização. Não inclui backups automáticos e pode pausar projetos por inatividade. Exceder 500 MB pode colocar o banco em modo somente leitura. Fontes: [preços](https://supabase.com/pricing), [tamanho do banco](https://supabase.com/docs/guides/platform/database-size), [cobrança por organização](https://supabase.com/docs/guides/platform/billing-on-supabase).

Para dimensionar a incerteza antes de construir as tabelas, estes cenários multiplicam os bytes JSON por 2, 3 ou 4 e adicionam os 26,14 MB atuais. **São hipóteses de planejamento para reservar espaço, não medições PostgreSQL nem limites garantidos.**

| Hipótese de espaço por dados e índices | Só núcleo operacional + base atual | Todos os dados medidos + base atual |
| --- | ---: | ---: |
| 2 vezes os bytes JSON | 76 MB | 325 MB |
| 3 vezes os bytes JSON | 101 MB | 475 MB |
| 4 vezes os bytes JSON | 126 MB | 624 MB |

O núcleo operacional tem margem nesses cenários. A migração completa pode ficar próxima ou acima da quota. Os 1.235 pedidos datados entre 13/08 e 11/09 representam aproximadamente 2,45 MB em JSON pelo tamanho médio; isso mede volume por data do pedido, não crescimento líquido. Histórico de anúncios e logs exigem uma política de retenção, além do espaço futuro de auditoria do MCP.

**O tráfego exige um ajuste antes da migração.** Para o filtro inicial da tela de vendas, a rotina carrega 473 pedidos de setembro e 1.212 do período anterior, totalizando **3.487.477 bytes de JSON** por atualização. A tela atualiza a cada dez segundos enquanto está visível. Uma reprodução dessa lógica no Supabase, transferindo os documentos completos ao servidor, modela aproximadamente **1,26 GB por hora** para uma aba continuamente ativa. Não é uma medição de tráfego faturado: compressão, protocolo, duração das consultas e uso real mudam o resultado.

O cálculo de totais, produtos e estados deve ocorrer no PostgreSQL, retornando somente os resultados agregados. Estoque e demanda precisam de filtros e paginação no banco; hoje podem reler conjuntos inteiros. Cache curto e atualização menos frequente reduzem chamadas repetidas. Dados enviados do Supabase à Vercel também contam como saída, assim como determinadas formas de backup: [regras de egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress).

Antes da leitura completa desta avaliação, o Monitoring registrava **1.765.562 leituras em 30 dias**. A US$ 0,06 por 100 mil leituras na região `nam5`, isso representa aproximadamente **US$ 1,06 antes da franquia gratuita**. Não é o valor da fatura: não inclui armazenamento, gravações, outros itens de cobrança ou tributos. A coleta paginada desta avaliação acrescenta leituras pontuais. [Preços do Firestore](https://cloud.google.com/firestore/pricing).

O escopo inicial recomendado é levar `salesOrders`, `stockUpdates`, `supplies`, `inventoryMovements`, `productionColumns`, `productionLots` e `productionLotItems` ao Supabase. As gravações e integrações desses dados devem acompanhar a mudança. Site, login e OAuth podem preservar seu funcionamento; outros módulos e os pequenos acessos de autenticação ainda podem usar Firestore nessa etapa.

Para decidir a troca, os próximos critérios são: medir tabelas e índices do esquema proposto; validar resultados e permissões; testar consultas com uma carga representativa em ambiente isolado; conferir a franquia compartilhada de tráfego; e preparar backup com restauração verificada. Uma meta inicial de até 300 MB de ocupação deixaria 200 MB de reserva, como critério de engenharia, não como limite adicional do provedor.

Não houve importação no Supabase, exclusão de logs, migração de usuários, teste de carga, mudança de plano, commit ou publicação. A avaliação confirma a plausibilidade de capacidade para o núcleo operacional; não declara a migração completa pronta para produção.
