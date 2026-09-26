// Torcidas com aversões diferentes: prova que a proibição de cor (matiz e tom)
// é executável e que o tema base (preto/branco) não vaza para quem a proíbe.
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarTema } = require('../tema/criar');
const { tomDe, contraste, validarTema } = require('../tema/validacao');
const base = require('../tema/base');

const marca = sigla => ({
  nome: `TORCIDA ${sigla} FIVEM`, nomeSegmentado: `TORCIDA ${sigla} - FIVEM`, nomeCurto: `TORCIDA ${sigla}`,
  nomeNormal: `Torcida ${sigla}`, nomeNormalFivem: `Torcida ${sigla} FiveM`, nomeTorcida: `TORCIDA ${sigla}`,
  de: 'da', sigla, nickPrefixo: `S ${sigla} | `, logo: 'logo.png',
});

// Paleta completa sem nenhum preto (Mancha / Máfia Azul): fundo é o tom da torcida.
const SEM_PRETO = {
  cor: { primaria: 0x0B3D91, perigo: 0xFF0000, aviso: 0xFFCC00, destaque: 0xFFFFFF, neutro: 0x808080 },
  emoji: { ativo: '🦅', inativo: '⚪' },
  imagem: { fundo: '#0B2A5C', grade: '#3A5F9E', gradeForte: '#4F73B0', texto: '#FFFFFF', textoFraco: '#C8D4EA' },
  cartao: { fundo: '#FFFFFF', tinta: '#0B2A5C', tintaSuave: '#2A4A85', sobreTinta: '#FFFFFF' },
  transcricao: {
    fundoPagina: '#1A3A75', fundoCabecalho: '#0B2A5C', fundoHover: '#244A8F', painel: '#1A3A75',
    linha: '#3A5F9E', texto: '#FFFFFF', textoFraco: '#C8D4EA', textoForte: '#FFFFFF', rodape: '#0B2A5C',
  },
};

test('tons: preto, branco e cinza', () => {
  assert.equal(tomDe(0x000000), 'preto');
  assert.equal(tomDe('#1a1a1a'), 'preto');
  assert.equal(tomDe('#262626'), 'cinza'); // grade dos gráficos não é preto
  assert.equal(tomDe(0xFFFFFF), 'branco');
  assert.equal(tomDe(0x808080), 'cinza');
  assert.equal(tomDe(0x0B2A5C), null); // azul-marinho tem matiz: não é "preto"
  assert.equal(tomDe(0xFF0000), null);
});

test('contraste: preto/branco 21:1, igual 1:1', () => {
  assert.ok(Math.abs(contraste('#000000', '#FFFFFF') - 21) < 0.01);
  assert.equal(contraste('#777777', '#777777'), 1);
});

test('Mancha: quem proíbe preto e não troca a base não sobe — e o erro diz o que declarar', () => {
  assert.throws(
    () => criarTema({ marca: marca('MV'), cor: { primaria: 0x0B6623 }, proibido: { matizes: [], tons: ['preto'] } }),
    err => /imagem\.fundo .*preto, tom proibido neste tema — herdado da base/.test(err.message)
      && /emoji\.(ativo|marca)|cartao\.tinta/.test(err.message),
  );
});

test('Máfia Azul: paleta completa sem preto sobe, mesmo herdando o resto da base', () => {
  const tema = criarTema({ marca: marca('MA'), ...SEM_PRETO, proibido: { matizes: [], tons: ['preto'] } });
  for (const v of [...Object.values(tema.imagem), ...Object.values(tema.cartao), ...Object.values(tema.transcricao)]) assert.notEqual(tomDe(v), 'preto', v);
  assert.notEqual(tomDe(tema.cor.primaria), 'preto');
});

test('Galocura: proibir azul barra cor azul e emoji azul, inclusive o herdado', () => {
  assert.throws(() => criarTema({ marca: marca('GC'), cor: { primaria: 0x0B3D91 }, proibido: { matizes: ['azul'] } }), /cor\.primaria .*azul, matiz proibido/);
  assert.throws(() => criarTema({ marca: marca('GC'), emoji: { ativo: '🔵' }, proibido: { matizes: ['azul'] } }), /emoji\.ativo \(🔵\) é azul/);
  assert.throws(() => criarTema({ marca: marca('GC'), cor: { primaria: 0xCC0000 }, proibido: { matizes: ['azul'] } }), /transcricao.(selo|link) .*herdado da base/); // a base tem link azul do Discord
  assert.doesNotThrow(() => criarTema({ marca: marca('GC'), cor: { primaria: 0xCC0000 }, transcricao: { selo: '#CC0000', link: '#FF6666' }, proibido: { matizes: ['azul'] } }));
});

test('o emoji de cor da base também respeita tom proibido (⚪ inativo, ⚫ ativo)', () => {
  const erros = validarTema({ ...base, marca: marca('X'), proibido: { matizes: [], tons: ['branco'] } });
  assert.ok(erros.some(e => /emoji\.inativo \(⚪\) é branco/.test(e)), erros.join('\n'));
});

test('contraste: paleta ilegível não sobe', () => {
  assert.throws(
    () => criarTema({ marca: marca('X'), imagem: { texto: '#333333' }, proibido: { matizes: [] } }),
    /contraste imagem\.texto/,
  );
});

test('tom/matiz desconhecido é erro de tenant, não silêncio', () => {
  const erros = validarTema({ ...base, marca: marca('X'), proibido: { matizes: ['marrom'], tons: ['dourado'] } });
  assert.ok(erros.some(e => /matiz desconhecido "marrom"/.test(e)));
  assert.ok(erros.some(e => /tom desconhecido "dourado"/.test(e)));
});
