# Gravações do núcleo em PostgreSQL — etapa 4

**Resultado: concluída e revisada em 12/09/2026.** As 19 entradas de escrita do núcleo estão atrás de contratos de repositório, com adaptador Firestore extraído sem mudança de comportamento e adaptador PostgreSQL novo. **Nenhum seletor foi trocado**: os oito exportam a implementação Firestore. Nada foi publicado, nenhuma variável de ambiente ou `vercel.json` foi alterada, e nenhuma ferramenta MCP de escrita existe.

## Verificação

| Bateria | Resultado |
| --- | ---: |
| Vitest (access, oauth, mcp, operations, backup, deployment) sob emulador Firestore | **264 testes / 44 arquivos** |
| Integração PostgreSQL (`npm run test:postgres`, contêiner descartável) | **39 testes** |
| `npm run typecheck` | **25 diagnósticos**, todos preexistentes e fora dos arquivos alterados |
| `npm run build` | compilou |

A suíte partiu de 245 testes vitest e 19 de integração. O emulador Firestore exige Java: `PATH="/opt/homebrew/opt/openjdk@21/bin:$PATH"` antes do comando.

## O que foi portado

| Domínio | Operações | Contrato |
| --- | ---: | --- |
| Insumos e movimentações | 5 | `SuppliesWriteRepository` |
| Produção (colunas, lotes, itens, comentários, contador) | 12 | `ProductionWriteRepository` |
| Ingestão de vendas e estoque | 2 caminhos | `SalesIngestRepository` |

Fundação comum: papel `brsteel_ops_writer`, schema `brsteel_write` com auditoria e idempotência, `withOperationalWrite` (transação serializable, recusa cópia não pronta, recusa escopo de piloto, repete `40001`/`40P01` até três vezes) e execução sentinela `NATIVE_RUN_ID` para linhas nativas.

## Concorrência e idempotência

- Cinco movimentações simultâneas no mesmo insumo: saldo exato e cinco registros.
- Quatro criações disputando o mesmo SKU: exatamente uma vencedora.
- Quatro criações concorrentes de lote: números distintos e consecutivos, sem repetição.
- Contador anual reinicia por ano e parte acima do maior número legado existente.
- Chave de idempotência repetida devolve a resposta anterior sem segundo efeito; a mesma chave com outro pedido devolve conflito 409.

## Equivalência entre adaptadores

Três harnesses comparam o rastro das mesmas chamadas contra os dois adaptadores, normalizando apenas identificadores e instantes, e exigem um piso de passos bem-sucedidos para que um rastro inteiramente falho não compare igual. Cada um foi validado por mutação:

| Harness | Mutação que o quebra |
| --- | --- |
| Insumos (12 chamadas) | status HTTP de `DUPLICATE_SKU` de 409 para 400 |
| Produção (14 chamadas) | `padStart(4,'0')` para `padStart(3,'0')` na numeração |
| Ingestão (6 passos) | remover a guarda de `markOrderDeleted`; trocar merge por replace em `upsertOrders` |

## Revisão independente

Uma revisão de código sobre o diff completo apontou um problema crítico e seis importantes. Todos os de correção foram corrigidos antes do encerramento:

1. **`upsertOrders` substituía o payload em SQL enquanto o Firestore mescla.** Uma regravação esparsa — que acontece de verdade quando a busca de detalhes do pedido falha — apagaria `itens`, XML e campos de nota fiscal, e ainda excluiria as linhas da projeção de itens. Corrigido para mesclar com o armazenado. O harness de equivalência **não conseguia** ver isso: os dois upserts do rastro tinham o mesmo conjunto de chaves, onde mesclar e substituir coincidem. Foram acrescentados um passo de regravação esparsa e um de campo `undefined`, e comprovou-se que reverter a correção quebra o teste.
2. **`serialize()` havia sido perdido nos adaptadores SQL.** `canonicalJson` lança em `undefined` e `Date` enquanto `JSON.stringify` os descarta em silêncio — as duas metades da mesma instrução discordavam. Reaplicado nos três adaptadores.
3. **A guarda da execução sentinela faltava no pré-check de versão do importador.** Três coleções usam identificadores determinísticos compartilhados com o Firestore (contador anual, hash do SKU, colunas padrão); sem o filtro, uma gravação nativa mais nova abortaria a importação inteira, e na ordem inversa a linha nativa seria reivindicada pelo snapshot — fazendo o contador de lotes andar para trás e cunhar números duplicados.
4. **A dedução de entrega engolia o retry do Bling.** O curto-circuito valia para qualquer evento existente: uma falha no meio do processamento deixava o evento não terminal, e a reentrega do Bling dentro da janela era descartada com 200 — pior que antes da fila. Agora só desfecho terminal encurta.
5. **Duas das 19 entradas não estavam conectadas.** `applyStockObservation` e `markOrderDeleted` tinham adaptadores e testes, mas o webhook continuava gravando direto em `stockUpdates` e `salesOrders`. A afirmação anterior de "19 portadas" estava errada; agora está correta.
6. **Falha ao publicar a marca de cache derrubava gravação já persistida.** A invalidação passou a ser tolerante a falha nos pontos do webhook: a cópia local já foi limpa, e o pedido já estava salvo.
7. Teto de cinco tentativas no dreno, para um evento permanentemente falho não repetir sem fim.

Pontos menores levantados e **não** corrigidos, registrados para as etapas seguintes: `createLot` não escreve `updatedAt` na coluna em SQL (só a bloqueia); `findBySku` não passa pela guarda de cópia pronta; contadores de criados/atualizados divergem para pedido com exclusão lógica; `sku_order` de linhas nativas envelhece após uma importação; `reorderColumns`, `seedDefaultColumns`, `updateLot` e `deleteComment` não estão no rastro de equivalência.

## Limitações

- **Nenhuma gravação real foi feita em PostgreSQL hospedado.** Tudo rodou local, em contêiner descartável, com dados sintéticos.
- **A idempotência existe como biblioteca, não como propriedade das operações.** As duas fronteiras passam `idempotencyKey: null`; chaves reais chegam com as ferramentas MCP de escrita, em entrega posterior.
- **A janela de identidade permanece aberta.** `resolveWriteIdentity` roda antes da transação de persistência: um usuário desativado entre a validação e o commit conclui a gravação já autorizada. Fechá-la exigiria a identidade no mesmo banco do núcleo.
- **O processamento do webhook continua síncrono.** A entrega é persistida antes de qualquer trabalho, mas torná-lo assíncrono depende de agendar o dreno, o que pertence à etapa 5, onde o interruptor de manutenção pode suspendê-lo.
- Um teste de concorrência preexistente (`production.test.ts`, numeração concorrente) falhou uma vez em três execuções da suíte cheia por contenção no emulador; recebeu limite explícito de 30 s.
