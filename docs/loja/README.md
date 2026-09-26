# Loja e plano de controle: como o produto escala para várias torcidas

> Estudo de arquitetura (2026-09-26). O que **já existe no repositório** está
> marcado ☑; o que a loja ainda precisa construir, ☐. O bot em si não muda: cada
> torcida continua sendo **uma instância** (`docs/contratos/tenant.md`).

## Duas camadas

```
PLANO DE CONTROLE (um só, do operador)             PLANO DE DADOS (um por torcida)
┌──────────────────────────────────────┐           ┌──────────────────────────────┐
│ Loja web + API + Postgres de controle│  provisiona│ container botfivem (TENANT)  │
│  catálogo, planos, torcidas, status  │──────────▶│ + Postgres próprio           │
│                                      │◀──────────│ + token de bot próprio       │
└──────────────────────────────────────┘  batida    └──────────────────────────────┘
        ▲ vitrine pública (só leitura)              POST /batida a cada 60 s (opcional)
```

Regra de ouro: **nada de dado de torcida sobe para a loja.** A loja sabe quem é
cliente, qual plano, e se o bot está de pé. Ficha de recrutamento, log do jogo,
telefone e tokens nunca passam por ela.

## Vitrine (cargos, módulos, torcidas)

- ☑ `npm run catalogo` gera o JSON da vitrine: cada módulo (`id`, `descricao`,
  `requer`, `comandos`, `padrao`) e cada torcida (nome, sigla, módulos ligados,
  rótulos da hierarquia, paleta, cores proibidas, fonte de logs). Sem ID de
  Discord, token nem caminho de arquivo (teste em `test/loja.controle.test.js`).
  Com `TENANTS_DIR=/caminho` lê tenants fora do repositório.
- ☐ Página web que consome esse JSON. A descrição de "como funciona cada cargo"
  hoje vem de `hierarquia` do tenant; texto mais rico por cargo é campo novo
  (`hierarquia[].descricao`) a acrescentar no schema do tenant.

## Torcidas, planos e vigência

- ☑ Esquema pronto e testado em `docs/loja/schema-controle.sql`: `planos`,
  `torcidas`, `assinaturas`, `instancias`, `batida_atual`, `batida_historico`,
  `auditoria` e a view **`torcidas_status`**, que já calcula:
  - plano: `vigente` · `carencia` (vencida, dentro de `carencia_dias`) · `vencido` · `sem_plano`;
  - bot: `no_ar` · `degradado` · `parado` (sem batida em 3 intervalos) · `nunca`.
- ☐ Job diário da loja: `vencido` → parar o container e remover os comandos do
  servidor; `carencia` → avisar o responsável; renovou → reativar. **Suspender
  é ação da loja** (parar a instância), não do bot: um bot que se auto-suspende
  por data seria trivial de contornar por quem tem o código.
- Dados de uma torcida suspensa ficam **N dias** no banco dela (definir o prazo
  junto com a LGPD, `docs/comercial.md`) e depois são apagados por rotina.

## Bots funcionando

- ☑ `plataforma/heartbeat.js`: com `CONTROLE_URL` + `CONTROLE_TOKEN` a instância
  faz `POST` a cada `CONTROLE_INTERVALO_SEG` (padrão 60, mínimo 10) com
  `{ slug, guildId, versao, status, uptimeSeg, discordPronto, bancoOk, modulos,
  emitidaEm }`. Desligado por padrão; falha da loja nunca derruba o bot; log
  limitado (1ª falha e a cada 30).
- ☑ `GET /health` (200/503) continua para o orquestrador (Railway/Docker).
- ☐ Endpoint `/batida` na loja: autentica pelo hash do token (`instancias.token_batida_hash`),
  faz upsert em `batida_atual` e acrescenta `batida_historico` (reter 30 dias).

## API: o que é da loja e o que é do bot

| Quem | Superfície | Estado |
|---|---|---|
| Bot | Sem API pública. Discord (slash/botões) + `GET /health` + batida de saída | ☑ |
| Loja, público | `GET /catalogo` (módulos e torcidas ativas, do JSON acima), `GET /torcidas` (nome, plano, bot no ar) | ☐ |
| Loja, operador | provisionar, trocar plano, suspender/reativar, ver status; tudo grava `auditoria` | ☐ |
| Loja, batida | `POST /batida` autenticado por instância | ☐ |

Não expor o bot como API: ele não precisa, e cada porta a mais é superfície de
ataque numa máquina que guarda token de Discord.

## Banco por torcida (performance e isolamento)

- **Modelo mantido: um Postgres por torcida.** Isolamento total (LGPD, backup e
  restauração por cliente, exclusão ao cancelar), sem `guild_id` em toda tabela,
  e o custo de agregação dos painéis (somam meses de log) fica dentro do banco
  do próprio cliente. O `pg_dump` por torcida já está em `docs/operacao.md`.
- Desempenho: pool por instância (`DATABASE_POOL_MAX`), painéis leem
  `logs_jogo` por período (índices em `utils/migracoes.js`) e editam mensagem
  fixa com debounce; um cliente pesado não afeta outro.
- Custo: se o número de clientes crescer, um **cluster Postgres com um banco por
  torcida** (não um schema compartilhado) reduz o custo sem quebrar o isolamento.
  Multi-guilda em um processo (`guild_id` em tudo) só se justifica com dezenas de
  clientes pequenos, e é um projeto grande: fora do escopo por ora.

## Provisionamento de torcida nova

1. ☑ `npm run novo-tenant -- --slug x --guild <ID> --nome "X" --proibir preto,azul`
   cria `tenant.js`, `tema.js` (já com as cores que a torcida recusa) e assets.
2. ☐ A loja chama esse passo, cria o banco, grava os segredos no cofre e sobe o
   container da mesma imagem (`Dockerfile`) com `TENANT`, `TENANTS_DIR`,
   `CONTROLE_URL`, `CONTROLE_TOKEN`.
3. ☑ `/setup diagnostico | mapear | criar` no Discord; `/status` confere.
4. ☑ Cores: o bot **recusa subir** com token de cor ou emoji que a torcida
   proíbe, inclusive herdado da base (`docs/contratos/tema.md`).

## Segurança da loja

- Token de bot, `DATABASE_URL` e `CONTROLE_TOKEN` só em cofre de segredos; a loja
  guarda `segredo_ref` e o **hash** do token de batida.
- `DATABASE_SSL=verify` em toda instância provisionada pela loja.
- Tudo que a loja muda em uma torcida entra em `auditoria` (quem, quando, o quê).
- Contas de operador com 2FA; a API do operador atrás de autenticação forte.
