# Cópia da lógica de produção do iApp para o BR Steel

> Plano de início, escrito em 12/11/2026 a partir da reunião de 10/11/2026, da leitura do iApp em produção (somente leitura) e do código desta branch. Segue a skill `system-function-migrator`: a parte 1 é o relatório de análise (`analyze-system`) e a parte 3 é a ordem de migração (`migrate-functions`).

**Objetivo:** substituir o iApp (PCP da Iniciativa Aplicativos) pelo BR Steel em duas etapas. A primeira é gerar e importar as OPs, rodando em paralelo com o iApp. A segunda é o Kanban de produção com operações, líderes, apontamentos e perdas. Depois disso o iApp é desligado.

**Prazo falado na reunião:** cerca de 5 dias para a geração de OPs e 5 a 6 dias para o Kanban. Próxima revisão: sexta-feira, 13/11/2026, às 15h.

**Fora do escopo inicial:** tendências e sazonalidade no gerador de OPs, checklists de qualidade, grupos de máquinas, metas, custos (MOD, GGF, margem) e máscara de lote. A reunião adiou esses itens. O modelo de dados deixa espaço para eles.

---

## Parte 1. Relatório de análise do iApp

**Origem:** `https://iapp.iniciativaaplicativos.com.br` (sessão de administrador).
**Modo de acesso:** navegador (telas e grids) e leitura de requisições. Nenhum formulário foi enviado e nenhum card foi movido.
**Tecnologia:** Laravel com páginas renderizadas no servidor, jQuery, Bootstrap, grids Infragistics (`/iggrid/filtrar?type=<tela>`) e DHTMLX Kanban. As telas de edição seguem o padrão `/<módulo>/<recurso>/editar?id=<ID>`.

### 1.1 Visão geral

O iApp é um PCP genérico com centenas de telas. A BR Steel usa um recorte pequeno:

1. **Engenharia:** uma linha de produção com fases, operações, equipes, funcionários e fichas técnicas.
2. **Manufatura:** OPs criadas uma a uma ou por planilha. Cada OP gera uma OS (ordem de serviço) por operação do roteiro da ficha.
3. **Controle:** um Kanban "Ordem de Produção por Fase Produtiva". O card é a OP, e a coluna é a fase da OS em andamento.
4. **Apontamentos:** início e fim de cada OS por bipagem, e perdas.

Bling é o sistema principal. O iApp recebe os cadastros do Bling e devolve os apontamentos de estoque.

### 1.2 Telas usadas pela BR Steel

| Rota | Tela | Uso na BR Steel |
| --- | --- | --- |
| `/engenharia/linha-producao/lista` | Linhas de Produção | 1 linha ("Linha de produção", CMI 250 un/mês) com 11 fases |
| `/engenharia/operacoes/lista` | Operações | 12 operações |
| `/engenharia/equipes/lista` | Equipes de Trabalho | 6 equipes: Corte, Dobra, Solda, Polimento, Limpeza, Embalagem |
| `/engenharia/funcionarios/lista` | Funcionários | 23 cadastros, cada um com um tipo (Cortador, Dobrador, Soldador, Polidor, Limpador, Embalador, Gerência) |
| `/engenharia/ficha-tecnica/lista` | Fichas Técnicas | 387 fichas, uma por produto |
| `/manufatura/ordens-producao/lista` | OPs | 9.438 OPs, numeradas `0009664 OP` |
| `/manufatura/ordens-producao/cadastro/producao-para-estoques` | Nova OP | Criação manual e aba "Importar Planilha" (`POST /importador/importar`, `import=op`, só `.xlsx`, até 5 MB) |
| `/controle/kanban/ordem-producao-por-fase-produtiva` | Kanban por fase | Quadro do dia a dia |
| `/controle/ordens-producao/balanco/gerencial?op=<ID>` | Balanço | Previsto x produzido, materiais e apontamentos de tempo |
| `/configuracoes/dados` (aba Horários) | Minha Empresa | Expediente usado no cálculo de tempo |
| `/configuracoes/feriados/lista`, `/configuracoes/motivos/lista` | Feriados, Motivos | Calendário e motivos de perda |

### 1.3 Inventário de funções

#### Linha de produção e fases

Na BR Steel há uma linha. As fases, em ordem, são: Corte → Check Q/Q Corte → Dobra → Check Q/Q Dobra → Soldagem → Check Q/Q Solda → Polimento → Check Q/Q Polimento → Limpeza → Check Q/Q Limpeza → Embalagem. Há também a fase "Projeto". As fases viram as colunas do Kanban (ver 1.3, Kanban).

