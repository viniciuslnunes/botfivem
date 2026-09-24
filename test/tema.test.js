const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { criarTema } = require('../tema/criar');
const { matizDe, validarTema } = require('../tema/validacao');
const base = require('../tema/base');

// Marca mínima válida para montar temas de teste.
const MARCA = {
  nome: 'TORCIDA X FIVEM', nomeSegmentado: 'TORCIDA X - FIVEM', nomeCurto: 'TORCIDA X',
  nomeNormal: 'Torcida X', nomeNormalFivem: 'Torcida X FiveM', nomeTorcida: 'TORCIDA X',
  de: 'da',
  sigla: 'TX', nickPrefixo: 'S TX | ', logo: 'logo.png',
};

test('matizDe: cores acromáticas não têm matiz; cada matiz cai na faixa certa', () => {
  for (const c of [0x000000, 0xFFFFFF, 0x808080, '#8C8C8C', '#1a1a1a', '#f0f0f0']) assert.equal(matizDe(c), null, String(c));
  assert.equal(matizDe(0xFF0000), 'vermelho');
  assert.equal(matizDe(0xFFCC00), 'amarelo');
  assert.equal(matizDe(0x00AA00), 'verde');
  assert.equal(matizDe(0x25D366), 'verde'); // verde do WhatsApp, já banido do projeto
  assert.equal(matizDe('#00ff00'), 'verde');
  assert.equal(matizDe(0x5865F2), 'azul');
  assert.equal(matizDe('#00aff4'), 'ciano');
});

test('tema dos Gaviões: carrega, é válido e tem exatamente os valores que o servidor usa hoje', () => {
  const tema = require('../tema');
  assert.equal(tema.cor.primaria, 0x000000);
  assert.equal(tema.cor.perigo, 0xFF0000);
  assert.equal(tema.cor.aviso, 0xFFCC00);
  assert.equal(tema.cor.destaque, 0xFFFFFF);
  assert.equal(tema.cor.neutro, 0x808080);
  assert.equal(tema.imagem.grade, '#262626');
  assert.equal(tema.imagem.gradeForte, '#333333');
  assert.deepEqual(tema.proibido.matizes, ['verde']);
  assert.equal(tema.marca.nickPrefixo, 'S GDF | ');
});

test('tema dos Gaviões: nenhuma cor nem emoji de estado é verde (a regra da torcida, executável)', () => {
  const tema = require('../tema');
  const cores = [
    ...Object.values(tema.cor), ...Object.values(tema.imagem),
    ...Object.values(tema.cartao), ...Object.values(tema.transcricao),
  ];
  for (const c of cores) assert.notEqual(matizDe(c), 'verde', String(c));
  for (const e of Object.values(tema.emoji)) {
    for (const verde of ['🟢', '✅', '💚', '🟩', '🍀']) assert.ok(!e.includes(verde), `emoji ${e}`);
  }
});

test('a base neutra também é válida e não usa verde', () => {
  assert.deepEqual(validarTema({ ...base, marca: MARCA, proibido: { matizes: ['verde'] } }), []);
});

test('proibido: cor primária verde num tema que proíbe verde falha ao carregar', () => {
  assert.throws(
    () => criarTema({ marca: MARCA, cor: { primaria: 0x00AA00 }, proibido: { matizes: ['verde'] } }),
    /cor\.primaria .*verde, matiz proibido/,
  );
});

test('proibido: hex de gráfico, de cartão e de transcrição verdes também falham', () => {
  for (const bloco of ['imagem', 'cartao', 'transcricao']) {
    assert.throws(
      () => criarTema({ marca: MARCA, [bloco]: { texto: '#22cc44' }, proibido: { matizes: ['verde'] } }),
      new RegExp(`${bloco}\\.texto .*verde`),
    );
  }
});

test('proibido: emoji verde de estado falha (🟢 e ✅ leem como verde mesmo sem hex)', () => {
  for (const e of ['🟢', '✅', '💚']) {
    assert.throws(
      () => criarTema({ marca: MARCA, emoji: { ok: e }, proibido: { matizes: ['verde'] } }),
      /emoji\.ok .*verde/,
    );
  }
});

test('torcida de mancha verde: com verde permitido o mesmo tema carrega (reatividade)', () => {
  const tema = criarTema({
    marca: MARCA,
    cor: { primaria: 0x0B6623, destaque: 0x2ECC71 },
    emoji: { ok: '✅', ativo: '🟢' },
    imagem: { destaque: '#2ECC71' },
    proibido: { matizes: [] },
  });
  assert.equal(tema.cor.primaria, 0x0B6623);
  assert.equal(tema.emoji.ativo, '🟢');
  // e o que não foi sobrescrito vem da base:
  assert.equal(tema.cor.perigo, base.cor.perigo);
});

