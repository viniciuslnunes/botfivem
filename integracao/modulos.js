// Integração dos repositórios do botfivem contra Postgres real (PGlite, WASM).
// Conexão única: valida SQL, migrações e lógica transacional — não concorrência real.
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
// e sujou produção (fichas, eventos, rifas, departamentos etc. com dados de teste).
// Aborta ANTES de qualquer escrita se `require('utils/db')` não devolver o pool falso.
if (require(path.join(REPO, 'utils/db.js')) !== pool) {
  throw new Error('[integracao] Interceptação de utils/db.js falhou — abortando para não escrever no banco real.');
}

const R = p => require(path.join(REPO, p));
const config = R('config/index.js');
const q = async (sql, params) => (await pool.query(sql, params)).rows;
const futuro = h => new Date(Date.now() + h * 3600000);

const passos = [];
const passo = (nome, fn) => passos.push([nome, fn]);

(async () => {
  // Tabelas que já existem em produção antes do bot novo
  await pool.query('CREATE TABLE socios (discord_id TEXT PRIMARY KEY, numero_socio INT, nome TEXT, validade DATE)');
  await pool.query('CREATE TABLE bot_config (key TEXT PRIMARY KEY, value TEXT)');

  const erroOriginal = console.error;
  const falhas = [];
  console.error = (...a) => falhas.push(a.join(' '));
  await R('utils/migracoes').executarMigracoes();
  await R('utils/migracoes').executarMigracoes(); // idempotente
  console.error = erroOriginal;

  passo('migrações rodam duas vezes sem falha', async () => {
    assert.deepEqual(falhas, []);
  });

  passo('logs: gravação idempotente, filtros, resumo, série, rankings, última atividade', async () => {
    const { registrosDaMensagem, gravarRegistros } = R('utils/logsJogo/ingestao');
    const repo = R('utils/logsJogo/repositorio');
    const mensagem = (id, desc, cat = 'lideranca') => ({
      id, channelId: config.logsJogo.canais[0], author: { bot: true, username: 'webhook' }, webhookId: 'w', createdAt: new Date(),
      embeds: [{ data: { title: 'Registro de Atividade: Rarin', description: desc, footer: { text: `Time: Gaviões da Fiel | Categoria: ${cat}` } } }],
    });
    const m1 = mensagem('m1', 'O Novato Rarin (ID: 8914 ) entrou na sua torcida Novato.');
    assert.equal((await gravarRegistros(registrosDaMensagem(m1))).length, 1);
    assert.equal((await gravarRegistros(registrosDaMensagem(m1))).length, 0);
    await gravarRegistros(registrosDaMensagem(mensagem('m2', 'Rarin (ID: 8914) depositou $ 1.500 para Beto (ID: 77)', 'bau')));
    assert.deepEqual([...(await repo.idsJaGravados(['m1', 'x']))], ['m1']);

    const pagina = await repo.buscarLogs({ idFivem: '8914', texto: 'deposit' }, 0, 10);
    assert.equal(pagina.total, 1);
    assert.equal(pagina.itens[0].valor, '1500.00');
    const resumo = await repo.resumo({ inicio: futuro(-1), fim: futuro(1) });
    assert.equal(resumo.total, 2);
    assert.equal(resumo.valor_total, 1500);
    assert.equal((await repo.contarPorDia({})).reduce((s, d) => s + d.total, 0), 2);
    assert.equal((await repo.topCategorias({}, 5)).length, 2);
    assert.equal((await repo.topAtores({}, 5))[0].total, 2);
    assert.deepEqual(await repo.categoriasDistintas('ba'), ['bau']);
    assert.deepEqual(await repo.acoesDistintas('nov'), ['novato_entrou']);
    assert.ok((await repo.ultimaAtividadePorIds(['77', '8914', '0'])).has('77'));
  });

  passo('fichas de recrutamento: pendente, reprovação definitiva e fallback pelo embed', async () => {
    const fichas = R('utils/recrutamento/fichas');
    await fichas.registrarFicha({ messageId: 'f1', discordId: 'cand', nome: 'Rarin', idade: '19', idFivem: '8914', telefone: '11', recrutador: 'x', areaSlug: 'bateria' });
    assert.ok((await fichas.situacaoDoCandidato('cand')).pendenteDesde);
    assert.equal((await fichas.buscarFicha('f1')).area_slug, 'bateria');
    await fichas.decidirFicha('f1', { status: 'REPROVADO', decididoPorId: 'rec', categoria: 'manto', motivo: 'sem manto enviado', permiteReenvio: false });
    assert.equal((await fichas.situacaoDoCandidato('cand')).reprovacaoDefinitiva, true);
    assert.deepEqual((await fichas.listarReprovacoesDefinitivas()).map(r => r.discord_id), ['cand']);
    assert.equal((await fichas.liberarReenvio('f1', { porId: 'lid', motivo: 'conversamos no ticket' })).id_fivem, '8914');
    assert.equal(await fichas.liberarReenvio('f1', { porId: 'lid', motivo: 'de novo' }), null);
    assert.equal((await fichas.situacaoDoCandidato('cand')).reprovacaoDefinitiva, false);
    assert.deepEqual(await fichas.listarReprovacoesDefinitivas(), []);
    await fichas.decidirFicha('antiga', { status: 'APROVADO', decididoPorId: 'rec' }, {
      fields: [{ name: 'NOME', value: 'Velho' }, { name: 'IDADE', value: '30' }, { name: 'ID FIVEM', value: '555' }, { name: 'ID | DISCORD', value: 'velho | <@velho>' }],
    });
    assert.equal((await fichas.buscarFicha('antiga')).status, 'APROVADO');
  });

  passo('funil: novato dos logs cruzado com fichas; alerta registrado uma vez', async () => {
    const repo = R('utils/recrutamento/funilRepositorio');
    const novatos = await repo.novatosDoPeriodo(null, futuro(1));
    assert.equal(novatos.length, 1);
    assert.equal(novatos[0].id_fivem, '8914');
    assert.equal(novatos[0].pediu, true);
    assert.equal(novatos[0].aprovado, false);
    await repo.registrarAlertas('novato', ['8914', '8914', '1']);
    assert.deepEqual([...(await repo.alertasJaEnviados('novato', ['8914', '2']))], ['8914']);
  });

  passo('departamentos: salvar, listar ativos na ordem da config e mapa de cargos', async () => {
    const repo = R('utils/departamentos/repositorio');
    await repo.salvarDepartamento({ slug: 'bateria', cargoMembroId: 'rm', cargoGestorId: 'rg', canalId: 'c' });
    await repo.salvarDepartamento({ slug: 'loja', cargoMembroId: 'lm', cargoGestorId: 'lg', canalId: 'c2' });
    const ativos = await repo.listarDepartamentos({ apenasAtivos: true });
    assert.deepEqual(ativos.map(a => a.slug), ['loja', 'bateria']);
    assert.equal((await repo.listarDepartamentos()).length, config.departamentos.length);
    assert.deepEqual((await repo.mapaCargosDepartamento()).get('rg'), { slug: 'bateria', papel: 'gestor' });
  });

  let eventoId;
  passo('eventos: vaga, lista de espera, promoção, presença e fechamento', async () => {
    const repo = R('utils/eventos/repositorio');
    const e = await repo.criarEvento({ tipo: 'GERAL', titulo: 'Churrasco', descricao: null, local: 'Sede', inicioEm: futuro(48), capacidade: 1, areaSlug: null, serieId: 's1', canalId: 'c', criadoPorId: 'g' });
    eventoId = e.id;
    assert.equal((await repo.inscrever(e.id, 'A')).status, 'CONFIRMADO');
    assert.equal((await repo.inscrever(e.id, 'B')).status, 'ESPERA');
    assert.equal((await repo.inscrever(e.id, 'A')).erro, 'ja_inscrito');
    const saida = await repo.desistir(e.id, 'A');
    assert.equal(saida.promovido, 'B');
    assert.equal((await repo.desistir(e.id, 'A')).erro, 'nao_inscrito');
    assert.equal((await repo.inscrever(e.id, 'A')).status, 'ESPERA'); // volta para o fim da fila
    assert.deepEqual((await repo.marcarPresenca(e.id, ['B', 'C'], 'g')).sort(), ['B', 'C']);
    assert.deepEqual(await repo.marcarPresenca(e.id, ['B'], 'g'), []);
    const inscricoes = await repo.listarInscricoes(e.id);
    assert.equal(inscricoes.find(i => i.discord_id === 'C').status, 'AVULSO');
    await repo.gravarMensagem(e.id, 'msg');
    assert.equal((await repo.buscarEvento(e.id)).message_id, 'msg');
    assert.ok((await repo.listarProximos()).some(x => x.id === e.id));

    const passado = await repo.criarEvento({ tipo: 'GERAL', titulo: 'Passado', descricao: null, local: null, inicioEm: futuro(-5), capacidade: null, areaSlug: null, serieId: null, canalId: 'c', criadoPorId: 'g' });
    assert.equal((await repo.inscrever(passado.id, 'A')).erro, 'fechado');
    await pool.query("INSERT INTO evento_inscricoes (evento_id, discord_id, status, presente_em) VALUES ($1, 'A', 'CONFIRMADO', now()), ($1, 'B', 'CONFIRMADO', NULL)", [passado.id]);
    const periodo = await repo.eventosDoPeriodo(null, futuro(1));
    const linha = periodo.find(x => x.id === passado.id);
    assert.deepEqual([linha.confirmados, linha.presentes, linha.no_show], [2, 1, 1]);
    assert.equal((await repo.maisPresentes(null, futuro(1)))[0].discord_id !== undefined, true);

    const serie2 = await repo.criarEvento({ tipo: 'ENSAIO', titulo: 'Ensaio', descricao: null, local: null, inicioEm: futuro(200), capacidade: null, areaSlug: null, serieId: 's1', canalId: 'c', criadoPorId: 'g' });
    const cancelados = await repo.cancelarEventos(await repo.buscarEvento(e.id), 'serie');
    assert.deepEqual(cancelados.map(x => x.id).sort(), [e.id, serie2.id].sort());
  });

  passo('escala: convocar, repetir, trocar função, responder, remover', async () => {
    const repo = R('utils/escala/repositorio');
    assert.ok((await repo.convocar(eventoId, 'A', 'BANDEIRA', 'g')).linha);
    assert.equal((await repo.convocar(eventoId, 'A', 'BANDEIRA', 'g')).erro, 'ja_escalado');
    assert.equal((await repo.convocar(eventoId, 'A', 'COORDENACAO', 'g')).trocouFuncao, true);
    assert.equal((await repo.responder(eventoId, 'A', true)).status, 'ACEITO');
    assert.equal(await repo.responder(eventoId, 'ninguem', true), null);
    assert.equal((await repo.listarEscala(eventoId)).length, 1);
    assert.equal(await repo.removerDaEscala(eventoId, 'A'), true);
  });

  passo('caravana: capacidade do veículo, só confirmado, embarque por trecho', async () => {
    const eventos = R('utils/eventos/repositorio');
    const repo = R('utils/caravana/repositorio');
    const car = await eventos.criarEvento({ tipo: 'CARAVANA', titulo: 'BH', descricao: null, local: null, inicioEm: futuro(72), capacidade: null, areaSlug: 'caravanas', serieId: null, canalId: 'c', criadoPorId: 'g' });
    await eventos.inscrever(car.id, 'X');
    await eventos.inscrever(car.id, 'Y');
    const v = await repo.adicionarVeiculo({ eventoId: car.id, nome: 'Van', capacidade: 1, responsavelId: null, ponto: null, horario: null });
    assert.equal((await repo.alocar(car.id, 'X', v.id)).lugar, 1);
    assert.match((await repo.alocar(car.id, 'Y', v.id)).erro, /LOTADO/);
    assert.match((await repo.alocar(car.id, 'Z', v.id)).erro, /CONFIRMADO/);
    assert.match((await repo.alocar(car.id, 'X', v.id)).erro, /JÁ ESTÁ/);
    assert.deepEqual(await repo.registrarEmbarque(car.id, ['X', 'Y'], 'IDA', 'g'), ['X', 'Y']);
    assert.deepEqual(await repo.registrarEmbarque(car.id, ['X'], 'IDA', 'g'), []);
    assert.equal((await repo.listarCheckins(car.id)).length, 2);
    assert.equal((await eventos.listarInscricoesComVeiculo(car.id)).find(i => i.discord_id === 'X').veiculo_id, v.id);
  });

  passo('financeiro: automático não duplica, manual exclui, totais e filtro por evento', async () => {
    const repo = R('utils/financeiro/repositorio');
    const manual = await repo.lancar({ tipo: 'DESPESA', categoria: 'CARAVANA', valor: 400.5, descricao: 'Ônibus', data: '2026-09-10', eventoId, criadoPorId: 'g' });
    assert.ok(manual.id);
    const auto = { tipo: 'RECEITA', categoria: 'LOJA', valor: 300, descricao: 'Pedido', data: '2026-09-10', origem: 'LOJA', origemId: '99', criadoPorId: 'g' };
    assert.ok(await repo.lancar(auto));
    assert.equal(await repo.lancar(auto), null);
    const totais = await repo.totaisPorCategoria({ inicio: '2026-09-01', fim: '2026-09-30' });
    assert.equal(totais.length, 2);
    assert.equal((await repo.totaisPorCategoria({ eventoId }))[0].total, 400.5);
    assert.equal((await repo.listarLancamentos({ tipo: 'RECEITA' })).length, 1);
    const automatico = (await repo.listarLancamentos({ categoria: 'LOJA' }))[0];
    assert.equal(await repo.excluirManual(automatico.id), null);
    assert.equal((await repo.excluirManual(manual.id)).id, manual.id);
    await assert.rejects(repo.lancar({ ...auto, origemId: '100', valor: 0 }));
  });

  passo('loja: reserva no pedido, esgotado, cancelamento devolve, vendas', async () => {
    const repo = R('utils/loja/repositorio');
    const p = await repo.criarProduto({ nome: 'Manto', descricao: null, preco: 150, estoque: { P: 2 }, imagemRef: null, criadoPorId: 'g' });
    const r1 = await repo.criarPedido({ produtoId: p.id, tamanho: 'P', quantidade: 2, discordId: 'A', observacao: null });
    assert.equal(r1.pedido.total, '300.00');
    assert.deepEqual((await repo.buscarProduto(p.id)).estoque, { P: 0 });
    assert.match((await repo.criarPedido({ produtoId: p.id, tamanho: 'P', quantidade: 1, discordId: 'B', observacao: null })).erro, /ESGOTAR/);
    assert.equal(await repo.contarPedidosAbertos('A'), 1);
    assert.equal((await repo.decidirPedido(r1.pedido.id, 'CANCELADO', 'g')).pedido.status, 'CANCELADO');
    assert.deepEqual((await repo.buscarProduto(p.id)).estoque, { P: 2 });
    assert.match((await repo.decidirPedido(r1.pedido.id, 'CONFIRMADO', 'g')).erro, /JÁ FOI/);
    const r2 = await repo.criarPedido({ produtoId: p.id, tamanho: 'P', quantidade: 1, discordId: 'B', observacao: 'M' });
    await repo.gravarCanalPedido(r2.pedido.id, 'canal');
    await repo.decidirPedido(r2.pedido.id, 'CONFIRMADO', 'g');
    const vendas = await repo.vendasDoPeriodo(null, futuro(1));
    assert.deepEqual([vendas[0].unidades, vendas[0].total], [1, 150]);
    assert.equal((await repo.editarProduto(p.id, { ativo: false, preco: 120 })).ativo, false);
    assert.equal((await repo.listarProdutos()).length, 0);
  });

  passo('patrimônio: empréstimo único, recorte por categoria, pendências, baixa', async () => {
    const repo = R('utils/patrimonio/repositorio');
    const faixa = await repo.criarItem({ nome: 'Faixa Gaviões', categoria: 'BANDEIRA', subtipo: 'FAIXA', quantidade: 1, localizacao: 'Sede', responsavelId: null, fotoRef: null, observacao: null, criadoPorId: 'g' });
    const r = await repo.abrirEmprestimo({ itemId: faixa.id, discordId: 'A', eventoId, fotoSaidaRef: 'c/m', observacao: null, porId: 'g' });
    assert.ok(r.emprestimo.id);
    assert.match((await repo.abrirEmprestimo({ itemId: faixa.id, discordId: 'B', eventoId: null, fotoSaidaRef: 'c/m', observacao: null, porId: 'g' })).erro, /JÁ ESTÁ FORA/);
    assert.equal((await repo.listarItens({ categorias: ['BANDEIRA'] }))[0].emprestimo_discord_id, 'A');
    assert.deepEqual(await repo.listarItens({ categorias: ['INSTRUMENTO'] }), []);
    assert.deepEqual(await repo.listarItens({ categorias: [] }), []);
    assert.equal((await repo.emprestimosAbertos(null))[0].evento_titulo, 'Churrasco');
    assert.equal((await repo.buscarItem(faixa.id)).emprestimo_discord_id, 'A');
    assert.equal((await repo.fecharEmprestimo({ itemId: faixa.id, fotoVoltaRef: 'c/n', comDano: true, observacao: 'rasgou' })).status, 'COM_DANO');
    assert.equal(await repo.fecharEmprestimo({ itemId: faixa.id, fotoVoltaRef: 'c/n', comDano: false, observacao: null }), null);
    assert.equal((await repo.editarItem(faixa.id, { localizacao: 'Barracão' })).localizacao, 'Barracão');
    assert.equal((await repo.baixarItem(faixa.id, 'rasgada')).status, 'BAIXADO');
    assert.equal((await repo.listarItens({ categorias: null })).length, 0);
    assert.equal((await repo.listarItens({ categorias: null, incluirBaixados: true })).length, 1);
  });

  passo('confiança: a mesma origem não pontua duas vezes; situação calculada', async () => {
    const repo = R('utils/confianca/repositorio');
    const { registrarSinal, situacaoDe } = R('utils/confianca/servico');
    assert.ok(await registrarSinal(null, { discordId: 'A', sinal: 'PRESENCA', origemTipo: 'evento', origemId: 1 }));
    assert.equal(await registrarSinal(null, { discordId: 'A', sinal: 'PRESENCA', origemTipo: 'evento', origemId: 1 }), null);
    await registrarSinal(null, { discordId: 'B', sinal: 'PRESENCA', origemTipo: 'evento', origemId: 1 });
    await registrarSinal(null, { discordId: 'A', sinal: 'APROVACAO', origemTipo: 'ficha', origemId: 'f' });
    assert.equal((await repo.listarEventos('A')).length, 2);
    const s = await situacaoDe('A');
    assert.equal(s.score, 35);
    assert.equal(s.nivel.rotulo, 'Conhecido');
  });

  passo('memória: decisão só de pendente e tópico por dia', async () => {
    const repo = R('utils/memoria/repositorio');
    const fato = await repo.criarFato({ dia: '2026-09-01', autorId: 'A', texto: 'Festa', midiaRef: null, eventoId: null, status: 'PENDENTE' });
    const aprovado = await repo.decidirFato(fato.id, 'APROVADA', 'g');
    assert.equal(aprovado.dia_chave, '2026-09-01');
    assert.equal(await repo.decidirFato(fato.id, 'REJEITADA', 'g', 'x'), null);
    await repo.gravarPublicacao(fato.id, 'https://discord/msg');
    assert.equal((await repo.buscarFato(fato.id)).publicado_url, 'https://discord/msg');
    await repo.gravarThreadDoDia('2026-09-01', 't1');
    await repo.gravarThreadDoDia('2026-09-01', 't2');
    assert.equal(await repo.threadDoDia('2026-09-01'), 't2');
    assert.equal((await repo.fatosDoDia('2026-09-01')).length, 1);
  });

  passo('carteirinha: aviso por DM uma vez por ciclo; vencida antiga não gera DM', async () => {
    const { verificarVencimentos } = R('utils/carteirinha/vencimentos');
    await pool.query(`INSERT INTO socios (discord_id, numero_socio, nome, validade) VALUES
      ('aVencer', 1, 'A', (now() AT TIME ZONE 'America/Sao_Paulo')::date + 3),
      ('vencidaRecente', 2, 'B', (now() AT TIME ZONE 'America/Sao_Paulo')::date - 2),
      ('vencidaAntiga', 3, 'C', (now() AT TIME ZONE 'America/Sao_Paulo')::date - 60),
      ('vigente', 4, 'D', (now() AT TIME ZONE 'America/Sao_Paulo')::date + 200)`);
    const dms = [];
    const client = { users: { fetch: async id => ({ send: async () => dms.push(id) }) } };
    await verificarVencimentos(client);
    assert.deepEqual(dms.sort(), ['aVencer', 'vencidaRecente']);
    await verificarVencimentos(client);
    assert.equal(dms.length, 2);
    const marcados = await q('SELECT discord_id FROM socios WHERE aviso_vencida_em IS NOT NULL ORDER BY discord_id');
    assert.deepEqual(marcados.map(m => m.discord_id), ['vencidaAntiga', 'vencidaRecente']);
  });

  passo('carteirinha: perder o cargo revoga e tira do mural; recuperar restaura', async () => {
    const { sincronizarCarteirinhaComCargo } = R('utils/carteirinhaSocio');
    const enviados = [];
    const canal = { messages: { fetch: async () => { throw new Error('sem mensagem'); } }, send: async m => { enviados.push(m); return { id: 'mural' }; } };
    const client = { channels: { fetch: async () => canal } };
    await sincronizarCarteirinhaComCargo(client, 'vigente', false);
    assert.ok((await q("SELECT revogada_em FROM socios WHERE discord_id = 'vigente'"))[0].revogada_em);
    assert.ok(!enviados[0].embeds[0].description.includes('— D'));
    await sincronizarCarteirinhaComCargo(client, 'vigente', true);
    assert.equal((await q("SELECT revogada_em FROM socios WHERE discord_id = 'vigente'"))[0].revogada_em, null);
  });

  passo('agendador: tarefa vencida executa uma vez e fica "feita"; erro volta para a fila', async () => {
    const { agendar, registrarTipo, iniciarAgendador } = R('utils/agendador');
    const execucoes = [];
    registrarTipo('teste_ok', async (_c, p) => execucoes.push(p.n));
    registrarTipo('teste_erro', async () => { throw new Error('falhou de propósito'); });
    const ok = await agendar('teste_ok', new Date(Date.now() - 1000), { n: 1 });
    const erro = await agendar('teste_erro', new Date(Date.now() - 1000), {});
    const futura = await agendar('teste_ok', futuro(5), { n: 2 });
    const erroOriginal2 = console.error;
    console.error = () => {};
    iniciarAgendador({});
    await new Promise(r => setTimeout(r, 1500));
    console.error = erroOriginal2;
    assert.deepEqual(execucoes, [1]);
    const status = Object.fromEntries((await q('SELECT id, status, tentativas FROM tarefas_agendadas')).map(t => [t.id, t]));
    assert.equal(status[ok].status, 'feita');
    assert.equal(status[erro].status, 'pendente');
    assert.equal(status[erro].tentativas, 1);
    assert.equal(status[futura].status, 'pendente');
  });

  let falhasPasso = 0;
  for (const [nome, fn] of passos) {
    try {
      await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout (trava?)')), 15000))]);
      console.log(`✔ ${nome}`);
    } catch (err) {
      falhasPasso++;
      console.log(`✖ ${nome}\n   ${String(err.stack || err.message).split('\n').slice(0, 8).join('\n   ')}`);
    }
  }
  console.log(`\n${passos.length - falhasPasso}/${passos.length} passaram`);
  process.exit(falhasPasso ? 1 : 0);
})().catch(err => { console.error('FALHA GERAL:', err); process.exit(1); });