#### Operações (`PROCESSOS_*`)

- **Campos usados:**
  - linha e fase produtiva;
  - nome e identificação (`0000000001`);
  - ordem de execução na fase;
  - **predecessor**: outra operação, por exemplo Dobrar → Check Q/Q Corte;
  - funcionário padrão;
  - local (interno ou externo);
  - classificação (BATELADAS, TRANSIENTES);
  - unidade de tempo e capacidade diária.
- **Operações existentes:** Cortar, Check Q/Q Corte, Dobrar, Check Q/Q Dobra, Soldar, Check Q/Q Solda, Polir, Check Q/Q Polimento, Limpar, Check Q/Q Limpeza, Embalar e Projetar.
- **Campos que existem e não são usados:** consumo, máquinas e ferramentas, EPIs, checklist, metas e instruções.

#### Equipes (`EQUIPES_*`)

- **Campos:** descrição, status (Aberto, Inativo, Fechado), turno, **líder**, operações ou competências da equipe, valor médio por hora e capacidade em horas por dia.
- **Regra da reunião:** os membros respondem ao líder. O líder pode iniciar OS em nome de um membro. O membro só inicia em nome próprio. Só o líder move o card para a próxima fase (ponto de checagem de quantidade e qualidade).
- **Membros e hierarquia:** ficam num organograma dentro da equipe (DHTMLX Diagram). Nós são funcionários e linhas ligam o líder aos subordinados. A equipe Dobra tem o líder e dois membros ligados a ele. O BR Steel pode guardar isso como `leader_id` em cada membro; não precisa de diagrama.

#### Funcionários (`FUNCIONARIOS_*`)

- **Campos operacionais:** nome, crachá, tipo, status, setor, área, **operações permitidas** (lista de operações da linha), habilidades (máquinas), horário individual e salário por hora. O salário por hora é usado em custo, que está fora do escopo.
- **A ficha também guarda dados de RH:** documentos, endereço, dependentes, salários, banco. **Esses dados não serão copiados.** O repositório é público, e o BR Steel não precisa deles para produção.
- **Parâmetro relevante:** `BLOQUEAR_APONTAMENTOS_MESMO_FUNCIONARIO_HORARIO`, que impede o mesmo funcionário de ter dois apontamentos no mesmo horário.

#### Ficha técnica (`fichatecnica_*`)

- **Cabeçalho:** produto (SKU do Bling em `PRODUTOS_IDENTIFICACAO`), nome, identificação (`00000204`), status (ABERTO, BLOQUEADO, SUSPENSO, FECHADO…), quantidade base, linha e status de aprovação.
- **Aba Operações:** roteiro ordenado. Exemplo de um balcão: Projetar, Cortar, Check Corte, Dobrar, Check Dobra, Soldar, Check Solda, Polir, Check Polimento, Limpar, Check Limpeza, Embalar. Um suporte simples tem só Dobrar e Embalar.
- **Por operação da ficha:**
  - tempos: fila, preparação, espera, transporte, execução, pessimista, otimista;
  - **predecessor**, predecessor de apontamentos e predecessores PERT;
  - capacidade e meta por dia;
  - tipo: comum, crítica ou gargalo;
  - máquinas;
  - atribuição a funcionário ou equipe;
  - imagem e observações;
  - **materiais consumidos**: os componentes da estrutura, com quantidade prevista e perdas;
  - produtos gerados, terceirização, checklist e dados de sequenciamento (máquina, setup, execução).
- **Na prática:** só estão preenchidos o roteiro, os materiais consumidos e a quantidade prevista.

#### Ordem de produção (`OP_*`)

- **Campos:** identificação sequencial, produto, quantidade, unidade, ficha, datas (abertura, início, previsão de entrega e faturamento), prioridade (Estoque, Fullfilment, Pedido urgente), origem, **OP pai e OP principal** (multinível), empenho, documento e classificação.
- **Status** (amostra das últimas 100 OPs): A PRODUZIR, PRODUZINDO, CONCLUÍDO (integral ou sem produção) e ENCERRADO. Há também SUSPENSO e BLOQUEADO, que aparecem como colunas do Kanban.
- **Multinível:** com "Criar Multi-Níveis", a OP do produto gera OPs filhas para os componentes da estrutura. Na planilha a coluna vale **S para o corte** (OP de cada parte) e **N para a produção semanal, também chamada dobra** (só o produto final). Na amostra, 52 de 100 OPs tinham OP pai.
- **Importação por planilha:** o modelo vem da própria tela. As colunas citadas na reunião são identificação da ficha, SKU, quantidade, lote antecipado, empenhar e multiníveis. Falta testar se o SKU basta ou se é preciso o número da ficha (ver 4.1).

