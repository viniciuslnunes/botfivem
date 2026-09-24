// Regrava test/conformidade.baseline.json com a contagem atual.
// Só rode depois de MIGRAR código (o número caiu) — nunca para "aceitar" violação nova.
const fs = require('fs');
const path = require('path');
const { contar, totais } = require('./conformidade');

const destino = path.join(__dirname, '..', 'test', 'conformidade.baseline.json');
const atual = contar();
fs.writeFileSync(destino, JSON.stringify(atual, null, 2) + '\n');
console.log('baseline regravado:', JSON.stringify(totais(atual)));
