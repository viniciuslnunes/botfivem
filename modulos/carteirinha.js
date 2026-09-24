module.exports = {
  id: 'carteirinha',
  descricao: 'Carteirinha de sócio (imagem gerada), vencimento e renovação, e mural de associados',
  padrao: true,
  exige: { canais: ['carteirinha', 'mural'], marca: ['capa', 'carteirinha.subtitulo', 'carteirinha.assinatura.nome'] },
  comandos: ['carteirinha', 'carteirinhas', 'mural'],
  carregar() {
    require('../utils/carteirinhaInteracoes');
    require('../utils/muralAssociados'); // registra o prefixo "mural"
  },

  aoIniciar(client) {
    const { reconciliarCarteirinhas } = require('../utils/carteirinhaSocio');
    const { iniciarVerificacaoVencimentos } = require('../utils/carteirinha/vencimentos');

    // Carteirinhas de quem perdeu ou recuperou o cargo SÓCIO com o bot desligado
    reconciliarCarteirinhas(client)
      .then(alteradas => { if (alteradas) console.log(`[carteirinha] ${alteradas} carteirinha(s) reconciliada(s).`); })
      .catch(err => console.error('[carteirinha] Erro na reconciliação:', err));
    // Aviso por DM de carteirinha vencendo/vencida (a cada 6h)
    iniciarVerificacaoVencimentos(client);
  },

  // Desligar (perder o cargo SÓCIO, por ADV vencida ou pela diretoria) revoga a
  // carteirinha e tira do mural; recuperar restaura com o mesmo número.
  aoMembroAtualizado(antes, depois, client) {
    const config = require('../config/index.js');
    const { sincronizarCarteirinhaComCargo } = require('../utils/carteirinhaSocio');
    const eraSocio = antes.roles.cache.has(config.cargos.socio);
    const ehSocio = depois.roles.cache.has(config.cargos.socio);
    if (eraSocio === ehSocio) return undefined;
    return sincronizarCarteirinhaComCargo(client, depois.id, ehSocio)
      .catch(err => console.error('[carteirinha] Erro ao sincronizar com o cargo:', err));
  },
};
