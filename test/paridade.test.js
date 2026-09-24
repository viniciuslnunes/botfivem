// Paridade da F3 (módulos por manifesto): com todos os módulos ligados (tenant
// gavioes), o bot registra exatamente o que registrava antes da refatoração —
// mesmos comandos, mesmos prefixos/customIds de interação, mesmos eventos.
// As fixtures são o retrato tirado do código anterior (events/*.js):
//   test/fixtures/retrato-legado.json   comandos, prefixos e listeners
//   test/fixtures/customids-legados.json os 28 customIds do antigo interactionCreate
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');
const fixture = nome => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', nome), 'utf8'));

function retratoDoTenant(slug) {
  const saida = execFileSync(process.execPath, ['tools/instantaneo.js'], {
    cwd: RAIZ, env: { ...process.env, TENANT: slug }, encoding: 'utf8',
  });
  return JSON.parse(saida.slice(saida.indexOf('{')));
}

// Comandos criados depois do retrato legado (F5): /setup (onboarding) e /status (saúde).
const COMANDOS_NOVOS = ['setup', 'status'];

// Módulos novos (de outras frentes) podem acrescentar comandos: o que não pode é PERDER
// algum dos 31 legados nem os da F5. Comando sem módulo dono é pego pelo teste de órfãos.
test('paridade: nenhum dos 31 comandos de antes sumiu, e os da F5 (setup, status) existem', () => {
  const antes = fixture('retrato-legado.json');
  const agora = retratoDoTenant('gavioes');
  assert.equal(antes.comandos.length, 31);
  const faltando = [...antes.comandos, ...COMANDOS_NOVOS].filter(c => !agora.comandos.includes(c));
  assert.deepEqual(faltando, []);
});

test('paridade: eventos do Discord idênticos (1 listener de cada, mesmos nomes)', () => {
  const antes = fixture('retrato-legado.json');
  const agora = retratoDoTenant('gavioes');
  assert.deepEqual(agora.listeners, antes.listeners);
});

test('paridade: todos os 26 prefixos de antes e os 28 customIds que viviam no interactionCreate continuam registrados', () => {
  const antes = fixture('retrato-legado.json');
  const legados = fixture('customids-legados.json').map(i => i.id.replace(/:$/, ''));
  assert.equal(legados.length, 28);
  const esperado = [...new Set([...antes.prefixosInteracao, ...legados, 'setup'])].sort(); // + o botão do /setup (F5)
  const agora = retratoDoTenant('gavioes');
  const faltando = esperado.filter(p => !agora.prefixosInteracao.includes(p));
  assert.deepEqual(faltando, []); // prefixo de módulo novo é bem-vindo; perder um existente, não
});

test('paridade: no tenant gavioes todos os módulos sobem, inclusive os opcionais (elenco, testes)', () => {
  const agora = retratoDoTenant('gavioes');
  assert.deepEqual(agora.modulosDesligados, []);
  assert.ok(agora.modulosLigados.includes('elenco') && agora.modulosLigados.includes('testes'));
});

test('feature flag: tenant que desliga módulos não registra comando, handler nem painel deles', () => {
  const gavioes = retratoDoTenant('gavioes');
  const exemplo = retratoDoTenant('_exemplo');

  for (const desligado of ['rifas', 'loja', 'caravana', 'escala', 'patrimonio', 'memoria', 'financeiro', 'painelFarm', 'antiSpam', 'elenco', 'testes']) {
    assert.ok(exemplo.modulosDesligados.includes(desligado), `${desligado} deveria estar desligado`);
  }
  // comandos dos módulos desligados sumiram; os dos ligados ficaram
  for (const cmd of ['rifa', 'loja', 'caravana', 'escala', 'patrimonio', 'memoria', 'financeiro', 'elenco', 'testenick', 'testenovato', 'testesocio']) {
    assert.ok(!exemplo.comandos.includes(cmd), `comando ${cmd} não deveria existir`);
    assert.ok(gavioes.comandos.includes(cmd));
  }
  for (const cmd of ['logs', 'evento', 'carteirinha', 'departamentos', 'hierarquia']) assert.ok(exemplo.comandos.includes(cmd), `comando ${cmd} deveria existir`);
  // handlers dos desligados não foram registrados
  for (const prefixo of ['rifa', 'loja', 'car', 'esc', 'farm', 'mem', 'antispam']) {
    assert.ok(!exemplo.prefixosInteracao.includes(prefixo), `prefixo ${prefixo} não deveria existir`);
    assert.ok(gavioes.prefixosInteracao.includes(prefixo), `gavioes deveria ter ${prefixo}`);
  }
  // e o que ficou ligado continua
  for (const prefixo of ['evt', 'logs', 'recrut', 'dept', 'mural', 'abrir_ticket']) assert.ok(exemplo.prefixosInteracao.includes(prefixo), prefixo);
});

test('modo instalação: tenant novo sobe só com o /setup (nenhum outro comando, handler ou módulo)', () => {
  const r = retratoDoTenant('_instalacao');
  assert.deepEqual(r.modulosLigados, ['setup']);
  assert.deepEqual(r.comandos, ['setup']);
  assert.deepEqual(r.prefixosInteracao, ['setup']);
  assert.ok(r.modulosDesligados.includes('logsJogo') && r.modulosDesligados.includes('nucleo'));
});

test('todo arquivo de commands/ tem exatamente um módulo dono (nenhum órfão, nenhum duplicado)', () => {
  const manifestos = require('../modulos');
  const donos = new Map();
  for (const m of manifestos) {
    for (const cmd of m.comandos || []) {
      assert.ok(!donos.has(cmd), `comando ${cmd} declarado por ${donos.get(cmd)} e por ${m.id}`);
      donos.set(cmd, m.id);
    }
  }
  const arquivos = fs.readdirSync(path.join(RAIZ, 'commands')).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, ''));
  const orfaos = arquivos.filter(a => !donos.has(a));
  const fantasmas = [...donos.keys()].filter(c => !arquivos.includes(c));
  assert.deepEqual({ orfaos, fantasmas }, { orfaos: [], fantasmas: [] });
});
