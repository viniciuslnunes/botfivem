// O que o `npm run deploy` mandaria ao Discord para cada tenant: os comandos
// dos módulos ligados, com as regras da API respeitadas (nome, descrição,
// limites). Roda o mesmo caminho do deploy-commands.js, sem chamar a API.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

const RAIZ = path.join(__dirname, '..');

function comandosDoDeploy(slug) {
  const codigo = `
    process.env.DATABASE_URL = 'postgres://teste:teste@127.0.0.1:1/teste';
    const plataforma = require('./plataforma');
    const cliente = { commands: null };
    plataforma.carregarModulos(cliente);
    console.log(JSON.stringify({ json: [...cliente.commands.values()].map(c => c.data.toJSON()), ligados: plataforma.ativos.map(m => m.id) }));`;
  const saida = execFileSync(process.execPath, ['-e', codigo], { cwd: RAIZ, env: { ...process.env, TENANT: slug }, encoding: 'utf8' });
  return JSON.parse(saida.slice(saida.indexOf('{"json"')));
}

for (const slug of ['gavioes', '_exemplo', '_instalacao']) {
  test(`deploy do tenant ${slug}: comandos válidos para a API do Discord`, () => {
    const { json, ligados } = comandosDoDeploy(slug);
    assert.ok(json.length >= 1 && json.length <= 100, `${json.length} comandos`);
    const nomes = json.map(c => c.name);
    assert.equal(new Set(nomes).size, nomes.length, 'nome de comando repetido');
    for (const c of json) {
      assert.match(c.name, /^[\p{Ll}\p{N}_-]{1,32}$/u, `nome inválido: ${c.name}`);
      assert.ok(c.description && c.description.length <= 100, `descrição de /${c.name} com ${c.description?.length} caracteres`);
      assert.ok((c.options ?? []).length <= 25, `/${c.name} com opções demais`);
      for (const o of c.options ?? []) {
        assert.ok(o.description && o.description.length <= 100, `/${c.name} ${o.name}: descrição inválida`);
        assert.match(o.name, /^[\p{Ll}\p{N}_-]{1,32}$/u, `/${c.name} opção ${o.name}`);
      }
    }
    assert.ok(ligados.includes('setup'));
  });
}

test('deploy: um tenant sem rifas não registra /rifa; em instalação só /setup', () => {
  assert.ok(comandosDoDeploy('gavioes').json.some(c => c.name === 'rifa'));
  assert.ok(!comandosDoDeploy('_exemplo').json.some(c => c.name === 'rifa'));
  assert.deepEqual(comandosDoDeploy('_instalacao').json.map(c => c.name), ['setup']);
});
