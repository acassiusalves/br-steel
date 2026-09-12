# Piloto hospedado de leitura operacional

> **For agentic workers:** Use superpowers:executing-plans para executar as tarefas e verificar cada entrega.

**Goal:** Copiar e conferir uma exportação nova do Firestore no Supabase escolhido e medir os leitores candidatos com credencial restrita.

**Architecture:** O Firestore continua oficial. A carga usa conexão direta ou sessão persistente; as leituras usam papel separado, TLS verificado e pool pequeno. A CLI limita origem, destino e volume e publica somente métricas agregadas.

**Tech Stack:** Node 22, pg 8.23, Firestore Admin, PostgreSQL 17 no Supabase.

**Spec:** ../specs/2026-09-12-operational-postgres-design.md, etapa 3. Esta entrega cobre a cópia e a medição por cliente PostgreSQL; a ativação de endpoints para usuários restritos e a latência Vercel ficam para a continuação da etapa.

## Restrições globais

- Destino exclusivo `mlumbvxpaqfzpdjnvzxc`; origem exclusiva `marketflow-9h4tg`.
- Nenhuma troca dos seletores ativos, gravação de negócio, alteração de OAuth ou upgrade de plano.
- Sem acesso operacional para `anon`, `authenticated` e `PUBLIC`; login de leitura sem associação ao importador.
- Cópia não transacional: registrar início/fim, não apresentar como saldo oficial atualizado.
- Teto de planejamento de 400 MB por banco e 4 GB de tráfego compartilhado por ciclo; métricas locais de bytes não equivalem à cobrança do provedor.
- Um export, uma importação, uma conferência independente e amostras limitadas de leitura; arquivos reais e credenciais somente fora do Git, com modo 0600.

## 1. Exportação nova e conexões restritas

Arquivos: `src/server/migration/operational-hosted.ts`, `operational-import.ts`, `tests/operations/operational-hosted.test.ts`.

- [x] Executar `exportOperationalSnapshot(db, 'marketflow-9h4tg')` com credencial da origem e salvar de forma exclusiva em diretório privado.
- [x] Testar rejeição de outro projeto, login administrativo, TLS desativado, parâmetros extras e pool transacional no importador; o caminho local deve continuar rejeitando bancos remotos.
- [x] Criar fábricas de pool com TLS obrigatório e guardas de banco/papel/origem antes da primeira mutação, sem alterar o padrão local de `importSnapshot`/`verifySnapshot`.
- [x] Rodar testes focados e ensaio PostgreSQL local.

## 2. Ferramenta reproduzível de carga e medição

Arquivos: `scripts/operational-hosted-pilot.ts`, `src/server/migration/operational-hosted.ts`, testes da tarefa 1.

- [x] CLI `import|verify|measure /absolute/file.json`, com credenciais em variáveis privadas e limite de snapshot de 128 MiB.
- [x] Medir consultas de vendas, estoque, produção, demanda e insumos; registrar duração, bytes do protocolo recebidos e tamanho JSON da resposta, sem payloads.
- [x] Usar `performance.now()` e diferenças de `socket.bytesRead` em um único cliente serializado; identificar que inclui protocolo, não comprova egress faturado nem latência Vercel.
- [x] Testar limites/configuração e rodar integração existente antes da carga real.

## 3. Schema, cópia e conferência hospedados

Arquivos: migrations operacionais existentes, evidência agregada `docs/evidence/operational-postgres-hosted-pilot.json`.

- [x] Conferir catálogo e uso antes; aplicar as duas migrations operacionais revisadas no destino.
- [x] Provisionar logins de piloto com senha aleatória, expiração e associação somente ao papel correspondente. Encerrados e revogados após a medição; não foi necessário ampliar o acesso do administrador.
- [x] Importar snapshot novo, conferir conteúdo/projeções por leitura independente e testar negações de leitura/escrita/roles públicos.
- [x] Executar amostras com login de leitura e advisors; medir tamanho de banco/tabelas e comparar com o teto de planejamento.

## 4. Evidência e continuação

Arquivos: `docs/evidence/operational-postgres-hosted-pilot.md`, `supabase/operational/README.md`.

- [x] Registrar hashes, contagens, duração, volume, resultados e limitações. Não versionar dados nem credenciais.
- [x] Documentar continuação: endpoints piloto com usuários restritos, permissões efetivas, metadados de atualização, medida Vercel e tráfego da organização/backup antes de concluir viabilidade do Free.
- [x] Verificar diff e typecheck contra os 25 diagnósticos anteriores; commit local da entrega.

Resultado: [evidência do ensaio](../../evidence/operational-postgres-hosted-pilot.md). A validação completa da etapa 3 segue pendente para endpoints Vercel, permissões individuais e orçamento de backup.
