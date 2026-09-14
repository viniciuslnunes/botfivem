const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../utils/logsJogo/painelFormato');

// Tabela monoespaçada (```...```) — alternativa à lista numerada de texto
// corrido pra ranking com várias colunas (pedido do usuário em 2026-09-14,
// ver painelTerritorioInteracoes.js). Só a função pura, sem banco.

test('tabela alinha colunas por largura (título ou maior célula, o que for maior)', () => {
  const colunas = [
    { titulo: '#', alinhar: 'dir', valor: (_, i) => String(i + 1) },
    { titulo: 'TERRITÓRIO', alinhar: 'esq', valor: t => t.nome },
    { titulo: 'COINS', alinhar: 'dir', valor: t => String(t.coins) },
  ];
  const linhas = [{ nome: 'Hipódromo', coins: 354 }, { nome: 'Metrô', coins: 8 }];
  const texto = F.tabela(colunas, linhas);
  const [, cabecalho, l1, l2] = texto.split('\n');
  assert.equal(cabecalho, '#  TERRITÓRIO  COINS');
  assert.equal(l1, '1  Hipódromo     354');
  assert.equal(l2, '2  Metrô           8');
  assert.ok(texto.startsWith('```') && texto.endsWith('```'));
});

test('tabela com lista vazia devolve null (nada pra desenhar)', () => {
  assert.equal(F.tabela([{ titulo: 'X', alinhar: 'esq', valor: () => '' }], []), null);
});

test('tabela corta célula acima de larguraMax e nunca deixa crase quebrar o bloco', () => {
  const colunas = [{ titulo: 'NOME', alinhar: 'esq', larguraMax: 5, valor: t => t.nome }];
  const texto = F.tabela(colunas, [{ nome: 'Nome bem comprido' }, { nome: 'a`b' }]);
  const linhas = texto.split('\n');
  assert.ok(linhas[2].includes('…'), 'nome longo trunca com reticências');
  assert.ok(!texto.includes("a`b"), 'crase da célula não sobrevive');
  assert.ok(texto.includes("a'b"), 'crase vira aspa simples');
});