#### Ordem de serviço (OS)

A OS é criada a partir da OP: uma por operação do roteiro, numeradas `0009470.01`, `.02`… Cada OS guarda operação, fase e status: **ABERTO → EM EXECUÇÃO → EXECUTADA**. Uma OP de corte tem uma OS só (Cortar). Uma OP de produção semanal tem a sequência inteira do roteiro.

#### Kanban "Ordem de Produção por Fase Produtiva"

- **Filtros:** período (data de início), linha, exibir encerradas, mini cards, ordenação e OPs ou pedidos específicos.
- **Colunas:** `A Produzir`, as 11 fases da linha, `Suspenso`, `Concluído`, `Bloqueado` e `Encerrado`. O id de cada coluna é `<id da fase>*<slug>`.
- **Card:**
  - número da OP e status;
  - produto e quantidade;
  - data de início, previsão de faturamento e tempo previsto;
  - lista das OS com status e cor (verde: executada; verde forte: em execução; azul: aberta);
  - faixa de prazo: início atrasado, entrega atrasada ou no prazo.
- **Menu do card (três pontos):** Detalhes, Balanço, Comparativo de Materiais, Conta Corrente, Status da Execução, Ordens de Serviço, Executar OP, **Finalizar Ordem de Serviço** e Apontar Produtos Produzidos.
- **Arrastar card:** faz `POST .../ordem-producao-por-fase-produtiva/acoes` com `acao=movimentar` e os campos origem, destino e id. O servidor responde de três formas:
  - erro com texto, e o quadro desfaz o movimento;
  - card atualizado;
  - URL de um modal de apontamento, para escolher o funcionário que inicia a OS da fase de destino.
- **Regras confirmadas na reunião** (o servidor as aplica; não foram testadas, para não mexer na produção):
  1. O card só entra numa fase se a OS predecessora estiver EXECUTADA.
  2. Só funcionários cuja equipe ou operações incluem a operação podem iniciar a OS.
  3. Quem finaliza a OS tem de ser quem a iniciou (o modal só oferece o funcionário com apontamento aberto).
  4. Observações registradas numa OS acompanham a OP e aparecem para as fases seguintes.
  5. Ao finalizar, o líder pode lançar **perdas** (quantidade e motivo). O iApp registra a perda, mas o card continua mostrando a quantidade original.

#### Apontamento de tempo e expediente

- Cada OS tem início e fim por funcionário.
- O tempo de espera é o intervalo entre o fim da OS anterior e o início da próxima.
- O tempo de execução vai do início ao fim.
- Os dois contam **só horas de expediente**: seg–sex, 07:45–17:30, com pausas 12:00–13:00 e 16:00–16:15, descontados os feriados.
- Exemplo da reunião: uma OS parada da tarde de um dia até a manhã seguinte contou 3h04, e não as horas corridas.

### 1.4 Notas de UX pedidas na reunião

- Trocar as janelas novas (Balanço, Detalhes) por um balão no próprio card com operador, início, previsão de fim, quantidade prevista e produzida, e perdas.
- Botão **Finalizar** no rodapé do card, em vez do menu de três pontos.
- Card com **quantidade atual** e **perdas** ("Qtde 19 · Perda 1"). Clicar na perda mostra o motivo.
- Equipe definida na ficha do funcionário, sem tela separada de equipes, se possível.

---

## Parte 2. O que o BR Steel já tem

O levantamento completo desta branch está resumido abaixo, com os caminhos para começar.

