const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const R = require('../utils/rifas/regras');

test('criação: faixa de números, preço e limite por pessoa', () => {
  assert.equal(R.validarCriacao({ totalNumeros: 100, preco: 50, limitePorPessoa: 10 }).ok, true);
  assert.equal(R.validarCriacao({ totalNumeros: 9, preco: 50 }).ok, false);
  assert.equal(R.validarCriacao({ totalNumeros: 10001, preco: 50 }).ok, false);
  assert.equal(R.validarCriacao({ totalNumeros: 100, preco: null }).ok, false);
  assert.equal(R.validarCriacao({ totalNumeros: 100, preco: 50, limitePorPessoa: 101 }).ok, false);
  assert.equal(R.limitePadrao(100), 10);
  assert.equal(R.limitePadrao(15), 2);
});

test('números escolhidos: lista, faixa, fora da rifa e excesso', () => {
  assert.deepEqual(R.parseNumeros('13, 7; 20 - 22 7', 100).numeros, [7, 13, 20, 21, 22]);
  assert.match(R.parseNumeros('0', 100).erro, /FORA DA RIFA/);
  assert.match(R.parseNumeros('99-101', 100).erro, /FORA DA RIFA/);
  assert.match(R.parseNumeros('22-20', 100).erro, /INVERTIDA/);
  assert.match(R.parseNumeros('sete', 100).erro, /NÃO ENTENDI/);
  assert.match(R.parseNumeros('1-60', 100).erro, /NO MÁXIMO/);
  assert.match(R.parseNumeros('', 100).erro, /AO MENOS UM/);
});

test('exibição: zeros à esquerda e faixas compactas', () => {
  assert.equal(R.formatarNumero(7, 1000), '0007');
  assert.equal(R.formatarNumero(7, 999), '007');
  assert.deepEqual(R.faixasCompactas([10, 1, 2, 3, 7, 9], 100), ['001-003', '007', '009-010']);
  assert.deepEqual(R.numerosLivres(5, new Set([2, 4])), [1, 3, 5]);
});

test('venda: status, prazo e limite por pessoa', () => {
  const agora = new Date('2026-09-11T15:00:00Z');
  assert.equal(R.aceitaVenda({ status: 'ABERTA', encerra_em: null }, agora), true);
  assert.equal(R.aceitaVenda({ status: 'ABERTA', encerra_em: '2026-09-11T14:59:00Z' }, agora), false);
  assert.equal(R.aceitaVenda({ status: 'ENCERRADA', encerra_em: null }, agora), false);
  assert.equal(R.saldoLimite(null, 40), null);
  assert.equal(R.saldoLimite(10, 7), 3);
  assert.equal(R.saldoLimite(10, 12), 0);
  assert.equal(R.totalCompra('19.90', 3), 59.7);
});

test('data do sorteio só com 70% vendidos, dizendo quanto falta em números', () => {
  assert.deepEqual(R.progressoLimiar({ totalNumeros: 100, vendidos: 17 }), { pct: 70, alvo: 70, faltam: 53, atingido: false });
  assert.equal(R.progressoLimiar({ totalNumeros: 101, vendidos: 71 }).atingido, true);
  assert.equal(R.cruzouLimiar({ totalNumeros: 100, antes: 68, depois: 70 }), true);
  assert.equal(R.cruzouLimiar({ totalNumeros: 100, antes: 70, depois: 75 }), false);
  assert.equal(R.barraProgresso(0.5, 4), '▰▰▱▱');
});

