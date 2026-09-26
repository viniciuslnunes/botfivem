// Pendências de 2ª advertência: lembrete de prazo, painel vivo, alerta de restrição com botões (caso da
// inteligência), fechamento automático do caso, escalonamento do caso parado e resumo diário.
// PGlite + Discord falso; nada real.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_SSL = 'off';
const { instalarBanco } = require('../tools/banco-em-memoria');
const { criarCanal, criarMembro, criarServidor } = require('../tools/discord-falso');

const HORA = 3600 * 1000;
let banco;
let config;
let guild;
let pendentes;
let membro;
let repo;
let P;
let linha;

async function novaPendencia(prazoEmMs, { discordId = 'D1', idFivem = '1234' } = {}) {
  return repo.inserir({
    discordId, idFivem, nivel: 2, origem: 'impedimento', motivo: 'teste', registradoPor: 'Lider',
    logMessageId: `L${Math.random()}`, prazoEm: new Date(Date.now() + prazoEmMs),
  });
}

test.before(async () => {
  banco = await instalarBanco();
  config = require('../config/index.js');
  repo = require('../utils/advertencia/repositorio');
  P = require('../utils/advertencia/pendencias');
  pendentes = criarCanal(config.canais.advPendentes, 'advertencias-pendentes');
  membro = criarMembro('D1', { cargos: [config.cargos.socio, config.cargos.adv[1]], apelido: 'S GDF | Fulano - 1234' });
  guild = criarServidor({ id: config.guildId, canais: [pendentes], membros: [membro] });
  guild.client.users = { fetch: async () => membro };
  await banco.q("INSERT INTO bot_config (key, value) VALUES ('canal_inteligencia', $1)", [pendentes.id]); // inteligência posta aqui no teste
  linha = await novaPendencia(11 * HORA);
});
test.after(async () => { await banco.pglite.close(); });

test('lembrete só é agendado se ainda há mais de 12 h até o prazo', async () => {
  assert.ok(await P.agendarLembrete(linha, new Date(Date.now() + 2 * 24 * HORA)));
  assert.equal(await P.agendarLembrete(linha, new Date(Date.now() + 6 * HORA)), null);
  const [t] = await banco.q("SELECT payload FROM tarefas_agendadas WHERE tipo = 'adv_lembrete_prazo'");
  assert.equal(t.payload.advId, linha.id);
});

test('lembrete avisa o sócio por DM e a liderança no canal, com o que falta pagar', async () => {
  await banco.q('UPDATE advertencias_socio SET pago = $2 WHERE id = $1', [linha.id, { maconha: 20 }]);
  assert.equal(await P.lembrar(guild.client, { advId: linha.id }), 'avisada');
  assert.equal(membro.dms.length, 1);
  assert.match(JSON.stringify(membro.dms[0]), /30 maconha \+ 50 cocaina/);
  const msg = pendentes.enviadas.at(-1);
  assert.match(JSON.stringify(msg.embeds), /AINDA NÃO PAGA[\s\S]*30 maconha \+ 50 cocaina/);
  for (const id of config.lideranca) assert.ok(msg.content.includes(`<@&${id}>`));
});

test('painel lista a pendência com o que falta e as últimas baixas', async () => {
  const blocos = JSON.stringify(await P.montarBlocos());
  assert.match(blocos, /<@D1>/);
  assert.match(blocos, /30 maconha \+ 50 cocaina/);
});

test('com a inteligência ligada, restrição durante pendência vira caso com botões', async () => {
  require('../utils/inteligencia/fluxos').assinar();
  const contexto = require('../utils/advertencia/contexto');
  const ok = await contexto.alertarRestricaoComPendencia(guild.client, {
    acao: 'blacklist_adicionou', alvoIdFivem: '1234', ocorridoEm: new Date(), descricao: 'Fulano na blacklist',
  }, guild, membro);
  assert.ok(ok);
  const msg = pendentes.enviadas.at(-1);
  assert.match(JSON.stringify(msg.embeds), /BLACKLIST NO JOGO DURANTE PAGAMENTO PENDENTE/);
  const botoes = JSON.stringify(msg.components);
  assert.match(botoes, /intel:blq:/);
  assert.match(botoes, /intel:rem:/);
  assert.match(botoes, /intel:res:/);
  const [caso] = await banco.q("SELECT * FROM inteligencia_casos WHERE tipo = 'restricao_com_pendencia'");
  assert.equal(caso.status, 'ABERTO');
  assert.equal(caso.alvo_discord_id, 'D1');
});

