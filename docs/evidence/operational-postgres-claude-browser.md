# Leitura PostgreSQL pelo Claude no Chrome — 12/09/2026

**Resultado: aprovado e encerrado.** Na sessão já autenticada do usuário no Chrome, o Claude executou Meu acesso, Resumo de vendas, Estoque de produtos e Demanda de produção pelo conector BR Stell. Os retornos originais das três ferramentas de negócio informaram `source: postgres`, o mesmo hash e a data da cópia. A auditoria do servidor registrou sucesso nas quatro chamadas. [Evidência estruturada](operational-postgres-claude-browser.json).

O conector existente aponta para `https://br-steel-mcp-staging.vercel.app/api/mcp`. Antes da preparação, esse endereço servia a versão antiga com dados próprios de homologação. O teste ativou a cópia PostgreSQL para exatamente a conta de piloto já autorizada, sem modificar seu perfil, consentimento OAuth ou permissões permanentes no Claude. Cada chamada recebeu somente “Permitir uma vez”.

## Consultas e conferência

| Ferramenta | Escopo | Resultado | Duração registrada no servidor |
| --- | --- | --- | ---: |
| Meu acesso | Identidade vigente | Administrador, quatro capacidades de leitura, origem Firestore | 925 ms |
| Resumo de vendas | 01/09 a 12/09/2026 | Totais de pedidos, receita e clientes conferidos com SQL | 4.367 ms |
| Estoque de produtos | Primeira página, limite 5 | Cinco registros; cursor seguinte `5` | 1.445 ms |
| Demanda de produção | Mesmo período, limite 5 | Cinco registros; cursor seguinte `5` | 4.144 ms |

As durações vêm da auditoria do backend; não incluem o tempo de resposta do modelo, a espera pela aprovação ou toda a latência do navegador. Não houve medição nova de egress faturado ou concorrência. A continuação das páginas não foi executada neste teste; ela foi coberta pelo [ensaio anterior com SDK](operational-postgres-endpoint-pilot.md).

Os payloads originais foram abertos na interface do Claude. A produção não expôs campos financeiros ou clientes. Saldos ausentes permaneceram nulos, e o modelo distinguiu esses casos de saldo zero. Os totais comerciais e payloads completos não foram incluídos nesta evidência de repositório.

A cópia foi capturada às **14:41:15 BRT** de 12/09/2026, no projeto `mlumbvxpaqfzpdjnvzxc`, a partir de `marketflow-9h4tg`. O Claude preservou o aviso de cópia e as datas individuais dos saldos, algumas meses anteriores à captura. Esse achado exige tratar atualização/cobertura dos dados antes do uso operacional; a migração não torna uma observação antiga atual. Nenhuma escrita ou consulta a outros conectores foi executada.

## Publicação e encerramento

Foi reconstruído o candidato já verificado `dpl_GpYYyAWxWYW7NKun2roNMZt2AxTz`, sem novo upload de fontes. O novo deployment `dpl_5J8Es9WDfVh56ZjW38KgZJsvH5t8` foi promovido apenas no projeto de homologação, com seis variáveis temporárias. O acesso PostgreSQL usou o papel restrito de leitura, TLS verificado e expiração em duas horas.

Ao final, as seis variáveis foram removidas e o ambiente foi comparado com a captura anterior, desconsiderando apenas o token efêmero gerado pela CLI. A homologação voltou a `dpl_3K3Xt92mbCFYSdNUsiPBRswE5kqk`. O leitor ficou sem login, senha, associação de papéis ou sessões; importador e papel de backup também permaneceram fechados. A produção foi conferida no mesmo deployment `dpl_5j2BBDFg73UAnkiYywsEEL3UxTuj`. As credenciais temporárias locais foram removidas após a verificação.

## Limites e continuação

Esta prova valida **chamadas reais por uma conexão OAuth já existente no Claude**. Não valida uma nova navegação interativa de login/consentimento: o provedor compartilhado e seu redirecionamento ainda precisam ser conferidos nesse fluxo, conforme o limite registrado no ensaio anterior.

O piloto foi encerrado; novas consultas pelo conector de homologação voltam à base de homologação, sem a cópia PostgreSQL habilitada. A aplicação e o MCP de produção continuam no Firestore. Próximas etapas: validar reconexão interativa, observar consumo em uso controlado e fechar a atualização dos dados e o backup externo antes de ampliar o piloto. Gravações e troca da fonte oficial pertencem às etapas posteriores do plano.
