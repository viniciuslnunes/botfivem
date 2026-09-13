// Integração do repositório de rifas (escrito na sessão paralela que implementou a Fase 6) contra Postgres real (PGlite, WASM).
// Conexão única: transações serializadas — valida SQL e lógica, não trava de linha concorrente.
const path = require('path');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');

const REPO = path.join(__dirname, '..');
const pglite = new PGlite();
const parsers = { 20: v => v, 1700: v => v }; // int8 e numeric como texto, igual ao driver pg

let fila = Promise.resolve();
function exclusivo(fn) {
  const p = fila.then(fn);
  fila = p.catch(() => {});
  return p;
}
const consultar = (text, params) => pglite.query(text, params ?? [], { parsers })
  .then(r => ({ rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }));
const pool = {
  query: (t, p) => exclusivo(() => consultar(t, p)),
  connect: () => new Promise(entregar => {
    exclusivo(() => new Promise(liberar => entregar({ query: consultar, release: liberar })));
  }),
};
const dbPath = require.resolve(path.join(REPO, 'utils/db.js'));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: pool };
process.env.DATABASE_URL = 'postgres://x';

// Trava de segurança: sem isso, se a interceptação acima falhar por qualquer motivo
// (path resolvido diferente, módulo já carregado antes), o resto do script escreve
// direto no Postgres real do .env — foi exatamente isso que aconteceu em 2026-09-13
// e sujou produção (rifas, financeiro etc. com dados de teste). Aborta ANTES de
// qualquer escrita se `require('utils/db')` não devolver o pool falso.
if (require(path.join(REPO, 'utils/db.js')) !== pool) {
  throw new Error('[integracao] Interceptação de utils/db.js falhou — abortando para não escrever no banco real.');
}

const { executarMigracoes } = require(path.join(REPO, 'utils/migracoes'));
const repo = require(path.join(REPO, 'utils/rifas/repositorio'));
const R = require(path.join(REPO, 'utils/rifas/regras'));

const vencer = compraId => pool.query(
  "UPDATE rifa_compras SET expira_em = now() - interval '1 minute' WHERE id = $1", [compraId])
  .then(() => pool.query("UPDATE rifa_bilhetes SET expira_em = now() - interval '1 minute' WHERE compra_id = $1", [compraId]));
const bilhete = async (rifaId, numero) => (await pool.query('SELECT * FROM rifa_bilhetes WHERE rifa_id = $1 AND numero = $2', [rifaId, numero])).rows[0];
const compraDb = async id => (await pool.query('SELECT * FROM rifa_compras WHERE id = $1', [id])).rows[0];
const lancamentos = async (origem, origemId) => (await pool.query(
  'SELECT * FROM financeiro_lancamentos WHERE origem = $1 AND origem_id = $2', [origem, String(origemId)])).rows;

function novaRifa(extra = {}) {
  const c = R.gerarCompromisso();
  return repo.criarRifa({
    titulo: 'Rifa teste', descricao: null, premio: 'Camisa', custoPremio: null, imagemRef: null, preco: 100,
    totalNumeros: 20, limitePorPessoa: 5, metodoSorteio: 'SISTEMA', regraNaoVendido: 'PROXIMO_VENDIDO',
    compromissoHash: c.hash, semente: c.semente, encerraEm: null, canalId: '1', criadoPorId: 'gestor', ...extra,
  });
}

const passos = [];
const passo = (nome, fn) => passos.push([nome, fn]);

