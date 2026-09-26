# Fluxo: mérito de recrutadores (v2, aprofundado)

- **Slug:** meritoRecrutadores
- **Estado:** implementado (2026-09-26). Regras oficiais em `docs/contratos/regras-negocio.md` (seção Mérito de recrutadores); onde este desenho difere, vale o contrato
- **Dono humano:** liderança (presidência, vices, diretoria) decide a promoção
- **Torcidas:** qualquer tenant com `recrutamento` + `logsJogo` e os canais de mérito configurados

## Objetivo
Recompensar quem recruta **com constância e qualidade** e tornar a promoção a gestor do departamento previsível: a cada ciclo de 2 meses o bot fecha um ranking explicável, indica os 3 melhores e abre votação da liderança. O recrutador enxerga durante o ciclo onde está, o que falta e por quê.

## Princípios (o que a regra protege)
1. **Constância vale mais que pico.** Semana batida pesa mais que total do ciclo.
2. **Recruta que fica vale, recruta que some não.** Número bruto se compra; recruta que virou sócio e continua ativo não.
3. **Ninguém é promovido pelo bot.** Ele indica e explica; a liderança decide.
4. **Tudo explicável.** Cada ponto tem origem gravada; o recrutador vê o próprio extrato.
5. **Regra não muda no meio do ciclo.** O ciclo grava a versão dos pesos usada.

## O que conta como recrutamento (validade)
O log `jogador_recrutou` é o bruto. Ele vira **recrutamento válido** quando, até 14 dias depois, o recrutado:
- voltou a aparecer no jogo depois de 10 min do recrutamento (não é "fantasma"), **ou** foi aprovado como sócio no Discord; **e**
- não saiu cedo e não sofreu advertência, blacklist, impedimento ou suspensão nos 30 dias seguintes (sinais já usados pelo painel de recrutadores).

Consequências: a meta semanal conta **válidos**; a semana fica **pendente** por até 14 dias e o painel mostra "10 (7 confirmados, 3 em validação)". Isso evita pagar mérito por conta descartável e não pune o recrutador por algo que ainda não aconteceu.

## Pontuação (100 pontos, pesos ajustáveis, propostos)
| Critério | Pontos | Como mede |
|---|---|---|
| **Constância** | até **45** | semanas do ciclo em que bateu a meta (padrão **10 válidos/semana**) ÷ 8 × 40, **+ até 5** pela maior sequência de semanas seguidas batendo a meta (8 seguidas = 5) |
| **Qualidade dos recrutas** | até **25** | % dos recrutamentos do ciclo que viraram **sócio ativo** 30 dias depois (fantasma, saída cedo e problema contam contra) |
| **Conversão do funil** | até **10** | dos recrutados, quantos pediram ficha e foram aprovados (funil de recrutamento já existente) |
| **Manto** | até **10** | % de mantos CORRETO nas fichas que ele decidiu, **de primeira** |
| **Ficha completa** | até **5** | % das fichas aprovadas por ele com nome, idade, ID e telefone |
| **Engajamento** | até **5** | presença em eventos e contribuição no período (dados que a inteligência cruzada já tem) |
| **Disciplina** | −10 por ADV | cada advertência (automática ou manual) aplicada no ciclo |

Recrutador com menos de 5 recrutamentos no ciclo tem os critérios de percentual (qualidade, conversão, manto, ficha) tratados como **neutros**, não zerados: amostra pequena é ruído (mesma lógica de `MIN_CASOS_ATENCAO`).

### Bônus de trajetória (até +5, fora dos 100 para não distorcer)
- **Evolução:** melhorou de posição ou de pontos em relação ao ciclo anterior (premia quem cresce, não só quem já está no topo).
- **Retorno:** voltou de ADV com ciclo limpo.

## Elegibilidade (barra o ranking, não só desconta)
- Cargo de recrutador há ≥ 4 semanas (semanas anteriores à promoção não contam).
- Bateu a meta em ≥ **4 das 8** semanas.
- Sem advertência ativa de 2ª ou mais; não perdeu o cargo no ciclo.
- **Portão de confiança:** risco do sócio (`inteligencia/repositorio#resumoDe`) não pode estar em nível alto. Quem vai virar gestor não pode estar "esfriando" ou em atenção.
- Não estar na fila de fraude (abaixo) sem revisão.

