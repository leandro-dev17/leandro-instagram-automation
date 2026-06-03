'use strict';

/**
 * fiscal-resultado.cjs — Sistema de resultados dos fiscais de qualidade
 *
 * Os fiscais NÃO enviam Telegram diretamente quando encontram problemas.
 * Em vez disso, gravam o resultado em logs/fiscal-{nome}-resultado.json
 * e saem com exit 1.
 *
 * O guardião lê esse arquivo e imediatamente aciona Claude Resolver
 * com o contexto completo do problema na 1ª falha.
 * Claude analisa, tenta corrigir e SÓ ENTÃO notifica o Leandro.
 */

const fs   = require('fs');
const path = require('path');

const LOGS_DIR = path.join(__dirname, '..', 'logs');

/**
 * Grava o resultado do fiscal em arquivo para o guardião ler.
 * O guardião aciona Claude com esse contexto na 1ª falha.
 *
 * @param {string} nomeFiscal - Nome do agente (ex: 'qualidade-kling')
 * @param {string[]} problemas - Lista de problemas críticos encontrados
 * @param {string[]} avisos    - Lista de avisos (não-críticos)
 * @param {object}   extras    - Dados adicionais para o Claude
 */
function salvarResultado(nomeFiscal, problemas, avisos, extras = {}) {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });

  const resultado = {
    fiscal:      nomeFiscal,
    timestamp:   new Date().toISOString(),
    critico:     problemas.length > 0,
    problemas,
    avisos,
    extras,
  };

  const filePath = path.join(LOGS_DIR, `fiscal-${nomeFiscal}-resultado.json`);
  fs.writeFileSync(filePath, JSON.stringify(resultado, null, 2));
  console.log(`[${nomeFiscal}] Resultado gravado: ${problemas.length} problema(s), ${avisos.length} aviso(s)`);

  return resultado;
}

/**
 * Lê o resultado gravado por um fiscal.
 * Chamado pelo guardião antes de acionar Claude.
 */
function lerResultado(nomeFiscal) {
  const filePath = path.join(LOGS_DIR, `fiscal-${nomeFiscal}-resultado.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch { return null; }
}

/**
 * Remove o arquivo de resultado após o Claude ter tratado o problema.
 */
function limparResultado(nomeFiscal) {
  const filePath = path.join(LOGS_DIR, `fiscal-${nomeFiscal}-resultado.json`);
  try { fs.unlinkSync(filePath); } catch { /* ignora */ }
}

module.exports = { salvarResultado, lerResultado, limparResultado };
