// Inteligência do manto: erro recuperado, aviso ao aprovar, reincidência, lembretes
// agendados, relatório e barreira de entrada. Postgres em memória + Discord falso.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_SSL = 'off';
const { instalarBanco } = require('../tools/banco-em-memoria');
const { criarCanal, criarMembro, criarServidor, criarMensagem } = require('../tools/discord-falso');
const regras = require('../utils/recrutamento/mantoRegras');

let banco;
let config;
let repo;

test.before(async () => {
  banco = await instalarBanco();
  config = require('../config/index.js');
  require('../plataforma').carregarModulos({ commands: null });
  repo = require('../utils/recrutamento/mantoRepositorio');
});
test.after(async () => { await banco.pglite.close(); });

const foto = (resultado, motivo = null) => ({ resultado, motivo });

test('regras: erro recuperado, reincidência e motivo mais frequente', () => {
  assert.equal(regras.resumirFotos([foto('ERRADO', 'ia'), foto('CORRETO')]).erradosEfetivos, 0);
  assert.equal(regras.resumirFotos([foto('ERRADO', 'ia'), foto('CORRETO')]).recuperados, 1);
  const dois = regras.resumirFotos([foto('ERRADO', 'ia'), foto('ERRADO', 'foto_escura')]);
  assert.equal(dois.erradosEfetivos, 2);
  assert.equal(dois.reincidente, true);
  assert.equal(dois.ultimoMotivo, 'foto_escura');
  assert.deepEqual(regras.motivoMaisFrequente([{ motivo: 'ia', total: 1 }, { motivo: 'foto_escura', total: 3 }]), { motivo: 'foto_escura', total: 3 });
  assert.equal(regras.motivoMaisFrequente([]), null);
});

test('regras: aviso ao aprovar só quando há o que avisar', () => {
  assert.equal(regras.avisoAoAprovar([]).nivel, 'sem_foto');
  assert.equal(regras.avisoAoAprovar([foto(null)]).nivel, 'pendente');
  assert.equal(regras.avisoAoAprovar([foto('ERRADO', 'ia')], regras.rotuloMotivo).nivel, 'errado');
  assert.match(regras.avisoAoAprovar([foto('ERRADO', 'ia')], regras.rotuloMotivo).texto, /Utilização de IA/);
  assert.equal(regras.avisoAoAprovar([foto('ERRADO', 'ia'), foto('CORRETO')]), null);
  assert.equal(regras.avisoAoAprovar([foto('CORRETO')]), null);
});

test('regras: placar traz recuperados e o motivo mais frequente por recrutador', () => {
  const { recrutadores } = regras.montarPlacar(
    [{ recrutador_id: 'A', acertos: 1, erros: 2, recuperados: 1 }],
    ['A'],
    [{ recrutador_id: 'A', motivo: 'ia', total: 1 }, { recrutador_id: 'A', motivo: 'foto_escura', total: 2 }]
  );
  assert.equal(recrutadores[0].recuperados, 1);
  assert.deepEqual(recrutadores[0].motivoTop, { motivo: 'foto_escura', total: 2 });
});

