# Atualização da verificação do hook hospedado

- Novo `tests/mcp_access_token_hook_cli.sql`: um único `DO` com os mesmos blocos de asserções de ACL e audience do teste direto, executados como o chamador atual. Não troca papel, não concede permissões e não contém comandos de transação adicionais.
- `tests/mcp_access_token_hook.sql` foi preservado byte a byte para conexões já autorizadas a assumir `supabase_auth_admin`.
- README diferencia prova por catálogo, chamada pelo proprietário e invocação real do Auth. A última depende de emitir tokens reais após ativar o hook; nenhum grant deve ser adicionado para contornar a restrição da CLI.
- Recuperação agora exige o snapshot anterior do proprietário/ACL de `private` e uma nova captura antes de reverter, para restaurar só as alterações desta migration e preservar mudanças posteriores legítimas.

Informado pela tarefa principal: inventário remoto executado e migration aplicada atomicamente. Inventário anterior sem `private` nem tabelas/funções da aplicação. A tentativa com `SET LOCAL ROLE supabase_auth_admin` falhou por permissão; verificação completa nesse papel não comprovada.

Verificado nesta atualização: análise SQL/PL/pgSQL dos quatro arquivos; o arquivo CLI contém uma instrução SQL e um bloco PL/pgSQL. Os corpos de asserções correspondem exatamente aos dois blocos do teste direto. Execução remota do novo teste e emissão real de tokens não realizadas por este preparador.

Verificação remota pela tarefa principal: `tests/mcp_access_token_hook_cli.sql` executado com sucesso (zero exceções); advisors de segurança sem avisos. Hook `private.mcp_access_token_hook` habilitado no Auth e seleção conferida após recarregar o dashboard. Invocação real e claims emitidos ainda aguardam a prova HTTPS.

Prova HTTPS pela tarefa principal concluída: emissão comum/código/refresh/reconexão e assinatura ES256 verificados pelo JWKS do projeto; audiences authenticated/recurso MCP, client_id e validade de 900 segundos corretos. A prova do SDK terminou passed e removeu seus registros. Ver docs/evidence/mcp-staging-https-2026-09-11.json. Isso comprova a emissão pelo Auth com o hook habilitado, sem trocar o papel da CLI. Claude hospedado continua não verificado.
