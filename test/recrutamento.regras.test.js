const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../utils/recrutamento/regras');

test('laudo exige categoria conhecida e justificativa de 15 a 1000 caracteres', () => {
  assert.equal(R.validarLaudo({ categoria: 'xyz', justificativa: 'a'.repeat(20) }).ok, false);
  assert.equal(R.validarLaudo({ categoria: 'manto', justificativa: 'curta demais' }).ok, false);
  assert.equal(R.validarLaudo({ categoria: 'manto', justificativa: 'a'.repeat(1001) }).ok, false);
  const ok = R.validarLaudo({ categoria: 'manto', justificativa: '   Não enviou a foto do manto no prazo.  ' });
  assert.equal(ok.ok, true);
  assert.equal(ok.justificativa, 'Não enviou a foto do manto no prazo.');
});

test('nova solicitação: definitiva barra, pendente recente barra, pendente esquecida libera', () => {
  const agora = new Date('2026-09-11T12:00:00Z').getTime();
  assert.equal(R.avaliarNovaSolicitacao(null, agora).ok, true);
  assert.equal(R.avaliarNovaSolicitacao({ reprovacaoDefinitiva: true, pendenteDesde: null }, agora).ok, false);
  assert.equal(R.avaliarNovaSolicitacao({ reprovacaoDefinitiva: false, pendenteDesde: new Date('2026-09-10T12:00:00Z') }, agora).ok, false);
  assert.equal(R.avaliarNovaSolicitacao({ reprovacaoDefinitiva: false, pendenteDesde: new Date('2026-09-01T12:00:00Z') }, agora).ok, true);
  assert.equal(R.avaliarNovaSolicitacao({ reprovacaoDefinitiva: false, pendenteDesde: null }, agora).ok, true);
});

test('ficha lida do embed de análise', () => {
  const campos = [
    { name: 'NOME', value: 'Rarin' },
    { name: 'IDADE', value: '19' },
    { name: 'ID FIVEM', value: '8914' },
    { name: 'TELEFONE', value: '11912345678' },
    { name: 'RECRUTADOR', value: 'Fulano' },
    { name: 'ÁREA PRETENDIDA', value: 'Bateria' },
    { name: 'ID | DISCORD', value: '123456789012345678 | <@123456789012345678>' },
  ];
  const f = R.lerFichaDoEmbed(campos);
  assert.equal(f.discordId, '123456789012345678');
  assert.equal(f.idade, 19);
  assert.equal(f.idFivem, '8914');
  assert.equal(R.slugDaAreaNoEmbed(campos, [{ slug: 'bateria', nome: 'Bateria' }]), 'bateria');
  assert.equal(R.slugDaAreaNoEmbed(campos.filter(c => c.name !== 'ÁREA PRETENDIDA'), [{ slug: 'bateria', nome: 'Bateria' }]), null);
});

test('liberação de reprovação definitiva exige motivo de 10 a 500 caracteres', () => {
  assert.equal(R.validarMotivoLiberacao('curto').ok, false);
  assert.equal(R.validarMotivoLiberacao('a'.repeat(501)).ok, false);
  const ok = R.validarMotivoLiberacao('  Provou o manto depois, conversamos no ticket.  ');
  assert.equal(ok.ok, true);
  assert.equal(ok.motivo, 'Provou o manto depois, conversamos no ticket.');
});

test('busca de reprovados: números = ID FiveM exato; texto = parte do nome sem acento', () => {
  const lista = [
    { message_id: 'a', nome: 'João Jesus', id_fivem: '16993' },
    { message_id: 'b', nome: 'Rarin', id_fivem: '169' },
  ];
  assert.deepEqual(R.filtrarReprovados(lista, '169').map(r => r.message_id), ['b']);
  assert.deepEqual(R.filtrarReprovados(lista, ' joao ').map(r => r.message_id), ['a']);
  assert.deepEqual(R.filtrarReprovados(lista, '   '), []);
});

test('opção do select de reprovado cabe no limite do Discord', () => {
  const opcao = R.opcaoReprovado({ message_id: 'm1', nome: 'x'.repeat(120), id_fivem: '1', reprovado_categoria: 'manto' });
  assert.equal(opcao.value, 'm1');
  assert.ok(opcao.label.length <= 100);
  assert.equal(opcao.description, 'Não enviou o manto');
});

test('rótulo de categoria desconhecida cai em "Outro motivo"', () => {
  assert.equal(R.rotuloCategoria('conduta'), 'Conduta ou histórico no servidor');
  assert.equal(R.rotuloCategoria('nao-existe'), 'Outro motivo');
});