test('torcida de mancha verde que proíbe VERMELHO: o mesmo mecanismo vale para outro matiz', () => {
  assert.throws(
    () => criarTema({ marca: MARCA, proibido: { matizes: ['vermelho'] } }), // base tem perigo vermelho
    /cor\.perigo .*vermelho/,
  );
});

test('formato: cor fora do intervalo, hex inválido, matiz desconhecido e marca faltando listam TODOS os erros', () => {
  const erros = validarTema({
    ...base,
    cor: { ...base.cor, primaria: 0x1000000 },
    imagem: { ...base.imagem, fundo: 'preto' },
    marca: { nome: 'X' },
    proibido: { matizes: ['fúcsia'] },
  });
  assert.ok(erros.some(e => e.includes('cor.primaria')));
  assert.ok(erros.some(e => e.includes('imagem.fundo')));
  assert.ok(erros.some(e => e.includes('marca.nomeSegmentado')));
  assert.ok(erros.some(e => e.includes('fúcsia')));
  assert.ok(erros.length >= 4);
});

test('helpers: título, anexo e URL de anexo', () => {
  const tema = criarTema({ marca: MARCA }, { pastaAssets: path.join('x', 'assets') });
  assert.equal(tema.titulo('📦 BAÚ'), '📦 BAÚ — TORCIDA X FIVEM');
  assert.equal(tema.tituloSegmentado('TICKET'), 'TICKET - TORCIDA X - FIVEM');
  assert.deepEqual(tema.logo(), { attachment: path.join('x', 'assets', 'logo.png'), name: 'logo.png' });
  assert.equal(tema.urlLogo(), 'attachment://logo.png');
  assert.equal(tema.urlAnexo('capa.png'), 'attachment://capa.png');
});

test('o tema é imutável em runtime', () => {
  const tema = criarTema({ marca: MARCA });
  assert.throws(() => { 'use strict'; tema.cor.primaria = 0xFF00FF; }, TypeError);
});

test('assets do tenant existem no disco', () => {
  const fs = require('fs');
  const tema = require('../tema');
  for (const nome of [tema.marca.logo, tema.marca.capa, tema.marca.faixa, tema.marca.elenco.logo]) {
    assert.ok(fs.existsSync(tema.asset(nome)), `asset ausente: ${nome}`);
  }
});

test('regressão: o tema dos Gaviões reproduz exatamente os textos que o servidor exibia antes da migração', () => {
  const tema = require('../tema');
  assert.equal(tema.titulo('📦 BAÚ DA TORCIDA'), '📦 BAÚ DA TORCIDA — GAVIÕES DA FIEL FIVEM');
  assert.equal(tema.tituloSegmentado('RECRUTAMENTO'), 'RECRUTAMENTO - GAVIÕES DA FIEL - FIVEM');
  assert.equal(`🌐 REDES SOCIAIS ${tema.marca.dosNome}`, '🌐 REDES SOCIAIS DOS GAVIÕES DA FIEL - FIVEM');
  assert.equal(`🤝 PARCEIROS ${tema.marca.dosNome}`, '🤝 PARCEIROS DOS GAVIÕES DA FIEL - FIVEM');
  assert.equal(`Gera sua carteirinha de sócio ${tema.marca.dosNormal}`, 'Gera sua carteirinha de sócio dos Gaviões da Fiel - FiveM');
  assert.equal(`NOSSA EQUIPE DA ${tema.marca.nomeCurto} VAI TE ATENDER`, 'NOSSA EQUIPE DA GAVIÕES DA FIEL VAI TE ATENDER');
  assert.equal(`Convite do grupo de sócios ${tema.marca.de} **${tema.marca.nomeSegmentado}** no WhatsApp`, 'Convite do grupo de sócios dos **GAVIÕES DA FIEL - FIVEM** no WhatsApp');
  assert.equal(tema.marca.elenco.titulo, '🦅・[R.S.J] RUA SÃO JORGE - ELENCO');
  assert.equal(tema.urlLogo(), 'attachment://gavioesdafielfivem_logo.png');
  assert.equal(tema.urlAnexo(tema.marca.faixa), 'attachment://FAIXA_19.jpg');
  assert.equal(tema.logo().name, 'gavioesdafielfivem_logo.png');
});

test('regressão: formatarNick continua gerando "S GDF | Nome - 1234" e respeita o limite de 32 caracteres do Discord', () => {
  const { formatarNick } = require('../utils/formatarNick');
  assert.equal(formatarNick('Fulano', '1234'), 'S GDF | Fulano - 1234');
  assert.ok(formatarNick('N'.repeat(80), '12345').length <= 32);
});
