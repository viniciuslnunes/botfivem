// Documentação em sincronia com o código: contrato que descreve token, módulo,
// ação ou campo que não existe mais (ou esquece um que existe) falha aqui.
// Também confere que os agentes apontam para arquivos que existem.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

process.env.DATABASE_URL = 'postgres://teste:teste@127.0.0.1:1/teste';
const RAIZ = path.join(__dirname, '..');
const ler = rel => fs.readFileSync(path.join(RAIZ, rel), 'utf8');

const base = require('../tema/base');
const { MARCA_OBRIGATORIA } = (() => {
  // MARCA_OBRIGATORIA não é exportada; lê do fonte para não duplicar a lista.
  const fonte = ler('tema/validacao.js');
  const m = /const MARCA_OBRIGATORIA = \[([\s\S]*?)\];/.exec(fonte);
  return { MARCA_OBRIGATORIA: [...m[1].matchAll(/'([A-Za-z]+)'/g)].map(x => x[1]) };
})();
const { ACOES_CANONICAS, CATEGORIAS_CANONICAS } = require('../fontes/contrato');
const manifestos = require('../modulos');
const tenant = require('../tenants/gavioes/tenant.js');

test('tema.md cita todo token de cor, emoji, imagem, cartão e transcrição do tema base', () => {
  const doc = ler('docs/contratos/tema.md');
  const faltando = [];
  for (const bloco of ['cor', 'emoji', 'imagem', 'cartao', 'transcricao']) {
    for (const token of Object.keys(base[bloco])) {
      if (!new RegExp(`\`${token}\``).test(doc)) faltando.push(`${bloco}.${token}`);
    }
  }
  assert.deepEqual(faltando, [], 'tokens sem menção em docs/contratos/tema.md');
});

test('tema.md cita todo campo obrigatório de marca', () => {
  const doc = ler('docs/contratos/tema.md');
  assert.ok(MARCA_OBRIGATORIA.length >= 10);
  const faltando = MARCA_OBRIGATORIA.filter(c => !new RegExp(`\`${c}\``).test(doc));
  assert.deepEqual(faltando, []);
});

test('eventos-canonicos.md cita toda ação e toda categoria canônica', () => {
  const doc = ler('docs/contratos/eventos-canonicos.md');
  assert.deepEqual([...ACOES_CANONICAS].filter(a => !doc.includes(`| ${a} |`)), [], 'ações fora da tabela');
  const lista = /## Categorias\s+`([^`]+)`/.exec(doc)[1].split(/\s+/);
  assert.deepEqual([...CATEGORIAS_CANONICAS].sort(), lista.sort());
});

test('modulos.md: a tabela tem todo módulo, com o padrão e as dependências reais', () => {
  const doc = ler('docs/contratos/modulos.md');
  const linhas = [...doc.matchAll(/^\| ([a-zA-Z]+) \| (.+?) \| (.+?) \| (.+?) \|$/gm)]
    .filter(l => !['id', '---'].includes(l[1]) && manifestos.some(m => m.id === l[1]));
  const daTabela = new Map(linhas.map(l => [l[1], { padrao: l[3].trim(), requer: l[4].trim() }]));

  assert.deepEqual(manifestos.filter(m => !daTabela.has(m.id)).map(m => m.id), [], 'módulos fora da tabela');
  const divergencias = [];
  for (const m of manifestos) {
    const { padrao, requer } = daTabela.get(m.id);
    const esperadoPadrao = m.obrigatorio ? 'obrigatório' : m.padrao ? 'sim' : '**não**';
    if (padrao !== esperadoPadrao) divergencias.push(`${m.id}: padrão "${padrao}" ≠ "${esperadoPadrao}"`);
    const doDoc = requer === '—' ? [] : requer.split(',').map(s => s.trim());
    const doCodigo = m.requer ?? [];
    if (JSON.stringify([...doDoc].sort()) !== JSON.stringify([...doCodigo].sort())) divergencias.push(`${m.id}: requer "${requer}" ≠ [${doCodigo.join(', ')}]`);
  }
  assert.deepEqual(divergencias, []);
});

test('tenant.md cita todo campo de primeiro nível do tenant', () => {
  const doc = ler('docs/contratos/tenant.md');
  const faltando = Object.keys(tenant).filter(k => !new RegExp(`\`${k}\``).test(doc));
  assert.deepEqual(faltando, []);
});

test('docs/padroes.md (versionado) não contém ID de Discord', () => {
  assert.equal(/\b\d{17,20}\b/.test(ler('docs/padroes.md')), false);
});

test('agentes: frontmatter completo e todo caminho citado existe', () => {
  const dir = path.join(RAIZ, '.claude', 'agents');
  const arquivos = fs.readdirSync(dir).filter(f => f.endsWith('.md'));
  // Outros agentes (de outras frentes) podem conviver na pasta; os desta arquitetura precisam existir.
  const nossos = ['eventos-operacao', 'financas-patrimonio', 'guardiao', 'logs-jogo', 'plataforma', 'recrutamento-disciplina', 'tema-design'];
  assert.deepEqual(nossos.filter(a => !arquivos.includes(`${a}.md`)), []);

  // Só policiamos os nossos: agentes de outras frentes têm o próprio formato.
  for (const arq of nossos.map(a => `${a}.md`)) {
    const texto = fs.readFileSync(path.join(dir, arq), 'utf8');
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(texto);
    assert.ok(fm, `${arq}: sem frontmatter`);
    const campos = Object.fromEntries(fm[1].split('\n').map(l => [l.slice(0, l.indexOf(':')), l.slice(l.indexOf(':') + 1).trim()]));
    assert.equal(campos.name, arq.replace('.md', ''), `${arq}: name diferente do arquivo`);
    assert.ok(campos.description && campos.description.length > 40, `${arq}: description curta`);
    assert.ok(campos.tools, `${arq}: sem tools`);

    // Caminhos entre crases que começam por pasta/arquivo conhecidos do repo precisam existir
    for (const m of texto.matchAll(/`((?:docs|utils|modulos|plataforma|tenants|tema|fontes|config|commands|tools|test)\/[A-Za-z0-9_./*<>-]+)`/g)) {
      const caminho = m[1];
      if (/[*<>]/.test(caminho)) continue; // padrão/exemplo (utils/setup/*, tenants/<slug>/…)
      assert.ok(fs.existsSync(path.join(RAIZ, caminho.replace(/#.*$/, ''))), `${arq}: caminho inexistente: ${caminho}`);
    }
  }
});

test('CLAUDE.md e contratos: todo caminho de arquivo citado entre crases existe', () => {
  const alvos = ['CLAUDE.md', ...fs.readdirSync(path.join(RAIZ, 'docs', 'contratos')).map(f => `docs/contratos/${f}`)];
  const inexistentes = [];
  for (const alvo of alvos) {
    const texto = ler(alvo);
    for (const m of texto.matchAll(/`((?:docs|utils|modulos|plataforma|tenants|tema|fontes|config|commands|tools|test)\/[A-Za-z0-9_./-]+\.(?:js|md|json))`/g)) {
      if (!fs.existsSync(path.join(RAIZ, m[1]))) inexistentes.push(`${alvo}: ${m[1]}`);
    }
  }
  assert.deepEqual(inexistentes, []);
});
