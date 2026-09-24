const config = require('../../config/index.js');
const tema = require('../../tema');
const { lerConfig, gravarConfig } = require('../botConfig');
const { ehSocioOuAcima } = require('../permissoes');

// Link do grupo de sócios no WhatsApp: editável em runtime (painel
// 📲・convite-whatsapp) via bot_config, sem precisar redeploy. Sem valor salvo,
// cai no padrão fixo em config/index.js.
const CHAVE_LINK = 'whatsapp_socios_link';

async function obterLink() {
  const salvo = await lerConfig(CHAVE_LINK);
  return salvo || config.links.whatsappSocios;
}

async function definirLink(novoLink) {
  await gravarConfig(CHAVE_LINK, novoLink);
}

function textoConvite(link) {
  return `${tema.emoji.marca} Convite do grupo de sócios ${tema.marca.de} **${tema.marca.nomeSegmentado}** no WhatsApp:\n${link}`;
}

// Guarda central: o link NUNCA pode ir pra quem não tem cargo de sócio pra
// cima (visitante/provar-manto vazaria o grupo pra rivais). Todo ponto de
// disparo (aprovação de recrutamento, comando, painel) passa por aqui.
// Retorna 'enviado' | 'sem_cargo' | 'falhou'.
async function enviarConvitePara(membro, link) {
  if (!ehSocioOuAcima(membro)) return 'sem_cargo';
  try {
    await membro.send({ content: textoConvite(link) });
    return 'enviado';
  } catch {
    return 'falhou';
  }
}

module.exports = { obterLink, definirLink, textoConvite, enviarConvitePara, CHAVE_LINK };