test('aleatório nunca devolve número ocupado, nem na rifa quase cheia', () => {
  let semente = 1;
  const aleatorio = () => { semente = (semente * 16807) % 2147483647; return semente / 2147483647; };
  const tomados = new Set([1, 2, 3]);
  const esparso = R.sortearNumerosLivres(100, tomados, 10, aleatorio);
  assert.equal(esparso.length, 10);
  assert.equal(new Set(esparso).size, 10);
  assert.ok(esparso.every(n => n >= 1 && n <= 100 && !tomados.has(n)));

  const cheio = new Set([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(R.sortearNumerosLivres(10, cheio, 5, aleatorio).sort((a, b) => a - b), [9, 10]);
});

test('sorteio pelo bot: compromisso confere e qualquer um recalcula o vencedor', () => {
  const { semente, hash } = R.gerarCompromisso();
  assert.equal(R.conferirCompromisso(semente, hash), true);
  assert.equal(R.conferirCompromisso(`${semente}0`, hash), false);

  const pagos = [42, 3, 17, 8];
  const r = R.sorteioSistema({ semente, rifaId: '12', pagos });
  const lista = [3, 8, 17, 42];
  const hmac = crypto.createHmac('sha256', semente).update(`12:${lista.join(',')}`).digest('hex');
  assert.equal(r.numero, lista[Number(BigInt(`0x${hmac}`) % 4n)]);
  assert.equal(r.hashLista, R.hashListaPagos(pagos));
  assert.deepEqual(R.sorteioSistema({ semente, rifaId: '12', pagos: [...lista].reverse() }), r);
  assert.notEqual(R.hashListaPagos([...pagos, 50]), r.hashLista);
  assert.equal(R.sorteioSistema({ semente, rifaId: '12', pagos: [] }), null);
});

test('sorteio ao vivo: número não vendido segue a regra da criação', () => {
  const pagos = [5, 40, 77];
  assert.equal(R.resolverVencedorManual(40, pagos, 100, 'PROXIMO_VENDIDO'), 40);
  assert.equal(R.resolverVencedorManual(41, pagos, 100, 'PROXIMO_VENDIDO'), 77);
  assert.equal(R.resolverVencedorManual(90, pagos, 100, 'PROXIMO_VENDIDO'), 5); // dá a volta na faixa
  assert.equal(R.resolverVencedorManual(41, pagos, 100, 'REPETIR_SORTEIO'), null);
  assert.equal(R.resolverVencedorManual(41, [], 100, 'PROXIMO_VENDIDO'), null);
});

test('sortear exige vendas encerradas, venda paga e nenhuma compra pendente', () => {
  assert.deepEqual(R.bloqueiosParaSortear({ status: 'ENCERRADA', metodo: 'SISTEMA', compromissoHash: 'x', vendidos: 3, pendentes: 0 }), []);
  assert.equal(R.bloqueiosParaSortear({ status: 'ABERTA', metodo: 'MANUAL', vendidos: 3, pendentes: 0 }).length, 1);
  assert.equal(R.bloqueiosParaSortear({ status: 'ENCERRADA', metodo: 'SISTEMA', compromissoHash: null, vendidos: 0, pendentes: 2 }).length, 3);
  assert.equal(R.podeTransicionar('ABERTA', 'SORTEADA'), false);
  assert.equal(R.podeTransicionar('ENCERRADA', 'SORTEADA'), true);
  assert.equal(R.podeTransicionar('SORTEADA', 'CANCELADA'), false);
});

test('resultado, chance real e auditoria', () => {
  assert.deepEqual(R.resultadoRifa({ arrecadado: 5000, custoPremio: 1200.5 }), { arrecadado: 5000, custoPremio: 1200.5, liquido: 3799.5 });
  assert.equal(R.resultadoRifa({ arrecadado: 5000 }).liquido, 5000);
  assert.equal(R.chanceDeGanhar({ meus: 2, vendidos: 20 }), 0.1);
  assert.equal(R.chanceDeGanhar({ meus: 2, vendidos: 0 }), null);
  assert.equal(R.formatarChance(0.004), 'menos de 1%');
  assert.equal(R.formatarChance(0.1), '10%');

  const { semente, hash } = R.gerarCompromisso();
  const s = R.sorteioSistema({ semente, rifaId: '3', pagos: [1, 2, 9] });
  const texto = R.textoAuditoria({
    id: '3', titulo: 'Camisa', premio: 'Camisa autografada', metodo_sorteio: 'SISTEMA', compromisso_hash: hash, semente,
    hash_lista_final: s.hashLista, numero_vencedor: s.numero, sorteada_em: new Date(),
  }, [9, 1, 2]);
  assert.match(texto, /1,2,9/);
  assert.ok(texto.includes(semente) && texto.includes(hash));
  assert.match(texto, new RegExp(`NÚMERO VENCEDOR: ${s.numero}$`));
});
