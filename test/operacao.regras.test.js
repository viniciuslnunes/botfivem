const test = require('node:test');
const assert = require('node:assert/strict');
const Esc = require('../utils/escala/regras');
const Car = require('../utils/caravana/regras');
const Pat = require('../utils/patrimonio/regras');

const agora = new Date('2026-09-11T15:00:00Z');

test('escala: vazia, sem coordenação, silêncio a menos de 48h e recusas', () => {
  const daqui24h = new Date(agora.getTime() + 24 * 3600000);
  assert.equal(Esc.pendenciasEscala({ escala: [], inicioEm: daqui24h, agora })[0].gravidade, 'alta');
  const escala = [
    { funcao: 'COORDENACAO', status: 'RECUSADO' },
    { funcao: 'BANDEIRA', status: 'CONVOCADO' },
    { funcao: 'BATERIA', status: 'ACEITO' },
  ];
  const textos = Esc.pendenciasEscala({ escala, inicioEm: daqui24h, agora }).map(p => p.texto);
  assert.ok(textos.some(t => t.startsWith('Sem coordenação')));
  assert.ok(textos.some(t => t.includes('sem resposta a menos de 48h')));
  assert.ok(textos.some(t => t.includes('recusa')));
  const daqui5dias = new Date(agora.getTime() + 5 * 86400000);
  const semSilencio = Esc.pendenciasEscala({ escala: [{ funcao: 'COORDENACAO', status: 'CONVOCADO' }], inicioEm: daqui5dias, agora });
  assert.equal(semSilencio.length, 0);
});

test('caravana: capacidade do veículo', () => {
  assert.equal(Car.podeAlocarNoVeiculo({ capacidade: 2, alocados: 1, jaNesteVeiculo: false }).ok, true);
  assert.equal(Car.podeAlocarNoVeiculo({ capacidade: 2, alocados: 2, jaNesteVeiculo: false }).ok, false);
  assert.equal(Car.podeAlocarNoVeiculo({ capacidade: 2, alocados: 0, jaNesteVeiculo: true }).ok, false);
});

test('caravana: pendências de frota', () => {
  const daqui48h = new Date(agora.getTime() + 48 * 3600000);
  assert.equal(Car.pendenciasCaravana({ veiculos: [], confirmados: [{}], inicioEm: daqui48h, agora })[0].texto, 'Nenhum veículo cadastrado.');
  const p = Car.pendenciasCaravana({
    veiculos: [{ capacidade: 1, responsavel_id: null }],
    confirmados: [{ discord_id: 'a', veiculo_id: 1 }, { discord_id: 'b', veiculo_id: null }],
    inicioEm: daqui48h,
    agora,
  }).map(x => x.texto);
  assert.ok(p.includes('Faltam 1 assento para os confirmados.'));
  assert.ok(p.includes('1 veículo sem responsável.'));
  assert.ok(p.includes('1 confirmado ainda sem veículo a menos de 72h.'));
});

test('caravana: volta sem ida aparece', () => {
  const r = Car.resumirEmbarque([
    { discord_id: 'a', trecho: 'IDA' }, { discord_id: 'a', trecho: 'VOLTA' }, { discord_id: 'b', trecho: 'VOLTA' },
  ]);
  assert.equal(r.ida.size, 1);
  assert.deepEqual(r.voltaSemIda, ['b']);
});

test('patrimônio: recortes de Bandeiras e Bateria não abrem o acervo inteiro', () => {
  const gestorBandeiras = Pat.resolverEscopoPatrimonio({ papelBandeiras: 'gestor' });
  assert.equal(Pat.permite(gestorBandeiras.gerir, 'BANDEIRA'), true);
  assert.equal(Pat.permite(gestorBandeiras.ver, 'ELETRONICO'), false);
  assert.deepEqual(Pat.categoriasPermitidas(gestorBandeiras.ver), ['BANDEIRA']);
  assert.equal(Pat.podeMudarCategoria(gestorBandeiras, 'BANDEIRA', 'MOBILIARIO'), false);

  const membroBateria = Pat.resolverEscopoPatrimonio({ papelBateria: 'membro' });
  assert.equal(Pat.permite(membroBateria.movimentar, 'INSTRUMENTO'), true);
  assert.equal(Pat.permite(membroBateria.gerir, 'INSTRUMENTO'), false);

  const lideranca = Pat.resolverEscopoPatrimonio({ lideranca: true });
  assert.equal(Pat.categoriasPermitidas(lideranca.ver), null);
  assert.equal(Pat.permite(lideranca.movimentar, 'BANDEIRA'), false);

  const presidencia = Pat.resolverEscopoPatrimonio({ presidencia: true });
  assert.equal(Pat.podeMudarCategoria(presidencia, 'BANDEIRA', 'MOBILIARIO'), true);

  assert.deepEqual(Pat.resolverEscopoPatrimonio({}), { ver: [], movimentar: [], gerir: [] });
});

test('patrimônio: tipo da peça só em bandeiras', () => {
  assert.equal(Pat.validarSubtipo('BANDEIRA', 'FAIXA').ok, true);
  assert.equal(Pat.validarSubtipo('BANDEIRA', null).ok, false);
  assert.equal(Pat.validarSubtipo('INSTRUMENTO', 'FAIXA').ok, false);
  assert.equal(Pat.validarSubtipo('INSTRUMENTO', null).ok, true);
});

test('patrimônio: pendência de empréstimo', () => {
  assert.equal(Pat.pendenciaDoEmprestimo({ saiu_em: agora, evento_inicio_em: new Date(agora.getTime() - 24 * 3600000) }, agora), 'não voltou do evento');
  assert.equal(Pat.pendenciaDoEmprestimo({ saiu_em: new Date(agora.getTime() - 10 * 86400000), evento_inicio_em: null }, agora), 'fora há 10 dias');
  assert.equal(Pat.pendenciaDoEmprestimo({ saiu_em: new Date(agora.getTime() - 2 * 86400000), evento_inicio_em: null }, agora), null);
});
