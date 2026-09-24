// Discord falso para exercitar os handlers REAIS do bot em teste: servidor com
// canais, cargos e membros; interações que registram o que o bot respondeu.
// Só o suficiente do formato do discord.js para os fluxos do projeto (mensagens,
// canais, membros, botões, selects e modais). Nada de rede.
let contador = 1000;
const proximoId = () => String(++contador);

class Colecao extends Map {
  find(fn) { for (const v of this.values()) if (fn(v)) return v; return undefined; }
  some(fn) { return Boolean(this.find(fn)); }
  filter(fn) { const c = new Colecao(); for (const [k, v] of this) if (fn(v, k)) c.set(k, v); return c; }
  map(fn) { return [...this.values()].map(fn); }
  first() { return this.values().next().value; }
  last() { return [...this.values()].pop(); }
}

function criarMensagem(canal, payload = {}, autor = { id: 'BOT', bot: true, username: 'bot' }) {
  const msg = {
    id: proximoId(),
    channel: canal,
    channelId: canal.id,
    content: payload.content ?? null,
    embeds: payload.embeds ?? [],
    components: payload.components ?? [],
    files: payload.files ?? [],
    attachments: new Colecao(),
    createdTimestamp: Date.now(),
    author: { displayAvatarURL: () => null, ...autor },
    editada: 0,
    apagada: false,
    async edit(novo) {
      this.editada++;
      if ('content' in novo) this.content = novo.content;
      if ('embeds' in novo) this.embeds = novo.embeds;
      if ('components' in novo) this.components = novo.components;
      return this;
    },
    async delete() { this.apagada = true; },
    async reply(p) { return canal.send(p); },
  };
  return msg;
}

function criarCanal(id, nome, { tipo = 0, parentId = null } = {}) {
  const canal = {
    id, name: nome, type: tipo, parentId,
    enviadas: [],
    historico: [], // mais nova primeiro (como o fetch do Discord)
    apagado: false,
    isTextBased: () => tipo === 0,
    toString: () => `<#${id}>`,
    async send(payload) {
      const msg = criarMensagem(canal, payload);
      canal.enviadas.push(msg);
      canal.historico.unshift(msg);
      return msg;
    },
    messages: {
      async fetch(arg) {
        if (typeof arg === 'string') {
          const achada = canal.historico.find(m => m.id === arg);
          if (!achada) throw new Error('Unknown Message');
          return achada;
        }
        const { limit = 50, before } = arg ?? {};
        let base = canal.historico;
        if (before) base = base.slice(base.findIndex(m => m.id === before) + 1);
        const colecao = new Colecao();
        for (const m of base.slice(0, limit)) colecao.set(m.id, m);
        return colecao;
      },
    },
    awaitMessages: () => Promise.reject(new Error('time')), // ninguém manda manto no teste
    async delete() { canal.apagado = true; },
  };
  return canal;
}

function criarMembro(id, { cargos = [], nome = 'Fulano', apelido = null, permissoes = [] } = {}) {
  const cache = new Colecao(cargos.map(c => [c, { id: c }]));
  const membro = {
    id,
    nickname: apelido,
    displayName: apelido ?? nome,
    registros: [],
    user: { id, username: nome, displayName: nome, bot: false, displayAvatarURL: () => null, toString: () => `<@${id}>` },
    permissions: { has: f => permissoes.includes(f) },
    roles: {
      cache,
      async add(cargo) { cache.set(cargo, { id: cargo }); membro.registros.push(['add', cargo]); },
      async remove(cargo) { cache.delete(cargo); membro.registros.push(['remove', cargo]); },
    },
    async setNickname(n) { membro.nickname = n; membro.displayName = n; membro.registros.push(['nick', n]); },
    toString: () => `<@${id}>`,
  };
  return membro;
}

function criarServidor({ id = 'GUILD', canais = [], membros = [] } = {}) {
  const canaisCache = new Colecao(canais.map(c => [c.id, c]));
  const membrosCache = new Colecao(membros.map(m => [m.id, m]));
  const guild = {
    id,
    channels: {
      cache: canaisCache,
      async fetch(cid) { return canaisCache.get(cid) ?? null; },
      async create(opcoes) {
        const canal = criarCanal(proximoId(), opcoes.name, { tipo: opcoes.type ?? 0, parentId: opcoes.parent ?? null });
        canal.opcoes = opcoes;
        canaisCache.set(canal.id, canal);
        return canal;
      },
    },
    members: {
      cache: membrosCache,
      me: { id: 'BOT', permissions: { has: () => true }, roles: { highest: { position: 99 } } },
      async fetch(alvo) {
        if (alvo === undefined) return membrosCache;
        const m = membrosCache.get(alvo);
        if (!m) throw new Error('Unknown Member');
        return m;
      },
    },
    roles: { cache: new Colecao(), everyone: { id: 'EVERYONE' } },
  };
  guild.client = {
    guilds: { fetch: async () => guild },
    channels: { fetch: async cid => canaisCache.get(cid) ?? null, cache: canaisCache },
    user: { id: 'BOT', tag: 'Bot#0001' },
  };
  return guild;
}

// Interação (botão, select ou modal) que registra tudo que o bot respondeu.
function criarInteracao({ customId, user, membro, guild, canal, mensagem, campos = {}, valores = [] }) {
  const registros = [];
  const i = {
    customId,
    user: user ?? membro?.user,
    member: membro,
    guild,
    client: guild.client,
    channel: canal ?? mensagem?.channel ?? null,
    channelId: (canal ?? mensagem?.channel)?.id,
    message: mensagem,
    values: valores,
    deferred: false,
    replied: false,
    registros,
    fields: { getTextInputValue: k => (k in campos ? campos[k] : '') },
    isRepliable: () => true,
    async reply(p) { i.replied = true; registros.push(['reply', p]); return {}; },
    async deferReply(p) { i.deferred = true; registros.push(['deferReply', p]); },
    async deferUpdate() { i.deferred = true; registros.push(['deferUpdate']); },
    async editReply(p) { registros.push(['editReply', p]); return {}; },
    async followUp(p) { registros.push(['followUp', p]); return {}; },
    async update(p) { registros.push(['update', p]); return {}; },
    async showModal(m) { registros.push(['showModal', m]); },
  };
  i.acao = tipo => registros.filter(r => r[0] === tipo).map(r => r[1]);
  // Texto de tudo que o bot respondeu (para conferir com regex)
  i.texto = () => registros.map(([, p]) => JSON.stringify(p ?? {})).join('\n');
  return i;
}

module.exports = { Colecao, criarCanal, criarMembro, criarMensagem, criarServidor, criarInteracao };
