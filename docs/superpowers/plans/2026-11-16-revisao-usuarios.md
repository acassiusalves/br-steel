# Revisão da lógica de usuários antes dos cadastros reais

Revisão de 16/11/2026, feita sobre o commit `a3b118f` (`main`). Registro histórico: o comportamento atual é o do código.

## Andamento

- **16/11/2026, Fase 1 implementada** na branch `claude/revisao-usuarios-beebf5`, seguindo as recomendações de P-1, P-2 e P-5. PIN inicial individual de 6 dígitos, válido por 72 h e mostrado uma vez ao administrador; conta antiga sem senha gravada não entra mais pelo crachá. Papel `Produção` (quadro de OPs, perfil e próprios reportes) para as contas de crachá. "Criar acesso" adota a conta existente do mesmo crachá com reset, recusa conta de administrador e recusa quando outro funcionário já está vinculado ao login. Crachá validado e gravado normalizado (migration `20261118120000_pcp_worker_badge_normalized.sql`, a aplicar com destino explícito). Troca de crachá bloqueada com login vinculado. Bipagem com a mesma normalização, recusando código repetido. Limite de login por endereço (coleção `loginRateLimits`, com TTL a publicar em `firestore.indexes.json`). Também entraram partes pequenas de U-08 (lista de contas só para administrador), U-10 (opção visível para login removido), U-17 (importação do iApp não troca crachá de quem tem login) e U-18 (líder cai no quadro).
- P-4 (zeros à esquerda) segue aberta: a normalização mantém os zeros até o teste do leitor na Fase 0.

## Objetivo e método

O administrador vai começar os cadastros reais do PCP: funcionários, acessos pelo crachá, líderes e o operador do piloto. Hoje nenhum dos 23 funcionários ativos de `brsteel_pcp.workers` tem `user_id`, e os 5 líderes das 6 equipes abertas também estão sem acesso. Esta revisão segue o caminho real do código de login, sessão, contas, permissões e vínculo com o Kanban, e lista o que precisa ser corrigido antes e depois desses cadastros.

O trabalho foi só de leitura de código e testes (`tests/access`, `tests/operations/pcp-badge-access.test.ts`, `tests/postgres/pcp-engineering.integration.ts`). Nenhum fluxo foi executado no emulador e nada foi lido ou gravado em Firebase, Supabase ou Vercel hospedados. Os achados marcados como "a confirmar" dependem de comportamento de runtime que não foi exercitado.

## Resumo

**Resolver antes de o administrador criar acessos** (detalhes nos achados):

1. **U-01**: a senha inicial é 123456 para todos, sem prazo, e o crachá funciona como nome de usuário. Qualquer pessoa na internet que conheça ou percorra os números de crachá entra na conta antes do dono e cadastra a própria senha.
2. **U-02**: "Criar acesso pelo crachá" reaproveita em silêncio qualquer conta `cracha-<código>` que já exista, com a senha pessoal, o papel e o estado dela.
3. **U-03**: trocar o crachá de um funcionário depois de criar o acesso deixa o login no código antigo. Se o código antigo for dado a outra pessoa, ela herda a conta antiga.
4. **U-04**: o código do crachá não é validado nem normalizado ao salvar o funcionário. Um código com espaço ou caractere fora de `[A-Z0-9-]` não gera acesso nem é encontrado pela bipagem. Dois códigos que só diferem em maiúsculas iniciam a OS no nome da pessoa errada.
5. **U-05**: a conta de crachá nasce com o papel Operador, que abre atendimento ao cliente (chat do Mercado Livre), insumos, estoque, produtos e anúncios. Para o chão de fábrica, isso precisa de uma decisão do dono antes de abrir as contas.
6. **Checagens sem código** (Fase 0 do plano): contas de e-mail sem senha gravada (entram com 123456 pelo e-mail, sem bloqueio), contas `cracha-*` já existentes, códigos de crachá inválidos ou repetidos nos 23 registros e `APP_ORIGIN` igual ao endereço dos terminais.

**Pode esperar a primeira semana**, desde que só os líderes e o operador do piloto recebam acesso: U-06 a U-16. **Pode esperar mais**: U-17 em diante.

**Os 5 achados mais graves:** U-01, U-02, U-03, U-05 e U-06.

Se o dono quiser começar antes das correções de código, o mínimo aceitável é: criar acesso só para os líderes e o operador do piloto, um por vez, com a pessoa ao lado fazendo o primeiro acesso na hora; não criar acesso para os demais funcionários (a bipagem no Kanban não exige conta); e fazer a Fase 0 antes do primeiro clique.

## Mapa do fluxo atual

### Identidade

- A identidade fica em Firestore, coleção `users`, lida e gravada só pelo Admin SDK. As regras negam o acesso pelo cliente (`firestore.rules:24-26` e o catch-all em `firestore.rules:140-142`). O app **não** usa Firebase Auth para login. `src/lib/authenticated-fetch.ts` é legado e não participa desse fluxo.
- Documento: `name`, `email`/`normalizedEmail` (contas de e-mail), `badge` (contas de crachá), `role`, `active`, `mustChangePassword`, `passwordHash`/`passwordSalt` (scrypt), `authVersion`, `failedLogins`/`lockedUntil` (crachá), `createdAt`, `lastLogin` (`src/server/access/users.ts:22-35`).
- Papéis fixos: Administrador, Vendedor e Operador (`src/lib/permissions.ts:4-8`). Um papel fora da lista bloqueia login e sessão (`users.ts:14`, `server-auth.ts:54`).

### Login

- `POST /api/auth/login` (`src/app/api/auth/login/route.ts`). Exige `Origin` igual a `APP_ORIGIN` (`src/server/access/request.ts:4-9`).
- **E-mail** (`login/route.ts:39-48`): `findUserByEmail` tenta o id direto, depois os campos `normalizedEmail` e `email` e, por fim, varre a coleção inteira (`users.ts:50-67`). Recusa contas de crachá, inativas, sem papel ou com senha errada. Não tem limite de tentativas.
- **Crachá** (`login/route.ts:31-38`, `69-95`): `normalizeBadge` faz trim e maiúsculas e aceita `^[A-Z0-9-]{1,40}$` (`badges.ts:18-22`). O documento é `users/cracha-<código em minúsculas>` (`badges.ts:24`). Leitura, verificação e contador de falhas rodam numa transação. Com 5 erros seguidos, o crachá fica bloqueado por 15 minutos (`badges.ts:13-14`) e responde 429.
- **Senha**: sem `passwordHash` nem `passwordSalt`, a senha aceita é `123456` (`passwords.ts:9-10`). É o estado da conta de crachá recém-criada ou resetada, e de qualquer conta antiga sem senha.
- Sucesso: grava `lastLogin`, emite o cookie de sessão e devolve `publicUser` e as permissões (`login/route.ts:51-62`).