| Tema | Estado atual | Onde |
| --- | --- | --- |
| Fonte de dados | O núcleo operacional roda em **PostgreSQL** (Supabase `mmewkphsrnttkzvpyddv`) desde 12/11/2026. O Firestore ainda guarda usuários, `appConfig`, credenciais do Bling e a fila de webhooks | `src/server/persistence/source.ts`, `supabase/operational/` |
| Demanda de produção | Tela `/producao` com a "Fila de Produção". A ordenação coincide com a regra da reunião: zerados primeiro, por quantidade vendida; depois déficit `min - saldo`; depois vendidos. Sugestões `corte = floor(média*2)` e `dobra = floor(média*1.5)` | `src/app/producao/ProducaoClient.tsx:112-163`, `src/server/persistence/postgres-production-demand.ts:77` |
| Kanban | `/producao/kanban` com colunas livres e "lotes" criados a partir de itens de pedidos de venda. Não tem fases, operações, regras de movimento, tempo nem estoque | `src/app/producao/kanban/`, `src/components/kanban/`, `src/server/operations/production.ts` |
| Ficha técnica, operações, funcionários, apontamento, perdas | **Não existem.** Os únicos papéis são os de login (Administrador, Vendedor, Operador) | `src/lib/permissions.ts`, `src/server/access/` |
| Estrutura de produto | Só o vínculo de kits de anúncio (um nível, para marketplace). A estrutura do Bling não é lida | `src/services/brsteel-product-associations.ts` |
| Bling | OAuth com refresh automático (60 s antes de expirar ou no 401). Não há trava entre instâncias na renovação | `src/server/integrations/bling.ts:17` |
| MCP | 13 ferramentas de leitura, 6 delas de produção. Escritas pelo MCP estão bloqueadas sem `MCP_WRITES_ENABLED=true` | `src/server/mcp/read-tools.ts`, `src/server/operations/common.ts:15` |
| Planilhas | `xlsx` já é dependência e é usado em exportações de vendas | `package.json`, `src/components/sales-list-page.tsx:221` |

**Consequências para o desenho:**

- As entidades novas nascem **só em PostgreSQL**, sem par no Firestore, porque o Firebase está sendo abandonado. As gravações passam por `withOperationalWrite` (`src/server/persistence/postgres-write.ts:18`), `requireOperation` e auditoria, como as de produção.
- O gerador de OP pode reaproveitar o cálculo da `/producao`. O que muda é o fator do corte: o script da família fala em 1,7 (ver 4.1).
- O "refresh token" das próximas etapas da reunião se refere ao **script local** do gerador. No app ele já existe. Se o gerador virar uma função do app ou uma ferramenta MCP, o problema some.

---

## Parte 3. Plano de migração

Abordagem: **adaptar ao estilo do BR Steel**, não copiar o iApp como está. Copiamos a lógica e os campos usados e deixamos o resto em um campo `extras jsonb`, para o MCP preencher depois. Foi o que se combinou na reunião: primeiro a curadoria, depois o MCP.

### Fase 0. Insumos e decisões (antes de codar, até 13/11)

- [ ] Receber da família Barbosa: o modelo de planilha de importação de OP do iApp, a planilha referencial com as OPs atuais e o script ou skill do gerador de OP.
- [x] Confirmar no iApp onde ficam os membros de cada equipe e a hierarquia líder → membros: organograma dentro da equipe (ver 1.3, Equipes).
- [ ] Exportar do iApp, pelo botão de Excel de cada grid e só para leitura, as operações, a linha e as fases, as equipes, os funcionários (só os campos operacionais) e as fichas com seus roteiros. Os arquivos ficam fora do Git: o repositório é público.
- [ ] Decidir o destino do Kanban de lotes atual (pergunta 4.1-a).

### Fase 1. Cadastros de engenharia

> **Estado em 12/11/2026:** implementada na branch `claude/pcp-fase1-cadastros`. Decisões tomadas na implementação:
> - Só PostgreSQL (Supabase), em schema próprio `brsteel_pcp` com tabelas relacionais. Não há par no Firestore e o PCP não passa pela chave de fonte do núcleo (`postgresOnlyRepository`). O login continua no Firestore, como no resto do app.
> - O iApp tem funcionários em mais de uma equipe (um líder chefia Dobra e Polimento). Por isso a hierarquia fica em `work_team_members` (equipe, funcionário, superior), e não num `leader_id` do funcionário. Chaves compostas garantem que superior e líder sejam membros da mesma equipe.
> - A página `/producao/engenharia` é só do Administrador.
> - O backup operacional passou a incluir `brsteel_pcp` (29 tabelas com as fichas). O roteiro de backup recusa um banco hospedado que não tenha as migrations do PCP.
> - **13/11/2026:** `20261112120000_pcp_engineering.sql` aplicada no projeto `mmewkphsrnttkzvpyddv` com `supabase db query --linked`, num workdir isolado. Conferido no hospedado: 11 tabelas com RLS, 12 chaves estrangeiras e 33 políticas, só para os papéis de gravação, leitura e backup; `anon` e `authenticated` sem acesso; o papel de backup sem `INSERT`; as 15 tabelas do núcleo intactas.
> - Carga inicial: `scripts/pcp-import-iapp.ts`. Na leitura do iApp, um membro da equipe Limpeza (ID 26557) não está na lista de funcionários e ficou fora. As predecessoras foram copiadas como estão no iApp: Check Q/Q Corte, Polir, Limpar e Embalar estão sem predecessora lá.