test('escalonamento: caso parado há 24 h ganha um lembrete só, chamando a liderança', async () => {
  const E = require('../utils/inteligencia/escalonamento');
  assert.equal(await E.escalarCasosParados(guild.client), 0, 'caso novo ainda não escala');
  await banco.q("UPDATE inteligencia_casos SET aberto_em = now() - interval '25 hours'");
  const antes = pendentes.enviadas.length;
  assert.equal(await E.escalarCasosParados(guild.client), 1);
  const aviso = pendentes.enviadas.at(-1);
  assert.equal(pendentes.enviadas.length, antes + 1);
  assert.match(aviso.content, /sem ação há 24 h/);
  assert.ok(aviso.content.includes(`<@&${config.lideranca[0]}>`));
  assert.equal(await E.escalarCasosParados(guild.client), 0, 'só escala uma vez');
});

test('resumo diário lista o que vence em 24 h e o caso parado; sem nada, não publica', async () => {
  const D = require('../utils/inteligencia/diario');
  const linhas = (await D.montarLinhas()).join('\n');
  assert.match(linhas, /Pagamentos que vencem em 24 h \(1\)[\s\S]*<@D1>/);
  assert.match(linhas, /Casos abertos há mais de 24 h \(1\)[\s\S]*Restrição com pagamento pendente/);
  const antes = pendentes.enviadas.length;
  assert.equal(await D.publicarResumoDiario(guild.client), true);
  assert.equal(pendentes.enviadas.length, antes + 1);
  assert.equal(D.diaEHoraLocal(new Date('2026-09-26T12:30:00Z')).hora, 9);
});

test('pendência encerrada fecha o caso sozinho e sai do painel', async () => {
  await repo.encerrar(linha.id, 'PAGA', 'teste');
  await require('../utils/barramento').emitir('adv.pendencia_encerrada', { client: guild.client, advId: linha.id });
  const [caso] = await banco.q("SELECT * FROM inteligencia_casos WHERE tipo = 'restricao_com_pendencia'");
  assert.equal(caso.status, 'RESOLVIDO');
  assert.match(caso.resolucao, /encerrada/);
  assert.match(JSON.stringify(await P.montarBlocos()), /Nenhum pagamento pendente/);
  assert.equal(await P.lembrar(guild.client, { advId: linha.id }), 'ignorada', 'já paga: lembrete não sai');
});

test('recrutador vê no painel a qualidade do que aprovou (aprovados que tomaram ADV em 30 dias)', async () => {
  const decidido = new Date(Date.now() - 10 * 24 * HORA);
  for (const [i, adv] of [[1, true], [2, true], [3, false]]) {
    await banco.q(
      `INSERT INTO fichas_recrutamento (message_id, discord_id, nome, id_fivem, status, decidido_por_id, criado_em, decidido_em)
       VALUES ($1, $2, 'Novato', $3, 'APROVADO', 'REC1', $4, $4)`, [`FQ${i}`, `N${i}`, `90${i}`, decidido]);
    if (adv) await repo.inserir({ discordId: `N${i}`, idFivem: `90${i}`, nivel: 1, origem: 'manual', motivo: 'x', logMessageId: `QA${i}` });
  }
  const { qualidadeDeAprovacao } = require('../utils/advertenciaRecrutadorAuto/inteligencia');
  const q = (await qualidadeDeAprovacao()).get('REC1');
  assert.equal(q.aprovados, 3);
  assert.equal(q.comProblema, 2);
  assert.ok(q.alerta);
});