(async () => {
  const erroOriginal = console.error;
  const falhasMigracao = [];
  console.error = (...a) => falhasMigracao.push(a.join(' '));
  await executarMigracoes();
  console.error = erroOriginal;
  const falhasRifa = falhasMigracao.filter(f => /rifa/i.test(f));
  console.log(`migrações: ${falhasMigracao.length} falha(s) fora do escopo (ex.: tabela socios inexistente); de rifa: ${falhasRifa.length}`);
  assert.deepEqual(falhasRifa, []);

  const rifa = await novaRifa();
  let compraA;

  passo('reserva escolhida grava compra PENDENTE com total e prazo', async () => {
    const r = await repo.reservar({ rifaId: rifa.id, discordId: 'A', numeros: [1, 2, 3] });
    assert.equal(r.erro, undefined);
    compraA = r.compra;
    assert.equal(r.compra.status, 'PENDENTE');
    assert.equal(r.compra.total, '300.00');
    assert.deepEqual(r.numeros, [1, 2, 3]);
    assert.equal((await bilhete(rifa.id, 2)).status, 'RESERVADO');
  });

  passo('número ocupado recusa a compra inteira, sem reservar nada', async () => {
    const r = await repo.reservar({ rifaId: rifa.id, discordId: 'B', numeros: [3, 4] });
    assert.equal(r.erro, 'indisponiveis');
    assert.deepEqual(r.numeros, [3]);
    assert.equal(await bilhete(rifa.id, 4), undefined);
    assert.equal((await pool.query("SELECT COUNT(*)::int n FROM rifa_compras WHERE discord_id = 'B'")).rows[0].n, 0);
  });

  passo('limite por pessoa conta pago + reserva viva', async () => {
    const r = await repo.reservar({ rifaId: rifa.id, discordId: 'A', numeros: [4, 5, 6] });
    assert.equal(r.erro, 'limite');
    assert.equal(r.saldo, 2);
  });

  passo('dois compradores no mesmo número: só um leva', async () => {
    const [b, c] = await Promise.all([
      repo.reservar({ rifaId: rifa.id, discordId: 'B', numeros: [7] }),
      repo.reservar({ rifaId: rifa.id, discordId: 'C', numeros: [7] }),
    ]);
    assert.equal([b, c].filter(x => !x.erro).length, 1);
    assert.equal([b, c].filter(x => x.erro === 'indisponiveis').length, 1);
  });

  passo('reserva vencida é retomada; compra antiga vira EXPIRADA e solta o resto', async () => {
    await vencer(compraA.id);
    const r = await repo.reservar({ rifaId: rifa.id, discordId: 'B', numeros: [2] });
    assert.equal(r.erro, undefined);
    assert.equal((await compraDb(compraA.id)).status, 'EXPIRADA');
    assert.equal((await bilhete(rifa.id, 1)).status, 'CANCELADO');
    assert.equal((await bilhete(rifa.id, 2)).discord_id, 'B');
    const compraB2 = r.compra;
    // B confirma direto do PENDENTE (pagou antes de avisar)
    const conf = await repo.confirmarPagamento(compraB2.id, 'gestor');
    assert.equal(conf.erro, undefined);
    assert.equal(conf.rifa.vendidos, 1);
  });

  let compraA12;
  passo('aviso de pagamento: só o dono; vencida mas intacta ainda vale; deixa de vencer', async () => {
    const r = await repo.reservar({ rifaId: rifa.id, discordId: 'A', numeros: [12] });
    compraA12 = r.compra;
    assert.equal((await repo.avisarPagamento(compraA12.id, 'B')).erro, 'nao_dono');
    await vencer(compraA12.id);
    const av = await repo.avisarPagamento(compraA12.id, 'A');
    assert.equal(av.erro, undefined);
    assert.equal(av.compra.status, 'AGUARDANDO');
    assert.equal(av.compra.expira_em, null);
    assert.equal((await bilhete(rifa.id, 12)).expira_em, null);
    assert.equal((await repo.avisarPagamento(compraA12.id, 'A')).erro, 'ja_avisado');
    // Sem prazo, ninguém retoma
    assert.equal((await repo.reservar({ rifaId: rifa.id, discordId: 'C', numeros: [12] })).erro, 'indisponiveis');
  });

  passo('comprador não desiste depois de avisar que pagou', async () => {
    assert.equal((await repo.cancelarCompra(compraA12.id, 'A', { peloComprador: true })).erro, 'aguardando');
  });

  passo('confirmação: PAGO, contadores e receita no financeiro uma vez só', async () => {
    const r = await repo.confirmarPagamento(compraA12.id, 'gestor');
    assert.equal(r.erro, undefined);
    assert.equal(r.rifa.vendidos, 2);
    assert.equal(r.rifa.arrecadado, '200.00');
    assert.equal(r.rifaAntes.vendidos, 1);
    assert.deepEqual(r.numeros, [12]);
    assert.equal((await bilhete(rifa.id, 12)).status, 'PAGO');
    assert.equal((await repo.confirmarPagamento(compraA12.id, 'gestor')).erro, 'ja_paga');
    const l = await lancamentos('RIFA', compraA12.id);
    assert.equal(l.length, 1);
    assert.equal(l[0].tipo, 'RECEITA');
    assert.equal(l[0].categoria, 'RIFA');
    assert.equal(l[0].valor, '100.00');
    assert.equal((await repo.cancelarCompra(compraA12.id, 'gestor', { peloComprador: false })).erro, 'paga');
  });

  passo('aleatório entrega números livres, sem repetir ocupados', async () => {
    const ocupadosAntes = new Set(await repo.numerosOcupados(rifa.id));
    const r = await repo.reservar({ rifaId: rifa.id, discordId: 'C', quantidade: 3 });
    assert.equal(r.erro, undefined);
    assert.equal(r.numeros.length, 3);
    assert.ok(r.numeros.every(n => !ocupadosAntes.has(n) && n >= 1 && n <= 20));
  });

  passo('encerrar automático respeita o prazo; manual encerra', async () => {
    assert.equal(await repo.encerrarRifa(rifa.id, { automatico: true }), null); // sem encerra_em
    assert.equal((await repo.encerrarRifa(rifa.id)).status, 'ENCERRADA');
    assert.equal((await repo.reservar({ rifaId: rifa.id, discordId: 'D', numeros: [19] })).erro, 'fechada');
  });

  passo('sortear bloqueia com pendência; depois sorteia e qualquer um recalcula', async () => {
    const bloqueado = await repo.sortear(rifa.id, { porId: 'gestor' });
    assert.ok(bloqueado.bloqueios.some(b => /aguardando/.test(b)));
    for (const p of await repo.comprasPendentes(rifa.id)) {
      assert.equal((await repo.cancelarCompra(p.id, 'gestor', { peloComprador: false })).erro, undefined);
    }
    assert.equal((await repo.comprasPendentes(rifa.id)).length, 0);
    const s = await repo.sortear(rifa.id, { porId: 'gestor' });
    assert.equal(s.erro, undefined);
    assert.equal(s.bloqueios, undefined);
    assert.deepEqual(s.pagos, [2, 12]);
    const conferido = R.sorteioSistema({ semente: s.rifa.semente, rifaId: s.rifa.id, pagos: s.pagos });
    assert.equal(s.rifa.numero_vencedor, conferido.numero);
    assert.equal(s.rifa.vencedor_id, conferido.numero === 2 ? 'B' : 'A');
    assert.equal(s.rifa.hash_lista_final, R.hashListaPagos([2, 12]));
    assert.ok(R.conferirCompromisso(s.rifa.semente, s.rifa.compromisso_hash));
    assert.equal((await repo.cancelarRifa(rifa.id, 'x', 'gestor')).erro, 'fechada');
    assert.equal((await repo.sortear(rifa.id, { porId: 'gestor' })).bloqueios.length > 0, true);
  });

  passo('data do sorteio só com 70% vendidos', async () => {
    const r2 = await novaRifa({ totalNumeros: 10, limitePorPessoa: 10 });
    const antes = await repo.marcarSorteio(r2.id, new Date(Date.now() + 864e5));
    assert.equal(antes.erro, 'limiar');
    assert.equal(antes.faltam, 7);
    const c = await repo.reservar({ rifaId: r2.id, discordId: 'A', numeros: [1, 2, 3, 4, 5, 6, 7] });
    await repo.confirmarPagamento(c.compra.id, 'gestor');
    const depois = await repo.marcarSorteio(r2.id, new Date(Date.now() + 864e5));
    assert.equal(depois.erro, undefined);
    assert.ok(depois.rifa.sorteio_em);
  });

  passo('sorteio ao vivo: evidência obrigatória, REPETIR_SORTEIO e número vendido', async () => {
    const r3 = await novaRifa({ totalNumeros: 10, metodoSorteio: 'MANUAL', regraNaoVendido: 'REPETIR_SORTEIO', compromissoHash: null, semente: null });
    const c = await repo.reservar({ rifaId: r3.id, discordId: 'E', numeros: [3] });
    await repo.confirmarPagamento(c.compra.id, 'gestor');
    await repo.encerrarRifa(r3.id);
    assert.ok((await repo.sortear(r3.id, { numeroManual: 5, porId: 'gestor' })).bloqueios.some(b => /evidência/.test(b)));
    assert.equal((await repo.sortear(r3.id, { numeroManual: 5, evidencia: 'https://live', porId: 'gestor' })).erro, 'repetir');
    assert.equal((await repo.buscarRifa(r3.id)).status, 'ENCERRADA');
    const s = await repo.sortear(r3.id, { numeroManual: 3, evidencia: 'https://live', porId: 'gestor' });
    assert.equal(s.rifa.status, 'SORTEADA');
    assert.equal(s.rifa.vencedor_id, 'E');

    const r4 = await novaRifa({ totalNumeros: 10, metodoSorteio: 'MANUAL', compromissoHash: null, semente: null });
    const c4 = await repo.reservar({ rifaId: r4.id, discordId: 'F', numeros: [2] });
    await repo.confirmarPagamento(c4.compra.id, 'gestor');
    await repo.encerrarRifa(r4.id);
    const s4 = await repo.sortear(r4.id, { numeroManual: 9, evidencia: 'foto', porId: 'gestor' });
    assert.equal(s4.rifa.numero_sorteado, 9);
    assert.equal(s4.rifa.numero_vencedor, 2); // dá a volta na faixa
  });

  passo('cancelar rifa: pendentes caem, pagos ficam, devolução lançada uma vez', async () => {
    const r5 = await novaRifa();
    const paga = await repo.reservar({ rifaId: r5.id, discordId: 'G', numeros: [1, 2] });
    await repo.confirmarPagamento(paga.compra.id, 'gestor');
    const aguardando = await repo.reservar({ rifaId: r5.id, discordId: 'H', numeros: [5] });
    await repo.avisarPagamento(aguardando.compra.id, 'H');
    const r = await repo.cancelarRifa(r5.id, 'Prêmio não chegou', 'gestor');
    assert.equal(r.rifa.status, 'CANCELADA');
    assert.equal(r.pendentes.length, 1);
    assert.equal(r.pendentes[0].status, 'AGUARDANDO'); // status de antes, para avisar quem pode ter pago
    assert.deepEqual(r.pagantes.map(p => [p.discord_id, Number(p.total)]), [['G', 200]]);
    assert.equal((await bilhete(r5.id, 1)).status, 'PAGO');
    assert.equal((await bilhete(r5.id, 5)).status, 'CANCELADO');
    const estorno = await lancamentos('RIFA_ESTORNO', r5.id);
    assert.equal(estorno.length, 1);
    assert.equal(estorno[0].tipo, 'DESPESA');
    assert.equal(estorno[0].valor, '200.00');
    assert.equal((await repo.cancelarRifa(r5.id, 'de novo', 'gestor')).erro, 'fechada');
  });

  passo('tarefa de expiração: vence uma vez, e nada acontece se já foi retomada', async () => {
    const r6 = await novaRifa();
    const c = await repo.reservar({ rifaId: r6.id, discordId: 'I', numeros: [8, 9] });
    assert.equal(await repo.expirarCompra(c.compra.id), null); // ainda no prazo
    await vencer(c.compra.id);
    assert.equal((await repo.expirarCompra(c.compra.id)).status, 'EXPIRADA');
    assert.equal((await bilhete(r6.id, 8)).status, 'CANCELADO');
    assert.equal(await repo.expirarCompra(c.compra.id), null);
    assert.equal((await repo.reservar({ rifaId: r6.id, discordId: 'J', numeros: [8] })).erro, undefined);
  });

  passo('listagens e relatório', async () => {
    assert.ok((await repo.listarRifas()).length >= 6);
    assert.ok((await repo.listarRifas({ status: ['CANCELADA'] })).every(r => r.status === 'CANCELADA'));
    const top = await repo.maioresCompradores(rifa.id);
    assert.deepEqual(top.map(t => t.discord_id).sort(), ['A', 'B']);
    assert.equal(typeof (await repo.contarReservados(rifa.id)), 'number');
    assert.deepEqual((await repo.bilhetesDaPessoa(rifa.id, 'A')).map(b => b.numero), [12]);
  });

  let falhas = 0;
  for (const [nome, fn] of passos) {
    try {
      await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout (trava?)')), 15000))]);
      console.log(`✔ ${nome}`);
    } catch (err) {
      falhas++;
      console.log(`✖ ${nome}\n   ${err.message.split('\n').slice(0, 6).join('\n   ')}`);
    }
  }
  console.log(`\n${passos.length - falhas}/${passos.length} passaram`);
  process.exit(falhas ? 1 : 0);
})().catch(err => { console.error('FALHA GERAL:', err); process.exit(1); });
