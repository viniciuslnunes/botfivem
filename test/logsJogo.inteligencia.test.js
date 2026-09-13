const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRegistro } = require('../utils/logsJogo/parser');
const E = require('../utils/logsJogo/estatisticas');
const A = require('../utils/logsJogo/analises');

// Formatos reais tirados do banco em 2026-09-13 (eram 3.957 registros gravados
// como 'desconhecido'). Cada caso aqui é uma família inteira de log.

test('baú: título diz a ação e o compartimento, descrição traz id/item/quantidade', () => {
  const r = parseRegistro({
    title: 'Removeu [GDF Presidência]',
    description: 'Usuário: `13067`\nItem: `tecido`\nQuantidade: `5477`',
  });
  assert.equal(r.acao, 'bau_removeu');
  assert.equal(r.categoria, 'bau');
  assert.equal(r.atorIdFivem, '13067');
  assert.equal(r.atorNome, null); // o log do baú não traz nome
  assert.equal(r.alvoNome, 'tecido');
  assert.equal(r.valor, 5477);
  assert.equal(E.bauDoTitulo(r.titulo), 'GDF Presidência');

  const g = parseRegistro({ title: 'Guardou [GDF Sócio]', description: 'Usuário: `19618`\nItem: `mochila_m-1787863708`\nQuantidade: `1`' });
  assert.equal(g.acao, 'bau_guardou');
  assert.equal(g.alvoNome, 'mochila_m-1787863708');
});

test('fechaduras além de sede/portão entram com o nome em alvoNome; sede continua com a ação antiga', () => {
  const arena = parseRegistro({ title: 'Registro de Atividade: Blaczx Inajar', description: 'O jogador Blaczx Inajar (ID: 855) destrancou a arena.' });
  assert.equal(arena.acao, 'fechadura_destrancou');
  assert.equal(arena.alvoNome, 'arena');
  assert.equal(arena.atorIdFivem, '855');

  const entrada = parseRegistro({ description: 'O jogador Arthur Lima (ID: 2543) trancou a entrada automatica.' });
  assert.equal(entrada.acao, 'fechadura_trancou');
  assert.equal(entrada.alvoNome, 'entrada automatica');

  // "destrancou" contém "trancou": não pode cair na regra de trancar
  assert.equal(parseRegistro({ description: 'O jogador X (ID: 1) destrancou a bau.' }).acao, 'fechadura_destrancou');
  assert.equal(parseRegistro({ description: '#163 Gladiador LHP trancou a sede.' }).acao, 'sede_trancou');
});

test('arena bloqueada é outro sistema, não fechadura', () => {
  assert.equal(parseRegistro({ title: 'arena', description: '#182 Bxlhp Inajar bloqueou arena.' }).acao, 'arena_bloqueou');
  const d = parseRegistro({ title: 'arena', description: '#13067 Cris Sabará desbloqueou arena.' });
  assert.equal(d.acao, 'arena_desbloqueou');
  assert.equal(d.atorNome, 'Cris Sabará');
});

test('tag: ator, alvo e a tag entre parênteses; HTML do jogo não quebra a regra', () => {
  const r = parseRegistro({ title: 'tag', description: '#1716 Akemi GDF adicionou tag #3157 Ghosting JIUTHAI (RSJ).' });
  assert.equal(r.acao, 'tag_adicionou');
  assert.equal(r.atorIdFivem, '1716');
  assert.equal(r.alvoIdFivem, '3157');
  assert.equal(r.alvoNome, 'Ghosting JIUTHAI');
  assert.equal(E.extrairEntreParenteses(r.descricao), 'RSJ');

  const html = parseRegistro({ title: 'tag', description: '#1588 Renato Lhp <b>adicionou tag</b> #1588 Renato Lhp (RSJ).' });
  assert.equal(html.acao, 'tag_adicionou');
  assert.equal(html.atorNome, 'Renato Lhp');
});

test('restrições: blacklist, suspensão e impedimento; alvo "#nil" mantém o ator', () => {
  assert.equal(parseRegistro({ description: '#1164 Pipper Dazn adicionou impedimento #5150 Mkzin RSJ.' }).acao, 'impedimento_adicionou');
  assert.equal(parseRegistro({ description: '#13067 Cris Sabará removeu suspensão da torcida #10529 ajota ferreira.' }).acao, 'suspensao_removeu');

  const nil = parseRegistro({ description: '#537 Brodis Rsj adicionou blacklist da torcida #nil nil nil.' });
  assert.equal(nil.acao, 'blacklist_adicionou');
  assert.equal(nil.atorNome, 'Brodis Rsj');
  assert.equal(nil.alvoIdFivem, null);
});

