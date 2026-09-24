// Fábrica de manifesto para os canais de inteligência de log (📦 baú, 🏦 caixa,
// 🌾 farm…). Todos seguem o mesmo padrão (docs/padroes.md § 1.1): iniciam depois
// da sincronização dos logs e acordam por debounce quando chega log do tipo
// deles. Arquivo com "_" no nome: não é um módulo, é ferramenta dos módulos.
//
//   manifestoDePainel({
//     id: 'painelBau', descricao: '…', arquivo: 'painelBau',
//     iniciar: 'iniciarPainelBau',            // export que sobe o painel
//     agendar: 'agendarAtualizacaoReativa',   // export que reedita com debounce
//     categorias: ['bau'], acoes: [],         // que logs acordam o painel
//   })

function manifestoDePainel({
  id, descricao, arquivo, iniciar, agendar, categorias = [], acoes = [],
  requer = [], aoRegistrosExtra, exige,
}) {
  const carregarArquivo = () => require(`../utils/logsJogo/${arquivo}`);
  const manifesto = {
    id,
    descricao,
    padrao: true,
    requer: ['logsJogo', ...requer],
    carregar() { carregarArquivo(); },
    painelLog: {
      iniciar: client => carregarArquivo()[iniciar](client),
      async aoRegistros(novos, client) {
        if (agendar && novos.some(r => categorias.includes(r.categoria) || acoes.includes(r.acao))) {
          carregarArquivo()[agendar](client);
        }
        if (aoRegistrosExtra) await aoRegistrosExtra(novos, client);
      },
    },
  };
  if (exige) manifesto.exige = exige;
  return manifesto;
}

module.exports = { manifestoDePainel };
