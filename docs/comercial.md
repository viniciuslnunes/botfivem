# Comercial: o que se vende, o que o cliente precisa e o que ainda é decisão sua

> Documento de trabalho para quem vai oferecer o bot a outras torcidas. Descreve
> **fatos do produto** (verificados no código) e lista as **decisões que só o
> dono do produto pode tomar**. Não é aconselhamento jurídico.

## O que a torcida recebe

Uma instância própria do bot, configurada para ela:

- **Identidade**: cores, emojis de estado, nome, sigla, prefixo de apelido, logo,
  capa e textos dela (`tenants/<slug>/tema.js`), com uma cor ou família de cores
  que ela **proíbe** (o bot recusa subir se algo cair nela).
- **Módulos** que ela escolhe ligar (recrutamento, carteirinha, departamentos,
  eventos, escala, caravana, financeiro, loja, rifas, patrimônio, memória,
  tickets, advertência, anti-spam, e a inteligência de logs do jogo com seus
  painéis). Os que ela não usa não ficam no servidor: nem comando, nem canal,
  nem tabela.
- **Inteligência dos logs do jogo**: o servidor de FiveM publica os logs por
  webhook; o bot lê, grava e transforma em painéis (baú, caixa, disciplina,
  território, farm, recrutadores…), alertas e fichas de jogador.
- **Onboarding guiado**: `/setup diagnostico`, `/setup mapear`, `/setup criar`.
- **Operação**: `/status` (saúde), `GET /health`, log estruturado, backup e
  restauração documentados (`docs/operacao.md`).

## O que a torcida precisa fornecer

| item | detalhe |
|---|---|
| Aplicação de bot no Discord | token, `CLIENT_ID`, intents **Server Members** e **Message Content** ligados |
| Servidor Discord | com (ou disposto a criar) cargos e canais; o `/setup mapear` acha pelo nome o que já existe e o `/setup criar` cria o resto |
| Logs do jogo em webhook | os canais que recebem o webhook do servidor de FiveM, **todos numa mesma categoria** |
| Postgres | um banco por torcida (o produto não compartilha banco entre clientes) |
| Hospedagem | processo/container com Node 20 e as variáveis de `docs/operacao.md` |
| Uma pessoa responsável | quem decide cargos, limites de alerta e quem é liderança |

## Servidor de jogo: o fator de esforço

O bot traduz o texto do webhook do servidor de jogo por um **adapter**
(`fontes/<id>/`). Hoje existe um: `hoolibras`. Torcida em **outro servidor de
jogo** exige um adapter novo: mapear os formatos de log dele para as ações
canônicas (`docs/contratos/eventos-canonicos.md`) com amostras reais e testes.
Esse é o principal item a orçar; o resto do bot não muda.

Limitações conhecidas da fonte (declaradas, não escondidas):

- O saldo por baú lê o nome do compartimento entre colchetes do título do log
  (`Guardou [Nome]`); uma fonte precisa produzir esse título.
- A regra de "peça de patrimônio" (`nomePatrimonio`) é do adapter; o SQL de baú
  trata o "Baú de Recompensas" como caso especial.
- Itens de farm, nomes de baú e limites são configuração do tenant, não código.
- O ID do jogador no jogo troca por season: o bot correlaciona por **nome**, o que
  é aproximado (a liderança confirma sugestões fracas).

## Limites atuais do produto

- **Uma guilda por instância** (não há multi-guilda em um processo).
- Nenhum painel web: tudo é Discord.
- Docker: o `Dockerfile` existe mas **não foi construído nem testado** ainda.
- Não há exportação/anonimização automática de dados pessoais (ver LGPD abaixo).
- Log do jogo é a única fonte de "inteligência"; nada de integração direta com o
  servidor de jogo além do webhook.

## Decisões que são suas

1. **Licença.** O `package.json` declara `MIT` e o autor está vazio. MIT permite
   que qualquer pessoa use, copie e **revenda** o código. Se o produto é o seu
   negócio, escolha a licença (proprietária, ou uma com restrição comercial)
   **antes** de entregar código a um cliente, e preencha `author`.
2. **Marca e ativos dos Gaviões.** `tenants/gavioes/` traz logo, capa, faixa,
   textos e IDs reais do servidor deles, além do subtítulo "Corinthians" na
   carteirinha. Isso é dado do cliente Gaviões, não do produto: confirme que pode
   ser distribuído (ou mova para fora do repositório com `TENANTS_DIR`) antes de
   qualquer cópia do repositório sair da sua mão.
3. **Nome do servidor de jogo.** O adapter e a documentação citam "Hoolibras".
   Confirme se pode ser citado em material comercial e se há relação formal com
   o servidor.
4. **Dados pessoais (LGPD).** O recrutamento guarda **nome, idade e telefone** do
   candidato e IDs do Discord; os logs guardam atividade de jogadores. Defina:
   quem é controlador e quem é operador entre você e a torcida, prazo de
   retenção, e como atender pedido de exclusão (hoje é manual, no banco). Peça
   revisão jurídica.
5. **Suporte e SLA.** Quem responde quando um servidor de jogo muda o formato do
   log (o parser quebra em silêncio: cai em `desconhecido`)? Defina prazo e o
   que está incluído (adapter novo, mudança de regra, módulo novo).
6. **Modelo de cobrança.** Por instância? Por módulo? Adapter novo à parte? O
   custo real é hospedagem (um Postgres e um processo por cliente) mais o tempo
   de suporte e de adapter.
7. **Segurança operacional do cliente.** Exija `DATABASE_SSL=verify`, backup com
   restauração testada e alerta no `GET /health`. Está no checklist de go-live.

## Como vender com segurança (resumo)

1. Tenant do cliente **fora** do repositório (`TENANTS_DIR`), em repositório ou
   volume só dele.
2. Um bot, um token, um banco por cliente.
3. Adapter novo somente com amostras reais (teste guardião do parser).
4. Go-live só com o checklist de `docs/operacao.md` completo.
