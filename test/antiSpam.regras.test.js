const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../utils/antiSpam/regras');

const limites = { janelaSegundos: 30, canaisMesmaMensagem: 3, canaisQualquerMensagem: 5 };
const agora = 1_000_000;

test('normaliza o que o spammer muda entre um envio e outro', () => {
  assert.equal(
    R.normalizarTexto('  NITRO​  GRÁTIS <@123> @everyone https://x.gg '),
    R.normalizarTexto('nitro gratis <@!456> https://x.gg'),
  );
});

test('assinatura: texto curto sozinho não conta; com link, anexo ou figurinha conta', () => {
  assert.equal(R.assinaturaMensagem({ conteudo: 'bom dia' }), null);
  assert.equal(R.assinaturaMensagem({ conteudo: '' }), null);
  assert.ok(R.assinaturaMensagem({ conteudo: 'discord.gg/abc' }));
  assert.ok(R.assinaturaMensagem({ conteudo: 'olha', anexos: [{ nome: 'a.png', tamanho: 10 }] }));
  assert.ok(R.assinaturaMensagem({ figurinhas: ['99'] }));
  assert.equal(
    R.assinaturaMensagem({ anexos: [{ nome: 'b.png', tamanho: 2 }, { nome: 'a.png', tamanho: 1 }] }),
    R.assinaturaMensagem({ anexos: [{ nome: 'a.png', tamanho: 1 }, { nome: 'b.png', tamanho: 2 }] }),
  );
});

test('link ou anexo: o que conta na regra de vários canais', () => {
  assert.equal(R.temLinkOuAnexo({ conteudo: 'pega o nitro https://x.com' }), true);
  assert.equal(R.temLinkOuAnexo({ conteudo: 'discord.gg/abc' }), true);
  assert.equal(R.temLinkOuAnexo({ conteudo: '', anexos: [{ nome: 'a.png', tamanho: 1 }] }), true);
  assert.equal(R.temLinkOuAnexo({ conteudo: 'já te atendo no ticket' }), false);
});

const msg = (canalId, assinatura, segundosAtras, linkOuAnexo = false) => ({ canalId, assinatura, linkOuAnexo, em: agora - segundosAtras * 1000 });

test('mesma mensagem em 3 canais dentro da janela é spam', () => {
  const r = R.avaliarHistorico([msg('a', 'x', 10), msg('b', 'x', 5), msg('c', 'x', 0)], agora, limites);
  assert.deepEqual(r, { spam: true, motivo: 'mesma_mensagem', canais: 3 });
});

test('mesma mensagem repetida no MESMO canal não é esse tipo de spam', () => {
  const r = R.avaliarHistorico([msg('a', 'x', 3), msg('a', 'x', 2), msg('a', 'x', 1), msg('b', 'x', 0)], agora, limites);
  assert.equal(r.spam, false);
});

test('fora da janela não soma', () => {
  const r = R.avaliarHistorico([msg('a', 'x', 60), msg('b', 'x', 5), msg('c', 'x', 0)], agora, limites);
  assert.equal(r.spam, false);
});

test('conversa normal em canais diferentes com texto curto não dispara', () => {
  const r = R.avaliarHistorico([msg('a', null, 20), msg('b', null, 10), msg('c', null, 0)], agora, limites);
  assert.equal(r.spam, false);
});

test('texto embaralhado COM link em 5 canais diferentes é spam', () => {
  const h = ['a', 'b', 'c', 'd', 'e'].map((c, i) => msg(c, `t${i}`, i, true));
  assert.deepEqual(R.avaliarHistorico(h, agora, limites), { spam: true, motivo: 'varios_canais', canais: 5 });
});

const alta = { janelaSegundos: 60, arquivosMinimos: 2, canaisMinimos: 4 };
const imagens = [{ tamanho: 101 }, { tamanho: 202 }, { tamanho: 303 }, { tamanho: 404 }];
const comAnexos = (canalId, anexos, segundosAtras) => ({ canalId, anexos, em: agora - segundosAtras * 1000 });

test('alta certeza: 4 imagens iguais numa mensagem em 4 canais', () => {
  const h = ['a', 'b', 'c', 'd'].map((c, i) => comAnexos(c, imagens, 40 - i * 10));
  assert.deepEqual(R.avaliarAltaCerteza(h, agora, alta), { spam: true, motivo: 'anexos_replicados', arquivos: 4, canais: 4 });
});

test('alta certeza: uma imagem por mensagem também conta', () => {
  const h = ['a', 'b', 'c', 'd'].flatMap((c, i) => imagens.map(img => comAnexos(c, [img], i)));
  assert.equal(R.avaliarAltaCerteza(h, agora, alta).spam, true);
});

test('alta certeza NÃO dispara: só 3 canais, só 1 imagem, ou fora da janela', () => {
  assert.equal(R.avaliarAltaCerteza(['a', 'b', 'c'].map(c => comAnexos(c, imagens, 0)), agora, alta).spam, false);
  assert.equal(R.avaliarAltaCerteza(['a', 'b', 'c', 'd', 'e', 'f'].map(c => comAnexos(c, [{ tamanho: 9 }], 0)), agora, alta).spam, false);
  const h = ['a', 'b', 'c', 'd'].map((c, i) => comAnexos(c, imagens, i === 0 ? 90 : 0));
  assert.equal(R.avaliarAltaCerteza(h, agora, alta).spam, false);
});

test('alta certeza NÃO dispara com imagens diferentes em cada canal', () => {
  const h = ['a', 'b', 'c', 'd'].map((c, i) => comAnexos(c, [{ tamanho: 1000 + i }, { tamanho: 2000 + i }], 0));
  assert.equal(R.avaliarAltaCerteza(h, agora, alta).spam, false);
});

test('recrutador respondendo 5 tickets seguidos sem link não dispara', () => {
  const h = ['a', 'b', 'c', 'd', 'e'].map((c, i) => msg(c, `t${i}`, i, false));
  assert.equal(R.avaliarHistorico(h, agora, limites).spam, false);
});
