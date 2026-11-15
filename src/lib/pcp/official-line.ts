/**
 * Linha oficial de fabricação: os 71 SKUs com a tag "inox" no Bling (lista do script de OP da fábrica,
 * exportada em 17/09/2026). A API v3 do Bling não devolve as tags do produto, por isso a lista é
 * versionada aqui: atualize-a ao lançar ou retirar um produto da linha.
 *
 * Só estes SKUs entram no gerador de OP. Kits (formato E), lentes e consumíveis de máquina, códigos de
 * anúncio, EPI e embalagem ficam fora da fila de fábrica.
 */
export const OFFICIAL_LINE_SKUS: readonly string[] = [
  // Caixa de gordura
  'CXG280280200', 'CXG380380200', 'CXG450450280',
  // Calhas
  'CLS600158100IN', 'CLS900158100IN', 'CNUL440205140IN', 'CNUL600205140IN', 'CNU430360100IN', 'CNU530430100IN',
  // Tampas de canal
  'TMPCLH430360', 'TMPCLH440230', 'TMPCLH530430', 'TMPCLH600230',
  // Cubas e cesto
  'CBA500400250', 'CBA600400250', 'CBA600400350', 'CBA600500250', 'CBA600500350', 'CBA700500250', 'CBA700500350', 'CSTE495200120',
  // Ralos com coletor
  'RL50014060', 'RL80014060', 'RL100014060', 'RLC5009060', 'RLC8009060', 'RLC10009060',
  // Ralos piscina e residencial
  'RLINPISOCULTN', 'RLPISCGREFENDAS', 'RLPISCGREGOTAS', 'RLPISCGREONDAS', 'RLRESGRCIR', 'RLRESGRONDA', 'RLRESGROBL', 'RLRESGROCUL',
  // Linha cozinha / utilidades
  'FRUT500350450', 'FRUT1100270200', 'FRUT1800270200', 'MTP18511570', 'MTG210180115', 'PDQUEIJO', 'PSMH140', 'PSMH200ABA',
  'RCP15016520', 'RCP40015020', 'SPA4151P', 'SPA4153P', 'PC50', 'PC100', 'PTU200200150', 'PSB25017585', 'SPJ337025',
  'LIX205205220', 'PTB2052901304B', 'PTB2952871306B',
  // Prateleiras, soleiras, suportes
  'PMF246030', 'PMF2410030', 'SOLINOX1000AMS', 'SOLINOX1000FLT', 'SOLINOX1200AMS', 'SOLINOX1200FLT', 'SUPAR42', 'SUPAR52', 'SUPAR67',
  'GADSIVO', 'GPTOALHA',
  // Tanque
  'TANINDINOXPE',
  // Plaquinhas (kit 50)
  'KIT50FORMATGO', 'KIT50OSSOMA', 'KIT50OSSOME', 'KIT50PLAQUAD',
];

/** Depósitos do Bling. Só o depósito Estoque entra no saldo de produto acabado para decidir OP. */
export const BLING_DEPOSITS = { estoque: 14886494459, estoqueCortado: 14886716794 } as const;