test('expulsão com motivo escrito também é expulsão (antes só passava com parênteses vazios)', () => {
  const r = parseRegistro({ title: 'removeu', description: '#13067 Cris Sabará removeu #18493 Enzo Tody (Traidor).' });
  assert.equal(r.acao, 'expulso_torcida');
  assert.equal(r.alvoIdFivem, '18493');
  assert.equal(r.alvoNome, 'Enzo Tody');
  assert.equal(E.extrairEntreParenteses(r.descricao), 'Traidor');
});

test('disciplina: advertência (punido é o alvo), cumprimento, perdão e multa', () => {
  const adv = parseRegistro({ description: 'O jogador Rafinha Inajar (ID: 4043) foi ADVERTIDO por Japones Inajar. Motivo: não escutou call Serviços: 300' });
  assert.equal(adv.acao, 'advertido');
  assert.equal(adv.alvoIdFivem, '4043');
  assert.equal(adv.alvoNome, 'Rafinha Inajar');
  assert.equal(adv.atorNome, 'Japones Inajar');
  assert.equal(E.extrairMotivo(adv.descricao), 'não escutou call');
  assert.equal(E.extrairServicos(adv.descricao), 300);

  const fim = parseRegistro({ description: 'O jogador Lucas Souzinha (ID: 7285) FINALIZOU sua advertência.' });
  assert.equal(fim.acao, 'adv_finalizou');
  assert.equal(fim.alvoIdFivem, '7285');
  assert.equal(fim.atorIdFivem, null);

  const perdao = parseRegistro({ description: 'O administrador Blaczx Inajar (ID: 855) REMOVEU MANUALMENTE a advertencia do jogador Mn Lhp (ID: 898).' });
  assert.equal(perdao.acao, 'adv_removida');
  assert.equal(perdao.atorIdFivem, '855');
  assert.equal(perdao.alvoIdFivem, '898');

  const multa = parseRegistro({ title: 'multou', description: '#14589 Guilherme Skunk multou #4072 cabeleira LHP (Não obedece, finge que não escuta radio!).' });
  assert.equal(multa.acao, 'multou');
  assert.equal(multa.alvoIdFivem, '4072');
  assert.equal(E.extrairEntreParenteses(multa.descricao), 'Não obedece, finge que não escuta radio!');
});

test('dinheiro: banco da torcida (com e sem nome) separado de gasto do sócio', () => {
  const dep = parseRegistro({ description: 'O jogador ID 855 depositou R$ 100000 no banco da torcida.' });
  assert.equal(dep.acao, 'banco_depositou');
  assert.equal(dep.atorIdFivem, '855');
  assert.equal(dep.valor, 100000);

  const saque = parseRegistro({ description: 'O presidente ID 901 sacou R$ 120000 do banco da torcida.' });
  assert.equal(saque.acao, 'banco_sacou');
  assert.equal(saque.atorIdFivem, '901');

  const roupa = parseRegistro({ description: 'O jogador Gm Stupydu (ID: 731) comprou 2 peça(s) de roupa por R$ 500.' });
  assert.equal(roupa.acao, 'comprou_roupa');
  assert.equal(roupa.valor, 500);

  const item = parseRegistro({ title: 'comprou', description: '#13067 Cris Sabará comprou +1 Revolver no Arsenal.' });
  assert.equal(item.acao, 'comprou_item');
  assert.equal(item.alvoNome, '+1 Revolver no Arsenal');
});

test('configuração: webhook, definição de tag e cargo do jogo', () => {
  const cfg = parseRegistro({ title: 'config', description: '#560 Gabriel Inajar alterou a configuração de webhook_log.' });
  assert.equal(cfg.acao, 'config_alterou');
  assert.equal(cfg.alvoNome, 'webhook_log');
  assert.equal(parseRegistro({ description: '#163 Gladiador LHP alterou tag (R.S.J. > R.S.J.).' }).acao, 'tag_alterou');
  const cargo = parseRegistro({ description: 'O jogador ID 953 criou/editou o cargo Vice Presidente.' });
  assert.equal(cargo.acao, 'cargo_editado');
  assert.equal(cargo.alvoNome, 'Vice Presidente');
  assert.equal(cargo.atorIdFivem, '953');
});

