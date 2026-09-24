// Sugestões de melhoria, de ponta a ponta: handlers REAIS + Postgres em memória +
// Discord falso. Recrutador+ envia, sócio+ vota (um voto por pessoa), autor não
// vota na própria sugestão, botão de enviar sempre por último, nada verde.
const test = require('node:test');
const assert = require('node:assert/strict');

process.env.DATABASE_SSL = 'off';
const { instalarBanco } = require('../tools/banco-em-memoria');
const { criarCanal, criarMembro, criarServidor, criarInteracao } = require('../tools/discord-falso');

const CANAL = '900000000000009999';
let banco;
let despachar;
let config;

test.before(async () => {
  banco = await instalarBanco();
  // O tenant Gaviões ainda não tem o ID do canal: injeta um antes do config congelar.
  require('../tenants/gavioes/tenant.js').canais.sugestoes = CANAL;
  config = require('../config/index.js');
  require('../plataforma').carregarModulos({ commands: null });
  ({ despacharInteracao: despachar } = require('../utils/modulos'));
});

test.after(async () => {
  await banco.pglite.close();
});

function cenario(membros) {
  const canal = criarCanal(CANAL, 'sugestoes');
  const guild = criarServidor({ canais: [canal], membros });
  return { guild, canal };
}

const membro = (id, cargos) => criarMembro(id, { nome: `M${id.slice(-2)}`, cargos });
const texto = 'Criar um canal para agendar as reuniões da liderança.';

async function enviar(guild, autor, campos = { texto }) {
  const i = criarInteracao({ customId: 'sug:enviar', membro: autor, guild, campos });
  await despachar(i);
  return i;
}

const votar = async (guild, canal, sugestao, quem, voto) => {
  const i = criarInteracao({ customId: `sug:votar:${sugestao}:${voto}`, membro: quem, guild, canal, mensagem: canal.enviadas.find(m => m.embeds[0]?.title?.includes(`#${sugestao}`)) });
  await despachar(i);
  return i;
};

test('sugestões: só recrutador+ abre o formulário; sócio comum e visitante são barrados', async () => {
  const recrutador = membro('900000000000000101', [config.cargos.recrutador]);
  const socio = membro('900000000000000102', [config.cargos.socio]);
  const { guild } = cenario([recrutador, socio]);

  const ok = criarInteracao({ customId: 'sug:nova', membro: recrutador, guild });
  await despachar(ok);
  assert.equal(ok.registros[0][0], 'showModal');
  assert.equal(ok.registros[0][1].data.custom_id, 'sug:enviar');

  for (const barrado of [socio, membro('900000000000000103', [])]) {
    const i = criarInteracao({ customId: 'sug:nova', membro: barrado, guild });
    await despachar(i);
    assert.match(i.acao('reply')[0].content, /SÓ RECRUTADORES E ACIMA ENVIAM SUGESTÕES/);
  }
});

test('sugestões: enviar publica o embed com botões de voto, grava no banco e deixa o painel por último', async () => {
  const recrutador = membro('900000000000000104', [config.cargos.recrutador]);
  const { guild, canal } = cenario([recrutador]);
  const antes = (await banco.q('SELECT count(*)::int AS n FROM sugestoes'))[0].n;

  const i = await enviar(guild, recrutador);
  assert.match(i.acao('editReply')[0].content, /SUGESTÃO \*\*#\d+\*\* PUBLICADA/);

  const publicada = canal.enviadas.find(m => m.embeds[0]?.title?.startsWith('💡 SUGESTÃO #'));
  assert.equal(publicada.embeds[0].description, texto);
  assert.match(publicada.embeds[0].footer.text, /^Enviado por /);
  const botoes = publicada.components[0].components;
  assert.match(botoes[0].data.custom_id, /^sug:votar:\d+:A$/);
  assert.match(botoes[1].data.custom_id, /^sug:votar:\d+:C$/);
  for (const b of botoes) assert.notEqual(b.data.style, 3, 'ButtonStyle.Success é verde'); // 3 = Success

  const [linha] = await banco.q('SELECT * FROM sugestoes ORDER BY id DESC LIMIT 1');
  assert.equal(linha.autor_id, recrutador.id);
  assert.equal(linha.message_id, publicada.id);
  assert.equal((await banco.q('SELECT count(*)::int AS n FROM sugestoes'))[0].n, antes + 1);

  const ultima = canal.historico[0];
  assert.equal(ultima.components[0].components[0].data.custom_id, 'sug:nova', 'o botão de enviar é a última mensagem do canal');
  assert.equal(canal.historico.filter(m => m.components[0]?.components[0]?.data.custom_id === 'sug:nova').length, 1);
});

test('sugestões: texto curto ou longo demais é recusado e nada é gravado', async () => {
  const recrutador = membro('900000000000000105', [config.cargos.recrutador]);
  const { guild, canal } = cenario([recrutador]);
  const antes = (await banco.q('SELECT count(*)::int AS n FROM sugestoes'))[0].n;
  for (const [t, re] of [['curto', /PELO MENOS 10/], ['x'.repeat(1001), /NO MÁXIMO 1000/]]) {
    const i = await enviar(guild, recrutador, { texto: t });
    assert.match(i.acao('reply')[0].content, re);
  }
  assert.equal(canal.enviadas.length, 0);
  assert.equal((await banco.q('SELECT count(*)::int AS n FROM sugestoes'))[0].n, antes);
});

test('sugestões: quem perdeu o cargo com o modal aberto não consegue enviar', async () => {
  const semCargo = membro('900000000000000106', [config.cargos.socio]);
  const { guild, canal } = cenario([semCargo]);
  const i = await enviar(guild, semCargo);
  assert.match(i.acao('reply')[0].content, /SÓ RECRUTADORES E ACIMA/);
  assert.equal(canal.enviadas.length, 0);
});

test('sugestões: sócio+ vota; um voto por pessoa (repetir retira, o outro troca); autor e visitante não votam', async () => {
  const autor = membro('900000000000000107', [config.cargos.recrutador]);
  const socioA = membro('900000000000000108', [config.cargos.socio]);
  const socioB = membro('900000000000000109', [config.cargos.socio]);
  const visitante = membro('900000000000000110', []);
  const { guild, canal } = cenario([autor, socioA, socioB, visitante]);
  await enviar(guild, autor);
  const [{ id }] = await banco.q('SELECT id FROM sugestoes WHERE autor_id = $1', [autor.id]);
  const rotulos = i => i.acao('update')[0].components[0].components.map(b => b.data.label);

  assert.deepEqual(rotulos(await votar(guild, canal, id, socioA, 'A')), ['1', '0']);
  assert.deepEqual(rotulos(await votar(guild, canal, id, socioB, 'C')), ['1', '1']);
  assert.deepEqual(rotulos(await votar(guild, canal, id, socioA, 'C')), ['0', '2']); // troca
  assert.deepEqual(rotulos(await votar(guild, canal, id, socioB, 'C')), ['0', '1']); // retira

  const proprio = await votar(guild, canal, id, autor, 'A');
  assert.match(proprio.acao('reply')[0].content, /NÃO PODE VOTAR NA PRÓPRIA SUGESTÃO/);
  const de_fora = await votar(guild, canal, id, visitante, 'A');
  assert.match(de_fora.acao('reply')[0].content, /SÓ SÓCIOS E ACIMA VOTAM/);
  assert.equal((await banco.q('SELECT count(*)::int AS n FROM sugestoes_votos WHERE sugestao_id = $1', [id]))[0].n, 1);
});