test('banco: erro recuperado e ficha reprovada não contam; ficha aprovada conta (placar e advertência iguais)', async () => {
  await banco.q(`INSERT INTO fichas_recrutamento (message_id, discord_id, status, decidido_por_id, decidido_em, criado_em) VALUES
    ('FA', 'CA', 'APROVADO', 'RECA', now(), now() - interval '3 hours'),
    ('FB', 'CB', 'APROVADO', 'RECA', now(), now() - interval '3 hours'),
    ('FC', 'CC', 'REPROVADO', 'RECB', now(), now() - interval '3 hours')`);
  await banco.q(`INSERT INTO mantos_avaliados (message_id, candidato_id, enviado_em, resultado, motivo, avaliado_em) VALUES
    ('MA1', 'CA', now() - interval '2 hours', 'ERRADO', 'ia', now() - interval '110 minutes'),
    ('MB1', 'CB', now() - interval '2 hours', 'ERRADO', 'foto_escura', now() - interval '110 minutes'),
    ('MB2', 'CB', now() - interval '1 hour', 'CORRETO', NULL, now() - interval '50 minutes'),
    ('MC1', 'CC', now() - interval '2 hours', 'ERRADO', 'ia', now() - interval '110 minutes')`);

  const placar = Object.fromEntries((await repo.placarPorRecrutador()).map(l => [l.recrutador_id, l]));
  assert.deepEqual({ ...placar.RECA }, { recrutador_id: 'RECA', acertos: 1, erros: 1, recuperados: 1 });
  assert.equal(placar.RECB, undefined, 'quem reprovou não é contado');

  const desde = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  assert.equal((await repo.errosEfetivosPorRecrutador(desde)).get('RECA'), 1, 'advertência conta igual ao placar');
  assert.equal((await repo.errosEfetivosPorRecrutador(desde)).has('RECB'), false);

  const motivos = await repo.motivosPorRecrutador();
  assert.deepEqual(motivos.map(m => ({ ...m })), [{ recrutador_id: 'RECA', motivo: 'ia', total: 1 }]);
});

test('aprovou com manto ruim: recrutador é avisado na própria ficha, com o prazo de desfazer', async () => {
  const { aoFichaDecidida } = require('../utils/recrutamento/mantoAvisos');
  const validar = criarCanal(config.canais.validarSetagem, 'validar-setagem');
  const guild = criarServidor({ canais: [validar], membros: [] });

  async function cenario(id, candidato, fotos) {
    const ficha = criarMensagem(validar, {});
    ficha.id = id;
    validar.historico.unshift(ficha);
    await banco.q("INSERT INTO fichas_recrutamento (message_id, discord_id, status, decidido_por_id, decidido_em, criado_em) VALUES ($1, $2, 'APROVADO', 'RECX', now(), now() - interval '2 hours')", [id, candidato]);
    for (const [i, f] of fotos.entries()) {
      await banco.q("INSERT INTO mantos_avaliados (message_id, candidato_id, enviado_em, resultado, motivo) VALUES ($1, $2, now() - interval '1 hour' + ($3 || ' minutes')::interval, $4, $5)", [`${id}-${i}`, candidato, String(i), f[0], f[1]]);
    }
    const antes = validar.enviadas.length;
    await aoFichaDecidida({ client: guild.client, fichaId: id, status: 'APROVADO', decididaPorId: 'RECX', discordId: candidato });
    return validar.enviadas.slice(antes);
  }

  const [errado] = await cenario('FX1', 'CX1', [['ERRADO', 'ia']]);
  assert.match(errado.content, /<@RECX>.*ERRADO.*Utilização de IA/s);
  assert.match(errado.content, /DESFAZER DECISÃO/);
  const [pendente] = await cenario('FX2', 'CX2', [[null, null]]);
  assert.match(pendente.content, /não foi avaliado/);
  const [semFoto] = await cenario('FX3', 'CX3', []);
  assert.match(semFoto.content, /nenhuma foto de manto/);
  assert.deepEqual(await cenario('FX4', 'CX4', [['ERRADO', 'ia'], ['CORRETO', null]]), [], 'recuperado: sem aviso');
  assert.deepEqual(await cenario('FX5', 'CX5', [['CORRETO', null]]), [], 'manto correto: sem aviso');

  // reprovar não avisa nada
  const antes = validar.enviadas.length;
  await aoFichaDecidida({ client: guild.client, fichaId: 'FX1', status: 'REPROVADO', decididaPorId: 'RECX', discordId: 'CX1' });
  assert.equal(validar.enviadas.length, antes);
});

