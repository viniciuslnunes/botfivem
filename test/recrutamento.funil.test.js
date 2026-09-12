const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../utils/recrutamento/funil');

const agora = new Date('2026-09-11T15:00:00Z');
const diasAtras = n => new Date(agora.getTime() - n * 86400000);
const membro = (nickname, socio) => ({ nickname, displayName: nickname, roles: { cache: { has: () => socio } } });

test('sócios mapeados pelo ID do apelido', () => {
  const mapa = F.mapearSociosPorIdFivem([membro('S GDF | Ana - 10', true), membro('S GDF | Beto - 20', false), membro('Visitante', true)], 'SOCIO');
  assert.deepEqual([...mapa.keys()], ['10']);
});

test('funil: sócio pelo apelido conta como pediu e aprovado', () => {
  const f = F.resumirFunil([
    { id_fivem: '1', ocorrido_em: diasAtras(5), pediu: true, aprovado: true },
    { id_fivem: '2', ocorrido_em: diasAtras(4), pediu: true, aprovado: false },
    { id_fivem: '3', ocorrido_em: diasAtras(3), pediu: false, aprovado: false },
    { id_fivem: '4', ocorrido_em: diasAtras(2), pediu: false, aprovado: false },
  ], new Set(['4']));
  assert.equal(f.novatos, 4);
  assert.equal(f.pediram, 3);
  assert.equal(f.aprovados, 2);
  assert.equal(f.taxaAprovacao, 2 / 3);
  assert.deepEqual(f.semPedido.map(n => n.id_fivem), ['3']);
  assert.equal(F.resumirFunil([]).taxaPedido, null);
});

test('alerta: só depois de N dias, dentro da janela, uma vez por ID', () => {
  const novatos = [
    { id_fivem: 'recente', ocorrido_em: diasAtras(1), pediu: false, aprovado: false },
    { id_fivem: 'alvo', ocorrido_em: diasAtras(4), pediu: false, aprovado: false },
    { id_fivem: 'antigo', ocorrido_em: diasAtras(40), pediu: false, aprovado: false },
    { id_fivem: 'pediu', ocorrido_em: diasAtras(5), pediu: true, aprovado: false },
    { id_fivem: 'socio', ocorrido_em: diasAtras(5), pediu: false, aprovado: false },
    { id_fivem: 'avisado', ocorrido_em: diasAtras(5), pediu: false, aprovado: false },
  ];
  const r = F.novatosParaAlertar(novatos, { idsSocios: new Set(['socio']), jaAlertados: new Set(['avisado']), agora, dias: 3 });
  assert.deepEqual(r.map(n => n.id_fivem), ['alvo']);
});
