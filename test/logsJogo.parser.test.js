const test = require('node:test');
const assert = require('node:assert/strict');
const { parseRegistro, extrairValor, extrairCategoria } = require('../utils/logsJogo/parser');

test('novato no formato real do webhook', () => {
  const r = parseRegistro({
    title: 'Registro de Atividade: Rarin Dimarolla',
    description: 'O Novato Rarin Dimarolla (ID: 8914 ) entrou na sua torcida Novato.',
    footer: { text: 'Time: Gaviões da Fiel | Categoria: lideranca • Hoje às 20:15' },
  });
  assert.equal(r.acao, 'novato_entrou');
  assert.equal(r.atorNome, 'Rarin Dimarolla');
  assert.equal(r.atorIdFivem, '8914');
  assert.equal(r.categoria, 'lideranca');
});

test('novato no formato do /testenovato (com negrito)', () => {
  const r = parseRegistro({
    title: 'Registro de Atividade: Teste Novato',
    description: 'O Novato **Teste Novato** (ID: **9999**) entrou na sua torcida **Novato**.',
    footer: { text: 'Time: Gaviões da Fiel | Categoria: lideranca • Hoje às 10:00' },
  });
  assert.equal(r.acao, 'novato_entrou');
  assert.equal(r.atorNome, 'Teste Novato');
  assert.equal(r.atorIdFivem, '9999');
});

test('entrada de jogador no formato do canal logs-painel', () => {
  const r = parseRegistro({
    title: 'Entrada',
    description: '#13138 Will lhp entrou no servidor.',
  });
  assert.equal(r.acao, 'jogador_entrou');
  assert.equal(r.atorNome, 'Will lhp');
  assert.equal(r.atorIdFivem, '13138');
  assert.equal(r.categoria, 'conexao');
});

test('saída de jogador no formato do canal logs-painel', () => {
  const r = parseRegistro({
    title: 'Saída',
    description: '#19200 Bigode lmzz saiu do servidor.',
  });
  assert.equal(r.acao, 'jogador_saiu');
  assert.equal(r.atorNome, 'Bigode lmzz');
  assert.equal(r.atorIdFivem, '19200');
  assert.equal(r.categoria, 'conexao');
});

test('recrutamento do próprio jogo (canal logs-recrutamento)', () => {
  const r = parseRegistro({
    title: 'Recrutamento',
    description: '#15277 Tiago Magrão recrutou #19465 Gelado Silva.',
  });
  assert.equal(r.acao, 'jogador_recrutou');
  assert.equal(r.atorNome, 'Tiago Magrão');
  assert.equal(r.atorIdFivem, '15277');
  assert.equal(r.alvoNome, 'Gelado Silva');
  assert.equal(r.alvoIdFivem, '19465');
  assert.equal(r.categoria, 'recrutamento');
});

test('sede trancada/destrancada (canal logs-painel)', () => {
  const trancou = parseRegistro({ title: 'Sede', description: '#163 Gladiador LHP trancou a sede.' });
  assert.equal(trancou.acao, 'sede_trancou');
  assert.equal(trancou.atorNome, 'Gladiador LHP');
  assert.equal(trancou.atorIdFivem, '163');
  assert.equal(trancou.categoria, 'patrimonio');

  const destrancou = parseRegistro({ title: 'Sede', description: '#13067 Cris Sabará destrancou a sede.' });
  assert.equal(destrancou.acao, 'sede_destrancou');
  assert.equal(destrancou.atorNome, 'Cris Sabará');
});

test('portão trancado/destrancado, galpão ou externo', () => {
  const trancou = parseRegistro({ title: 'Portão', description: '#1983 Joao Vitor trancou o portão do galpão.' });
  assert.equal(trancou.acao, 'portao_trancou');
  assert.equal(trancou.atorNome, 'Joao Vitor');

  const destrancou = parseRegistro({ title: 'Portão', description: '#7311 Bragunso Pertubado destrancou o portão externo.' });
  assert.equal(destrancou.acao, 'portao_destrancou');
  assert.equal(destrancou.atorIdFivem, '7311');
});

test('uso do sistema de trancar porta não diz se trancou ou destrancou, mas conta como atividade', () => {
  const r = parseRegistro({
    title: 'Registro de Atividade: Mgzin Lhp',
    description: 'O jogador Mgzin Lhp (ID: 377) usou o sistema de trancar porta.',
    footer: { text: 'Time: Gaviões da Fiel | Categoria: lideranca' },
  });
  assert.equal(r.acao, 'usou_sistema_porta');
  assert.equal(r.atorNome, 'Mgzin Lhp');
  assert.equal(r.atorIdFivem, '377');
});