### Sessão

- Token `payload.assinatura` em HMAC-SHA256 com `AUTH_SESSION_SECRET`, obrigatório em produção (`server-auth.ts:17-30`). Cookie `brsteel_session`: `HttpOnly`, `SameSite=Lax` e `Secure` em produção, com `Max-Age` de 8 h. A validade é absoluta, sem renovação (`server-auth.ts:13`, `65-68`).
- A cada requisição, `getSessionFromToken` relê o usuário em Firestore e recusa a sessão se a conta foi apagada, está inativa, tem papel desconhecido ou `authVersion` diferente do token (`server-auth.ts:50-56`). O papel usado é o do banco, não o do token. Desativar a conta, resetar a senha ou trocar a senha encerra as sessões na próxima requisição.
- "Sessão expirada. Faça login novamente." vem de `requireCurrentUser` (`current-user.ts:9`) e de `requireWebContext` (`operations/context.ts:9`).
- `mustChangePassword` (calculado por `needsPasswordChange`, `passwords.ts:18-21`) libera só `/perfil` (`policy.ts:8`). `requireWebContext` também recusa (`context.ts:10`), assim como o consentimento OAuth (`server/oauth/consent.ts:27`) e o token MCP (`server/oauth/access-token.ts:58`).
- Logout (`api/auth/logout/route.ts`) só apaga o cookie. O token continua válido até expirar se alguém o tiver copiado.

### Primeiro acesso e troca de senha

- `PATCH /api/auth/profile` (`api/auth/profile/route.ts`). Com troca obrigatória, aceita a nova senha sem a atual (`:48-50`). Crachá exige 6 caracteres e e-mail exige 12 (`:30`, `:42`). A nova senha não pode ser 123456 (`:45`). Grava o hash, zera `mustChangePassword`, incrementa `authVersion` e emite um cookie novo (`:53-67`).
- Depois do login, a tela manda para `/perfil` se a troca é obrigatória e, se não é, para `/vendas?tab=dashboard` (`src/app/login/page.tsx:63-66`).

### Reset de senha

- Só para crachá: botão "Resetar senha" (`EngineeringClient.tsx:249-255`), que chama `engineering.resetBadgePassword` (`operations/engineering.ts:125-132`) e depois `firestoreBadgeAccounts.reset` (`badges.ts:62-74`). O reset apaga o hash, liga a troca obrigatória, incrementa `authVersion` e zera o bloqueio. Para conta de e-mail não há reset. O administrador só consegue apagar e recriar a conta.

### Administração de contas

- Tela `/configuracoes` (`src/app/configuracoes/page.tsx`) com server actions em `src/services/user-service.ts`. Todas passam por `requireAdministrator` (`current-user.ts:17-21`).
- `addUser` (`user-service.ts:33-52`): só e-mail, com senha temporária aleatória de 18 bytes mostrada uma vez e troca obrigatória.
- `changeUser` (`user-service.ts:53-76`): troca o papel, ativa, desativa ou apaga, numa transação que mantém ao menos um administrador ativo. Desativar ou reativar incrementa `authVersion`. Trocar o papel vale na hora, porque a sessão relê o banco.
- Permissões por página: `appSettings/general` (`permissions`, `inactivePages`), mescladas com o padrão de `permissions.ts` (`server-auth.ts:72-81`, `app-settings-service.ts`). `/configuracoes` e `/perfil` não podem ser desativadas. O Administrador passa por cima de `permissions`, mas não de `inactivePages` (`policy.ts:5-10`).
- `requireOperation` (`operations/common.ts:15-23`) combina a capacidade (`mcp-capabilities.ts`), a página e `writeRoles`. Na web, o contexto recebe todas as capacidades (`context.ts:12`) e a página decide.

### Vínculo usuário ↔ funcionário do PCP

- `brsteel_pcp.workers.user_id text unique` e `badge text not null unique` (`supabase/operational/migrations/20261112120000_pcp_engineering.sql:43`, `:47`). Não há chave estrangeira para Firestore, porque a identidade fica em outro banco.
- "Criar acesso pelo crachá" (`EngineeringClient.tsx:242-247`) chama `engineering.createBadgeAccess` (`operations/engineering.ts:111-123`). A operação lê o funcionário, recusa se ele já tem `userId`, chama `accounts.create(nome, crachá)` e, em seguida, `repository.saveWorker` com o registro inteiro e o novo `userId`. São duas gravações em bancos diferentes, sem transação comum.
- `firestoreBadgeAccounts.create` (`badges.ts:47-61`) cria `cracha-<código>` com papel Operador, ativo, troca obrigatória e `authVersion` 0. Se a conta já existe com o mesmo crachá, **devolve a existente sem mudar nada**.
- O formulário do funcionário também permite escolher qualquer usuário de `getAssignableUsers` como "Usuário de login" (`EngineeringClient.tsx:327-328`, `operations/engineering.ts:35`).

### Uso do vínculo no Kanban (`/producao/quadro`)

- `loadPeople` (`postgres-pcp-kanban.ts:22-37`): o funcionário da sessão é o primeiro com `user_id = sessão` e `active` (`:34`). Equipes consideradas: só as com status `aberto` (`:26`).
- Regras (`src/lib/pcp/kanban-rules.ts`): o Administrador faz tudo. O líder da equipe da operação move o card (`moveError`, `:67-81`). Quem iniciou a OS ou o líder dele finaliza, pausa e retoma (`holdsStep`, `:112-118`). Só o Administrador exclui a OP e muda a urgência (`:131-143`). Um usuário sem funcionário vinculado só vê o quadro.
- Na coluna que pede crachá, `move` procura o funcionário pelo código bipado, comparando com `String(w.badge).toUpperCase()` e pegando o primeiro resultado (`postgres-pcp-kanban.ts:176-184`). Com `byBadge`, qualquer funcionário ativo habilitado na operação pode iniciar, mesmo que não seja da equipe do líder (`kanban-rules.ts:97`). A bipagem **não** exige conta de login do executor.
- Auditoria: as gravações do PCP chamam `recordWriteAudit` na mesma transação (`write-audit.ts:29-35`), com operação, `user_id`, origem e alvo, sem dados pessoais. As mudanças de identidade em Firestore não têm auditoria.

