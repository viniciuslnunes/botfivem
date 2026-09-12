const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../utils/departamentos/regras');

const base = { atorPresidencia: false, atorGestorDaArea: false, alvoSocio: true, alvoPapelAtual: null };

test('quem não é presidência nem gestor da área não mexe em ninguém', () => {
  assert.equal(D.decidirMudancaArea({ ...base, acao: 'incluir', papel: 'membro' }).ok, false);
  assert.equal(D.decidirMudancaArea({ ...base, acao: 'remover', alvoPapelAtual: 'membro' }).ok, false);
});

test('gestor inclui e remove membro, mas não mexe em gestor', () => {
  const gestor = { ...base, atorGestorDaArea: true };
  assert.deepEqual(D.decidirMudancaArea({ ...gestor, acao: 'incluir', papel: 'membro' }).adicionar, ['membro']);
  assert.equal(D.decidirMudancaArea({ ...gestor, acao: 'incluir', papel: 'gestor' }).ok, false);
  assert.deepEqual(D.decidirMudancaArea({ ...gestor, acao: 'remover', alvoPapelAtual: 'membro' }).remover, ['membro', 'gestor']);
  assert.equal(D.decidirMudancaArea({ ...gestor, acao: 'remover', alvoPapelAtual: 'gestor' }).ok, false);
  assert.equal(D.decidirMudancaArea({ ...gestor, acao: 'incluir', papel: 'membro', alvoPapelAtual: 'gestor' }).ok, false);
});

test('presidência define, promove e rebaixa gestor', () => {
  const presidencia = { ...base, atorPresidencia: true };
  assert.deepEqual(D.decidirMudancaArea({ ...presidencia, acao: 'incluir', papel: 'gestor' }).adicionar, ['membro', 'gestor']);
  assert.deepEqual(D.decidirMudancaArea({ ...presidencia, acao: 'incluir', papel: 'gestor', alvoPapelAtual: 'membro' }).adicionar, ['gestor']);
  const rebaixar = D.decidirMudancaArea({ ...presidencia, acao: 'incluir', papel: 'membro', alvoPapelAtual: 'gestor' });
  assert.deepEqual(rebaixar.remover, ['gestor']);
  assert.equal(rebaixar.resumo, 'rebaixado a membro');
});

test('só sócio entra em área; repetir papel e remover quem não está são avisos', () => {
  const presidencia = { ...base, atorPresidencia: true };
  assert.equal(D.decidirMudancaArea({ ...presidencia, acao: 'incluir', papel: 'membro', alvoSocio: false }).ok, false);
  assert.equal(D.decidirMudancaArea({ ...presidencia, acao: 'incluir', papel: 'membro', alvoPapelAtual: 'membro' }).ok, false);
  assert.equal(D.decidirMudancaArea({ ...presidencia, acao: 'remover' }).ok, false);
  // Ex-sócio pode ser removido (limpeza), mesmo sem o cargo SÓCIO
  assert.equal(D.decidirMudancaArea({ ...presidencia, acao: 'remover', alvoSocio: false, alvoPapelAtual: 'membro' }).ok, true);
});

test('nomes de cargo e canal', () => {
  assert.deepEqual(D.nomesDosCargos('Bateria'), { membro: 'MEMBRO • BATERIA', gestor: 'GESTOR • BATERIA' });
  assert.equal(D.nomeDoCanal({ emoji: '🥁', slug: 'bateria' }), '🥁・bateria');
  assert.equal(D.papelAtual({ temMembro: true, temGestor: true }), 'gestor');
  assert.equal(D.papelAtual({ temMembro: false, temGestor: false }), null);
});

test('lista do quadro não corta menção no meio', () => {
  const linhas = Array.from({ length: 40 }, (_, i) => `<@${100000000000000000 + i}>`);
  const texto = D.listaLimitada(linhas, 200);
  assert.ok(texto.length <= 200);
  assert.match(texto, /… e mais \d+/);
  for (const linha of texto.split('\n').slice(0, -1)) assert.match(linha, /^<@\d+>$/);
  assert.equal(D.listaLimitada(['<@1>', '<@2>'], 200), '<@1>\n<@2>');
});