test('convocação da equipe pra sede', () => {
  const r = parseRegistro({
    title: 'Registro de Atividade: Japa Sccp',
    description: 'O jogador Japa Sccp (ID: 368) convocou a equipe para a sede.',
  });
  assert.equal(r.acao, 'convocou_equipe');
  assert.equal(r.atorNome, 'Japa Sccp');
  assert.equal(r.atorIdFivem, '368');
  assert.equal(r.categoria, 'lideranca');
});

test('promoção e rebaixamento de cargo (o "de > para" fica na descrição, não em coluna própria)', () => {
  const promoveu = parseRegistro({
    title: 'promoveu',
    description: '#560 Gabriel Inajar promoveu #7670 Milgrau LHP (Sócio > Recrutador).',
  });
  assert.equal(promoveu.acao, 'promoveu_cargo');
  assert.equal(promoveu.atorNome, 'Gabriel Inajar');
  assert.equal(promoveu.atorIdFivem, '560');
  assert.equal(promoveu.alvoNome, 'Milgrau LHP');
  assert.equal(promoveu.alvoIdFivem, '7670');
  assert.match(promoveu.descricao, /Sócio > Recrutador/);

  const rebaixou = parseRegistro({
    title: 'rebaixou',
    description: '#1535 Texugo daBaixada rebaixou #196 Miguel ZonaLeste (Diretor > Recrutador).',
  });
  assert.equal(rebaixou.acao, 'rebaixou_cargo');
  assert.equal(rebaixou.alvoNome, 'Miguel ZonaLeste');
});

test('saída de sócio: voluntária, expulsão e remoção automática por inatividade', () => {
  const voluntaria = parseRegistro({ title: 'removeu', description: '#2127 Eduardo Fkk saiu da torcida.' });
  assert.equal(voluntaria.acao, 'saiu_torcida');
  assert.equal(voluntaria.atorNome, 'Eduardo Fkk');
  assert.equal(voluntaria.categoria, 'saida');

  const expulsao = parseRegistro({ title: 'removeu', description: '#2190 Macaco Loko removeu #3766 Paulo Vitor ().' });
  assert.equal(expulsao.acao, 'expulso_torcida');
  assert.equal(expulsao.atorNome, 'Macaco Loko');
  assert.equal(expulsao.alvoNome, 'Paulo Vitor');
  assert.equal(expulsao.alvoIdFivem, '3766');

  const automatica = parseRegistro({
    title: 'removeu',
    description: '#10728 Jhow Sccp removido automaticamente da torcida (sem login há mais de 10 dias).',
  });
  assert.equal(automatica.acao, 'removido_torcida_automatico');
  assert.equal(automatica.alvoNome, 'Jhow Sccp');
  assert.equal(automatica.alvoIdFivem, '10728');
  assert.equal(automatica.atorIdFivem, null); // ninguém agiu, foi o próprio sistema
});

test('remoção de blacklist/suspensão não é confundida com expulsão de sócio (sem segundo #ID de alvo)', () => {
  const r = parseRegistro({ title: 'blacklist', description: '#2190 Macaco Loko adicionou blacklist da torcida #7262 Pedro Pisico.' });
  assert.equal(r.acao, 'desconhecido');
});

test('formato desconhecido é mantido, com IDs e valor extraídos', () => {
  const r = parseRegistro({
    title: 'Registro de Atividade: Fulano',
    description: 'Fulano (ID: 12) depositou $ 1.500 no baú para Ciclano (ID: 34).',
    footer: { text: 'Time: Gaviões da Fiel | Categoria: Bau' },
  });
  assert.equal(r.acao, 'desconhecido');
  assert.equal(r.atorNome, 'Fulano');
  assert.equal(r.atorIdFivem, '12');
  assert.equal(r.alvoIdFivem, '34');
  assert.equal(r.valor, 1500);
  assert.equal(r.categoria, 'bau');
  assert.match(r.descricao, /depositou/);
});

test('campos do embed entram no texto analisado', () => {
  const r = parseRegistro({ fields: [{ name: 'Quantia', value: 'R$ 2.345,50' }] });
  assert.equal(r.valor, 2345.5);
  assert.equal(r.categoria, null);
  assert.equal(r.atorNome, null);
});

test('valores em dinheiro do jogo', () => {
  assert.equal(extrairValor('$2500'), 2500);
  assert.equal(extrairValor('$ 1.234.567'), 1234567);
  assert.equal(extrairValor('R$ 10,5'), 10.5);
  assert.equal(extrairValor('sem dinheiro (ID: 8914)'), null);
});

test('categoria no rodapé', () => {
  assert.equal(extrairCategoria('Time: X | Categoria: Membros • Ontem'), 'membros');
  assert.equal(extrairCategoria('sem categoria'), null);
});
