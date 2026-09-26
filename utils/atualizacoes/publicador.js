const config = require('../../config/index.js');
const tema = require('../../tema');
const { lerConfig, gravarConfig } = require('../botConfig');
const catalogo = require('./catalogo');
const regras = require('./regras');

// Ao subir, posta no canal de atualizações o que ainda não foi postado e que diz
// respeito aos módulos ligados nesta torcida. Cada entrega vira uma mensagem, da mais
// antiga para a mais nova. O que já saiu fica em bot_config (`atualizacoes_postadas`),
// gravado a cada envio: se cair no meio, a próxima subida continua de onde parou.
// canais.atualizacoes null = sem canal, nada é postado.
const CHAVE = 'atualizacoes_postadas';

async function lerPostadas() {
  const bruto = await lerConfig(CHAVE);
  if (!bruto) return null;
  try {
    return new Set(JSON.parse(bruto));
  } catch {
    return null;
  }
}

const gravarPostadas = postadas => gravarConfig(CHAVE, JSON.stringify([...postadas]));

// `moduloAtivo`: ctx.moduloAtivo da plataforma. Devolve { postadas: n, silenciadas: n }.
async function publicarPendentes(client, { moduloAtivo, agora = new Date(), entradas = null } = {}) {
  const canalId = config.canais.atualizacoes;
  if (!canalId) return { postadas: 0, silenciadas: 0 };

  const relevantes = regras.doTenant(entradas ?? catalogo.carregar(), moduloAtivo);
  const jaPostadas = await lerPostadas();
  const { publicar, silenciar } = regras.separarPendentes(relevantes, jaPostadas, agora);
  const postadas = new Set(jaPostadas ?? []);

  for (const e of silenciar) postadas.add(e.id);
  if (silenciar.length || (!jaPostadas && !publicar.length)) await gravarPostadas(postadas);
  if (!publicar.length) return { postadas: 0, silenciadas: silenciar.length };

  const canal = await client.channels.fetch(canalId).catch(() => null);
  if (!canal) {
    console.error('[atualizacoes] Canal de atualizações não encontrado; nada foi postado.');
    return { postadas: 0, silenciadas: silenciar.length };
  }

  let enviadas = 0;
  for (const e of publicar) {
    await canal.send({ embeds: [regras.montarEmbed(e, tema)], allowedMentions: { parse: [] } });
    postadas.add(e.id);
    await gravarPostadas(postadas);
    enviadas++;
  }
  return { postadas: enviadas, silenciadas: silenciar.length };
}

module.exports = { publicarPendentes };
