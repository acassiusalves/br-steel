# Ensaio do corte de fonte — etapa 5

**Resultado: sequência executada de ponta a ponta contra o destino hospedado em 16/09/2026, com divergência zero.** O núcleo de produção ficou bloqueado por **10 min 15 s**. Nenhum seletor de fonte foi trocado: `appConfig/operationalSource` continua inexistente em produção e em homologação.

A primeira tentativa, 28 minutos antes, falhou por defeito da ferramenta e é parte desta evidência.

## Linha do tempo

Horários UTC. Origem `marketflow-9h4tg`, destino `mlumbvxpaqfzpdjnvzxc`.

| Instante | Evento |
| --- | --- |
| 01:47:20 | **Primeira tentativa.** Bloqueio aplicado às 01:47:41 |
| 01:48:27 | `ERRO: Local import target required` — o `reconcile` não alcançava o hospedado |
| 01:48:28 | Restauração automática. Produção bloqueada por **46 s** |
| 02:04 | Correção mergeada (PR #23): `createCutoverPool` escolhe a fábrica por tipo de destino |
| 02:15:22 | **Segunda tentativa.** Preflight aprovado sem escrever em produção |
| 02:15:43 | `blocked` — escritas do núcleo recusadas |
| 02:15:54 | Snapshot capturado pelo próprio `reconcile`: 13.063 registros |
| 02:25:19 | `reconcile` concluído: 13.063 registros, 13.095 itens, hash `912964a27020`, **566 s** |
| 02:25:58 | `compare`: **divergência zero** |
| 02:25:58 | Restauração automática |

## Conferência do `compare`

| Coleção | Origem | Cópia | Nativas |
| --- | ---: | ---: | ---: |
| `salesOrders` | 12.632 | 12.632 | 0 |
| `stockUpdates` | 363 | 363 | 0 |
| `supplies` | 54 | 54 | 0 |
| `productionColumns` | 3 | 3 | 0 |
| `productionLots` | 3 | 3 | 0 |
| `productionLotItems` | 7 | 7 | 0 |
| `inventoryMovements` | 1 | 1 | 0 |
| `operationsMetadata`, `supplyCodes`, `productionComments` | 0 | 0 | 0 |

O comparador relê payloads e acusa diferença de conteúdo, não só de contagem. Zero divergências significa que a cópia reproduz a origem no instante do bloqueio.

## Estado depois, conferido de forma independente

- `appConfig/coreWriteMode` — **ausente**
- `appConfig/operationalSource` — **ausente**
- Fila `blingWebhookEvents` pendente — **0 eventos**

A fila zerada confirma o desenho: o webhook persiste a entrega sem consultar o modo, e o dreno consulta e suspende ([webhook-queue.ts:55](../../src/server/ingest/webhook-queue.ts)). Durante a janela os pedidos continuam chegando e são aplicados depois; nenhum se perde.

## O defeito que a primeira tentativa revelou

`scripts/operational-cutover.ts` montava um `pg.Pool` cru. `checkImportTarget` só reconhece pools criados pelas fábricas: um pool não registrado cai no ramo local e exige o banco `brsteel_ops_local`. O `reconcile` contra o hospedado era impossível, independente de credencial ou configuração.

O que tornou isso caro é que **o `compare` não passa por `importSnapshot`**. Um ensaio seco executado às 00:50 e outro às 02:10 passaram limpos e não denunciaram nada. A falha só aparece depois do núcleo bloqueado — dentro da janela de manutenção, que é onde menos se quer descobrir que a ferramenta não faz o trabalho.

Custo real da descoberta: 46 segundos de produção bloqueada, num ensaio. Sem o ensaio, a descoberta teria sido no corte.

## Deriva medida entre capturas

O `compare` foi executado duas vezes sem bloqueio, contra a cópia capturada às 23:46 de 15/09:

| Momento | Pedidos faltando | Estoque divergente | Total |
| --- | ---: | ---: | ---: |
| 00:50 | 3 | 2 | 5 |
| 02:10 | 5 | 3 | 8 |

Cerca de **3 divergências por hora** de operação real. Todas `missing-in-copy` ou `content`; nenhuma `missing-in-source`, nenhuma linha nativa. O delta a aplicar numa janela real é pequeno — o custo do `reconcile` é reprocessar os 13 mil registros, não o tamanho do delta.

## Provisionamento que sustentou o ensaio

- As sete migrations operacionais aplicadas e conferidas por objeto
- `brsteel_ops_runtime` e `brsteel_pilot_importer` provisionados com prazo até 17/09 23:00 UTC
- Carga inicial de 13.058 registros em 15/09 23:46 UTC, `verify` aprovado relendo 33,7 MB
- `BRSTEEL_OPERATIONAL_DATABASE_URL` e `BRSTEEL_OPERATIONAL_CA` gravadas em `br-steel-mcp-staging` e **ausentes de produção**, conferido
- Redeploy da homologação aprovado pelo `verify:mcp-staging`, que recusa deploy apontando o Firebase de produção

A associação `brsteel_pilot_importer → brsteel_ops_importer` exigiu `with inherit true` explícito; sem isso o login conecta e não enxerga privilégio nenhum. Registrado no README.

## Limitações

- **A troca da fonte não aconteceu.** Exige escrever `appConfig/operationalSource` no Firestore da homologação, projeto separado cuja credencial não estava disponível na execução. O ensaio valida a mecânica do corte, não o comportamento da aplicação servindo do PostgreSQL.
- **A reversibilidade continua não demonstrada.** O retorno nos dois sentidos — antes e depois de gravações oficiais — é o passo que prova que o corte é reversível, e ele depende da troca da fonte.
- **`brsteel_write.audit` e `brsteel_write.idempotency` seguem vazias.** Nenhuma gravação de negócio real jamais ocorreu no PostgreSQL hospedado; o `reconcile` grava pelo caminho de importação, não pelas operações do núcleo.
- **Não há teste cobrindo a seleção de pool do corte.** A suíte que exercitaria isso precisa de Docker e do emulador Firestore; a CI roda a integração PostgreSQL e passou, mas ela cobre o caminho local.
- **A janela de 10 min 15 s é desta carga.** Os 566 s do `reconcile` reprocessam todos os registros; o tempo cresce com o volume, não com o delta.