### O que já está bem resolvido

- A sessão é revalidada no banco a cada requisição: desativar, resetar e trocar senha encerram as sessões, e o papel vem do banco (testes em `tests/access/session.test.ts` e `tests/access/users.test.ts:70-81`).
- Não foi encontrado caminho para um Operador virar Administrador nem IDOR. Todas as rotas de conta exigem Administrador. `/api/auth/profile` só altera a própria conta e monta o objeto gravado campo a campo.
- O último administrador ativo é preservado em transação, inclusive sob concorrência (`tests/access/users.test.ts:94`).
- O bloqueio do crachá é transacional e resiste a tentativas simultâneas (`tests/access/badge-login.test.ts:75`).
- A troca obrigatória é imposta no servidor em páginas, operações, OAuth e MCP.
- As regras do Firestore negam `users`, `appSettings` e as coleções MCP ao cliente (`tests/access/firestore-rules.test.ts`).
- As violações de restrição do PostgreSQL viram mensagens próprias, sem o texto do driver, que pode conter valores da linha (`postgres-pcp-engineering.ts:20-29`).
- `addUser` gera senha aleatória e grava só o hash. A listagem não expõe hash nem salt.

## Achados

Severidade: **Bloqueia** (bloqueia o cadastro real), **Alto**, **Médio** e **Baixo**. A coluna "Antes?" indica se a correção ou a mitigação precisa estar pronta antes dos cadastros.

| Id | Severidade | Antes? | Resumo |
| --- | --- | --- | --- |
| U-01 | Bloqueia | Sim | Senha inicial 123456 universal e sem prazo, com o crachá como usuário |
| U-02 | Bloqueia | Sim | `create` reaproveita conta de crachá existente com a senha e o estado dela |
| U-03 | Alto | Sim | Troca de crachá depois do acesso dessincroniza login e bipagem |
| U-04 | Alto | Sim | Crachá sem validação nem normalização ao salvar, com bipagem ambígua |
| U-05 | Alto | Decisão | Papel Operador abre dados de clientes e insumos para o chão de fábrica |
| U-06 | Alto | Checagem | Login por e-mail sem limite e contas antigas sem hash entram com 123456 |
| U-07 | Médio | Não | Sem limite por IP: varredura de PIN fraco e bloqueio proposital de líderes |
| U-08 | Médio | Não | Lista de crachás (logins) entregue a qualquer Operador |
| U-09 | Médio | Não | "Criar acesso" não é atômico e regrava o funcionário com dados velhos |
| U-10 | Médio | Não | Desativar ou desvincular o funcionário não mexe na conta, e apagar a conta deixa o vínculo órfão |
| U-11 | Médio | Não | Recriar a conta reaproveita id e `authVersion` 0, e sessões antigas voltam a valer |
| U-12 | Médio | A confirmar | Erros das server actions de `/configuracoes` mascarados em produção |
| U-13 | Médio | Não | Nenhuma auditoria das mudanças de identidade |
| U-14 | Médio | Não | Conta de crachá pode virar Administrador com senha de 6 caracteres |
| U-15 | Médio | Decisão | Sessão de 8 h em terminal compartilhado, sem troca de líder nem inatividade |
| U-16 | Médio | Não | `scryptSync` em toda requisição autenticada |
| U-17 | Médio | Não | Reimportar do iApp sobrescreve crachá e status |
| U-18 | Baixo | Não | Líder cai em `/vendas` depois do login |
| U-19 | Baixo | Não | Mensagens iguais para conta desativada, sem papel e senha errada |
| U-20 | Baixo | Não | Vínculo manual aceita qualquer id |
| U-21 | Baixo | Não | Varredura da coleção inteira a cada login por e-mail desconhecido |
| U-22 | Baixo | Não | Nome da conta e nome do funcionário divergem |
| U-23 | Baixo | Checagem | `APP_ORIGIN` precisa ser exatamente o endereço usado nos terminais |
| U-24 | Baixo | Não | Administrador pode se rebaixar ou se apagar sem aviso |

### U-01. Senha inicial 123456 universal, sem prazo, com o crachá como usuário (Bloqueia)

- **Onde**: `src/server/access/passwords.ts:5`, `:10`; `src/server/access/badges.ts:55-57`, `:69-71`; `src/app/api/auth/login/route.ts:69-94`; `src/app/login/page.tsx:91` (a tela pública informa que a senha é 123456 e mostra um crachá de exemplo com 5 dígitos, em `:107`).
- **Cenário**: o administrador cria os acessos dos líderes à tarde. À noite, alguém de fora, ou um colega que viu o crachá bipado o dia todo, abre o site público, entra com `<crachá>` e `123456` e cadastra a própria senha em `/perfil`, que não pede a senha atual na troca obrigatória (`profile/route.ts:48-50`). O dono real fica sem acesso, e as ações no Kanban saem no nome dele. O bloqueio de 5 tentativas não ajuda, porque cada crachá precisa de uma tentativa só. Percorrer os códigos numéricos de 5 dígitos com a mesma senha não esbarra em nenhum limite (U-07). A conta fica em 123456 por tempo indeterminado, até o primeiro acesso, e volta a esse estado a cada reset.
- **Correção proposta**:
  1. Senha inicial individual: gerar um PIN aleatório de 6 dígitos em `create` e em `reset`, gravar só o hash e mostrar o PIN uma vez ao administrador, como `addUser` já faz com a senha temporária. Remover o caminho "sem hash = 123456" de `verifyPassword` depois de migrar as contas antigas (ver U-06).
  2. Prazo do primeiro acesso: gravar `initialPasswordExpiresAt` (sugestão: 72 h) em `create` e `reset`. Depois do prazo, o login recusa com "Primeiro acesso vencido. Peça ao administrador para resetar a senha."
  3. Limite por IP no login (U-07).
  4. Tirar o texto "a senha é 123456" e o exemplo de crachá da tela pública.