**Desempate:** mais recrutamentos válidos; depois menos ADV; depois mais antigo no cargo. Empate no 3º lugar: entram todos os empatados na votação.

## Anti-manipulação (fraude é o principal risco de qualquer sistema de mérito)
Sinais que mandam o caso para a **fila de revisão da liderança** (o bot não pune sozinho; suspende só a contagem daquele lote até revisar):
| Sinal | Regra |
|---|---|
| Rajada | ≥ 6 recrutamentos em 1 hora, com a maioria virando fantasma |
| Mesmo alvo repetido | o mesmo ID recrutado 2+ vezes no ciclo (por ele ou por outros) conta **uma vez** |
| Auto/ciclo fechado | recrutado que é do mesmo círculo (mesmo nome parecido, `utils/nomes.js#nomesParecidos`) |
| Alvo bloqueado | ID em NÃO RECRUTAR (`naoRecrutarEspelho#ativos`) recrutado depois do bloqueio não conta e gera alerta |
| Pico fora do padrão | semana com mais de 3× a mediana do próprio recrutador |

## Justiça e exceções
- **Semana dispensada:** recrutador pede (botão) até **1 por ciclo** por ausência avisada (viagem, doença); a liderança aprova. A semana sai do denominador (não pune nem premia).
- **Semana fraca do servidor:** se entraram menos novatos que o piso (`novato_entrou`) naquela semana, a meta cai proporcionalmente. Recrutador não pode ser cobrado por um servidor vazio.
- **Promovido no meio do ciclo:** só ranqueia depois de 4 semanas; as semanas anteriores aparecem no painel como "fora da conta".
- **Troca de ID** (o ID muda a cada season): o bot detecta o apelido mudando de ID, junta as duas séries pelo Discord e avisa a liderança.
- **Fonte de logs parada:** o ciclo **não fecha** (mesma trava da advertência automática); estende até a fonte voltar e avisa.

## Ciclo
8 semanas (56 dias) a partir de uma âncora em `bot_config` (`merito_ciclo_inicio`); ao fechar, o seguinte abre no mesmo dia. Semana = 7 dias do ciclo.
`aberto → fechado → em_votacao → concluido`
- **Ciclo 0 (sombra):** roda só o painel, sem indicar nem votar, para ver a distribuição real de pontos e calibrar meta e pesos. Pesos e meta ficam em `bot_config` e são editáveis por botão → select → modal de 1 campo.

## Motivação durante o ciclo (o objetivo é retenção de gente)
- **Painel parcial** (`🏆・mérito-recrutadores`): pódio, "minha posição", pontos, o que falta para a meta da semana e para o 3º lugar, com tendência ▲▼.
- **Ritmo da semana:** aviso na quinta ("faltam 4 para bater a meta, restam 3 dias") e comemoração ao bater; evita repetir com `alertaPersistente#jaAlertadoRecentemente`.
- **Reconhecimento por degraus**, para quem não chega ao top 3 também ser visto: selo **Constante** (bateu a meta em ≥ 6/8 semanas) e **Destaque** (top 3). Registrados na ficha de mérito; cargo de Discord só se a liderança pedir.
- **Comando `/merito`** (ephemeral): meu extrato completo, com o que somou e o que descontou.
- **Ficha histórica:** ciclos anteriores, selos e evolução. É o que a liderança consulta ao votar.

## Fechamento e votação
1. Tarefa de fim de ciclo (`agendador.js`) congela ranking e detalhe (`jsonb`) por recrutador, com a versão das regras.
2. Aviso à liderança (menção no `content`, não no embed) com os 3 indicados, dossiê de cada um (pontos por critério, semanas, recrutas que ficaram, ADV, selos anteriores) e a fila de fraude pendente.
3. **Votação** por botão no canal da liderança: um voto por pessoa, **placar oculto até o fim** (evita puxar voto), prazo de 7 dias, abstenção permitida, **quórum** mínimo (proposta: maioria da liderança) e **veto motivado** (registrado).
4. Resultado publicado com o placar. **O bot não dá o cargo de gestor.** A promoção é manual e a decisão (promovido, adiado, vetado, por quê) fica registrada para a ficha histórica.
5. **Contestação:** o recrutador pode contestar a pontuação por ticket até o fim da votação; a liderança corrige e o bot recalcula.