test('lembretes: foto parada e caso aberto só cobram enquanto a situação continua', async () => {
  const painel = require('../utils/recrutamento/painelManto');
  const provar = criarCanal(config.canais.provarManto, 'provar-manto');
  const caso = criarCanal('CASOCH', 'caso');
  const guild = criarServidor({ canais: [provar, caso], membros: [criarMembro('LID1', { nome: 'Lid' })] });

  // foto parada
  await banco.q("INSERT INTO mantos_avaliados (message_id, candidato_id, enviado_em) VALUES ('FP1', 'CP1', now() - interval '31 minutes')");
  const aviso = criarMensagem(provar, {});
  provar.historico.unshift(aviso);
  await painel.lembrarFotoParada(guild.client, { fotoId: 'FP1', canalId: provar.id, avisoId: aviso.id, etapa: 0 });
  assert.match(provar.enviadas.at(-1).content, /aguardando avaliação há 30 min/);
  const proxima = await banco.q("SELECT payload FROM tarefas_agendadas WHERE tipo = 'manto_foto_parada' ORDER BY id DESC LIMIT 1");
  assert.equal(proxima[0].payload.etapa, 1, 'agenda o lembrete de 2 h');

  const enviadas = provar.enviadas.length;
  await banco.q("UPDATE mantos_avaliados SET resultado = 'CORRETO' WHERE message_id = 'FP1'");
  await painel.lembrarFotoParada(guild.client, { fotoId: 'FP1', canalId: provar.id, avisoId: aviso.id, etapa: 1 });
  assert.equal(provar.enviadas.length, enviadas, 'já avaliada: não cobra');

  // caso aberto
  await banco.q("INSERT INTO mantos_avaliados (message_id, candidato_id, resultado, motivo, avaliado_por_id, caso_canal_id, caso_message_id) VALUES ('CA1', 'CP2', 'ERRADO', 'ia', 'LID1', 'CASOCH', 'CARD1')");
  const card = criarMensagem(caso, {});
  card.id = 'CARD1';
  caso.historico.unshift(card);
  await painel.lembrarPrazoCaso(guild.client, { fotoId: 'CA1', casoMessageId: 'CARD1', lembrete: 0 });
  assert.match(caso.enviadas.at(-1).content, /<@LID1>.*aberto há 24 h/);
  const seguinte = await banco.q("SELECT payload FROM tarefas_agendadas WHERE tipo = 'manto_caso_prazo' ORDER BY id DESC LIMIT 1");
  assert.equal(seguinte[0].payload.lembrete, 1);

  const antes = caso.enviadas.length;
  await banco.q("UPDATE mantos_avaliados SET caso_resolvido_em = now() WHERE message_id = 'CA1'");
  await painel.lembrarPrazoCaso(guild.client, { fotoId: 'CA1', casoMessageId: 'CARD1', lembrete: 1 });
  assert.equal(caso.enviadas.length, antes, 'resolvido: não cobra');
});

test('caso reincidente mostra o campo REINCIDÊNCIA; barreira avisa candidato reincidente', () => {
  const casos = require('../utils/recrutamento/mantoCasos');
  const base = { candidato_id: 'C', avaliado_por_id: 'L', motivo: 'ia', message_id: 'M' };
  assert.ok(casos.embedCaso({ ...base, reincidencia: 2 }, 'ABERTO').fields.some(f => f.name === 'REINCIDÊNCIA'));
  assert.ok(!casos.embedCaso(base, 'ABERTO').fields.some(f => f.name === 'REINCIDÊNCIA'));
  assert.equal(casos.embedCaso(base, 'ABERTO').fields.at(-1).name, 'STATUS');

  const { montarAvisos } = require('../utils/inteligencia/barreira');
  const avisos = montarAvisos({ nome: 'X', idFivem: '1', mantos: regras.resumirFotos([foto('ERRADO', 'ia'), foto('ERRADO', 'ia')]) });
  assert.match(avisos[0], /2 fotos de manto reprovadas/);
  assert.deepEqual(montarAvisos({ nome: 'X', idFivem: '1', mantos: regras.resumirFotos([foto('ERRADO', 'ia')]) }), []);
});

test('relatório do manto: resumo, motivos e nenhum verde', async () => {
  const rel = require('../utils/inteligencia/relatorios');
  const e = await rel.embedManto(30);
  assert.match(e.title, /MANTO/);
  assert.ok(JSON.stringify(e).length < 6000);
  assert.doesNotMatch(String(e.color), /^(65280|5763719)$/);
  const nomes = e.fields.map(f => f.name);
  assert.ok(nomes.includes('MOTIVOS DOS ERROS') && nomes.includes('AVALIADORES'));
});