Telas em `/producao/engenharia/*` e operações em `src/server/operations/engineering.ts`. As tabelas novas entram na cadeia manual `supabase/operational/migrations/`, com RLS no padrão das existentes.

| Entidade | Campos mínimos | Regras |
| --- | --- | --- |
| `production_lines` + `production_phases` | nome, CMI, fases ordenadas | Fases viram colunas do Kanban |
| `production_operations` | nome, código, fase, ordem, predecessor, classificação, `extras` | O predecessor tem de ser da mesma linha; sem ciclos |
| `work_teams` | nome, status, turno, líder, operações | O líder precisa ser membro ativo |
| `workers` | nome, crachá, tipo, status, equipe, `leader_id`, operações permitidas, `user_id` opcional | Vinculado a um usuário de login quando a pessoa usa o sistema (líderes). `leader_id` reproduz o organograma do iApp. Sem dados de RH |
| `work_calendar` | expediente por dia da semana com pausas, feriados | Usado no cálculo de tempo útil |
| `loss_reasons` | descrição, ativo | Lista fechada para as perdas |

- Capacidades novas: `engenharia:read` e `engenharia:write` (Administrador), em `src/lib/mcp-capabilities.ts`.
- Carga inicial a partir dos arquivos da Fase 0, por script em `scripts/`, com destino explícito e execução autorizada.
- **Pronto quando:** as 12 operações, as 6 equipes, os funcionários e o expediente aparecem no BR Steel iguais ao iApp, e a suíte de testes cobre o predecessor e a validação do líder.

### Fase 2. Fichas técnicas

> **Estado em 13/11/2026:** implementada na branch `claude/pcp-fase1-cadastros` (migration `20261113120000_pcp_product_sheets.sql`, aba "Fichas técnicas" em `/producao/engenharia`).
> - O roteiro é guardado por passo (`product_sheet_steps`), com predecessora dentro da própria ficha (chave composta) e minutos previstos. Os componentes (`product_sheet_components`) podem apontar para o passo em que entram.
> - Uma operação usada em alguma ficha não pode ser apagada.
> - **13/11/2026:** aplicada no projeto `mmewkphsrnttkzvpyddv` com `supabase db query --linked`. Conferido: 14 tabelas com RLS em `brsteel_pcp`, 18 chaves estrangeiras, 42 políticas; `anon` sem acesso.
> - **Carga dos dados reais em 13/11/2026** no projeto `mmewkphsrnttkzvpyddv`, aplicada pelo SQL gerado com `--emit-sql` e pelo `supabase db query --linked`. Resultado conferido no banco:
>   - 11 fases e 11 operações (6 com predecessora);
>   - 23 funcionários, 6 equipes e 20 vínculos de organograma;
>   - 15 intervalos de expediente;
>   - 383 fichas (374 SKUs), 1.286 passos e 736 componentes, todos ligados a um passo. 409 componentes têm ficha própria: são as partes cortadas, usadas nas OPs de corte com multinível "S".
>   - Reaplicar a carga não duplica nada.
> - **O que ficou de fora da carga, e por quê:**
>   - a operação Projetar, que não tem fase na linha; ela aparecia em 2 fichas;
>   - a ficha `00000083`, sem produto vinculado no iApp;
>   - 3 fichas sem roteiro (`00000160`, `00000161` e `00000253`), duplicatas de SKUs que têm outra ficha completa;
>   - o membro 26557 da equipe Limpeza, que não está na lista de funcionários.
> - **Predecessoras:** só 46 dos 1.286 passos têm predecessora definida no iApp. Nos demais, a ordem do roteiro é a referência.
> - **SKUs com mais de uma ficha:** alguns SKUs têm até 3 fichas. O gerador de OP precisa escolher uma (Fase 3).
> - **Correção na extração:** nas linhas de matéria-prima (sem o botão "Gerar Nova Ficha"), a leitura pegava a unidade (UN, KG) no lugar do SKU em 279 componentes. Corrigi antes da carga final. O formato da linha é "DESCRIÇÃO SKU 01 - Matéria Prima % UN".
> - A carga do iApp (`scripts/pcp-import-iapp.ts`) aceita `sheets` na mesma exportação e gera um SQL único e idempotente, que pode ser aplicado pelo `supabase db query --linked` sem a senha do banco.


