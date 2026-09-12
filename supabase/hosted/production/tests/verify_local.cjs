const { PGlite } = require(process.env.BRSTEEL_PGLITE_MODULE || '@electric-sql/pglite');
const fs = require('fs');
(async () => {
 const db = new PGlite();
 const root=require('path').resolve(__dirname, '../..') + '/';
 await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role; CREATE ROLE supabase_auth_admin;');
 await db.exec(fs.readFileSync(root+'migrations/20260911214830_mcp_staging_oauth_audience.sql','utf8'));
 const inventory = "SELECT p.proowner, p.proacl::text, n.nspowner, n.nspacl::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE p.oid='private.mcp_access_token_hook(jsonb)'::regprocedure";
 const before=JSON.stringify((await db.query(inventory)).rows);
 await db.exec(fs.readFileSync(root+'production/migrations/20260912003415_mcp_production_oauth_audience.sql','utf8'));
 await db.exec(fs.readFileSync(root+'production/tests/mcp_access_token_hook_cli.sql','utf8'));
 if (JSON.stringify((await db.query(inventory)).rows)!==before) throw Error('ACL or owner changed');
 await db.exec('SET ROLE supabase_auth_admin');
 await db.exec(fs.readFileSync(root+'production/tests/mcp_access_token_hook_cli.sql','utf8'));
 await db.exec('RESET ROLE');
 console.log('PASS: in-memory PGlite migration, CLI assertions as owner and Auth admin, exact owner/ACL preservation');
 await db.exec(fs.readFileSync(root+'production/rollback_to_staging.sql','utf8'));
 await db.exec(fs.readFileSync(root+'tests/mcp_access_token_hook_cli.sql','utf8'));
 if (JSON.stringify((await db.query(inventory)).rows)!==before) throw Error('Rollback changed ACL or owner');
 console.log('PASS: staging rollback and historical assertions');
 // Idempotence and fail-closed precondition under an accidental new consumer.
 await db.exec(fs.readFileSync(root+'production/migrations/20260912003415_mcp_production_oauth_audience.sql','utf8'));
 await db.exec(fs.readFileSync(root+'production/migrations/20260912003415_mcp_production_oauth_audience.sql','utf8'));
 await db.exec('GRANT EXECUTE ON FUNCTION private.mcp_access_token_hook(jsonb) TO anon');
 let rejected=false;
 try { await db.exec(fs.readFileSync(root+'production/migrations/20260912003415_mcp_production_oauth_audience.sql','utf8')); }
 catch (error) { rejected=true; }
 if (!rejected) throw Error('Unsafe ACL was accepted');
 console.log('PASS: repeat application and unsafe ACL rejection');
 await db.close();
})().catch(e=>{console.error(e);process.exitCode=1});