- Se o dono mantiver 123456 (pergunta P-1), os itens 2 e 3 são o mínimo, e a criação do acesso deve ser feita com a pessoa presente.

### U-02. `create` reaproveita a conta de crachá existente (Bloqueia)

- **Onde**: `src/server/access/badges.ts:51-54`; `src/server/operations/engineering.ts:118-121`. O comportamento é intencional e testado (`tests/access/badge-login.test.ts:59`).
- **Cenários**:
  - Já existe `users/cracha-<código>` de um teste ou do piloto, com senha pessoal de quem testou. "Criar acesso" vincula o funcionário a essa conta, e quem testou continua entrando como ele. O aviso da tela diz que a senha é 123456, e o funcionário não consegue entrar.
  - A conta existe desativada ou com papel Vendedor: o vínculo é feito e o login falha com "Crachá ou senha inválidos." Pelo papel, a conta fica sem acesso ao quadro, e ninguém entende o motivo.
  - A conta existe com papel Administrador (U-14): o funcionário passa a ser administrador.
  - O código foi reaproveitado depois de uma troca de crachá (U-03): a pessoa nova herda a conta e a senha da antiga.
- **Correção proposta**: em `create`, se a conta já existe, recusar com uma mensagem clara ("Já existe um login para este crachá. Confira em Configurações antes de continuar.") ou, por decisão do administrador, **adotar e resetar**: apagar o hash, ligar a troca obrigatória, incrementar `authVersion`, reativar e definir o papel padrão do crachá, numa transação. Em ambos os casos, conferir no PostgreSQL que nenhum outro funcionário aponta para esse id antes de vincular.

### U-03. Troca de crachá depois do acesso (Alto)

- **Onde**: `saveWorker` aceita outro `badge` com `user_id` mantido (`operations/engineering.ts:33-36`, `postgres-pcp-engineering.ts:218-220`). A conta continua `cracha-<antigo>` com `badge` antigo (`badges.ts:24`, `:34`). A bipagem usa `workers.badge` (`postgres-pcp-kanban.ts:178`). A reimportação do iApp também regrava o crachá (U-17).
- **Cenário**: o funcionário perde o crachá e recebe outro código. O administrador edita o código, e a bipagem passa a funcionar com o novo, mas o login só entra com o código antigo. "Resetar senha" reseta a conta antiga. Se o código antigo for dado a outra pessoa e o administrador clicar em "Criar acesso" para ela, U-02 a vincula à conta antiga ou dá erro de "usuário" duplicado.
- **Correção proposta**: em `saveWorker`, se o funcionário tem uma conta de crachá vinculada e o código normalizado mudou, recusar com a mensagem "Este funcionário tem login pelo crachá {antigo}. Use 'Trocar crachá do login'." Criar a ação `changeBadge`, que cria `cracha-<novo>` com os campos da conta antiga (senha, papel, `authVersion` + 1), desativa a antiga (sem apagar, ver U-11), regrava `workers.badge` e `user_id` e audita. A alternativa mais simples é desvincular e desativar a conta antiga e criar um acesso novo, com primeiro acesso.

### U-04. Crachá sem validação nem normalização ao salvar (Alto)

- **Onde**: `workerSchema.badge` aceita qualquer texto de 1 a 50 caracteres (`operations/engineering.ts:34`). `normalizeBadge` exige `[A-Z0-9-]{1,40}` (`badges.ts:18-22`). A coluna é `unique` sobre o texto cru (`20261112120000_pcp_engineering.sql:43`). A bipagem compara em maiúsculas e pega o primeiro resultado (`postgres-pcp-kanban.ts:178`). O iApp é importado sem normalização (`scripts/pcp-import-iapp.ts:110`).
- **Cenários**:
  - Crachá salvo como `12 34`, com acento ou com mais de 40 caracteres: "Criar acesso" falha com `NO_BADGE` e a bipagem sempre responde "Crachá não encontrado."
  - Dois funcionários com `ab-1` e `AB-1`: o banco aceita, a bipagem inicia a OS no nome de qualquer um dos dois, e o segundo "Criar acesso" adota a conta do primeiro (U-02) e termina em "Já existe um cadastro com este usuário."
  - Zeros à esquerda: o leitor emite `000123` e o cadastro tem `123`, ou o contrário. Bipagem e login falham sem explicação (pergunta P-4).
- **Correção proposta**: validar e gravar o crachá já normalizado em `saveWorker` (usar `normalizeBadge` no schema, com a mensagem "Use só letras, números e hífen."). Migration com índice único em `upper(badge)` depois de conferir os dados (Fase 0). Na bipagem, comparar com a mesma normalização e recusar se houver mais de um resultado. Aplicar a regra de zeros decidida em P-4 nos três pontos (cadastro, login e bipagem).

### U-05. Papel Operador amplo demais para o chão de fábrica (Alto, decisão)

- **Onde**: `badges.ts:56` cria com o papel Operador. Pelo padrão de `src/lib/permissions.ts:10-31`, o Operador acessa `/atendimento/chat` (conversas com clientes do Mercado Livre), `/anuncios-mercado-livre`, `/analise-ads`, `/buscar-mercado-livre`, `/insumos` (com escrita, `mcp-capabilities.ts:7`), `/estoque`, `/produtos`, `/producao`, `/producao/kanban` e `/producao/ops`.
- **Cenário**: um líder entra pelo crachá no terminal da operação e consegue ler conversas e dados de clientes e lançar movimentações de insumo. Restringir as páginas do papel Operador em `/configuracoes` afeta também os Operadores do escritório.
- **Correção proposta**: criar o papel `Produção` (ou `Líder`) em `availableRoles` e nos `z.enum` de papel (`user-service.ts:11`, `app-settings-service.ts:12`), com acesso padrão só a `/producao/quadro`, `/perfil` e `/meus-reportes`, e incluí-lo onde o PCP confere papel (`resolveWriteIdentity` em `operations/production.ts:44` e `getAssignableUsers` em `user-service.ts:29`, se o Kanban antigo também for usado). As contas de crachá nascem com esse papel. Ver P-2.

### U-06. Login por e-mail sem limite, e contas antigas sem hash entram com 123456 (Alto, checagem)

