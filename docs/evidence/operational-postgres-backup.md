# Backup e restauração operacional — 12/09/2026

**Ensaio aprovado e acesso temporário encerrado.** A cópia real do Supabase foi exportada, criptografada e restaurada em PostgreSQL local descartável. Conteúdo e permissões conferiram integralmente. A produção continua no Firestore.

[Evidência estruturada](operational-postgres-backup.json) · [Procedimento reproduzível](../../supabase/operational/backup-restore.md).

## O que foi recuperado

Os schemas `brsteel_ops` e `brsteel_import`, com **25.968 linhas em 13 tabelas**, incluindo 12.538 pedidos, 12.999 itens, estoque, insumos, produção e metadados da importação. As contagens incluem projeções e metadados; não representam 25.968 documentos originais do Firestore.

A conferência comparou SHA256 de cada linha completa e seu agregado por tabela, incluindo payload, projeções geradas, referências e metadados. Também conferiram colunas, constraints, 18 chaves estrangeiras, 25 índices, RLS nas 13 tabelas, políticas e grants. A leitura pelo papel de backup foi aceita e uma tentativa real de UPDATE foi recusada.

O manifesto obtido com acesso administrativo e o manifesto do papel de backup foram iguais. Isso evita considerar completo um dump silenciosamente filtrado por RLS. A captura e o dump compartilharam o mesmo snapshot PostgreSQL; a conferência administrativa posterior também confirmou que a origem permaneceu igual.

## Tempo e tráfego medidos

| Medida | Resultado |
|---|---:|
| Download, compressão e criptografia | 2,29 segundos |
| Arquivo custom comprimido | 4.435.068 bytes |
| Arquivo criptografado age | 4.436.340 bytes — 4,44 MB |
| TCP recebido do Supabase durante o dump | 34.997.169 bytes — 35,00 MB |
| TCP enviado durante o dump | 22.594 bytes |
| Conexões do dump medidas | 1 |
| Restauração SQL inicial | 1,04 segundo |
| Recuperação local inicial, incluindo criação do banco e verificações | 3,33 segundos |
| Repetição local com código final | 3,42 segundos |

**O tamanho do arquivo comprimido não representa o tráfego do backup.** A compressão ocorreu no cliente, depois de receber os dados. O contador inclui os bytes TCP transportados, inclusive enquadramento TLS, e exclui cabeçalhos de pacotes, consultas de preparação/verificação e outros serviços. Não é uma consulta ao medidor de cobrança Supabase.

Mantendo a base atual, **30 downloads equivaleriam a aproximadamente 1,05 GB** pelo caminho TCP medido. Reter sete arquivos diários e quatro semanais ocuparia cerca de **48,80 MB**, reutilizando o arquivo diário para a cópia semanal. São projeções lineares de uma amostra, sem crescimento da base, retries ou outros projetos; ainda precisam ser somadas ao uso real compartilhado antes de aprovar o Free.

## Falhas e isolamento

- Uma cópia adulterada do arquivo age foi recusada e deixou **zero schemas parciais**. A restauração usa uma transação única e interrompe no primeiro erro.
- Um SIGTERM após a criação do contêiner terminou com erro esperado, executou a limpeza e deixou **zero contêineres do ensaio**. A repetição válida posterior passou usando o mesmo arquivo, sem outro download.
- O destino foi criado no Docker local, fixado a socket Unix, com rede desativada, sem portas publicadas, uma CPU e 512 MiB de memória. O contêiner e o volume foram removidos ao final.
- Cliente `pg_dump` 17.11; banco de origem e imagem de restauração PostgreSQL 17.6. TLS verificou certificado e hostname pelo pooler de sessão.
- Nenhum dump em texto ou arquivo descriptografado foi persistido fora do contêiner descartável.

## Acesso e encerramento

A migration `20260912193921_operational_backup_role.sql` foi registrada no projeto como `20260912194556`. Ela criou o papel `brsteel_ops_backup`, sem login, sem BYPASSRLS ou privilégios administrativos, com SELECT explícito nas 13 tabelas. Não concedeu acesso a usuários já existentes.

O login temporário `brsteel_backup_probe` recebeu somente esse papel e foi encerrado após o download: **NOLOGIN, senha removida, zero associações a papéis e zero sessões**. Os antigos logins do piloto também continuam encerrados. A credencial temporária local foi excluída. `anon` e `authenticated` seguem sem acesso operacional.

A cópia permaneceu pronta, com hash `8a783d1454afcb13a045545de0dbdf7d2d4af000998c05bae5d09fe4f9faeae9`, captura em **12/09/2026 às 14:41:15 BRT** e importação concluída às **14:54:50 BRT**. O backup começou às **16:47:18 BRT**; não atualizou a cópia a partir do Firestore.

O arquivo criptografado e os manifestos foram mantidos em uma pasta privada deste computador: `/Users/acassiusalves/.local/share/brsteel-backups/2026-09-12-operational-rehearsal`. A identidade age está em pasta privada separada: `/Users/acassiusalves/.config/brsteel/backup-keys`. Ambos ficam fora do Git. **Ainda não há cópia externa durável nem custódia independente da chave.**

## Verificação e limites

Passaram 226 testes existentes, cinco testes novos de guardas e 19 testes de integração PostgreSQL. O typecheck manteve os 25 diagnósticos preexistentes, sem novos erros. O advisor de segurança não trouxe novos achados; permanece o aviso anterior de [proteção contra senhas vazadas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Este ensaio comprova recuperação local dos dois schemas e da cópia medida. Não comprova restauração no serviço gerenciado, recuperação de Auth/Storage/OAuth ou retomada da aplicação em produção. Os 3,42 segundos não são uma promessa de recuperação completa do sistema.

Antes de produção, faltam armazenamento externo, custódia da chave, agendamento/alertas e validação do processo completo contra as metas propostas de perda máxima de 24 horas e recuperação em até duas horas. Para o Free, a documentação recomenda exportações regulares e backups fora do projeto. [Supabase — backups](https://supabase.com/docs/guides/platform/backups).

A próxima validação do MCP é o teste direto no Claude, seguido de observação do consumo em uso controlado. A escrita pelo Claude e a troca da fonte oficial continuam em etapas próprias.
