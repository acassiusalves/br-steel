/**
 * Ensaio do corte de fonte: bloqueia o núcleo, reconcilia, compara e devolve produção.
 *
 *   BRSTEEL_CUTOVER_SOURCE_PROJECT=... BRSTEEL_CUTOVER_DATABASE_URL=... \
 *   BRSTEEL_CUTOVER_CA_FILE=... npm run cutover:rehearse -- --confirm
 *
 * **Grava `appConfig/coreWriteMode` no Firestore da origem.** Entre `BLOCKED` e `RESTAURADO`, toda
 * escrita do núcleo responde 503 e o dreno de webhooks fica suspenso. Leituras seguem normais e as
 * entregas continuam sendo enfileiradas: nada se perde, tudo chega atrasado.
 *
 * Vive separado de `operational-cutover.ts` de propósito. Aquele CLI não decide nada — recusa
 * reconciliar fora do modo `blocked` e deixa a decisão para quem o chama. Este decide: é ele que
 * abre e fecha a janela. Misturar os dois apagaria essa distinção.
 *
 * Duas propriedades que existem por experiência, não por gosto:
 *
 * **Preflight antes de qualquer escrita.** Conecta, confere identidade, prontidão da cópia e o
 * registro de manutenção. Uma falha aqui aborta com impacto zero. No ensaio de 16/09/2026 duas
 * execuções quebraram antes de tocar produção por acaso, não por desenho; se tivessem quebrado um
 * passo depois, produção teria ficado bloqueada esperando alguém perceber.
 *
 * **Restauração garantida.** O `finally` cobre erro, divergência e Ctrl-C. Não cobre `SIGKILL`: se
 * isso acontecer, apague `appConfig/coreWriteMode` para destravar.
 */
import { getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { reconcileFromFirestore, compareSources } from '../src/server/migration/operational-reconcile';
import { resetCoreWriteModeCache } from '../src/server/operations/maintenance';
import { createCutoverPool } from './lib/cutover-pool';

const log = (m: string) => console.log(`${new Date().toISOString()}  ${m}`);
const espera = (s: number) => new Promise(r => setTimeout(r, s * 1000));

async function main() {
  if (!process.argv.includes('--confirm')) {
    console.error('Este comando bloqueia as escritas do núcleo na origem. Repita com --confirm.');
    process.exit(1);
  }
  const connectionString = process.env.BRSTEEL_CUTOVER_DATABASE_URL;
  const sourceProject = process.env.BRSTEEL_CUTOVER_SOURCE_PROJECT;
  if (!connectionString || !sourceProject) {
    console.error('Defina BRSTEEL_CUTOVER_DATABASE_URL e BRSTEEL_CUTOVER_SOURCE_PROJECT.'
      + ' Para o destino hospedado, defina também BRSTEEL_CUTOVER_CA_FILE.');
    process.exit(1);
  }

  if (!getApps().length) initializeApp({ projectId: sourceProject });
  const db = getFirestore();
  const modeRef = db.collection('appConfig').doc('coreWriteMode');
  const pool = createCutoverPool(connectionString);

  try {
    log('=== PREFLIGHT (nenhuma escrita na origem) ===');

    if ((await modeRef.get()).exists) {
      log('ABORTADO: appConfig/coreWriteMode já existe — uma execução anterior pode ter deixado a origem travada.');
      return;
    }
    log('  ok  coreWriteMode ausente — origem aceitando escritas');

    const id = (await pool.query(`select current_user actor, session_user login,
      (select rolsuper from pg_roles where rolname = current_user) superuser`)).rows[0];
    if (id.actor !== id.login || id.superuser) {
      log(`ABORTADO: identidade inesperada no destino (${id.actor}/${id.login}, superuser=${id.superuser})`);
      return;
    }
    log(`  ok  identidade ${id.actor}, superuser=false`);

    const copia = (await pool.query('select ready, captured_at, source_project from brsteel_import.state')).rows[0];
    if (!copia?.ready) { log('ABORTADO: a cópia não está pronta (ready=false)'); return; }
    if (copia.source_project !== sourceProject) {
      log(`ABORTADO: cópia é de ${copia.source_project}, não de ${sourceProject}`); return;
    }
    log(`  ok  cópia pronta, origem ${copia.source_project}, capturada ${copia.captured_at.toISOString()}`);
    log('PREFLIGHT APROVADO — a partir daqui a origem é afetada');
  } catch (error) {
    // Nunca imprimir o erro cru: pode carregar consulta, payload ou credencial.
    log('PREFLIGHT FALHOU: ' + (error instanceof Error ? error.message : 'falha desconhecida'));
    log('Nada foi escrito na origem.');
    await pool.end().catch(() => undefined);
    process.exitCode = 1;
    return;
  }

  const restaurar = async () => {
    try {
      await modeRef.delete();
      resetCoreWriteModeCache();
      log('RESTAURADO: coreWriteMode removido — a origem aceita escritas de novo');
    } catch (error) {
      log('FALHA AO RESTAURAR: ' + (error instanceof Error ? error.message : 'falha desconhecida')
        + ' — apague appConfig/coreWriteMode à mão');
    }
  };
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => { log('sinal ' + sig); void restaurar().then(() => process.exit(1)); });
  }

  try {
    log('');
    log(`=== ENSAIO (origem=${sourceProject}) ===`);
    await modeRef.set({ mode: 'draining', updatedAt: new Date().toISOString() });
    resetCoreWriteModeCache();
    log('1/6 draining — aguardando chamadas em trânsito (20s)');
    await espera(20);

    await modeRef.set({ mode: 'blocked', updatedAt: new Date().toISOString() });
    resetCoreWriteModeCache();
    log('2/6 BLOCKED — escritas do núcleo recusadas a partir de agora');
    await espera(10);

    log('3/6 reconcile — exportando origem e aplicando o delta...');
    const inicio = Date.now();
    const resultado = await reconcileFromFirestore(pool, db, sourceProject);
    const segundos = Math.round((Date.now() - inicio) / 1000);
    // A repetição de um snapshot já aplicado não devolve contagem de itens: é no-op, não uma carga.
    log('    reconcile: ' + ('items' in resultado
      ? `${resultado.records} registros, ${resultado.items} itens, hash ${resultado.hash.slice(0, 12)}`
      : `no-op, snapshot ${resultado.hash.slice(0, 12)} já aplicado`) + ` (${segundos}s)`);

    log('4/6 compare — exigindo divergência zero...');
    const { divergences, counts } = await compareSources(pool, db, sourceProject);
    for (const [colecao, linha] of Object.entries(counts)) {
      log(`    ${colecao.padEnd(20)} origem ${linha.source} | cópia ${linha.copy} | nativas ${linha.native}`);
    }

    if (divergences.length) {
      log(`5/6 ${divergences.length} DIVERGÊNCIA(S) — NÃO trocar a fonte:`);
      for (const item of divergences.slice(0, 20)) log(`      ${item.collection}/${item.id}: ${item.kind}`);
      if (divergences.length > 20) log(`      ... e mais ${divergences.length - 20}`);
      process.exitCode = 1;
    } else {
      log('5/6 DIVERGÊNCIA ZERO — a cópia reproduz a origem no instante do bloqueio');
      log('    A troca da fonte é passo MANUAL, no Firestore do ambiente sob ensaio:');
      log('    appConfig/operationalSource = { source: "postgres" }');
      log('    Um ambiente sem BRSTEEL_OPERATIONAL_DATABASE_URL responderia 503 no núcleo inteiro.');
    }
    log('6/6 encerrando e devolvendo a origem');
  } catch (error) {
    log('ERRO: ' + (error instanceof Error ? error.message : 'falha desconhecida'));
    process.exitCode = 1;
  } finally {
    await restaurar();
    await pool.end().catch(() => undefined);
    log('=== FIM ===');
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'Falha no ensaio do corte.');
  process.exit(1);
});