- **Onde**: `login/route.ts:39-48` não tem contador nem bloqueio. `verifyPassword` aceita 123456 para qualquer conta sem `passwordHash` e `passwordSalt` (`passwords.ts:10`). O comentário em `passwords.ts:4` diz que o caminho existe por compatibilidade com contas antigas.
- **Cenário**: uma conta de e-mail criada antes do hash, ou à mão no console, entra com 123456 por quem souber o e-mail. Como a troca é obrigatória e não pede a senha atual, o invasor fica com a conta. Se for de administrador, controla todo o sistema. Para contas com senha, é possível tentar senhas sem limite.
- **Correção proposta**: Fase 0, contar (só leitura, por quem tem acesso ao Firestore) as contas sem `passwordHash` e sem `badge`. Se houver alguma, desativá-la ou recriá-la por `addUser`. Depois, no código, recusar o caminho "sem hash" para contas de e-mail e aplicar ao e-mail o mesmo contador de falhas do crachá e o limite por IP (U-07).

### U-07. Sem limite por IP: varredura de PIN fraco e bloqueio proposital (Médio)

- **Onde**: `login/route.ts` só tem contador por crachá. A senha de crachá aceita `000000` e `111111` (`profile/route.ts:30`, `:45`).
- **Cenários**:
  - Testar as 4 senhas mais comuns em todos os crachás a cada 15 minutos nunca dispara o bloqueio.
  - No início do turno, alguém erra 5 vezes o crachá de cada líder. Todos ficam 15 minutos sem acesso ao quadro, e o único destravamento rápido, o reset, devolve a conta a 123456.
- **Correção proposta**: limite por IP e por janela no login, com contador em Firestore no mesmo molde de `src/server/mcp/rate-limit.ts` (por exemplo, 20 tentativas por minuto por IP e 200 por hora), ou uma regra de rate limit no firewall da Vercel para `/api/auth/login`. Recusar PINs triviais (todos os dígitos iguais e sequências como 123456 ou 654321). Para os terminais da fábrica, avaliar uma lista de IPs liberados do limite (P-6).

### U-08. Lista de crachás (logins) entregue a qualquer Operador (Médio)

- **Onde**: `getAssignableUsers` (`src/services/user-service.ts:25-32`) exige só `/producao/kanban` (padrão: Operador) e devolve `id`, `name`, `role` e `badge` de todas as contas ativas de Administrador e Operador. É usada por `EngineeringClient.tsx:93` e pelo Kanban antigo (`components/kanban/AssignUserPopover.tsx:44`). Além disso, a resposta 429 só aparece para crachá existente (`login/route.ts:83-85`).
- **Cenário**: um Operador chama a server action e recebe a lista de nomes de usuário de todos os líderes, pronta para U-01 e U-07.
- **Correção proposta**: tirar `badge` de `getAssignableUsers` e criar `getLinkableAccounts`, só para Administrador, para a tela de Engenharia. Responder 429 sem diferenciar crachá inexistente fica para depois do limite por IP.

### U-09. "Criar acesso" não é atômico e regrava o funcionário inteiro (Médio)

- **Onde**: `operations/engineering.ts:113-121` lê o funcionário, cria a conta em Firestore e chama `saveWorker` com o registro lido. `saveWorker` regrava nome, crachá, tipo, status, `user_id` e todas as operações (`postgres-pcp-engineering.ts:205-232`). No cliente, o formulário guarda uma cópia do funcionário de quando foi aberto (`EngineeringClient.tsx:120`, `:147-148`).
- **Cenários**:
  - O `saveWorker` falha (pool cheio, funcionário inativado entre as duas gravações): a conta fica criada, ativa e em 123456, sem vínculo nem aviso.
  - O administrador abre a edição do funcionário, outra aba clica em "Criar acesso", e o formulário salvo devolve `userId: null`, desfazendo o vínculo. O inverso também acontece: a criação regrava operações e crachá antigos por cima de uma edição recém-salva.
- **Correção proposta**: um método próprio no repositório, `linkWorkerUser(workerId, userId, expectedBadge)`, com `update workers set user_id = $2 where id = $1 and user_id is null and upper(badge) = $3`, que recusa quando nenhuma linha é afetada, e auditoria `pcp.linkWorkerUser`. Se o vínculo falhar, desativar a conta recém-criada. Em `saveWorker`, só alterar `user_id` quando o campo vier explicitamente diferente do atual, ou exigir o `updated_at` lido (controle otimista) para o formulário não sobrescrever mudanças.

### U-10. Desativar ou desvincular o funcionário não mexe na conta, e apagar a conta deixa o vínculo órfão (Médio)

- **Onde**: `saveWorker` com `active: false` ou `userId: null` não toca no Firestore. `deleteUser` (`user-service.ts:67`, `:77`) não toca no PostgreSQL. A tela mostra "Vinculado" e esconde os dois botões quando o id não está na lista (`EngineeringClient.tsx:239-253`). O `select` de usuário não tem opção para um id ausente (`:327-328`).
- **Cenários**:
  - Funcionário desligado e inativado no PCP: a conta continua ativa com papel Operador, ele entra de casa e vê as páginas de U-05. No quadro, `loadPeople` o ignora (`postgres-pcp-kanban.ts:34`).
  - O administrador apaga a conta em `/configuracoes`: o funcionário fica com `user_id` órfão. "Criar acesso" some, e limpar o campo no formulário não funciona porque o valor exibido não corresponde ao estado.
- **Correção proposta**: ao inativar ou desvincular um funcionário com conta de crachá, desativar a conta (mesmo fluxo de `setUserActive`, com auditoria) ou, no mínimo, pedir confirmação com essa opção. Na tela, mostrar "Login removido" para id órfão, com o botão "Desvincular". Em `/configuracoes`, ao apagar ou desativar uma conta de crachá, avisar que há funcionário vinculado. Ver P-5 sobre apagar ou só desativar.

### U-11. Recriar a conta reaproveita id e `authVersion` 0 (Médio)

