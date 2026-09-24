// Contrato de um módulo do bot (modulos/<id>.js). Um módulo é uma fatia de
// funcionalidade que a torcida pode ligar ou desligar (rifas, farm, caravana…).
// Este arquivo só valida a FORMA do manifesto; quem decide se ele sobe é
// plataforma/resolver.js.
//
//   module.exports = {
//     id: 'rifas',
//     descricao: 'Rifas vendidas em dinheiro do jogo',
//     padrao: true,                       // ligado quando o tenant não diz nada
//     obrigatorio: false,                 // true = não pode ser desligado (só o núcleo)
//     instalacao: false,                  // true = sobe também no modo instalação (tenant.instalacao)
//     requer: ['financeiro'],             // módulos que precisam estar ligados junto
//     exige: { canais: [], cargos: [], categorias: [], links: [], marca: [], tenant: [] },
//     // canais/cargos/categorias/links: chaves de tenant.js; marca: caminho no tema
//     // (ex.: 'elenco.logo'); tenant: chave de primeiro nível (ex.: 'parceiros').
//     comandos: ['rifa'],                 // arquivos de commands/ (sem .js)
//     carregar() { require('../utils/rifas/interacoes'); }, // registra handlers
//     // As tabelas do módulo são marcadas com `modulo: 'rifas'` em utils/migracoes.js.
//     // hooks (todos opcionais; recebem um último argumento `ctx`, ver plataforma/index.js):
//     aoIniciar(client) {},               // bot pronto, migrações feitas
//     aoMensagem(message, client) {},     // devolve true para consumir a mensagem
//     aoMembroAtualizado(antes, depois, client) {},
//     aoReacaoAdicionada(reaction, user, client) {},
//     aoReacaoRemovida(reaction, user, client) {},
//     painelLog: { iniciar(client), aoRegistros(novos, client) }, // ver logsJogo
//   };

const HOOKS = ['aoIniciar', 'aoMensagem', 'aoMembroAtualizado', 'aoReacaoAdicionada', 'aoReacaoRemovida'];
const CHAVES_EXIGE = ['canais', 'cargos', 'categorias', 'marca', 'links', 'tenant'];
const CHAVES_CONHECIDAS = new Set([
  'id', 'descricao', 'padrao', 'obrigatorio', 'instalacao', 'requer', 'exige', 'comandos', 'carregar', 'painelLog', ...HOOKS,
]);

function validarManifesto(m, origem = 'manifesto') {
  const erros = [];
  const e = msg => erros.push(`${origem}: ${msg}`);
  if (m === null || typeof m !== 'object') return [`${origem}: deve exportar um objeto`];

  if (typeof m.id !== 'string' || !/^[a-z][A-Za-z0-9]*$/.test(m.id)) e(`id inválido: ${JSON.stringify(m.id)} (camelCase, começa com letra minúscula)`);
  if (typeof m.descricao !== 'string' || !m.descricao) e('descricao obrigatória');
  if (typeof m.padrao !== 'boolean') e('padrao deve ser true/false');
  if (m.obrigatorio !== undefined && typeof m.obrigatorio !== 'boolean') e('obrigatorio deve ser true/false');
  if (m.obrigatorio && m.padrao !== true) e('módulo obrigatório precisa de padrao: true');
  if (m.instalacao !== undefined && typeof m.instalacao !== 'boolean') e('instalacao deve ser true/false');

  const lista = (k, obrigatoria = false) => {
    if (m[k] === undefined) return !obrigatoria || (e(`${k} obrigatório`), false);
    if (!Array.isArray(m[k]) || m[k].some(x => typeof x !== 'string' || !x)) { e(`${k} deve ser lista de textos`); return false; }
    return true;
  };
  lista('requer');
  lista('comandos');

  if (m.exige !== undefined) {
    if (m.exige === null || typeof m.exige !== 'object' || Array.isArray(m.exige)) e('exige deve ser objeto');
    else {
      for (const k of Object.keys(m.exige)) {
        if (!CHAVES_EXIGE.includes(k)) e(`exige.${k} desconhecido (use: ${CHAVES_EXIGE.join(', ')})`);
        else if (!Array.isArray(m.exige[k]) || m.exige[k].some(x => typeof x !== 'string')) e(`exige.${k} deve ser lista de textos`);
      }
    }
  }

  if (m.carregar !== undefined && typeof m.carregar !== 'function') e('carregar deve ser função');
  for (const h of HOOKS) if (m[h] !== undefined && typeof m[h] !== 'function') e(`${h} deve ser função`);
  if (m.painelLog !== undefined) {
    if (m.painelLog === null || typeof m.painelLog !== 'object') e('painelLog deve ser objeto');
    else {
      if (typeof m.painelLog.iniciar !== 'function') e('painelLog.iniciar deve ser função');
      if (m.painelLog.aoRegistros !== undefined && typeof m.painelLog.aoRegistros !== 'function') e('painelLog.aoRegistros deve ser função');
    }
  }

  // Erro de digitação (aoMesnagem) não pode virar hook silenciosamente ignorado.
  for (const k of Object.keys(m)) if (!CHAVES_CONHECIDAS.has(k)) e(`chave desconhecida "${k}"`);
  return erros;
}

module.exports = { validarManifesto, HOOKS, CHAVES_EXIGE };
