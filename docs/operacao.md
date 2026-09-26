# Operação

> Como rodar, monitorar e atualizar o bot. Uma instância por torcida: cada uma
> com seu token de bot, seu Postgres e seu `TENANT`.

## Variáveis de ambiente

| variável | obrigatória | o que faz |
|---|---|---|
| `DISCORD_TOKEN` | sim | token do bot desta torcida |
| `CLIENT_ID` | para `npm run deploy` | ID da aplicação no Discord |
| `DATABASE_URL` | sim | Postgres desta torcida |
| `TENANT` | não (default `gavioes`) | pasta do tenant |
| `TENANTS_DIR` | não | pasta **absoluta** com os tenants, fora do repositório |
| `DATABASE_SSL` | não | `verify` \| `no-verify` (default) \| `off` |
| `DATABASE_CA` | com `verify` e CA própria | PEM (com `\n` literal) ou caminho do arquivo |
| `DATABASE_POOL_MAX` | não | conexões do pool (1–100) |
| `LOG_FORMATO` | não | `texto` (default) ou `json` |
| `HEALTH_PORT` / `HEALTH_HOST` | não | liga `GET /health` |
| `CONTROLE_URL` / `CONTROLE_TOKEN` / `CONTROLE_INTERVALO_SEG` | não | batida de vida para a loja (`docs/loja/README.md`); só liga com `CONTROLE_URL`; intervalo padrão 60 s, mínimo 10 |

Segredo (token, senha do banco) só em variável de ambiente ou secret do
orquestrador — nunca em `tenants/`, nunca em log. Modelo: `.env.example`.

## Subir uma torcida

**Direto (Railway ou servidor):**

```
npm ci
npm run deploy      # registra os comandos dos módulos LIGADOS no servidor (fala com o Discord)
npm start
```

**Docker** (ver `Dockerfile`; **ainda não foi construído/testado** — faça o
primeiro `docker build` e `docker run … node tools/carregar-tudo.js` antes de
depender dele):

```
docker build -t botfivem .
docker run --env-file .env -e TENANT=mancha-verde -e TENANTS_DIR=/tenants \
  -v /caminho/dos/tenants:/tenants:ro -p 8080:8080 botfivem
```

O bot **valida tudo na subida** (tenant, tema, módulos, fonte de logs) e, se algo
faltar, sai com código 1 listando todos os problemas de uma vez.

## Várias torcidas

- Uma instância (processo/container) por torcida, cada uma com **seu** token,
  **seu** banco e `TENANT` próprio. Nada é compartilhado em runtime: um problema
  numa torcida não alcança outra.
- Tenants de clientes ficam fora do repositório do produto (`TENANTS_DIR`), em
  repositório/volume próprio do cliente.
- A imagem/o código é o mesmo; o que muda é o tenant. Atualizar o produto =
  redeploy de cada instância.

## Banco

- **Migrações** rodam sozinhas a cada start, só aditivas (`IF NOT EXISTS`), e só
  as tabelas dos módulos ligados. Por isso **voltar o código para uma versão
  anterior é seguro**: tabelas e colunas novas ficam sem uso.
- **TLS**: o padrão histórico é `DATABASE_SSL=no-verify` (criptografa, mas não
  valida o certificado). Em produção use `verify`. O bot avisa no log enquanto
  estiver em `no-verify` com banco remoto.
- **Backup** (rotina do provedor **e** um dump próprio):

```
pg_dump "$DATABASE_URL" --format=custom --file=backup-$(date +%F).dump
pg_restore --dbname="$DATABASE_URL_DESTINO" --clean --if-exists backup-2026-09-24.dump
```

  Teste a restauração em um banco de teste antes de precisar dela. O que a
  torcida perde sem backup: fichas de recrutamento, sócios/carteirinhas, eventos,
  rifas, financeiro, e o histórico de logs do jogo.
- Nunca aponte teste, script ou ferramenta para o banco real (incidente de
  2026-09-13; e de novo evitado em 2026-09-24). `npm test` usa PGlite em memória
  e stubs; as ferramentas de `tools/` forçam um banco falso.

## Logs

`LOG_FORMATO=json` → uma linha JSON por evento:

```json
{"ts":"2026-09-24T12:00:00.000Z","nivel":"error","tenant":"gavioes","modulo":"logs-jogo","msg":"Erro ao gravar log:","erro":{"nome":"Error","mensagem":"…","stack":"…"}}
```

Filtre por `tenant` e `modulo` no agregador. Sem a variável o console fica como
sempre foi.

## Saúde

- `GET /health` (com `HEALTH_PORT`): **200** = banco respondendo e Discord
  conectado; **503** = degradado. Só devolve slug, booleans e números. Deixe em
  rede interna (o orquestrador chama; o público não precisa).
- `/status` no Discord (liderança): banco, fila de tarefas, módulos ligados e a
  **última mensagem de cada canal de log** — canal parado há mais que
  `fonteParadaDias` aparece como problema, não como zero.

## Atualizar

1. `git pull` (ou nova imagem) → `npm ci`.
2. `npm test` e `npm run lint` no CI antes de publicar.
3. `npm run deploy` **só se** módulos/comandos mudaram (registra comandos).
4. Reiniciar a instância. Ver `[plataforma] módulos ligados: …` no log.
5. Conferir `/status`.

Tenant novo ou mudança de módulos: `npm run modulos` (`TENANT=<slug>`) mostra o
que vai subir sem conectar em nada.

## Trocar o token do bot

Discord Developer Portal → Reset Token → atualizar `DISCORD_TOKEN` na instância →
reiniciar. Não é preciso `npm run deploy` de novo.

## Checklist de go-live (torcida nova)

- [ ] Servidor: bot convidado; intents **Server Members** e **Message Content**
      ligados no portal do Discord (o bot lê mensagens e membros).
- [ ] `/setup diagnostico` sem problemas (permissões, posição do cargo do bot).
- [ ] Canais de log do jogo dentro de **uma** categoria só, e `logsJogo.categoriaLogs`
      apontando para ela.
- [ ] `DATABASE_SSL=verify`, backup configurado e **restauração testada**.
- [ ] `LOG_FORMATO=json` e `HEALTH_PORT` ligados no orquestrador, com alerta em 503.
- [ ] Módulos que a torcida **não** usa desligados em `tenant.modulos`.
- [ ] `/status` mostrando cada canal de log recebendo.
- [ ] Liderança sabe onde ficam os painéis e quem pode o quê.

## Incidentes conhecidos (para não repetir)

- **Canal de outra comunidade misturado nos logs** (2 meses de contaminação):
  a ingestão só aceita canais dentro de `logsJogo.categoriaLogs`.
- **Teste que escreveu no banco de produção** (2026-09-13): testes usam PGlite ou
  stubs e abortam se a interceptação falhar.
- **Executar o `index.js` num teste com o `.env` real** (2026-09-24): sobe o bot
  de verdade. Qualquer teste que precise do processo do bot roda com `cwd` numa
  pasta sem `.env` e variáveis explícitas.
- **Erro em conexão ociosa do banco derrubando o processo**: o pool tem ouvinte
  de `error` desde a F7.