- **Onde**: `badgeUserId` é determinístico (`badges.ts:24`), e a conta nasce com `authVersion: 0` (`badges.ts:56`). `getSessionFromToken` só compara id e `authVersion` (`server-auth.ts:53-54`). O token MCP compara `grant.authVersion` com `user.authVersion` (`server/oauth/access-token.ts:60`).
- **Cenário**: a conta é apagada e recriada pelo mesmo crachá dentro de 8 h. Um cookie antigo, de outro terminal ou de quem usava a conta, volta a valer. Uma conexão MCP antiga com `authVersion` 0 também passaria a valer, se existisse.
- **Correção proposta**: para contas de crachá, não apagar e só desativar (U-10 e P-5). Se apagar continuar permitido, iniciar `authVersion` a partir de um valor que não se repete (por exemplo, `Date.now()`) em `create` e `addUser` e, ao apagar, revogar `mcpConnections` e `mcpIdentityBindings` do id.

### U-12. Erros das server actions de `/configuracoes` mascarados em produção (Médio, a confirmar)

- **Onde**: `user-service.ts` e `app-settings-service.ts` lançam `Error` com mensagens em português ("Mantenha ao menos um administrador ativo.", "Já existe um usuário com este e-mail.", "Sessão expirada..."). A tela mostra `error.message` (`configuracoes/page.tsx:73`, `:168`, `:203`, `:224`).
- **Cenário**: no build de produção, o Next.js substitui a mensagem de erros lançados em server actions por um texto genérico com digest. O administrador vê um erro incompreensível ao tentar rebaixar o último administrador ou repetir um e-mail. Isso não foi exercitado nesta revisão. Confirmar no preview.
- **Correção proposta**: as actions devolvem `{ ok: false, error }` para erros esperados (ou passam a usar uma rota com `OperationError`, como a Engenharia). Teste de que a mensagem chega ao cliente.

### U-13. Nenhuma auditoria das mudanças de identidade (Médio)

- **Onde**: `addUser`, `changeUser`, `firestoreBadgeAccounts.create` e `reset`, a troca de senha (`profile/route.ts`) e o bloqueio por tentativas não registram quem fez o quê. `resetBadgePassword` descarta o ator (`operations/engineering.ts:126`). "Criar acesso" só aparece como `pcp.updateWorker`.
- **Cenário**: um líder diz que a senha foi trocada sem ele saber. Não há registro de quem resetou nem de quando a conta foi assumida.
- **Correção proposta**: coleção `accessAudit` em Firestore (Admin SDK, negada pelas regras), gravada na mesma transação da mudança, com `operation`, `actorUserId`, `targetUserId`, `at` e `source`, sem nome, e-mail, crachá ou IP em claro. Operações: `user.create`, `user.role`, `user.active`, `user.delete`, `badge.create`, `badge.reset`, `password.change`, `badge.locked`. No PostgreSQL, `pcp.linkWorkerUser` (U-09).

### U-14. Conta de crachá pode virar Administrador (Médio)

- **Onde**: o seletor de papel em `/configuracoes` (`page.tsx:414-422`) e `updateUserRole` não distinguem contas de crachá. A senha de crachá exige só 6 caracteres, qualquer que seja o papel (`profile/route.ts:42`).
- **Cenário**: o administrador promove um líder a Administrador para facilitar o piloto. A conta de maior poder do sistema passa a ter usuário visível (o crachá) e um PIN de 6 dígitos.
- **Correção proposta**: recusar o papel Administrador em conta de crachá ("Administradores entram com e-mail."), ou exigir 12 caracteres quando o papel for Administrador.

### U-15. Sessão de 8 h em terminal compartilhado (Médio, decisão)

- **Onde**: `server-auth.ts:13` (validade absoluta de 8 h), logout só local (`api/auth/logout/route.ts`), sem expiração por inatividade.
- **Cenários**: o líder do turno da manhã sai sem clicar em "Sair", e o da tarde opera o quadro com a sessão dele. As movimentações saem no nome errado (`production_order_events.user_id`). Com turno maior que 8 h, a sessão vence no meio do turno.
- **Correção proposta**: depende de P-3. Opções: expiração por inatividade (por exemplo, 30 minutos sem ação no quadro), botão "Trocar líder" que encerra a sessão e volta direto para a aba Crachá, e validade alinhada ao turno.

### U-16. `scryptSync` em toda requisição autenticada (Médio)

- **Onde**: `publicUser` (`users.ts:39`) chama `needsPasswordChange`, que executa `verifyPassword(DEFAULT_INITIAL_PASSWORD, hash, salt)` (`passwords.ts:18-21`) para toda conta com senha. Isso acontece em cada `getSessionFromToken`.
- **Cenário**: cada atualização do quadro nos terminais custa cerca de 20 ms de CPU síncrona (medido localmente: 22,5 ms por `scryptSync` de 64 bytes) e bloqueia o event loop da instância.
- **Correção proposta**: como o perfil já proíbe 123456 como nova senha e `addUser` gera senha aleatória, calcular "senha é a padrão" só no login e na troca, gravando `mustChangePassword: true` quando for o caso. No caminho da sessão, usar só `mustChangePassword` e a ausência de hash.

### U-17. Reimportar do iApp sobrescreve crachá e status (Médio)

- **Onde**: `scripts/pcp-import-iapp.ts:110-111` (`on conflict (iapp_id) do update set ... badge = excluded.badge, active = excluded.active`).
- **Cenário**: depois dos cadastros, alguém roda a importação de novo para trazer uma ficha. Funcionários inativados no BR Steel voltam a ficar ativos, e crachás corrigidos voltam ao valor do iApp, desencontrando login e bipagem (U-03).
- **Correção proposta**: depois do primeiro cadastro real, a importação não atualiza mais `badge` nem `active` de funcionário existente, ou exige uma flag explícita. Registrar isso em `scripts/README.md`. Ver P-7.

### U-18. Líder cai em `/vendas` depois do login (Baixo)

- **Onde**: `src/app/login/page.tsx:66`.
- **Cenário**: o líder entra pelo crachá e cai numa página sem permissão.
- **Correção**: redirecionar para a primeira página permitida, com `/producao/quadro` quando houver permissão.

### U-19. Mensagens iguais para conta desativada, sem papel e senha errada (Baixo)

- **Onde**: `login/route.ts:46`, `:79`.
- **Cenário**: o líder inativado por engano recebe "Crachá ou senha inválidos." e tenta de novo até bloquear.
- **Correção**: depois de a senha conferir, responder "Acesso desativado. Fale com o administrador." Antes disso, manter a mensagem genérica, para não revelar se a conta existe.

