// Regras puras dos departamentos (sem Discord nem banco).
// Área não concede permissão sozinha: quem gere pessoas é a presidência ou o
// gestor daquela área, e só a presidência mexe em gestor.

function nomesDosCargos(nome) {
  const n = String(nome).toUpperCase();
  return { membro: `MEMBRO • ${n}`, gestor: `GESTOR • ${n}` };
}

function nomeDoCanal(area) {
  return `${area.emoji}・${area.slug}`;
}

function papelAtual({ temMembro, temGestor }) {
  if (temGestor) return 'gestor';
  if (temMembro) return 'membro';
  return null;
}

/**
 * @param {{ acao: 'incluir'|'remover', papel?: 'membro'|'gestor', atorPresidencia: boolean,
 *   atorGestorDaArea: boolean, alvoSocio: boolean, alvoPapelAtual: null|'membro'|'gestor' }} p
 * @returns {{ ok: true, adicionar: string[], remover: string[], resumo: string } | { ok: false, mensagem: string }}
 */
function decidirMudancaArea(p) {
  const nega = mensagem => ({ ok: false, mensagem });
  if (!p.atorPresidencia && !p.atorGestorDaArea) {
    return nega('❌ SÓ A PRESIDÊNCIA OU O GESTOR DESTA ÁREA PODE ALTERAR QUEM FAZ PARTE DELA.');
  }

  if (p.acao === 'remover') {
    if (!p.alvoPapelAtual) return nega('⚠️ ESTE MEMBRO NÃO FAZ PARTE DESTA ÁREA.');
    if (p.alvoPapelAtual === 'gestor' && !p.atorPresidencia) return nega('❌ SÓ A PRESIDÊNCIA REMOVE UM GESTOR DE ÁREA.');
    return { ok: true, adicionar: [], remover: ['membro', 'gestor'], resumo: 'removido da área' };
  }

  if (!p.alvoSocio) return nega('❌ SÓ SÓCIO APROVADO PODE FAZER PARTE DE UMA ÁREA.');

  if (p.papel === 'gestor') {
    if (!p.atorPresidencia) return nega('❌ SÓ A PRESIDÊNCIA DEFINE GESTOR DE ÁREA.');
    if (p.alvoPapelAtual === 'gestor') return nega('⚠️ ESTE MEMBRO JÁ É GESTOR DESTA ÁREA.');
    return p.alvoPapelAtual === 'membro'
      ? { ok: true, adicionar: ['gestor'], remover: [], resumo: 'promovido a gestor' }
      : { ok: true, adicionar: ['membro', 'gestor'], remover: [], resumo: 'incluído como gestor' };
  }

  if (p.alvoPapelAtual === 'gestor') {
    if (!p.atorPresidencia) return nega('❌ SÓ A PRESIDÊNCIA ALTERA UM GESTOR DE ÁREA.');
    return { ok: true, adicionar: [], remover: ['gestor'], resumo: 'rebaixado a membro' };
  }
  if (p.alvoPapelAtual === 'membro') return nega('⚠️ ESTE MEMBRO JÁ FAZ PARTE DESTA ÁREA.');
  return { ok: true, adicionar: ['membro'], remover: [], resumo: 'incluído como membro' };
}

// Lista de menções que cabe num campo de embed sem cortar uma menção no meio
function listaLimitada(linhas, max = 480) {
  const saida = [];
  let tamanho = 0;
  for (let i = 0; i < linhas.length; i++) {
    const restante = linhas.length - i;
    const sufixo = `\n*… e mais ${restante}*`;
    if (tamanho + linhas[i].length + 1 + sufixo.length > max) {
      saida.push(`*… e mais ${restante}*`);
      break;
    }
    saida.push(linhas[i]);
    tamanho += linhas[i].length + 1;
  }
  return saida.join('\n');
}

module.exports = { nomesDosCargos, nomeDoCanal, papelAtual, decidirMudancaArea, listaLimitada };