## Estados de cada caso e falhas
| Etapa | Falha vira |
|---|---|
| Coletar métricas | ciclo fica aberto e o painel mostra "fonte parada" |
| Pontuar | erro logado; painel mantém o último ranking |
| Fechar | fica `aberto` e alerta a liderança |
| Abrir votação | liderança avisada; decide sem votação |
| Encerrar votação | idem; sem quórum, prorroga 3 dias uma vez |

## Onde aparece no Discord
- `🏆・mérito-recrutadores` (`canais.meritoRecrutadores`, `null` = desligado): painel fixo via `painelCanal.js`; recrutadores e liderança leem, só o bot escreve.
- `🗳️・votação-mérito` (`canais.votacaoMerito`, só liderança): votação, dossiê e fila de fraude.
- Seção "Mérito" em `📘・regras-recrutadores`, lida de `regras.js` (o quadro nunca desatualiza).
- Cores/emoji sempre do `tema/` (nunca verde: usar a paleta preto/vermelho/branco; "bateu a meta" usa `tema.emoji.ok`).

## Tabelas (aditivas, módulo `meritoRecrutadores`)
`merito_ciclos(id, inicio, fim, status, versao_regras)`, `merito_semanas(ciclo_id, discord_id, semana, brutos, validos, pendentes, dispensada)`, `merito_resultado(ciclo_id, discord_id, pontos, posicao, elegivel, motivo_inelegivel, indicado, detalhe jsonb)`, `merito_votos(ciclo_id, votante_id, indicado_id, veto_motivo)`, `merito_revisoes(ciclo_id, discord_id, tipo, decisao, decidido_por)`.

## Reaproveita
`inteligenciaRecrutadores.js` (meta, tendência, fantasmas, problema), `logsJogo/repositorio.js#recrutamentosDetalhados / recrutadosComOcorrenciaDepois / recrutadosSemAtividadeDepois`, `recrutamento/funil*.js`, `advertenciaRecrutadorAuto/repositorio.js` (ADV, manto, ficha), `inteligencia/repositorio#resumoDe`, `naoRecrutarEspelho#ativos`, `utils/nomes.js`, `alertaPersistente.js`, `painelCanal.js`, `agendador.js`, `botConfig.js`, `sugestoes/repositorio#votar`, `permissoes.js#ehLideranca`. Nova consulta agrupada: `recrutamentosPorSemana` (uma query, não uma por recrutador por semana).

## Regras de negócio a registrar após aprovação
Em `docs/contratos/regras-negocio.md` (seção "Mérito de recrutadores") e, para os utilitários novos, em `docs/contratos/reuso.md`.

## Decisões abertas (o que muda o desenho)
1. **Meta:** 10 válidos/semana, separada da meta 5 do painel de recrutadores? O ciclo 0 mostra quantos alcançam 10 antes de valer.
2. **Cargo de destino:** qual cargo o "gestor do departamento" recebe (área do módulo `departamentos`)?
3. **Peso de qualidade:** 25 pontos para "recruta que virou sócio ativo" é o que você quer, ou volume/constância deve pesar mais?
4. **Votação:** placar oculto, quórum de maioria da liderança e veto motivado estão bons?
5. **Semana dispensada:** 1 por ciclo, aprovada pela liderança?
6. **Selos:** só registro na ficha, ou também cargo de Discord (Constante/Destaque)?

## Como ficou (diferenças em relação ao desenho)
- Qualidade = recrutas que **ficaram** (válidos ÷ maduros); conversão = aprovados ÷ maduros (não se sobrepõem).
- Recrutamento `pendente` (< 14 dias) **conta** como presumido válido; `suspeito` (sumiu há 3+ dias) não conta.
- O ciclo **espera pendências** por até 3 dias antes de fechar (o ranking congela ao fechar).
- Decisões abertas resolvidas com o padrão recomendado: meta 10 separada da meta 5 do painel, placar oculto, quórum de maioria, veto motivado da presidência, 1 semana dispensada, selos só como registro. **Ainda em aberto:** qual cargo o gestor recebe (o bot só registra PROMOVIDO/ADIADO).
- Contestação segue por ticket (sem botão próprio).