### U-20. Vínculo manual aceita qualquer id (Baixo)

- **Onde**: `workerSchema.userId` é texto livre (`operations/engineering.ts:35`).
- **Cenário**: o funcionário X fica vinculado à conta de crachá de Y. "Resetar senha" de X reseta Y.
- **Correção**: em `saveWorker`, conferir que o id existe, está ativo, tem papel permitido e, se for conta de crachá, que o crachá dela é o do funcionário.

### U-21. Varredura da coleção inteira a cada login por e-mail desconhecido (Baixo)

- **Onde**: `users.ts:63-66`.
- **Cenário**: cada tentativa com e-mail inexistente lê todos os documentos de `users`. A diferença de tempo entre e-mail existente e inexistente (scrypt ou não) também permite descobrir quais e-mails existem.
- **Correção**: migrar as contas com e-mail misto para `normalizedEmail` e remover a varredura. Executar um scrypt fictício quando o usuário não existe.

### U-22. Nome da conta e nome do funcionário divergem (Baixo)

- **Onde**: `create` copia o nome do momento (`badges.ts:56`), e o perfil permite mudar o nome (`profile/route.ts:16`, `:54`).
- **Correção**: para conta de crachá, o perfil só troca a senha e o nome segue o cadastro do funcionário.

### U-23. `APP_ORIGIN` igual ao endereço dos terminais (Baixo, checagem)

- **Onde**: `request.ts:5`.
- **Cenário**: se o terminal abrir o sistema por outro domínio (por exemplo, o `*.vercel.app` em vez do domínio próprio), login, troca de senha e logout respondem "Origem não autorizada."
- **Correção**: Fase 0, confirmar o endereço que será fixado nos terminais.

### U-24. Administrador pode se rebaixar ou se apagar sem aviso (Baixo)

- **Onde**: `user-service.ts:62-67`. Só o último administrador é protegido.
- **Correção**: confirmação extra quando o alvo é o próprio usuário.

## Riscos em contratos OAuth/MCP (só apontados, sem mudança)

- **Conta de crachá não conecta o Claude.** `ensureIdentity` cria a identidade no Supabase Auth com `email: user.email`, que numa conta de crachá é `cracha-<código>`, um e-mail inválido. A falha aparece como "Não foi possível vincular esta identidade..." (`src/server/oauth/supabase.ts:29-38`), mensagem que sugere colisão de cadastro. Se líderes forem usar o MCP, o contrato precisa de um e-mail sintético estável. Mudar isso altera o vínculo de identidade e tem procedimento próprio (`docs/mcp-producao.md`).
- **Apagar conta não revoga** `mcpConnections`, `mcpIdentities` nem `mcpIdentityBindings`. Com o id reaproveitado (U-11), uma conexão antiga pode voltar a valer. Desativar, resetar e trocar senha revogam, pela comparação de `authVersion`.
- **O token MCP lê o papel atual** e recusa conta inativa ou com troca obrigatória (`access-token.ts:57-61`). Um papel novo (U-05) precisa entrar em `mcpCapabilities.writeRoles` (`src/lib/mcp-capabilities.ts`) só se for para gravar pelo MCP. Hoje o MCP não tem ferramentas do Kanban de OPs.
- **O cookie-ponte OAuth** é limpo no login, no logout e na troca de senha (`login/route.ts:61`, `profile/route.ts:67`). Qualquer mudança no formato do cookie de sessão precisa preservar esse comportamento e o `next` seguro (`src/lib/oauth-return-path.ts`).

## Plano de correção

Cada fase vira uma branch e um PR contra `main`. Cada PR roda `npm run lint`, `npm run typecheck:ci` e as suítes indicadas.

### Fase 0: checagens sem código, antes do primeiro clique

Feitas pelo dono ou pelo administrador, só leitura, sem copiar dados para o Git:

1. Em `/configuracoes`, procurar contas com e-mail `cracha-*`. Para cada uma, decidir entre apagar e manter antes de criar acessos (U-02).
2. No Firestore, contar as contas sem `passwordHash` e sem `badge` (U-06). Se houver, desativá-las ou recriá-las por "Adicionar usuário".
3. No PostgreSQL, conferir os 23 crachás: algum com caractere fora de `[A-Za-z0-9-]`, com mais de 40 caracteres, repetido ignorando maiúsculas ou com zeros à esquerda (U-04). Consulta sugerida: `select upper(trim(badge)) b, count(*) from brsteel_pcp.workers group by 1 having count(*) > 1`, mais `select count(*) from brsteel_pcp.workers where badge !~ '^[A-Za-z0-9-]{1,40}$'`.
4. Testar um crachá real no leitor do terminal e comparar o texto emitido com o cadastro (zeros, prefixos, Enter final).
5. Confirmar que o endereço fixado nos terminais é o mesmo de `APP_ORIGIN` (U-23).
6. Decidir P-1 a P-5.

### Fase 1: antes dos cadastros (um PR, "acesso pelo crachá seguro")

1. **Crachá normalizado** (U-04): em `operations/engineering.ts`, `badge` com `normalizeBadge` e a regra de P-4. Migration `supabase/operational/migrations/2026111x_pcp_worker_badge_normalized.sql` com `update` de normalização (só se a Fase 0 não achar colisões) e índice único em `upper(badge)`. Atualizar a contagem de tabelas e FKs do backup se aplicável. Em `postgres-pcp-kanban.ts`, comparar o crachá bipado normalizado e recusar quando houver mais de um resultado.
2. **`create` sem adoção silenciosa** (U-02): em `badges.ts`, recusar a conta existente ou adotar e resetar, conforme P-5.
3. **Senha inicial** (U-01): conforme P-1, PIN aleatório mostrado uma vez (`create` e `reset` devolvem o PIN, e `EngineeringClient.tsx` exibe um diálogo igual ao `newCredential` de `/configuracoes`) ou 123456 com `initialPasswordExpiresAt`. Ajustar o texto da tela de login.
4. **Papel de produção** (U-05): conforme P-2, papel novo em `permissions.ts`, schemas de papel, `resolveWriteIdentity` e `getAssignableUsers`. `create` usa esse papel.
5. **Bloqueio de troca de crachá com login** (U-03): recusa em `saveWorker` enquanto houver conta de crachá vinculada com código diferente.
6. **Limite por IP no login** (U-07 e U-06): `src/server/access/login-rate-limit.ts` no molde de `src/server/mcp/rate-limit.ts`, aplicado a crachá e e-mail. Regra da coleção nova negada em `firestore.rules`.