| Entidade | Campos mínimos |
| --- | --- |
| `product_sheets` | SKU (Bling), **código da ficha no iApp**, nome, status, quantidade base, linha, `extras` |
| `product_sheet_steps` | ficha, operação, ordem, predecessor, tempo previsto, observações |
| `product_sheet_components` | ficha, passo (opcional), SKU do componente, quantidade |

- O código da ficha no iApp resolve a dúvida de importar por SKU ou pela ficha (4.1-b).
- Tela de consulta com o roteiro em linha (como os cards do iApp) e edição simples. Edição em massa fica para o MCP.
- **Pronto quando:** as 387 fichas foram importadas, e para um SKU o sistema devolve o roteiro (por exemplo, Dobrar → Embalar no suporte) e os componentes.

### Fase 3. Gerador de OP e planilha do iApp (paralelo com o iApp)

> **Estado em 13/11/2026:** implementada na branch `claude/pcp-fase1-cadastros`: migration `20261113130000_pcp_production_orders.sql`, tela `/producao/ops` e API `/api/operations/production-orders`.
> - **Modelo da planilha:** o iApp fornece o modelo em `/importador/download?planilha=op`, com as colunas IDENTIFICAÇÃO DA FICHA, QUANTIDADE, LOTE ANTECIPADO, MULTI-NÍVEIS e EMPENHAR. Não há coluna de SKU, então a importação usa o código da ficha. Isso resolve a pergunta 4.1-b.
> - **Fila:** a mesma da `/producao`, calculada sobre a demanda já gravada no PostgreSQL (vendas faturadas, saldo e limites). Só entram SKUs com ficha técnica com roteiro, o que substitui a lista JSON de inox do script.
> - **Quantidade sugerida:** a média semanal × fator (1,5 na semanal e 2 no corte, os mesmos da tela atual), sem ficar abaixo do que falta para o mínimo. O fator é parâmetro da geração e fica gravado no lote; a pergunta 4.1-d (1,7 ou 2) continua aberta. A quantidade é editável antes de confirmar.
> - **Ficha por SKU:** quando há mais de uma ficha, vale a de roteiro mais completo.
> - **OS:** cada OP nasce com uma ordem de serviço por passo da ficha. Sem predecessora definida na ficha, vale o passo anterior.
> - **Corte:** gera a OP do produto e OPs filhas das partes com ficha própria (quantidade da parte × quantidade da OP ÷ quantidade base). A planilha do iApp leva só a OP mãe, com multinível "S", para o iApp gerar as partes.
> - **13/11/2026:** migration aplicada no projeto `mmewkphsrnttkzvpyddv` com `supabase db query --linked`. Conferido: 17 tabelas com RLS em `brsteel_pcp`, 24 chaves estrangeiras, 51 políticas, `anon` sem acesso e o papel de gravação com uso da sequência de numeração das OPs.
> - **Pendente:** a ferramenta MCP de geração (escrita pelo MCP continua desligada sem `MCP_WRITES_ENABLED`) e o teste de subir uma OP real no iApp com a planilha gerada.


- **Entrada:** a Fila de Produção da `/producao`, com os mesmos critérios: status do SKU, saldo, mínimo, vendidos e zerados. Usa só pedidos com NF e exclui os cancelados.
- **Saída:** duas sequências numeradas, uma para a **produção semanal (dobra)** e outra para o **corte**, com a quantidade sugerida editável antes de confirmar.
- **Gravação:**
  - `production_orders` com número sequencial, SKU, ficha, quantidade, tipo (corte ou semanal), prioridade, datas, status A PRODUZIR, OP pai e origem;
  - `production_order_steps`, que são as OS, geradas do roteiro da ficha: a OP de corte gera só a OS de corte; a semanal gera o roteiro inteiro.
- **Exportação:** um `.xlsx` no modelo do iApp, com multiníveis `N` na semanal e `S` no corte e o código da ficha.
- **MCP:** ferramenta `gerar_ops_producao`, com prévia e confirmação, atrás de `MCP_WRITES_ENABLED`. Assim o Claude atualiza o BR Steel e entrega a planilha do iApp de uma vez, como se combinou.
- **Teste combinado:** subir **uma** OP no iApp com a planilha gerada e conferir se a regra bate, sem afetar o dia a dia.
- **Pronto quando:** a sequência gerada bate com a planilha referencial, e a OP de teste entra no iApp sem erro.

