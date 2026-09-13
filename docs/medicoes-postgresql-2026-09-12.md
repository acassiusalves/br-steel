# Medições PostgreSQL para o BR Steel — 12/09/2026

**Os dados inventariados cabem no limite de armazenamento do Supabase Free no protótipo medido. O tráfego compartilhado e a estratégia de backup continuam sendo os pontos que precisam de orçamento antes da migração.**

Este ensaio substitui os multiplicadores hipotéticos de espaço da avaliação anterior por tamanhos de tabelas e índices de um esquema experimental. A evidência agregada está em `docs/evidence/supabase-postgres-measurements-2026-09-12.json`. A produção e o projeto Supabase hospedado não foram modificados.

| Escopo | Tabelas, TOAST e índices medidos | Somando os 26,14 MB já existentes no Supabase |
| --- | ---: | ---: |
| Vendas, estoque, insumos e produção | **37,08 MB** | **63,22 MB** |
| Todos os dados inventariados no modelo experimental | **190,37 MB** | **216,51 MB** |

A segunda coluna foi medida com as funções de tamanho do PostgreSQL. A última é uma projeção da soma com a base hospedada existente; não houve importação hospedada. No cenário completo, essa soma usa aproximadamente 43% dos 500 MB, deixando cerca de 283 MB antes de crescimento, novos índices ou bloat. MB aqui é decimal. [Limites do plano](https://supabase.com/pricing), [tamanho do banco](https://supabase.com/docs/guides/platform/database-size).

O teste utilizou a imagem Supabase PostgreSQL 17.6.1.167, em contêiner local dedicado, sem rede ou portas expostas, limitado a uma CPU e 512 MiB de memória. Não usou os contêineres dos outros projetos. Foram carregados 152.654 registros de origem, incluindo três novos logs em relação ao primeiro inventário. Os 12.528 pedidos foram separados em pedidos e 12.989 itens; as demais estruturas operacionais tiveram tabelas próprias. Outros módulos ficaram em uma tabela JSONB com chave primária e índice por coleção/data.

Textos maiores que três caracteres foram pseudonimizados em memória, preservando o comprimento em bytes; datas ISO e códigos curtos foram preservados. A diferença de volume JSON após a transformação foi de aproximadamente 0,016%. Isso não garante compressibilidade idêntica. As coleções `users`, `appConfig` e `mercadoLivreAccounts` foram substituídas por dados sintéticos de tamanho aproximado, sem copiar seus usuários ou segredos. O inventário abrange as coleções e subcoleções conhecidas pelo código; não é uma descoberta exaustiva de estruturas desconhecidas.

As consultas SQL de leitura foram comparadas com cálculos independentes que reproduzem as regras atuais. **Dez cenários passaram:** resumos de vendas e demanda em períodos mensal, anual e vazio, saldos de 361 SKUs e continuidade de duas páginas de estoque. Totais, quantidades, clientes distintos, produtos, estados, saldos nulos e sugestões de corte/dobra foram comparados. Uma diferença causada pela divisão decimal antes do `floor` foi detectada e corrigida apenas no protótipo, usando o comportamento de ponto flutuante do cálculo JavaScript atual.

| Consulta local | Mediana | Percentil 95 |
| --- | ---: | ---: |
| Resumo de vendas de setembro, com período anterior | 5,80 ms | 6,65 ms |
| Resumo de vendas de janeiro a setembro | 46,47 ms | 55,91 ms |
| Demanda de produção de setembro | 4,41 ms | 5,24 ms |
| Demanda de janeiro a setembro | 12,81 ms | 13,22 ms |
| Página de 100 saldos | 0,35 ms | 0,45 ms |
| Página de 100 pedidos | 0,09 ms | 0,11 ms |

Cada consulta teve cinco execuções de aquecimento e vinte amostras, com `EXPLAIN ANALYZE`. O teste misto de oito segundos com cinco clientes simultâneos completou 2.377 transações sem falhas, com 95% das latências até 87,16 ms. Um ensaio com um cliente também não teve falhas. Esses resultados usam cache aquecido e conexão por socket local como `postgres`: **não incluem rede, Vercel, OAuth, RLS ou os recursos compartilhados do Free hospedado e não são uma garantia de capacidade sustentada**.

O resumo de vendas calculado no banco retornou **1.943 bytes de agregados**, contra 3.487.477 bytes de pedidos completos carregados pela lógica atual, uma redução de 99,94% nesse volume de dados. O protótipo de demanda mensal retornou 7.901 bytes. São resultados de agregação, sem o envelope completo da API e alguns metadados de apresentação; o aplicativo ainda não usa essas consultas.

O painel da organização confirmou os seguintes valores, sujeitos ao atraso de atualização do provedor:

| Tráfego não cacheado compartilhado | Uso |
| --- | ---: |
| Ciclo atual, 07/09 a 07/10 | 1,961 GB de 5 GB |
| Restante no momento da consulta | 3,039 GB |
| Ciclo anterior | 3,749 GB |

O BR Steel aparecia com uso arredondado para 0 GB e gráfico na escala de KB, coerente com o uso atual de OAuth. Isso não significa zero bytes. O restante da organização também é consumido pelo Lunneta Ads Sistema. A sobra atual não é uma previsão de sobra no fechamento do ciclo. [Painel da organização](https://supabase.com/dashboard/org/xhdvfwtxqlllntebykda/usage), [regras de saída](https://supabase.com/docs/guides/platform/manage-your-usage/egress).

Como referência de planejamento, cinco usuários mantendo os resumos de vendas e demanda ativos por oito horas em 22 dias, com atualização a cada 60 segundos, gerariam aproximadamente **0,52 GB/mês só nesses agregados**. Esse intervalo ainda não foi implementado. O cenário não inclui outras telas, cabeçalhos, autenticação ou backups.

O backup completo local foi restaurado em outra base descartável. As nove tabelas mantiveram as contagens e os resumos de conteúdo; consultas de vendas, produção e estoque também produziram os mesmos resultados.

| Backup do ensaio | Arquivo comprimido | Dump texto sem compressão |
| --- | ---: | ---: |
| Núcleo operacional | 5,26 MB | 28,85 MB |
| Modelo completo | 22,51 MB | 167,84 MB |

O tamanho comprimido **não equivale ao tráfego de um `pg_dump` remoto**, pois a compressão do arquivo pode ocorrer no cliente após receber os dados. Como referência, trinta dumps texto completos somam 5,04 GB; do núcleo operacional, 0,87 GB. Esses tamanhos são indicadores para planejar o backup, não medições de egress faturado. Antes da troca, precisamos definir frequência, recuperação e orçamento de tráfego da estratégia escolhida. [Documentação do pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html).

**Recomendação:** iniciar a migração pelo núcleo operacional, com agregações SQL, paginação, cache e intervalo de atualização ajustados. Há espaço também para os demais dados no protótipo, mas seus esquemas definitivos, índices de cada módulo, retenção e gravações ainda precisam de projeto e validação. A decisão pelo Free deve considerar o tráfego dos dois projetos e o backup, além do espaço ocupado.

Este ensaio não valida a migração de permissões, OAuth, gravações, integrações, mudanças concorrentes ou recuperação de produção. Não houve alteração de plano, publicação, push ou merge. O contêiner, seu volume e a base de referência privada do ensaio foram removidos após a conferência; ficaram os relatórios e as evidências agregadas. Os scripts de investigação em `/private/tmp/brsteel-pg-probe` são descartáveis e não integram o sistema.