Testes da Fase 1:

- `tests/access/badge-login.test.ts`: `create` recusa ou reseta a conta existente (com senha pessoal, inativa, com papel Administrador); o PIN inicial aleatório entra e 123456 não entra; o primeiro acesso vencido recusa; o limite por IP responde 429 sem revelar se o crachá existe.
- `tests/operations/pcp-badge-access.test.ts`: crachá com espaço ou acento recusado em `saveWorker`; troca de crachá recusada com login vinculado; `createBadgeAccess` usa o papel novo.
- `tests/access/firestore-rules.test.ts`: a coleção do limite fica negada ao cliente.
- `tests/postgres/pcp-engineering.integration.ts`: o índice em `upper(badge)` recusa `ab-1` e `AB-1`.
- `tests/postgres/pcp-engineering.integration.ts` (bloco do Kanban): bipagem normalizada encontra `ab-1` digitado como ` AB-1 `.
- `tests/access/policy.test.ts`: o papel de produção só acessa `/producao/quadro`, `/perfil` e `/meus-reportes`.

### Fase 2: primeira semana do piloto

1. **Vínculo atômico** (U-09): `linkWorkerUser` em `pcp-engineering-contract.ts` e `postgres-pcp-engineering.ts`, com auditoria `pcp.linkWorkerUser`, desativação da conta se o vínculo falhar e `saveWorker` sem sobrescrever `user_id`.
2. **Ciclo de vida da conta** (U-10, U-11): desativar a conta de crachá ao inativar ou desvincular o funcionário; tratar id órfão na tela; trocar "apagar" por "desativar" para contas de crachá, conforme P-5; `authVersion` inicial que não se repete.
3. **Auditoria de identidade** (U-13): `src/server/access/audit.ts` e a coleção `accessAudit`, gravada em `user-service.ts`, `badges.ts` e `profile/route.ts`.
4. **Mensagens de erro** (U-12): actions devolvem `{ ok, error }`, e `/configuracoes` mostra a mensagem.
5. **Diretório sem crachá** (U-08): `getAssignableUsers` sem `badge`, mais `getLinkableAccounts` só para Administrador.
6. **Sessão no terminal** (U-15): conforme P-3.
7. **Contas de e-mail** (U-06 e U-14): sem o caminho "sem hash = 123456" para e-mail, com contador de falhas por conta, e papel Administrador recusado em conta de crachá.

Testes da Fase 2:

- `tests/access/users.test.ts`: apagar ou desativar conta de crachá vinculada; `authVersion` de conta recriada não aceita cookie antigo; a action devolve a mensagem de "último administrador"; papel Administrador recusado em conta de crachá; auditoria gravada por operação, sem nome nem e-mail.
- `tests/access/session.test.ts`: cookie de conta apagada e recriada é recusado.
- `tests/postgres/pcp-engineering.integration.ts`: `linkWorkerUser` recusa um funcionário já vinculado e recusa quando o crachá mudou; `saveWorker` sem `userId` explícito não desfaz o vínculo; o par de linhas de auditoria fica na mesma transação.
- `tests/operations/pcp-badge-access.test.ts`: inativar um funcionário com conta chama a desativação da conta; reset grava auditoria com o ator.

### Fase 3: melhorias

U-16 (scrypt fora do caminho da sessão), U-17 (importação do iApp sem regravar crachá e status), U-18 (destino após o login), U-19, U-20, U-21, U-22 e U-24, além do contrato de e-mail sintético para MCP, se os líderes forem usar o Claude.

## Perguntas para o dono do sistema

**P-1. Senha do primeiro acesso: 123456 para todos ou PIN individual?**
Recomendação: PIN aleatório de 6 dígitos, mostrado uma vez ao administrador e entregue em mãos, válido por 72 h. Se a fábrica preferir 123456 pela simplicidade do iApp, manter com prazo de 72 h, limite por IP e criação do acesso com a pessoa presente.

**P-2. Os líderes devem entrar como Operador ou com um papel só de produção?**
Recomendação: papel novo `Produção`, com o quadro de OPs, o perfil e os próprios reportes. O Operador do escritório continua como está.

**P-3. Como funciona a troca de líder no terminal da operação?**
Recomendação: botão "Trocar líder" no quadro, que encerra a sessão e abre a aba Crachá, mais saída automática após 30 minutos sem ação no quadro. Validade máxima da sessão igual à duração do turno mais uma margem.

**P-4. Zeros à esquerda e formato do crachá: `000123` e `123` são o mesmo crachá?**
Recomendação: decidir pelo que o leitor emite no teste da Fase 0. Se o leitor emite com zeros e o iApp guardou sem, remover os zeros à esquerda na normalização, aplicada a cadastro, login e bipagem.

**P-5. Conta de crachá pode ser apagada ou só desativada? E ao recriar o acesso de um crachá que já tem conta: recusar ou reaproveitar com reset?**
Recomendação: só desativar (o histórico do Kanban guarda o `user_id`). Ao recriar, reaproveitar com reset obrigatório (senha apagada, troca obrigatória, `authVersion` + 1, reativação e papel de produção), depois de confirmar que nenhum outro funcionário aponta para a conta.

**P-6. Os terminais da fábrica têm IP fixo?**
Recomendação: se tiverem, registrar o IP para isentá-lo do limite por IP e, no futuro, restringir o login por crachá a esses IPs, já que o chão de fábrica não usa celular.

**P-7. A importação do iApp ainda vai ser rodada depois dos cadastros?**
Recomendação: considerar o cadastro de funcionários do BR Steel a fonte da verdade a partir do primeiro acesso criado. A importação deixa de atualizar crachá e status.

**P-8. Os demais funcionários (não líderes) precisam de conta?**
Recomendação: não. Pela decisão de 13/11/2026, só o líder opera o quadro, e o executor se identifica pela bipagem, que não exige conta. Criar acesso só para líderes e para o operador do piloto reduz a superfície de U-01, U-05 e U-10.
