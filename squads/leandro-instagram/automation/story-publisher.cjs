/**
 * story-publisher.cjs — Wrapper que delega para story-publisher-new.cjs
 *
 * O Task Scheduler chama este arquivo com argumento "1".
 * Este wrapper ignora o número do slot e executa o publisher
 * atual (story-publisher-new.cjs) que combina 5 slides em 1 MP4.
 *
 * Uso: node story-publisher.cjs <1|2|3> [data]
 */

'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

// Ignora slot number (argv[2]), pega data opcional se existir
const dateArg = process.argv.slice(2).find(a => /^\d{4}-\d{2}-\d{2}$/.test(a));

const newPublisher = path.join(__dirname, 'story-publisher-new.cjs');
const callArgs = dateArg ? [newPublisher, dateArg] : [newPublisher];

console.log(`[story-publisher.cjs] Delegando para story-publisher-new.cjs${dateArg ? ' ' + dateArg : ''}...`);

try {
  execFileSync(process.execPath, callArgs, {
    cwd: __dirname,
    stdio: 'inherit'
  });
} catch (err) {
  process.exit(err.status || 1);
}
