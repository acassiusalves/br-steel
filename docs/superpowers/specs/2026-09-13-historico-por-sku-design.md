# Histórico por SKU na Análise para Produção

Data: 2026-09-13
Status: desenho aprovado, pendente de plano de implementação
Origem: auditoria da tela `/producao`. Resolve os achados C1, C4 e C6. Não resolve M1, M2 e M3 — mas
aplica o princípio deles, entregando o histórico já alcançável pelo MCP em vez de preso ao cliente.

## Objetivo

Dar a cada SKU da Análise para Produção uma série temporal visível: um mini-gráfico de tendência na
própria linha da tabela e uma visão de detalhe ao clicar. O uso principal é enxergar aceleração ou
desaceleração de demanda sem sair da tela.

## Premissas

O modelo de reposição por mínimo/máximo guiado por consumo histórico é decisão de produto e não está
em discussão aqui. Venda faturada é o sinal de baixa do estoque. Este desenho melhora a qualidade e a
visibilidade da série que alimenta esse modelo; não o substitui.

## Decisões tomadas

| Decisão | Escolha | Quem |
| --- | --- | --- |
| O que o gráfico plota | Demanda semanal agora; saldo de estoque como segunda série depois | usuário |
| Fuso dos buckets | `America/Sao_Paulo`, semana ISO de segunda a domingo | usuário — "é o fuso da fábrica" |
| Produção da série | Rollup semanal pré-computado (opção B) | recomendação aceita |
| Onde o cron roda | Vercel Cron na própria aplicação Next.js | — |

## O problema que justifica a captura imediata

O histórico de **demanda** já existe e é reconstruível: os 12.521 documentos de `salesOrders` guardam
itens, quantidades e datas desde o início. Nada precisa ser capturado para tê-lo.

O histórico de **estoque** não existe e está sendo destruído a cada webhook:

```ts
// src/server/persistence/firestore-sales-ingest.ts:40
adminDb.collection('stockUpdates').doc(sku).set(observation, { merge: true });
```

Um documento por SKU, sobrescrito. O caminho Postgres repete o mesmo comportamento
(`on conflict (source_id) do update`, com `source_id = sku`). As "361 observações de estoque" são 361
SKUs com um valor cada, não 361 leituras ao longo do tempo. Cada dia sem a mudança é um dia de saldo
perdido de forma irrecuperável — por isso a captura vai primeiro na ordem de entrega, antes do trabalho
de demanda, que pode esperar sem custo.

## Modelo de dados

### `skuWeeklyDemand/{sku}`

Um documento por SKU, semanas como mapa.

```
{
  sku: "CBA600400350",
  description: "CUBA INDUSTRIAL INOX Dimensões:600x400x350",
  weeks: {
    "2026-W36": { units: 14, orders: 12 },
    "2026-W37": { units:  9, orders:  9 }
  },
  lastClosedWeek: "2026-W37",
  updatedAt: "2026-09-14T06:15:00.000Z"
}
```

Mapa e não array por idempotência: `set({ weeks: { [w]: v } }, { merge: true })` faz merge aninhado, e
reprocessar a mesma semana é no-op — crons repetem. Janela de 104 semanas; as mais antigas removidas
com `FieldValue.delete()` no próprio rollup.

Um documento por SKU custa **79 leituras** para a tabela inteira, contra ~4.100 se a chave fosse
`{sku}_{semana}`. O limite de 1 MiB por documento não é uma restrição: 104 semanas ocupam alguns
kilobytes.

A chave de semana é ISO (`YYYY-Www`, segunda a domingo) derivada do **dia civil de São Paulo**, obtido
com o padrão que já existe em `src/server/persistence/supplies-read-projection.ts:4`:

```ts
new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' })
```

Sem dependência nova. `date-fns-tz` não é necessário.

### `stockObservations/{autoId}`

Log append-only, coleção plana.

```
{ sku, estoqueAtual, observedAt, event, source, expiresAt }
```