test('mojibake é corrigido só quando o sinal está lá', () => {
  assert.equal(E.corrigirMojibake('Fabio PeÃ§a'), 'Fabio Peça');
  assert.equal(E.corrigirMojibake('Cris Sabará'), 'Cris Sabará');
  assert.equal(E.corrigirMojibake('Lipão Inajar'), 'Lipão Inajar');
  assert.equal(parseRegistro({ description: 'O jogador Fabio PeÃ§a (ID: 331) trancou a arena.' }).atorNome, 'Fabio Peça');
});

// ── analises.js ────────────────────────────────────────────────────────────
// Eventos no formato do banco (snake_case), em ordem DECRESCENTE como o
// repositório devolve.
const ev = (acao, extra = {}, minutosAtras = 0) => ({
  acao, ator_nome: null, ator_id_fivem: null, alvo_nome: null, alvo_id_fivem: null, descricao: '',
  ocorrido_em: new Date(Date.UTC(2026, 8, 13, 12, 0) - minutosAtras * 60000), ...extra,
});

test('restrição ativa é quem tem "adicionou" como último evento, por tipo', () => {
  const eventos = [
    ev('blacklist_removeu', { alvo_id_fivem: '1', alvo_nome: 'Solto' }, 1),
    ev('impedimento_adicionou', { alvo_id_fivem: '1', alvo_nome: 'Solto' }, 2),
    ev('blacklist_adicionou', { alvo_id_fivem: '1', alvo_nome: 'Solto' }, 3),
    ev('blacklist_adicionou', { alvo_id_fivem: '2', alvo_nome: 'Banido', ator_nome: 'Chefe' }, 4),
    ev('blacklist_adicionou', { alvo_id_fivem: null }, 5), // "#nil": sem alvo, não entra
  ];
  const ativas = A.restricoesAtivas(eventos);
  assert.deepEqual(ativas.map(r => `${r.tipo}:${r.id}`), ['impedimento:1', 'blacklist:2']);
  assert.equal(ativas[1].porNome, 'Chefe');
});

test('advertência aberta até cumprir ou ser perdoada; serviços somam', () => {
  const eventos = [
    ev('adv_finalizou', { alvo_id_fivem: '10' }, 1),
    ev('advertido', { alvo_id_fivem: '20', alvo_nome: 'Punido', descricao: 'foi ADVERTIDO por X. Motivo: zaralho Serviços: 70' }, 2),
    ev('advertido', { alvo_id_fivem: '10', descricao: 'Motivo: a Serviços: 100' }, 3),
    ev('adv_removida', { alvo_id_fivem: '30' }, 4),
    ev('advertido', { alvo_id_fivem: '30' }, 5),
  ];
  const ativas = A.advertenciasAtivas(eventos);
  assert.equal(ativas.length, 1);
  assert.equal(ativas[0].id, '20');
  assert.equal(ativas[0].servicos, 70);
  assert.equal(ativas[0].motivo, 'zaralho');
});

test('tags ativas por tag: perder uma não mexe nas outras da mesma pessoa', () => {
  const eventos = [
    ev('tag_removeu', { alvo_id_fivem: '877', alvo_nome: 'Felipe', descricao: 'removeu tag #877 Felipe (Arsenal).' }, 1),
    ev('tag_adicionou', { alvo_id_fivem: '877', alvo_nome: 'Felipe', descricao: 'adicionou tag #877 Felipe (RSJ).' }, 2),
    ev('tag_adicionou', { alvo_id_fivem: '877', alvo_nome: 'Felipe', descricao: 'adicionou tag #877 Felipe (Arsenal).' }, 3),
    ev('tag_adicionou', { alvo_id_fivem: '5', alvo_nome: 'Ana', descricao: 'adicionou tag #5 Ana (RSJ).' }, 4),
  ];
  const tags = A.tagsAtivas(eventos);
  assert.deepEqual(tags.map(t => [t.tag, t.membros.map(m => m.id)]), [['RSJ', ['5', '877']]]);
});

test('fechaduras: sede/portão antigos e genéricas numa lista, destrancada primeiro', () => {
  const eventos = [
    ev('fechadura_trancou', { alvo_nome: 'arena' }, 1),
    ev('sede_destrancou', { ator_nome: 'Cris' }, 30),
    ev('fechadura_destrancou', { alvo_nome: 'vestiario' }, 10),
    ev('fechadura_destrancou', { alvo_nome: 'arena' }, 50), // mais antigo que o trancou: ignorado
  ];
  const estado = A.estadoFechaduras(eventos);
  assert.deepEqual(estado.map(f => [f.fechadura, f.destrancada]), [['sede', true], ['vestiário', true], ['arena', false]]);
  assert.equal(estado[0].porNome, 'Cris');
});

