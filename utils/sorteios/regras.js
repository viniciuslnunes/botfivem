const crypto = require('node:crypto');

// Regras puras do sorteio (sem Discord, sem banco): escolha sem repetição,
// leitura de data, de prêmios e do intervalo de números.

const TITULO_MAX = 80;
const PREMIO_MAX = 100;
const PREMIOS_MAX = 25;
const NUMEROS_MAX = 5000;

// Inteiro uniforme em [0, n). crypto e não Math.random: o resultado tem de ser
// imprevisível e justo, e ninguém pode "adivinhar" a sequência.
const aleatorio = n => crypto.randomInt(n);

// Um número dentre os que ainda não saíram. `sorteados` = números já usados.
function escolherNumero(total, sorteados, rand = aleatorio) {
  const usados = new Set(sorteados);
  const restantes = [];
  for (let n = 1; n <= total; n++) if (!usados.has(n)) restantes.push(n);
  if (!restantes.length) return null;
  return restantes[rand(restantes.length)];
}

// "AAAA-MM-DD", "DD/MM/AAAA" ou "DD/MM" (ano corrente); vazio = hoje (fuso de Brasília).
function parseDia(texto, agora = new Date()) {
  const hoje = new Date(agora.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const t = String(texto ?? '').trim();
  if (!t) return hoje;
  let ano;
  let mes;
  let dia;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) [, ano, mes, dia] = m;
  else if ((m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/))) [, dia, mes, ano] = [m[0], m[1], m[2], m[3] ?? hoje.slice(0, 4)];
  else return null;
  ano = Number(ano); mes = Number(mes); dia = Number(dia);
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return d.toISOString().slice(0, 10);
}

// Um prêmio por linha; linhas vazias somem; aceita marcador ("-", "•", "1.").
function parsePremios(texto) {
  const linhas = String(texto ?? '').split(/\r?\n/)
    .map(l => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim())
    .filter(Boolean);
  if (linhas.some(l => l.length > PREMIO_MAX)) return { ok: false, mensagem: `❌ CADA PRÊMIO TEM NO MÁXIMO ${PREMIO_MAX} CARACTERES.` };
  return { ok: true, premios: linhas };
}

function validarTitulo(texto) {
  const t = String(texto ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return { ok: false, mensagem: '❌ INFORME UM TÍTULO PARA O SORTEIO.' };
  if (t.length > TITULO_MAX) return { ok: false, mensagem: `❌ O TÍTULO TEM NO MÁXIMO ${TITULO_MAX} CARACTERES.` };
  return { ok: true, titulo: t };
}

// Intervalo 1..N do modo "só números". Vazio = usar o registro diário.
function parseNumeros(texto) {
  const t = String(texto ?? '').trim();
  if (!t) return { ok: true, numeros: null };
  if (!/^\d+$/.test(t)) return { ok: false, mensagem: '❌ NÚMEROS: USE UM INTEIRO (SORTEIA DE 1 ATÉ ELE) OU DEIXE VAZIO.' };
  const n = Number(t);
  if (n < 1 || n > NUMEROS_MAX) return { ok: false, mensagem: `❌ O INTERVALO VAI DE 1 A ${NUMEROS_MAX}.` };
  return { ok: true, numeros: n };
}

// Jogadores distintos (por ID) numerados 1..N em ordem alfabética: a mesma
// lista sempre gera a mesma numeração.
function numerarParticipantes(entradas) {
  const porId = new Map();
  for (const e of entradas ?? []) {
    const id = String(e.id ?? '').trim();
    if (id && !porId.has(id)) porId.set(id, { id, nome: String(e.nome ?? '?').trim() || '?' });
  }
  return [...porId.values()]
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }) || a.id.localeCompare(b.id, 'pt-BR', { numeric: true }))
    .map((p, i) => ({ numero: i + 1, id: p.id, nome: p.nome }));
}

// Mínimo de minutos online no dia (vazio = sem mínimo)
function parseMinutos(texto) {
  const t = String(texto ?? '').trim();
  if (!t) return { ok: true, minutos: null };
  if (!/^\d+$/.test(t) || Number(t) < 1 || Number(t) > 1440) return { ok: false, mensagem: '❌ MÍNIMO DE MINUTOS: INTEIRO DE 1 A 1440, OU VAZIO PARA TODOS.' };
  return { ok: true, minutos: Number(t) };
}

// Selo da lista: SHA-256 de "numero:id" em ordem. Quem tem a lista confere que
// ela não mudou entre a criação e o sorteio.
function hashLista(participantes) {
  const base = participantes.map(p => `${p.numero}:${p.id ?? p.id_jogo}`).join('|');
  return crypto.createHash('sha256').update(base).digest('hex');
}

// Aplica as regras de elegibilidade ANTES de numerar: quem sai não ocupa número.
// ganhadoresRecentes = { ids:Set, discords:Set, nomes:Set (normalizados) }.
function filtrarElegiveis(entradas, { minMinutos = null, ganhadoresRecentes = null, discordPorId = new Map(), normalizar = x => x } = {}) {
  let excluidosMinimo = 0;
  let excluidosRecentes = 0;
  const distintos = numerarParticipantes(entradas);
  const tempo = new Map();
  for (const e of entradas ?? []) tempo.set(String(e.id), Math.max(tempo.get(String(e.id)) ?? 0, Number(e.ms) || 0));
  const elegiveis = [];
  for (const p of distintos) {
    if (minMinutos && (tempo.get(p.id) ?? 0) < minMinutos * 60 * 1000) { excluidosMinimo++; continue; }
    const r = ganhadoresRecentes;
    if (r && (r.ids.has(p.id) || r.nomes.has(normalizar(p.nome)) || (discordPorId.get(p.id) && r.discords.has(discordPorId.get(p.id))))) { excluidosRecentes++; continue; }
    elegiveis.push(p);
  }
  return { elegiveis: elegiveis.map((p, i) => ({ ...p, numero: i + 1 })), excluidosMinimo, excluidosRecentes };
}

module.exports = {
  parseMinutos, hashLista, filtrarElegiveis,
  TITULO_MAX, PREMIO_MAX, PREMIOS_MAX, NUMEROS_MAX,
  aleatorio, escolherNumero, parseDia, parsePremios, validarTitulo, parseNumeros, numerarParticipantes,
};