Plana e não subcoleção porque o TTL do Firestore atua sobre um campo de timestamp da coleção, e já
existem duas políticas de TTL em `firestore.indexes.json`. Índice composto em `(sku, observedAt)`.
Retenção de 24 meses via `expiresAt`, casando com a janela de 104 semanas do rollup.

## Caminhos de escrita

### Captura de estoque — `applyStockObservation`

Passa a escrever nos dois lugares dentro de uma transação que lê o `stockUpdates/{sku}` atual:

- `stockUpdates/{sku}` — inalterado. Continua sendo a projeção "último valor". Nada a jusante muda:
  `readStoredStockSnapshot`, `readStockSnapshot`, a projeção Postgres e as ferramentas MCP seguem
  funcionando sem alteração.
- `stockObservations` — recebe uma linha **apenas se o saldo mudou**.

A transação com leitura prévia é o mesmo padrão de `recordMovement` em `firestore-supplies-write.ts:56`.
O filtro de "só se mudou" custa uma leitura por webhook e corta volume expressivo do log.

Os dois caminhos que recebem observação — o webhook direto (`/api/webhook/bling`) e o dreno de falhas
(`/api/cron/bling-webhook-drain`) — passam por essa mesma função, então a troca cobre ambos sem
agendamento novo.

### Rollup semanal — `GET /api/cron/sku-weekly-rollup`

Vercel Cron na própria aplicação Next.js, agendado `15 3 * * 1`. Protegido por `CRON_SECRET` e
`Authorization: Bearer`, no padrão estabelecido pelo `bling-webhook-drain`, cujo comentário registra a
regra: cron que aplica gravação de negócio fecha fechado. Sem o segredo configurado, responde 503.

O cron processa **todas as semanas desde `lastClosedWeek`**, não apenas a anterior. Uma execução
perdida se auto-corrige na seguinte, sem intervenção.

O checkpoint avança **a cada semana fechada**, não uma vez no fim do laço: uma execução encerrada no
meio conserva o que já fechou, e a seguinte continua de onde parou. Sem isso uma lacuna grande demais
para caber num passe nunca fecharia — cada execução recomeçaria do zero e morreria no mesmo ponto. A
execução também tem orçamento de tempo próprio, abaixo do `maxDuration` declarado na rota: ao esgotá-lo
ela para limpa e reporta `remaining`, em vez de seguir até ser morta pela plataforma. Uma semana sempre
fecha, para que toda execução avance.

O cold start continua não sendo trabalho do cron: sem checkpoint a lista é a janela inteira de 104
semanas, e reconstruí-la é o papel do script de backfill (abaixo). O orçamento existe para que, se
alguém disparar o cron nessa situação, ele convirja em execuções sucessivas em vez de repetir um passe
impossível.

O rollup **nunca grava a semana corrente**. `skuWeeklyDemand` contém apenas semanas fechadas; a semana
em curso é sempre derivada ao vivo, pelo caminho de leitura abaixo. Isso mantém o documento imutável
depois de escrito e elimina a necessidade de reescrever o mesmo bucket sete dias seguidos.

Volume: fechar uma semana lê de 1.000 a 1.500 pedidos, uma vez por semana. Folgado dentro do teto de
300s da função.

Vercel Cron dispara somente contra o deployment de produção — testar significa chamar a URL à mão com o
Bearer, como já acontece com os quatro crons existentes. O limite de crons não é obstáculo: o
`* * * * *` já em uso confirma plano Pro, que permite 40.

### Backfill — `scripts/backfill-sku-weekly-demand.ts`

Script local pontual, no molde de `scripts/refresh-claude-ml-token.ts`. Percorre semana a semana com
checkpoint em `appConfig/skuWeeklyDemandBackfill.lastProcessedWeek`, retomável.

Deliberadamente **não** é um cron: reconstruir 12.521 pedidos num passe único é risco real contra o teto
de 300s, e o job não precisa viver no deploy.

### Filtro de elegibilidade compartilhado