### Fase 4. Kanban por fase com OS, líderes e perdas

> **Estado em 13/11/2026:** implementada na branch `claude/pcp-fase1-cadastros`: migration `20261113140000_pcp_kanban.sql`, tela `/producao/quadro` ("Kanban de OPs") e API `/api/operations/production-kanban`.
> - **Pergunta 4.1-a:** o quadro novo convive com o Kanban de lotes (renomeado no menu para "Kanban de lotes") até ser validado na fábrica. Nada do quadro antigo mudou.
> - **Quem age:** o funcionário vinculado ao usuário de login (`workers.user_id`, escolhido na ficha do funcionário). O Administrador age como gestão. Um Operador sem vínculo só vê o quadro.
> - **Regras no servidor** (`src/lib/pcp/kanban-rules.ts`, com testes):
>   - o card só passa para a fase da próxima OS pendente, e só depois que a OS da fase atual terminou;
>   - quem passa adiante é o líder de uma equipe que tem a operação da fase de origem;
>   - iniciar exige a permissão da operação: o membro inicia em nome próprio, e o líder em nome de qualquer membro da equipe;
>   - só quem iniciou finaliza, ou o líder dele;
>   - a perda pede motivo e reduz a quantidade atual do card;
>   - as observações ficam na OS;
>   - todo movimento grava quem fez, de onde e para onde (`production_order_events`).
> - **13/11/2026:** migration aplicada no projeto `mmewkphsrnttkzvpyddv` com `supabase db query --linked`. Conferido: 19 tabelas com RLS em `brsteel_pcp`, 32 chaves estrangeiras, 57 políticas, `anon` sem acesso, e as colunas de execução nas OS.
> - **Configuração necessária antes do uso real:** no iApp, nenhuma equipe tem as operações de Check Q/Q, e os checks são executados pelo funcionário genérico "Padrão check". Para valer a regra da reunião (o líder da fase confere e passa o card), cada equipe precisa receber o check da sua fase em Engenharia → Equipes, e o líder precisa da permissão dessa operação. Sem isso, só o Administrador passa o card a partir das colunas de check.
> - **13/11/2026, configuração aplicada em produção:**
>   - cada equipe recebeu o check da sua fase: Corte, Dobra, Solda, Polimento e Limpeza. Embalagem fica sem check, porque não há check depois de Embalar;
>   - o líder de cada uma recebeu a permissão desse check. O líder da Dobra também lidera o Polimento e ficou com os dois.
>   - Registro na auditoria: `pcp.configureTeamChecks`.
>   - **Atenção:** a carga do iApp (`scripts/pcp-import-iapp.ts`) regrava as operações de equipes e funcionários com o que vem do iApp. Rodá-la de novo desfaz essa configuração, que então precisa ser refeita.
> - **Falta para o uso real:** vincular cada líder ao seu usuário de login, em Engenharia → Funcionários. Os líderes também precisam ter login no BR Steel.
> - **Fora desta fase:** arrastar e soltar (o card se move por botão, sempre para a próxima fase válida), coluna Suspenso e tempos em horas de expediente (Fase 5).


Evolui `/producao/kanban` para o quadro de OPs. Reaproveita o dnd-kit e os componentes que já existem.

- **Colunas:** A Produzir, as fases da linha, Concluído e Suspenso.
- **Card:** OP, produto, quantidade atual, perdas, prazo e lista de OS com status. Botão **Iniciar/Finalizar** e balão de detalhes no lugar de janelas.
- **Regras, todas no servidor e com teste cada uma:**
  1. Mover para uma fase só se a OS predecessora estiver EXECUTADA.
  2. Iniciar a OS da fase exige um funcionário com a operação permitida. O líder escolhe qualquer membro da equipe; o membro escolhe só a si mesmo.
  3. Finalizar exige o mesmo funcionário que iniciou.
  4. Mover entre fases é exclusivo do líder da equipe da fase de origem. A coluna Check Q/Q é a conferência de quantidade e qualidade.
  5. Na finalização, o líder pode lançar perdas (quantidade e motivo), e a quantidade atual da OP diminui.
  6. Observações por OS, visíveis nas fases seguintes.
  7. Todo movimento grava quem, quando, origem e destino, para saber quem moveu o card.
- **Pronto quando:** uma OP percorre Dobra → Check Dobra → Embalagem em teste, com as recusas esperadas para cada regra.

