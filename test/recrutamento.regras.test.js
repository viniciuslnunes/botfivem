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

test('rótulo de categoria desconhecida cai em "Outro motivo"', () => {
  assert.equal(R.rotuloCategoria('conduta'), 'Conduta ou histórico no servidor');
  assert.equal(R.rotuloCategoria('nao-existe'), 'Outro motivo');
});