O rollup e a agregação ao vivo precisam usar **o mesmo predicado** para decidir que pedido conta. Hoje o
filtro é apenas `if (!order.notaFiscal?.id) continue` — sem checar `situacao` nem `notaFiscal.situacao`,
o que faz pedidos cancelados com NF emitida entrarem como consumo real (achado C1).

Extrair um predicado único, aplicado nos dois lugares, com a checagem de cancelamento incluída. Sem
isso o sparkline e a coluna "Qtd. Total Vendida" mostrariam números diferentes para o mesmo SKU.

## Caminho de leitura

**Semanas fechadas** vêm de `skuWeeklyDemand`, com cache em processo e invalidação pelo marcador
compartilhado no Firestore — o mesmo mecanismo que `src/server/operations/stock.ts` já usa e documenta
para o cache do Bling. O rollup muda uma vez por semana, então o cache é quase sempre quente.

**Semana corrente** é derivada do loop de agregação que já roda em `readFirestoreProductionDemand`. O
último ponto do gráfico está sempre fresco sem tocar no rollup.

O histórico tem horizonte próprio (12 semanas) e não acompanha o filtro de data da tela — é justamente o
que motiva o rollup. Consequência a tratar: se o período selecionado **não cobre a semana corrente** (o
usuário escolheu "mês passado", por exemplo), o loop ao vivo não produz o ponto aberto. Nesse caso o
gráfico termina na última semana fechada, sem o segmento tracejado. Não se inventa o ponto e não se
recorre a uma segunda consulta de pedidos só para preenchê-lo.

O contrato `ProductionDemand` ganha:

```ts
history: { week: string; units: number; orders: number; open?: true }[]
```

`open: true` marca a semana corrente, que é parcial por definição.

## Interface

### Sparkline na linha

Coluna nova **"Tendência"**, logo após "Média Semanal", integrada ao `columnVisibility` que já existe —
visível por padrão, desligável pelo menu "Exibir Colunas".

SVG inline (`polyline`), cerca de 72×24 px, sem biblioteca. `recharts` está no projeto mas montar 79
instâncias numa tabela é caro; recharts fica reservado para a visão de detalhe.

Doze semanas por padrão. Três regras de leitura:

- **A semana corrente é tracejada.** Ela é sempre parcial, então uma linha sólida faria todo SKU
  parecer despencar no último ponto. O segmento final tracejado impede essa leitura falsa.
- **Último ponto marcado** com um círculo, para ancorar o olho no presente.
- **SKU sem rollup mostra "—", nunca uma linha reta no zero.** Reta no zero se lê como "não vendeu",
  que é diferente de "ainda não temos série".

Acessibilidade: `role="img"` e `aria-label` com a tendência em palavras, por exemplo
"12 semanas, de 4 a 19 unidades, última semana 9".

### Visão de detalhe

Clique na linha abre um painel com 52 semanas em `recharts`: barras de unidades por semana e, quando a
série de estoque tiver massa suficiente, uma linha de saldo sobreposta com as faixas de mínimo e máximo
como referência. É o lugar onde a segunda série entra sem retrabalho na tabela.

## MCP

Ferramenta nova `consultar_historico_sku` — `{ sku, semanas?, cursor? }`, capability `producao:read`,
page `/producao`.

O campo `history` (12 semanas) viaja junto em `consultar_demanda_producao`, para que o caso comum não
exija segunda chamada.

Isso atende o requisito levantado na auditoria: o MCP precisa alcançar tudo que a tela mostra. O
histórico nasce alcançável, em vez de nascer preso ao cliente como aconteceu com a Fila de Produção
(achado M3).

## Erros e degradação

