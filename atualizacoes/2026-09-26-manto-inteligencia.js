module.exports = {
  id: '2026-09-26-manto-inteligencia',
  data: '2026-09-26',
  tipo: 'melhoria',
  titulo: 'Inteligência do manto',
  resumo: 'O bot passou a avisar e acompanhar sozinho o que envolve o manto.',
  itens: [
    'Aprovou uma ficha com manto errado, sem avaliação ou sem foto? O recrutador é avisado na ficha e ainda pode desfazer em até 30 minutos.',
    'Foto sem avaliação por 30 minutos e por 2 horas gera lembrete; caso aberto é lembrado a cada 24 horas, até 3 vezes.',
    'Candidato com 2 ou mais fotos reprovadas é marcado como reincidente no caso e na análise da ficha.',
    'Novo relatório /inteligencia manto e uma seção no boletim semanal, com motivos, erros por recrutador e tempo de avaliação.',
    'O placar mostra o motivo em que cada recrutador mais erra e o desempenho de quem avalia.',
  ],
  quem: 'Recrutadores e liderança.',
  modulos: ['recrutamento'],
};
