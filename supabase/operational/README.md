# Banco operacional: preparação e piloto de leitura

Esta pasta contém a base SQL e as ferramentas de importação do núcleo operacional. A aplicação e o MCP continuam usando Firestore. O OAuth permanece na configuração Supabase existente; as migrations operacionais ficam fora da cadeia `supabase/migrations` para impedir aplicação incidental ao provedor de identidade.

O [piloto hospedado de 12/09/2026](../../docs/evidence/operational-postgres-hosted-pilot.md) copiou e conferiu 12.967 registros reais e mediu os leitores candidatos. Os acessos temporários foram revogados ao encerrar o ensaio. Não houve ativação dos leitores nos endpoints de produção.

## Verificação reproduzível

Requisitos: Node.js 22, dependências de `npm ci`, Docker, Firebase CLI e Java 21. O script inclui o caminho Homebrew do Java no macOS; em outros ambientes, disponibilize `java` no `PATH`.

```sh
npm run test:postgres
# Opcional: requer Supabase CLI 2.114.0; usa configuração temporária independente do OAuth.
BRSTEEL_PG_ADVISORS=1 npm run test:postgres
```

O ensaio cria PostgreSQL 17.6 descartável, aplica a migration, verifica o catálogo e executa os testes com Firestore Emulator e dados sintéticos. Publica PostgreSQL somente em `127.0.0.1:55436` e usa o emulador em `127.0.0.1:8188`. A senha é aleatória, o contêiner tem memória/CPU limitadas e o contêiner e seu volume são removidos no encerramento normal, inclusive após falha de teste. Não interrompa o processo com `SIGKILL`, que impede a limpeza em `finally`.

O ensaio não inicia os serviços OAuth do Supabase nem lê credenciais de produção. Os advisors usam `sslmode=disable` exclusivamente para o PostgreSQL local sem TLS; isso não é uma configuração para o banco hospedado.

## Exportação e importação manual local