| Falha | Comportamento |
| --- | --- |
| Rollup falha numa execução | A próxima fecha todas as semanas pendentes desde `lastClosedWeek`. Sem intervenção. |
| Rollup encerrado no meio (teto de tempo, deploy) | O checkpoint avança por semana fechada, então o que já fechou fica. A execução seguinte continua da semana seguinte, não do começo. |
| Mais semanas pendentes do que cabe numa execução | Para no orçamento de tempo e devolve `remaining > 0`. Cada execução fecha pelo menos uma semana, então a lacuna converge. Reconstrução completa continua sendo trabalho do script de backfill. |
| SKU que não serve de id de documento (`CHAPA/10`, código não textual) | O id do documento é uma versão saneada e o SKU verdadeiro fica no campo `sku`, como em `stockUpdates`. O que nem assim vira id é ignorado com aviso em log — um item não pode derrubar a semana inteira. |
| Item sem `descricao` | Grava sem o campo; a descrição já armazenada é preservada pelo `merge`. O tipo diz que `descricao` é obrigatório, a fonte diz que não. |
| Rollup roda duas vezes na mesma semana | No-op — a escrita por mapa é idempotente. |
| `skuWeeklyDemand` vazio ou ausente | `history: []`. A tabela renderiza exatamente como hoje. A feature degrada para invisível, nunca para erro. |
| Append em `stockObservations` falha | Uma retentativa; depois, `set` legado só no `stockUpdates` e registro da perda. **O webhook nunca retorna 500 por causa do log** — mesmo princípio já aplicado em `invalidateProductStockCache().catch(() => undefined)`. |
| Backfill interrompido | Retoma do checkpoint. |
| SKU novo, sem histórico | "—" na coluna, conforme a regra acima. |

## Testes

Suíte `vitest` contra o emulador do Firestore, no harness `test:vitest` que já existe.

`tests/operations/sku-weekly-demand.test.ts`:

- **Fronteira de fuso** — o teste de maior valor. Um pedido em `2026-09-13T02:00:00Z` é
  `2026-09-12 23:00` em São Paulo e deve cair na semana de 12/09, não na de 13/09.
- **Idempotência** — rodar o rollup duas vezes para a mesma semana produz documentos idênticos.
- **Auto-correção** — uma lacuna de três semanas é fechada numa execução.
- **Poda** — semanas além de 104 são removidas.
- **Cancelados fora** — pedido cancelado com NF emitida não entra na série, e o predicado
  compartilhado dá o mesmo resultado na agregação ao vivo.

`tests/operations/stock-observations.test.ts`:

- Append só quando o saldo muda; saldo repetido não cria linha.
- `expiresAt` preenchido.
- `stockUpdates/{sku}` continua com o último valor e o formato inalterado.
- Falha no append não derruba a atualização do saldo.

`tests/mcp/`: forma da resposta de `consultar_historico_sku`, bloqueio sem `producao:read`, paginação.

## Ordem de entrega

1. **Captura de estoque append-only.** Primeiro porque é o único relógio irreversível — cada dia sem
   ela perde histórico para sempre. Não depende de nada.
2. **Predicado de elegibilidade compartilhado** (corrige C1 nos dois caminhos).
3. **`skuWeeklyDemand` + cron de rollup + script de backfill.**
4. **Caminho de leitura**: `history` no contrato, cache, semana corrente ao vivo.
5. **Interface**: sparkline na coluna e painel de detalhe.
6. **MCP**: `consultar_historico_sku` e o `history` embutido na demanda.

## Fora de escopo

- Modelo de previsão com tendência e sazonalidade. A série viabiliza; este desenho não constrói.
- Série de estoque no sparkline — só depois de massa de captura suficiente.
- Ligação entre lote do Kanban e SKU.
- Substituir as colunas "Corte" e "Dobra" (achado C5).

## Dívida assumida

`brsteel_ops.stock_observations` no Postgres tem `source_id` único por SKU e não comporta log. Como a
fonte operacional ainda é Firestore e o Postgres é piloto, a implementação vai em Firestore agora, e a
tabela `stock_observation_log` entra na mesma cadeia de migração para que um cutover futuro não perca o
recurso.

A cadeia de migração é aplicada à mão (ver `docs/superpowers/plans/`), então esse passo precisa entrar
explicitamente no runbook — não acontece sozinho.