### Fase 5. Apontamento de tempo, balanço e estoque

> **Estado em 13/11/2026:** tempos e balanço implementados na branch `claude/pcp-fase1-cadastros`, sem migration nova.
> - **Cálculo:** `src/lib/pcp/business-time.ts` conta só os minutos dentro do expediente cadastrado e fora dos feriados, no fuso da fábrica (America/Sao_Paulo, com o deslocamento de cada dia vindo do Intl). O exemplo da reunião é teste: uma OS das 10:19 às 15:38 dá 4h19, sem o almoço.
> - **Tempos de cada OS no quadro:**
>   - espera: do fim da OS anterior até o início desta, ou até agora se ainda não começou;
>   - execução: do início ao fim, ou até agora se está em andamento.
> - **No card:** a OS em andamento mostra há quanto tempo útil está rodando. Os detalhes mostram espera e execução por OS e um balanço (previsto, atual, perdas, tempo útil total).
> - **Pendente (4.1-c):** o lançamento de estoque no Bling quando a OP é concluída. Ainda falta decidir quem lança a produção no Bling depois que o iApp sair.


- **Tempos por OS:**
  - espera: do fim da OS anterior ao início desta;
  - execução: do início ao fim;
  - ambos em horas de expediente, por uma função pura `businessDuration(start, end, calendar)` coberta por testes. O caso da reunião (17:30 de um dia → 3h04) entra como teste.
- **Balanço resumido no balão do card:** quantidade prevista, produzida e perdida; tempos por fase.
- **Estoque:** definir se a conclusão da OP lança produção no Bling, como o iApp faz hoje. Hoje nenhum código do BR Steel grava estoque no Bling (4.1-c).

### Fase 6. Desligar o iApp

Começa depois de um ciclo semanal inteiro rodando só no BR Steel: OPs geradas, Kanban operado pelos líderes, perdas e tempos registrados. Antes de cancelar a assinatura, exportar o histórico de OPs do iApp.

---

## Parte 4. Pendências

### 4.1 Perguntas em aberto

- **a. Kanban atual.** O quadro de lotes ligado a pedidos de venda vira o quadro de OPs, ou os dois convivem? Recomendação: transformar o atual. Os lotes de hoje são produção por pedido, e a operação descrita na reunião é produção para estoque.
- **b. Importar pelo SKU ou pela ficha.** Falta testar se o iApp acha a ficha pelo SKU na planilha. Guardar o código da ficha do iApp na Fase 2 resolve os dois casos.
- **c. Estoque.** Quem lança a produção concluída no Bling depois que o iApp sair?
- **d. Fator do corte.** O BR Steel usa `média × 2` e o script fala em 1,7. Qual vale?
- **e. Membros das equipes.** Resolvida: organograma por equipe no iApp, copiado como `leader_id`.
- **f. Filtro de inox.** A API do Bling não expõe as tags. O script filtra os produtos de inox por uma lista em JSON. O BR Steel precisa da mesma lista, ou de um campo no cadastro.

### 4.2 Matriz de migração

| # | Função | Complexidade | Depende de | Estado |
| --- | --- | --- | --- | --- |
| 1 | Linha, fases e operações com predecessor | Baixa | Exportação do iApp | A fazer |
| 2 | Equipes, líderes e funcionários operacionais | Média | Exportação do iApp | A fazer |
| 3 | Expediente e feriados | Baixa | — | A fazer |
| 4 | Fichas técnicas (roteiro e componentes) | Média | 1 | A fazer |
| 5 | Gerador de OP (corte e semanal) | Média | 4, 4.1-d, 4.1-f | A fazer |
| 6 | Planilha de importação do iApp | Baixa | 5, modelo da planilha | A fazer |
| 7 | Ferramenta MCP de geração de OP | Média | 5 | A fazer |
| 8 | OP/OS e Kanban por fase com regras | Alta | 1, 2, 4, 5, 4.1-a | A fazer |
| 9 | Perdas com motivo | Baixa | 8 | A fazer |
| 10 | Apontamento de tempo em expediente | Média | 3, 8 | A fazer |
| 11 | Balanço no card | Baixa | 9, 10 | A fazer |
| 12 | Lançamento de produção no Bling | Média | 4.1-c | A decidir |

### 4.3 Validação

Em cada fase, rodar:

- `npm run lint`
- `npm run typecheck:ci`
- `npm run test:vitest`
- `npm run test:postgres`

Migrations operacionais só no executor local até haver autorização para o projeto hospedado.
