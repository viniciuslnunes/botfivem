// Cria no servidor o que a torcida não tinha (cargos, categorias, canais) para os
// módulos ligados. Planejar é puro e testável; executar fala com o Discord.
//
// Canais nascem PRIVADOS (só o bot e a liderança) exceto os públicos do
// catálogo — advertência, bloqueio de ID e logs não são para todo mundo.
const { ChannelType, PermissionFlagsBits: P } = require('discord.js');
const { CARGOS, CARGOS_EM_LISTA, CANAIS, CATEGORIAS, CANAIS_PUBLICOS } = require('./catalogo');

// semCorrespondencia: ['cargos.socio', 'canais.ticket', 'cargos.adv[2]', 'categorias.tickets']
function planejarCriacao(semCorrespondencia) {
  const plano = [];
  for (const chave of semCorrespondencia) {
    const m = /^(cargos|canais|categorias)\.([A-Za-z0-9]+)(?:\[(\d+)\])?$/.exec(chave);
    if (!m) continue;
    const [, grupo, k, indice] = m;
    if (grupo === 'cargos' && indice) {
      const def = CARGOS_EM_LISTA[k];
      plano.push({ tipo: 'cargo', chave: `${k}[${indice}]`, lista: k, indice: Number(indice), nome: def ? def.nome(Number(indice)) : `${k.toUpperCase()} ${indice}` });
    } else if (grupo === 'cargos') {
      plano.push({ tipo: 'cargo', chave: k, nome: CARGOS[k]?.nome ?? k.toUpperCase() });
    } else if (grupo === 'categorias') {
      plano.push({ tipo: 'categoria', chave: k, nome: CATEGORIAS[k]?.nome ?? k.toUpperCase() });
    } else {
      plano.push({ tipo: 'canal', chave: k, nome: CANAIS[k]?.nome ?? k.toLowerCase(), publico: CANAIS_PUBLICOS.has(k) });
    }
  }
  // Ordem de criação: cargos primeiro (canais privados dependem deles), depois categorias, depois canais.
  const ordem = { cargo: 0, categoria: 1, canal: 2 };
  return plano.sort((a, b) => ordem[a.tipo] - ordem[b.tipo]);
}

// guild: Guild do discord.js (ou equivalente). lideranca: ids de cargo que podem
// ver os canais privados. Devolve { criados: {cargos, canais, categorias}, falhas: [texto] }.
async function executarCriacao(guild, plano, { lideranca = [] } = {}) {
  const criados = { cargos: {}, canais: {}, categorias: {} };
  const falhas = [];
  const razao = 'Onboarding /setup';
  const cargosDeLideranca = new Set(lideranca);

  for (const item of plano) {
    try {
      if (item.tipo === 'cargo') {
        const cargo = await guild.roles.create({ name: item.nome, reason: razao });
        if (item.lista) {
          (criados.cargos[item.lista] ??= [])[item.indice - 1] = cargo.id;
        } else {
          criados.cargos[item.chave] = cargo.id;
          // presidente/vice/velha guarda/diretoria criados agora também enxergam os canais privados
          if (['presidente', 'vicePresidente', 'velhaGuarda', 'diretoria'].includes(item.chave)) cargosDeLideranca.add(cargo.id);
        }
      } else if (item.tipo === 'categoria') {
        const cat = await guild.channels.create({ name: item.nome, type: ChannelType.GuildCategory, reason: razao });
        criados.categorias[item.chave] = cat.id;
      } else {
        const permissoes = item.publico ? [] : [
          { id: guild.roles.everyone.id, deny: [P.ViewChannel] },
          { id: guild.members.me.id, allow: [P.ViewChannel, P.SendMessages, P.EmbedLinks, P.AttachFiles, P.ReadMessageHistory, P.ManageMessages] },
          ...[...cargosDeLideranca].map(id => ({ id, allow: [P.ViewChannel, P.SendMessages, P.ReadMessageHistory] })),
        ];
        const canal = await guild.channels.create({ name: item.nome, type: ChannelType.GuildText, permissionOverwrites: permissoes, reason: razao });
        criados.canais[item.chave] = canal.id;
      }
    } catch (err) {
      falhas.push(`${item.tipo} ${item.nome}: ${err.message}`);
    }
  }
  return { criados, falhas };
}

module.exports = { planejarCriacao, executarCriacao };
