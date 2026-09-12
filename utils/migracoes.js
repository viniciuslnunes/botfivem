const db = require('./db');

// Estrutura nova do bot. Só aditivo (IF NOT EXISTS): roda a cada start sem
// tocar nos dados que já existem.
const MIGRACOES = [
  {
    nome: 'tarefas_agendadas',
    sql: `CREATE TABLE IF NOT EXISTS tarefas_agendadas (
      id BIGSERIAL PRIMARY KEY,
      tipo TEXT NOT NULL,
      executar_em TIMESTAMPTZ NOT NULL,
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'pendente',
      tentativas INT NOT NULL DEFAULT 0,
      ultimo_erro TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  },
  {
    nome: 'idx_tarefas_fila',
    sql: 'CREATE INDEX IF NOT EXISTS idx_tarefas_fila ON tarefas_agendadas (status, executar_em)',
  },
  {
    nome: 'logs_jogo',
    sql: `CREATE TABLE IF NOT EXISTS logs_jogo (
      id BIGSERIAL PRIMARY KEY,
      message_id TEXT NOT NULL,
      embed_indice INT NOT NULL DEFAULT 0,
      canal_id TEXT NOT NULL,
      categoria TEXT,
      acao TEXT NOT NULL,
      ator_nome TEXT,
      ator_id_fivem TEXT,
      alvo_nome TEXT,
      alvo_id_fivem TEXT,
      valor NUMERIC(18, 2),
      titulo TEXT,
      descricao TEXT,
      ocorrido_em TIMESTAMPTZ NOT NULL,
      bruto JSONB NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (message_id, embed_indice)
    )`,
  },
  { nome: 'idx_logs_ocorrido', sql: 'CREATE INDEX IF NOT EXISTS idx_logs_ocorrido ON logs_jogo (ocorrido_em)' },
  { nome: 'idx_logs_ator', sql: 'CREATE INDEX IF NOT EXISTS idx_logs_ator ON logs_jogo (ator_id_fivem, ocorrido_em)' },
  { nome: 'idx_logs_alvo', sql: 'CREATE INDEX IF NOT EXISTS idx_logs_alvo ON logs_jogo (alvo_id_fivem, ocorrido_em)' },
  { nome: 'idx_logs_categoria', sql: 'CREATE INDEX IF NOT EXISTS idx_logs_categoria ON logs_jogo (categoria, ocorrido_em)' },
  { nome: 'idx_logs_acao', sql: 'CREATE INDEX IF NOT EXISTS idx_logs_acao ON logs_jogo (acao, ocorrido_em)' },
  {
    // Desligar revoga a carteirinha sem apagar: o número e o histórico ficam
    nome: 'socios.revogada_em',
    sql: 'ALTER TABLE socios ADD COLUMN IF NOT EXISTS revogada_em TIMESTAMPTZ',
  },
  {
    nome: 'socios.renovacao_e_avisos',
    sql: `ALTER TABLE socios
      ADD COLUMN IF NOT EXISTS renovada_em TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS renovada_por_id TEXT,
      ADD COLUMN IF NOT EXISTS aviso_vencimento_em TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS aviso_vencida_em TIMESTAMPTZ`,
  },
  {
    // Ficha de recrutamento: sai do embed e ganha histórico, laudo de reprovação e área pretendida
    nome: 'fichas_recrutamento',
    sql: `CREATE TABLE IF NOT EXISTS fichas_recrutamento (
      id BIGSERIAL PRIMARY KEY,
      message_id TEXT NOT NULL UNIQUE,
      discord_id TEXT NOT NULL,
      nome TEXT,
      idade INT,
      id_fivem TEXT,
      telefone TEXT,
      recrutador TEXT,
      area_slug TEXT,
      status TEXT NOT NULL DEFAULT 'PENDENTE',
      decidido_por_id TEXT,
      decidido_em TIMESTAMPTZ,
      reprovado_categoria TEXT,
      reprovado_motivo TEXT,
      permite_reenvio BOOLEAN,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  },
  { nome: 'idx_fichas_candidato', sql: 'CREATE INDEX IF NOT EXISTS idx_fichas_candidato ON fichas_recrutamento (discord_id, criado_em DESC)' },
  {
    nome: 'eventos',
    sql: `CREATE TABLE IF NOT EXISTS eventos (
      id BIGSERIAL PRIMARY KEY,
      tipo TEXT NOT NULL DEFAULT 'GERAL',
      titulo TEXT NOT NULL,
      descricao TEXT,
      local TEXT,
      inicio_em TIMESTAMPTZ NOT NULL,
      capacidade INT,
      area_slug TEXT,
      serie_id TEXT,
      canal_id TEXT NOT NULL,
      message_id TEXT,
      status TEXT NOT NULL DEFAULT 'ATIVO',
      criado_por_id TEXT NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  },
  { nome: 'idx_eventos_inicio', sql: 'CREATE INDEX IF NOT EXISTS idx_eventos_inicio ON eventos (status, inicio_em)' },
  { nome: 'idx_eventos_serie', sql: 'CREATE INDEX IF NOT EXISTS idx_eventos_serie ON eventos (serie_id, inicio_em)' },
  {
    // Confirmação (quem vai) e presença (quem foi) são perguntas diferentes na mesma linha
    nome: 'evento_inscricoes',
    sql: `CREATE TABLE IF NOT EXISTS evento_inscricoes (
      evento_id BIGINT NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
      discord_id TEXT NOT NULL,
      status TEXT NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      presente_em TIMESTAMPTZ,
      presenca_por_id TEXT,
      PRIMARY KEY (evento_id, discord_id)
    )`,
  },
  { nome: 'idx_inscricoes_fila', sql: 'CREATE INDEX IF NOT EXISTS idx_inscricoes_fila ON evento_inscricoes (evento_id, status, criado_em)' },
  { nome: 'idx_inscricoes_pessoa', sql: 'CREATE INDEX IF NOT EXISTS idx_inscricoes_pessoa ON evento_inscricoes (discord_id, presente_em)' },
  {
    // Livro-caixa. Valor sempre positivo (o sinal vem do tipo); saldo nunca é gravado
    nome: 'financeiro_lancamentos',
    sql: `CREATE TABLE IF NOT EXISTS financeiro_lancamentos (
      id BIGSERIAL PRIMARY KEY,
      tipo TEXT NOT NULL,
      categoria TEXT NOT NULL,
      valor NUMERIC(14, 2) NOT NULL CHECK (valor > 0),
      descricao TEXT NOT NULL,
      data DATE NOT NULL,
      evento_id BIGINT,
      area_slug TEXT,
      origem TEXT NOT NULL DEFAULT 'MANUAL',
      origem_id TEXT,
      criado_por_id TEXT NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  },
  { nome: 'idx_financeiro_data', sql: 'CREATE INDEX IF NOT EXISTS idx_financeiro_data ON financeiro_lancamentos (data, categoria)' },
  {
    // Lançamento automático (loja, rifa) é idempotente pela origem
    nome: 'uq_financeiro_origem',
    sql: 'CREATE UNIQUE INDEX IF NOT EXISTS uq_financeiro_origem ON financeiro_lancamentos (origem, origem_id) WHERE origem_id IS NOT NULL',
  },
  {
    nome: 'loja_produtos',
    sql: `CREATE TABLE IF NOT EXISTS loja_produtos (
      id BIGSERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      descricao TEXT,
      preco NUMERIC(14, 2) NOT NULL CHECK (preco > 0),
      estoque JSONB NOT NULL DEFAULT '{}'::jsonb,
      imagem_ref TEXT,
      ativo BOOLEAN NOT NULL DEFAULT true,
      criado_por_id TEXT NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  },
  {
    nome: 'loja_pedidos',
    sql: `CREATE TABLE IF NOT EXISTS loja_pedidos (
      id BIGSERIAL PRIMARY KEY,
      discord_id TEXT NOT NULL,
      produto_id BIGINT NOT NULL REFERENCES loja_produtos(id),
      produto_nome TEXT NOT NULL,
      tamanho TEXT NOT NULL,
      quantidade INT NOT NULL CHECK (quantidade > 0),
      preco_unit NUMERIC(14, 2) NOT NULL,
      total NUMERIC(14, 2) NOT NULL,
      observacao TEXT,
      status TEXT NOT NULL DEFAULT 'PENDENTE',
      canal_id TEXT,
      decidido_por_id TEXT,
      decidido_em TIMESTAMPTZ,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  },
  { nome: 'idx_pedidos_comprador', sql: 'CREATE INDEX IF NOT EXISTS idx_pedidos_comprador ON loja_pedidos (discord_id, status)' },
  {
    // Escala responde "quem trabalha"; a inscrição continua respondendo "quem vai"
    nome: 'evento_escala',
    sql: `CREATE TABLE IF NOT EXISTS evento_escala (
      evento_id BIGINT NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
      discord_id TEXT NOT NULL,
      funcao TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'CONVOCADO',
      convocado_por_id TEXT NOT NULL,
      convocado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      respondido_em TIMESTAMPTZ,
      PRIMARY KEY (evento_id, discord_id)
    )`,
  },
  {
    nome: 'caravana_veiculos',
    sql: `CREATE TABLE IF NOT EXISTS caravana_veiculos (
      id BIGSERIAL PRIMARY KEY,
      evento_id BIGINT NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
      nome TEXT NOT NULL,
      capacidade INT NOT NULL CHECK (capacidade > 0),
      responsavel_id TEXT,
      ponto TEXT,
      horario TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  },
  {
    // Uma pessoa, um veículo: a alocação mora na inscrição
    nome: 'evento_inscricoes.veiculo_id',
    sql: 'ALTER TABLE evento_inscricoes ADD COLUMN IF NOT EXISTS veiculo_id BIGINT REFERENCES caravana_veiculos(id) ON DELETE SET NULL',
  },
  {
    // Embarque por trecho: quem apareceu na volta sem ter ido é buraco para o gestor ver
    nome: 'evento_checkins',
    sql: `CREATE TABLE IF NOT EXISTS evento_checkins (
      evento_id BIGINT NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
      discord_id TEXT NOT NULL,
      trecho TEXT NOT NULL,
      registrado_por_id TEXT NOT NULL,
      registrado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (evento_id, discord_id, trecho)
    )`,
  },
  {
    nome: 'patrimonio_itens',
    sql: `CREATE TABLE IF NOT EXISTS patrimonio_itens (
      id BIGSERIAL PRIMARY KEY,
      nome TEXT NOT NULL,
      categoria TEXT NOT NULL,
      subtipo TEXT,
      quantidade INT NOT NULL DEFAULT 1 CHECK (quantidade > 0),
      localizacao TEXT,
      responsavel_id TEXT,
      foto_ref TEXT,
      observacao TEXT,
      status TEXT NOT NULL DEFAULT 'ATIVO',
      baixado_em TIMESTAMPTZ,
      baixado_motivo TEXT,
      criado_por_id TEXT NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  },
  {
    nome: 'patrimonio_emprestimos',
    sql: `CREATE TABLE IF NOT EXISTS patrimonio_emprestimos (
      id BIGSERIAL PRIMARY KEY,
      item_id BIGINT NOT NULL REFERENCES patrimonio_itens(id) ON DELETE CASCADE,
      discord_id TEXT NOT NULL,
      evento_id BIGINT REFERENCES eventos(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'ABERTO',
      foto_saida_ref TEXT NOT NULL,
      foto_volta_ref TEXT,
      observacao TEXT,
      saiu_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      voltou_em TIMESTAMPTZ,
      registrado_por_id TEXT NOT NULL
    )`,
  },
  {
    nome: 'uq_emprestimo_aberto',
    sql: "CREATE UNIQUE INDEX IF NOT EXISTS uq_emprestimo_aberto ON patrimonio_emprestimos (item_id) WHERE status = 'ABERTO'",
  },
  {
    // Rifa: o número é a chave. Vendidos e arrecadado só crescem, na transação do pagamento.
    // A semente do sorteio pelo bot fica aqui até o sorteio; só o hash é publicado antes.
    nome: 'rifas',
    sql: `CREATE TABLE IF NOT EXISTS rifas (
      id BIGSERIAL PRIMARY KEY,
      titulo TEXT NOT NULL,
      descricao TEXT,
      premio TEXT NOT NULL,
      custo_premio NUMERIC(14, 2) CHECK (custo_premio >= 0),
      imagem_ref TEXT,
      preco NUMERIC(14, 2) NOT NULL CHECK (preco > 0),
      total_numeros INT NOT NULL CHECK (total_numeros BETWEEN 10 AND 10000),
      limite_por_pessoa INT CHECK (limite_por_pessoa > 0),
      metodo_sorteio TEXT NOT NULL,
      regra_nao_vendido TEXT NOT NULL DEFAULT 'PROXIMO_VENDIDO',
      limiar_sorteio_pct INT NOT NULL DEFAULT 70,
      compromisso_hash TEXT,
      semente TEXT,
      status TEXT NOT NULL DEFAULT 'ABERTA',
      encerra_em TIMESTAMPTZ,
      sorteio_em TIMESTAMPTZ,
      vendidos INT NOT NULL DEFAULT 0,
      arrecadado NUMERIC(14, 2) NOT NULL DEFAULT 0,
      numero_sorteado INT,
      numero_vencedor INT,
      vencedor_id TEXT,
      hash_lista_final TEXT,
      evidencia TEXT,
      evidencia_ref TEXT,
      sorteada_em TIMESTAMPTZ,
      sorteada_por_id TEXT,
      cancelada_motivo TEXT,
      canal_id TEXT NOT NULL,
      message_id TEXT,
      criado_por_id TEXT NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  },
  { nome: 'idx_rifas_status', sql: 'CREATE INDEX IF NOT EXISTS idx_rifas_status ON rifas (status, criado_em DESC)' },
  {
    // Uma compra, N números. PENDENTE vence em 15 min; AGUARDANDO (comprador avisou que pagou) não vence
    nome: 'rifa_compras',
    sql: `CREATE TABLE IF NOT EXISTS rifa_compras (
      id BIGSERIAL PRIMARY KEY,
      rifa_id BIGINT NOT NULL REFERENCES rifas(id),
      discord_id TEXT NOT NULL,
      quantidade INT NOT NULL CHECK (quantidade > 0),
      total NUMERIC(14, 2) NOT NULL CHECK (total > 0),
      status TEXT NOT NULL DEFAULT 'PENDENTE',
      expira_em TIMESTAMPTZ,
      avisado_em TIMESTAMPTZ,
      mensagem_equipe_ref TEXT,
      decidido_por_id TEXT,
      decidido_em TIMESTAMPTZ,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  },
  { nome: 'idx_rifa_compras', sql: 'CREATE INDEX IF NOT EXISTS idx_rifa_compras ON rifa_compras (rifa_id, status)' },
  { nome: 'idx_rifa_compras_pessoa', sql: 'CREATE INDEX IF NOT EXISTS idx_rifa_compras_pessoa ON rifa_compras (discord_id, rifa_id)' },
  {
    // A chave primária (rifa_id, numero) é a trava: dois compradores nunca levam o mesmo número.
    // Reserva vencida ou cancelada não é apagada: a linha é retomada pelo próximo comprador.
    nome: 'rifa_bilhetes',
    sql: `CREATE TABLE IF NOT EXISTS rifa_bilhetes (
      rifa_id BIGINT NOT NULL REFERENCES rifas(id),
      numero INT NOT NULL CHECK (numero > 0),
      compra_id BIGINT NOT NULL REFERENCES rifa_compras(id),
      discord_id TEXT NOT NULL,
      status TEXT NOT NULL,
      expira_em TIMESTAMPTZ,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (rifa_id, numero)
    )`,
  },
  { nome: 'idx_rifa_bilhetes_compra', sql: 'CREATE INDEX IF NOT EXISTS idx_rifa_bilhetes_compra ON rifa_bilhetes (compra_id)' },
  { nome: 'idx_rifa_bilhetes_pessoa', sql: 'CREATE INDEX IF NOT EXISTS idx_rifa_bilhetes_pessoa ON rifa_bilhetes (rifa_id, discord_id)' },
  {
    nome: 'departamentos',
    sql: `CREATE TABLE IF NOT EXISTS departamentos (
      slug TEXT PRIMARY KEY,
      cargo_membro_id TEXT,
      cargo_gestor_id TEXT,
      canal_id TEXT,
      ativo BOOLEAN NOT NULL DEFAULT true,
      atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  },
  {
    // Confiança: ledger append-only; a mesma origem nunca pontua duas vezes a mesma pessoa
    nome: 'confianca_eventos',
    sql: `CREATE TABLE IF NOT EXISTS confianca_eventos (
      id BIGSERIAL PRIMARY KEY,
      discord_id TEXT NOT NULL,
      sinal TEXT NOT NULL,
      peso INT NOT NULL,
      origem_tipo TEXT NOT NULL,
      origem_id TEXT NOT NULL,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (sinal, origem_tipo, origem_id, discord_id)
    )`,
  },
  { nome: 'idx_confianca_pessoa', sql: 'CREATE INDEX IF NOT EXISTS idx_confianca_pessoa ON confianca_eventos (discord_id, criado_em)' },
  {
    nome: 'memoria_fatos',
    sql: `CREATE TABLE IF NOT EXISTS memoria_fatos (
      id BIGSERIAL PRIMARY KEY,
      dia DATE NOT NULL,
      autor_id TEXT NOT NULL,
      texto TEXT NOT NULL,
      midia_ref TEXT,
      evento_id BIGINT REFERENCES eventos(id) ON DELETE SET NULL,
      status TEXT NOT NULL,
      decidido_por_id TEXT,
      decidido_em TIMESTAMPTZ,
      motivo TEXT,
      publicado_url TEXT,
      criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
    )`,
  },
  { nome: 'idx_memoria_dia', sql: 'CREATE INDEX IF NOT EXISTS idx_memoria_dia ON memoria_fatos (dia, status)' },
  {
    // Um tópico do fórum por dia civil
    nome: 'memoria_dias',
    sql: 'CREATE TABLE IF NOT EXISTS memoria_dias (dia DATE PRIMARY KEY, thread_id TEXT NOT NULL)',
  },
  {
    // Alerta periódico que não deve se repetir para a mesma chave (ex.: novato sem recrutamento)
    nome: 'alertas_enviados',
    sql: `CREATE TABLE IF NOT EXISTS alertas_enviados (
      tipo TEXT NOT NULL,
      chave TEXT NOT NULL,
      enviado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (tipo, chave)
    )`,
  },
];

async function executarMigracoes() {
  for (const migracao of MIGRACOES) {
    try {
      await db.query(migracao.sql);
    } catch (err) {
      console.error(`[migracoes] Falha em ${migracao.nome}:`, err.message);
    }
  }
}

module.exports = { executarMigracoes };
