# Contrato: tenant (uma torcida = uma instância)

> Quem manda: `config/schema.js` (forma), `config/carregar.js` (carrega, valida,
> congela) e `tenants/<slug>/`. Modelo de venda: **uma instância do bot por
> torcida** — cada uma com seu token, seu Postgres e seu `TENANT`.

## Estrutura

```
tenants/<slug>/
  tenant.js     IDs do Discord, regras de negócio, limites, módulos
  tema.js       cores, emojis, marca (ver docs/contratos/tema.md)
  assets/       logo, capa, faixa…
```

`TENANT=<slug>` (`.env`) escolhe o tenant (default `gavioes`). O bot **valida na
subida** e lista todos os problemas de uma vez; nada quebra no meio de um fluxo.
`config/index.js` devolve o tenant congelado (`Object.freeze` profundo): código
nunca muta configuração.

## Campos de `tenant.js`

| campo | o que é |
|---|---|
| `slug` | igual ao nome da pasta |
| `instalacao` | `true` = modo instalação (só o `/setup`); remover ao concluir |
| `modulos` | `{ idDoModulo: true\|false }`; sem entrada vale o `padrao` do módulo |
| `guildId` | ID do servidor Discord |
| `jogo` | `{ fonte }`: adapter de logs (`fontes/<id>/`) |
| `cargos` | `socio presidente vicePresidente velhaGuarda diretoria recrutador visitante provarManto reprovadoRecrutamento` (obrigatórios), `elenco` (opcional), `adv` (3 IDs), `advRec` (0 ou 3) |
| `lideranca` | cargos que consultam logs e recebem alertas |
| `canais` | IDs (ou `null` = ainda não criado); quais são obrigatórios depende dos módulos ligados (`exige`) |
| `categorias` | `tickets` |
| `links` | `whatsappSocios`, `redesSociais` |
| `parceiros` | até 5 `{ label, url }` para `!parceiros` |
| `hierarquia` | cargos e rótulos do quadro |
| `departamentos` | áreas da torcida |
| `eventos`, `carteirinha`, `memoria`, `confianca` | limites e prazos |
| `logsJogo` | canais de log, categoria, intervalos, limites de alerta, `farm`, `bau`, `caixa` |
| `antiSpam` | modo `alerta`/`punir` e limites |

## Onboarding de uma torcida nova

1. `npm run novo-tenant -- --slug mancha-verde --guild <ID> --nome "Mancha Verde"`
   (cria `tenants/mancha-verde/` em modo instalação).
2. `.env`: `TENANT`, `DISCORD_TOKEN`, `CLIENT_ID`, `DATABASE_URL` da torcida.
   `npm run deploy` (registra só o `/setup`) e `npm start`.
3. No Discord, como administrador: `/setup diagnostico` (permissões do bot),
   `/setup mapear` (acha pelo nome o que o servidor já tem e devolve o trecho
   para colar), `/setup criar` (cria o que falta; canais privados por padrão).
4. Colar os IDs no `tenant.js`, preencher `logsJogo` e o resto (referência
   completa: `tenants/gavioes/tenant.js`; exemplo enxuto:
   `tenants/_exemplo/tenant.js`), ajustar `tema.js`, **remover `instalacao: true`**.
5. Reiniciar; `npm run deploy` de novo (agora com os comandos dos módulos
   ligados). `/status` confere banco, tarefas e fontes de log.

`_exemplo` (torcida verde, sem vários módulos) e `_instalacao` existem como
molde e como fixture de teste; slug que começa com `_` é reservado a eles.

## Saúde

`/status` (liderança): banco, fila de tarefas, módulos ligados e a última
mensagem de cada canal de log — canal parado há mais que `fonteParadaDias` vira
alerta (não vira "zero" silencioso).