test('fechadura sem log recente é "último estado conhecido", nunca "destrancada agora"', () => {
  const agora = new Date(Date.UTC(2026, 8, 13, 12, 0));
  const eventos = [
    ev('sede_trancou', {}, 5),
    ev('fechadura_destrancou', { alvo_nome: 'bau' }, 60 * 24 * 200), // janeiro: fonte parou
  ];
  const estado = A.estadoFechaduras(eventos, { agora, limiteMs: 3 * 24 * 60 * 60 * 1000 });
  assert.deepEqual(estado.map(f => [f.fechadura, f.destrancada, f.semLogRecente]), [['sede', false, false], ['baú', true, true]]);
});

test('desconhecidos agrupados por formato, não por texto', () => {
  const familias = A.agruparDesconhecidos([
    { canal_id: 'c', descricao: '#1 Fulano Tal fez coisa nova #9 Beltrano.', ocorrido_em: new Date('2026-09-10') },
    { canal_id: 'c', descricao: '#22 Outro Nome fez coisa nova #9 Beltrano.', ocorrido_em: new Date('2026-09-12') },
    { canal_id: 'c', descricao: '#3 Ciclano outro formato.', ocorrido_em: new Date('2026-09-11') },
  ]);
  assert.equal(familias.length, 2);
  assert.equal(familias[0].total, 2);
  assert.equal(familias[0].assinatura, 'fez coisa nova #ID Beltrano.');
});

test('logs-banco: coins de território, dinheiro e honra (formatos atuais)', () => {
  const dom = parseRegistro({ title: 'Coins', description: 'Origem: Dominação (1h): Vila dos Pelados\nCoins: +3' });
  assert.equal(dom.acao, 'coins_dominacao');
  assert.equal(dom.alvoNome, 'Vila dos Pelados');
  assert.equal(dom.valor, 3);
  assert.equal(dom.categoria, 'territorio');

  const conq = parseRegistro({ title: 'Coins', description: 'Origem: Conquista: Petrolífera\nCoins: +10' });
  assert.equal(conq.acao, 'coins_conquista');
  assert.equal(conq.alvoNome, 'Petrolífera');
  assert.equal(conq.valor, 10);

  const dep = parseRegistro({ title: 'Depositou dinheiro', description: 'Torcida: gavioes\nID: 13067\nValor: 1500000' });
  assert.equal(dep.acao, 'banco_depositou');
  assert.equal(dep.atorIdFivem, '13067');
  assert.equal(dep.valor, 1500000);
  assert.equal(parseRegistro({ title: 'Sacou dinheiro', description: 'Torcida: gavioes\nID: 560\nValor: 1' }).acao, 'banco_sacou');

  const honra = parseRegistro({ title: 'Gastou honra', description: 'Torcida: gavioes\nID: 13067\nValor: 600\nItem: 1x Veículo VIP' });
  assert.equal(honra.acao, 'honra_gastou');
  assert.equal(honra.valor, 600);
  assert.equal(honra.alvoNome, '1x Veículo VIP');
  assert.equal(parseRegistro({ title: 'Honra adicionada', description: 'Torcida: gavioes\nID: 2\nValor: 3000' }).valor, 3000);

  const staff = parseRegistro({ title: 'Dinheiro Adicionado', description: 'Usuário: 2\nValor: 2000000' });
  assert.equal(staff.acao, 'dinheiro_adicionado');
  assert.equal(staff.atorIdFivem, '2');
});

test('logs-banco: formatos antigos (sinal no valor) viram as mesmas ações dos atuais', () => {
  const dep = parseRegistro({ title: 'Dinheiro', description: 'Usuário: 15277\nValor: 300000' });
  assert.equal(dep.acao, 'banco_depositou');
  assert.equal(dep.atorIdFivem, '15277');
  assert.equal(dep.valor, 300000);

  const saque = parseRegistro({ title: 'Dinheiro', description: 'Usuário: 6\nValor: -50000' });
  assert.equal(saque.acao, 'banco_sacou');
  assert.equal(saque.valor, 50000);

  const honra = parseRegistro({ title: 'Honra', description: 'Usuário: 6\nValor: -500' });
  assert.equal(honra.acao, 'honra_gastou');
  assert.equal(honra.valor, 500);

  const conq = parseRegistro({ title: 'Banco', description: 'Usuário: Conquista: Farol\nValor: 15000' });
  assert.equal(conq.acao, 'dinheiro_conquista');
  assert.equal(conq.alvoNome, 'Farol');
  assert.equal(conq.valor, 15000);
});