Com um emulador de demonstração já iniciado e um PostgreSQL local já provisionado com a migration:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8188 node --import tsx scripts/operational-import.ts export-local /absolute/snapshot.json
# Defina BRSTEEL_PG_LOCAL_URL no ambiente, sem registrar a senha em arquivos versionados.
node --import tsx scripts/operational-import.ts import-local /absolute/snapshot.json
node --import tsx scripts/operational-import.ts verify-local /absolute/snapshot.json
```

A URL da CLI local deve apontar explicitamente para `127.0.0.1` ou `::1`, ter porta e usar o banco `brsteel_ops_local`, sem parâmetros extras. Essa CLI continua exclusiva do emulador/banco local. O arquivo exportado nasce com permissão `0600` e não substitui arquivo existente. A entrada de importação é limitada a 128 MiB; erros da CLI não imprimem documentos nem detalhes de conexão.

## Ensaio hospedado

`scripts/operational-hosted-pilot.ts` oferece `import`, `verify` e `measure` com origem fixa `marketflow-9h4tg` e destino fixo `mlumbvxpaqfzpdjnvzxc`. Usa snapshot novo produzido por `exportOperationalSnapshot` com a credencial da origem e validação dos tipos nativos. Não usar um JSON antigo como prova de compatibilidade.

```sh
# Configure um arquivo privado de ambiente fora do Git, com permissão 0600:
# BRSTEEL_PG_PILOT_IMPORTER_URL: login brsteel_pilot_importer, conexão direta ou pooler de sessão em 5432
# BRSTEEL_PG_PILOT_READER_URL: login brsteel_pilot_reader, pooler transacional em 6543
# BRSTEEL_PG_CA_FILE: certificado raiz obtido na configuração SSL do projeto
node --env-file=/absolute/private.env --conditions=react-server --import tsx scripts/operational-hosted-pilot.ts import /absolute/snapshot.json /absolute/import-report.json
node --env-file=/absolute/private.env --conditions=react-server --import tsx scripts/operational-hosted-pilot.ts verify /absolute/snapshot.json /absolute/verify-report.json
node --env-file=/absolute/private.env --conditions=react-server --import tsx scripts/operational-hosted-pilot.ts measure /absolute/snapshot.json /absolute/measure-report.json
```

Relatórios são criados de forma exclusiva (0600), contêm somente métricas/hashes e passam a `failed` em caso de erro. A medição exige a mesma cópia pronta no início/fim, usa cinco amostras sequenciais por consulta e um pool de uma conexão. Os contadores são bytes do protocolo PostgreSQL decodificado; não são egress faturado nem medição do caminho completo pela Vercel. Nenhum comando muda seletores de runtime.

As fábricas rejeitam `postgres`, outro projeto/banco, parâmetros que alterem TLS e pooler transacional no importador, que depende de lock de sessão. TLS verifica CA e hostname. Os papéis de piloto nascem sem login. Uma execução autorizada deve provisionar senha aleatória/expiração e associação somente a `brsteel_ops_reader` ou `brsteel_ops_importer`. Ao terminar, desativar logins, remover senhas, revogar as associações e encerrar as sessões desses dois logins. Esse encerramento foi executado no primeiro ensaio; reexecutar exige provisionar os acessos novamente.

O conector gera versões próprias no histórico hospedado, mapeadas na evidência do piloto. Não misturar essa cadeia com `supabase/migrations` nem aplicar `db push` incidentalmente ao projeto OAuth.

## Contrato e recuperação

O snapshot declara versão de formato, projeto de origem, instante de captura, todas as dez coleções permitidas e registros com coleção, ID original, versão e payload. Inclui vendas, observações de estoque, insumos, códigos de insumos, movimentos, colunas, lotes, itens, comentários e apenas os contadores anuais de lotes. Usuários e outras coleções ficam fora. Campos desconhecidos, nulos, zeros e a ordem de itens são preservados; referências inválidas interrompem a validação.

Timestamps Firestore são normalizados para texto ISO UTC com a precisão original, inclusive frações de nanossegundo. `updateTime` é guardado separadamente como inteiro decimal em nanossegundos. Outros tipos especiais não JSON são rejeitados. A conferência compara essa representação normalizada, não reconstrói instâncias JavaScript de `Timestamp`.

Exceção necessária para preservar as consultas atuais: a exportação rejeita `Timestamp`/`Date` nativos em campos lidos de vendas, insumos, movimentos e produção, e em `sku`, `nome` ou `webhookReceivedAt` do estoque. Os escritores atuais usam texto ISO nesses campos. Converter um legado nativo automaticamente poderia incluir um saldo antes ignorado, alterar filtros de movimentos ou mudar a precisão devolvida ao cliente. Corrija esses legados de forma explícita antes de exportar. Metadados de estoque não usados nas respostas ainda preservam timestamps precisos. Arquivos exportados por versões anteriores não comprovam essa condição: antes do piloto, faça uma nova exportação validada da origem, pois JSON antigo já perdeu a distinção entre texto e timestamp nativo.

O importador fixa a identidade de origem, impede execução concorrente e confirma dados e checkpoint na mesma transação de cada lote. Uma interrupção exige retomar o mesmo snapshot. Ao concluir, reconcilia ausências como exclusões da origem, relê todos os conteúdos e itens e só então libera a cópia para consulta. A exclusão da origem fica separada de qualquer flag de exclusão lógica no payload.

A migration `operational_read_models` adiciona projeção mínima de estoque e chave de consulta de limites de insumos. A normalização usa as regras JavaScript existentes para datas, saldos, SKU e ordenação; o SQL escolhe a última observação válida e aplica filtro/paginação. A conferência relê também as projeções. Para bancos locais criados antes dessa migration, a cópia é marcada como incompleta e o checkpoint ativo volta a zero: reaplique o mesmo arquivo de snapshot para reconstruí-la. O runtime candidato rejeita a cópia até essa reconstrução terminar.

Repetir um snapshot já concluído é um no-op; não reativa um snapshot histórico nem substitui a verificação independente. Execute `verify-local` para conferir o estado atual, inclusive após uma repetição. Uma cópia parcial fica indisponível para os adaptadores. Durante importações seguintes, uma leitura já iniciada pode terminar usando a versão consistente anterior.

## Acesso e limites

Os schemas privados `brsteel_ops` e `brsteel_import` têm 13 tabelas com RLS. Papéis sem login separam importação e leitura; `anon`, `authenticated` e `PUBLIC` não recebem acesso operacional. O papel de leitura não grava dados nem consulta o histórico interno de importações. Essas políticas protegem o acesso pelo backend: a autorização de cada usuário continua obrigatória nas operações do sistema. Elas não representam políticas individuais por usuário.

Os adaptadores candidatos implementam vendas, estoque, insumos, movimentações, produção e demanda. Estoque usa a última observação válida por SKU; produção retorna listas permitidas de campos, inclusive para identidades aninhadas; demanda agrega pedidos faturados e combina saldos e limites na mesma transação. Listagens SQL mantêm os cursores existentes, inclusive o avanço por documentos examinados quando a página de insumos omite registros sem nome. Ainda não estão selecionados no runtime: os repositórios ativos continuam exportando Firestore.

As operações mantêm as verificações de usuário, capacidade e página antes de chamar qualquer repositório. A aplicação web mantém o comportamento live/cache de estoque e demanda existente; o MCP continua consultando apenas dados salvos. As transações de negócio, unicidade de SKU, movimentação com saldo e contadores concorrentes deverão ser validados na etapa de gravações.

O export paginado não congela o Firestore. Uma carga real precisa validar registros legados e reconciliar alterações concorrentes antes de qualquer troca. O payload integral de pedidos e a projeção de itens ocupam espaço adicional: as medições do protótipo anterior não comprovam o tamanho deste schema. Medições reais de armazenamento, tráfego, latência e recuperação continuam sendo critérios para o piloto hospedado.
