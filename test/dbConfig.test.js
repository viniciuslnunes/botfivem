const test = require('node:test');
const assert = require('node:assert/strict');
const { opcoesDoPool } = require('../utils/dbConfig');

const URL_REMOTA = 'postgres://u:p@db.exemplo.com:5432/x';

test('padrão: TLS sem verificação (compatível com o histórico) e AVISA, para quem usa banco remoto', () => {
  const { opcoes, avisos, modo } = opcoesDoPool({ DATABASE_URL: URL_REMOTA });
  assert.equal(modo, 'no-verify');
  assert.deepEqual(opcoes.ssl, { rejectUnauthorized: false });
  assert.equal(opcoes.connectionString, URL_REMOTA);
  assert.equal(avisos.length, 1);
  assert.match(avisos[0], /DATABASE_SSL=verify/);
});

test('banco local não gera aviso de TLS', () => {
  for (const url of ['postgres://u:p@127.0.0.1:5432/x', 'postgres://u:p@localhost/x', 'postgres://u:p@[::1]:5432/x']) {
    assert.deepEqual(opcoesDoPool({ DATABASE_URL: url }).avisos, [], url);
  }
  assert.equal(opcoesDoPool({ DATABASE_URL: 'isto não é url' }).avisos.length, 1); // na dúvida, avisa
});

test('verify: valida o certificado; CA vem como PEM (com \n literal) ou como caminho de arquivo', () => {
  const v = opcoesDoPool({ DATABASE_URL: URL_REMOTA, DATABASE_SSL: 'verify' });
  assert.deepEqual(v.opcoes.ssl, { rejectUnauthorized: true });
  assert.deepEqual(v.avisos, []);

  // Variável de ambiente de uma linha só: as quebras chegam como "\n" literal (barra + n)
  const pem = '-----BEGIN CERTIFICATE-----\\nABC\\n-----END CERTIFICATE-----';
  const comPem = opcoesDoPool({ DATABASE_URL: URL_REMOTA, DATABASE_SSL: 'verify', DATABASE_CA: pem });
  assert.equal(comPem.opcoes.ssl.ca, '-----BEGIN CERTIFICATE-----\nABC\n-----END CERTIFICATE-----');

  const lidos = [];
  const comArquivo = opcoesDoPool(
    { DATABASE_URL: URL_REMOTA, DATABASE_SSL: 'verify', DATABASE_CA: '/etc/ca.pem' },
    { lerArquivo: a => { lidos.push(a); return 'CONTEUDO'; } },
  );
  assert.equal(comArquivo.opcoes.ssl.ca, 'CONTEUDO');
  assert.deepEqual(lidos, ['/etc/ca.pem']);
});

test('off: sem TLS e sem aviso', () => {
  const r = opcoesDoPool({ DATABASE_URL: URL_REMOTA, DATABASE_SSL: 'off' });
  assert.equal('ssl' in r.opcoes, false);
  assert.deepEqual(r.avisos, []);
});

test('valor inválido derruba a subida com mensagem clara (nunca cai em modo inseguro sem querer)', () => {
  assert.throws(() => opcoesDoPool({ DATABASE_URL: URL_REMOTA, DATABASE_SSL: 'sim' }), /DATABASE_SSL inválido: "sim" \(use: verify, no-verify, off\)/);
  assert.throws(() => opcoesDoPool({ DATABASE_URL: URL_REMOTA, DATABASE_SSL: 'VERIFY' }), /inválido/);
});

test('DATABASE_POOL_MAX: inteiro de 1 a 100', () => {
  assert.equal(opcoesDoPool({ DATABASE_URL: URL_REMOTA, DATABASE_POOL_MAX: '5' }).opcoes.max, 5);
  assert.equal('max' in opcoesDoPool({ DATABASE_URL: URL_REMOTA }).opcoes, false);
  assert.equal('max' in opcoesDoPool({ DATABASE_URL: URL_REMOTA, DATABASE_POOL_MAX: '' }).opcoes, false);
  for (const ruim of ['0', '101', '2.5', 'abc']) {
    assert.throws(() => opcoesDoPool({ DATABASE_URL: URL_REMOTA, DATABASE_POOL_MAX: ruim }), /DATABASE_POOL_MAX inválido/, ruim);
  }
});

test('utils/db.js: o pool tem ouvinte de erro (conexão ociosa que cai não derruba o processo)', () => {
  process.env.DATABASE_URL = 'postgres://u:p@127.0.0.1:1/x';
  process.env.DATABASE_SSL = 'off';
  const pool = require('../utils/db');
  assert.ok(pool.listenerCount('error') >= 1);
  assert.doesNotThrow(() => pool.emit('error', new Error('conexão caiu')));
  pool.end();
});