test('território: horas = logs de dominação, ordenado por horas', () => {
  const { porTerritorio } = require('../utils/logsJogo/painelTerritorio');
  const t = porTerritorio([
    { alvo: 'Farol', acao: 'coins_dominacao', total: 5, soma: 15, ultima: new Date('2026-09-12') },
    { alvo: 'Farol', acao: 'coins_conquista', total: 2, soma: 20, ultima: new Date('2026-09-10') },
    { alvo: 'Metrô', acao: 'coins_dominacao', total: 9, soma: 27, ultima: new Date('2026-09-13') },
  ]);
  assert.deepEqual(t.map(x => [x.territorio, x.horas, x.conquistas, x.coins]), [['Metrô', 9, 0, 27], ['Farol', 5, 2, 35]]);
});

test('baú de recompensas: compartimento próprio, personagem com ID e nome', () => {
  const ret = parseRegistro({
    title: 'Baú de Recompensas [GDF] - Retirada (Torcida)',
    description: 'Personagem: #13067 Cris Sabará\nItem: Maconha\nQuantidade: 500\nData: 11/09/2026 23:44:05',
  });
  assert.equal(ret.acao, 'bau_removeu');
  assert.equal(ret.categoria, 'bau');
  assert.equal(ret.atorIdFivem, '13067');
  assert.equal(ret.atorNome, 'Cris Sabará');
  assert.equal(ret.alvoNome, 'Maconha');
  assert.equal(ret.valor, 500);
  assert.equal(E.bauDoTitulo(ret.titulo), 'Recompensas');

  const dep = parseRegistro({
    title: 'Baú de Recompensas [GDF] - Depósito (Staff)',
    description: 'Personagem: #2 Flavinha Hlb\nItem: Veículo VIP\nQuantidade: 3\nData: 18/07/2026 01:12:55',
  });
  assert.equal(dep.acao, 'bau_guardou');
  assert.equal(dep.atorNome, 'Flavinha Hlb');
  assert.equal(dep.alvoNome, 'Veículo VIP');
  assert.equal(dep.valor, 3);
  assert.equal(E.bauDoTitulo('Guardou [GDF Sócio]'), 'GDF Sócio');
});

test('tags: grafia antiga da mesma tag é a mesma tag, e quem saiu da torcida perde todas', () => {
  const eventos = [
    ev('tag_adicionou', { alvo_id_fivem: '9', alvo_nome: 'Voltou', descricao: 'adicionou tag #9 Voltou (RSJ).' }, 1),
    ev('expulso_torcida', { alvo_id_fivem: '9', ator_id_fivem: '1' }, 5), // expulso, voltou e ganhou RSJ de novo
    ev('saiu_torcida', { ator_id_fivem: '7' }, 6),
    ev('tag_adicionou', { alvo_id_fivem: '7', alvo_nome: 'Saiu', descricao: 'adicionou tag #7 Saiu (R.S.J.).' }, 10),
    ev('tag_adicionou', { alvo_id_fivem: '9', alvo_nome: 'Voltou', descricao: 'adicionou tag #9 Voltou (Arsenal).' }, 11),
    ev('tag_adicionou', { alvo_id_fivem: '5', alvo_nome: 'Ana', descricao: 'adicionou tag #5 Ana (R.S.J.).' }, 20),
  ];
  const tags = A.tagsAtivas(eventos);
  assert.deepEqual(tags.map(t => [t.tag, t.membros.map(m => m.id)]), [['RSJ', ['5', '9']]]);
});

test('desconhecido "Chave: valor" agrupa pelas chaves, não pelos valores', () => {
  assert.equal(
    A.assinaturaDesconhecido('Personagem: #13067 Cris Sabará Item: Maconha Quantidade: 500 Data: 11/09/2026 23:44:05'),
    A.assinaturaDesconhecido('Personagem: #2 Flavinha Item: Veículo VIP Quantidade: 3 Data: 18/07/2026 01:12:55')
  );
  const familias = A.agruparDesconhecidos([
    { canal_id: 'b', titulo: 'Baú X - Retirada', descricao: 'Personagem: #1 A Item: Pão Quantidade: 2', ocorrido_em: new Date('2026-09-10') },
    { canal_id: 'b', titulo: 'Baú X - Retirada', descricao: 'Personagem: #2 B Item: Faca Quantidade: 9', ocorrido_em: new Date('2026-09-11') },
    { canal_id: 'b', titulo: 'Baú X - Depósito', descricao: 'Personagem: #2 B Item: Faca Quantidade: 9', ocorrido_em: new Date('2026-09-11') },
  ]);
  assert.deepEqual(familias.map(f => f.total), [2, 1]);
});
