# Banco operacional: preparação local

Esta pasta contém a base SQL e as ferramentas de importação do núcleo operacional. A aplicação e o MCP continuam usando Firestore. O OAuth permanece na configuração Supabase existente; esta migration fica fora da cadeia `supabase/migrations` para impedir aplicação incidental ao provedor de identidade.

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

A URL de importação deve apontar explicitamente para `127.0.0.1` ou `::1`, ter porta e usar o banco `brsteel_ops_local`, sem parâmetros extras. A CLI não oferece exportação de produção nem importação hospedada. O arquivo exportado nasce com permissão `0600` e não substitui arquivo existente. A entrada de importação é limitada a 128 MiB; erros da CLI não imprimem documentos nem detalhes de conexão.

## Contrato e recuperação

O snapshot declara versão de formato, projeto de origem, instante de captura, todas as dez coleções permitidas e registros com coleção, ID original, versão e payload. Inclui vendas, observações de estoque, insumos, códigos de insumos, movimentos, colunas, lotes, itens, comentários e apenas os contadores anuais de lotes. Usuários e outras coleções ficam fora. Campos desconhecidos, nulos, zeros e a ordem de itens são preservados; referências inválidas interrompem a validação.

Timestamps Firestore são normalizados para texto ISO UTC com a precisão original, inclusive frações de nanossegundo. `updateTime` é guardado separadamente como inteiro decimal em nanossegundos. Outros tipos especiais não JSON são rejeitados. A conferência compara essa representação normalizada, não reconstrói instâncias JavaScript de `Timestamp`.

O importador fixa a identidade de origem, impede execução concorrente e confirma dados e checkpoint na mesma transação de cada lote. Uma interrupção exige retomar o mesmo snapshot. Ao concluir, reconcilia ausências como exclusões da origem, relê todos os conteúdos e itens e só então libera a cópia para consulta. A exclusão da origem fica separada de qualquer flag de exclusão lógica no payload.

Repetir um snapshot já concluído é um no-op; não reativa um snapshot histórico nem substitui a verificação independente. Execute `verify-local` para conferir o estado atual, inclusive após uma repetição. Uma cópia parcial fica indisponível para os adaptadores. Durante importações seguintes, uma leitura já iniciada pode terminar usando a versão consistente anterior.

## Acesso e limites

Os schemas privados `brsteel_ops` e `brsteel_import` têm 13 tabelas com RLS. Papéis sem login separam importação e leitura; `anon`, `authenticated` e `PUBLIC` não recebem acesso operacional. O papel de leitura não grava dados nem consulta o histórico interno de importações. Essas políticas protegem o acesso pelo backend: a autorização de cada usuário continua obrigatória nas operações do sistema. Elas não representam políticas individuais por usuário.

O adaptador candidato `createPostgresSalesRepository` implementa listagem, detalhe, leitura por período e resumo SQL. Ainda não está conectado ao runtime. Estoque e produção têm schema, preservação e vínculos; seus adaptadores de leitura, a agregação de demanda e as transações de negócio ainda precisam ser implementados. Unicidade de SKU, movimentação com saldo e contadores concorrentes deverão ser validados na etapa de gravações.

O export paginado não congela o Firestore. Uma carga real precisa validar registros legados e reconciliar alterações concorrentes antes de qualquer troca. O payload integral de pedidos e a projeção de itens ocupam espaço adicional: as medições do protótipo anterior não comprovam o tamanho deste schema. Medições reais de armazenamento, tráfego, latência e recuperação continuam sendo critérios para o piloto hospedado.
