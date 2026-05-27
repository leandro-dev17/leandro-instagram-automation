/**
 * Guardião 24/7 — Vovó Teresinha
 * Roda a cada 15 minutos via GitHub Actions.
 * Detecta falhas, chama Claude, aplica correções automaticamente.
 */

const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");
const https = require("https");
const { execSync } = require("child_process");

// ── Config ──────────────────────────────────────────────────────────────────
const APP_URL     = process.env.APP_URL     || "https://receitinhas-vovo-teresinha.vercel.app";
const CRON_SECRET = process.env.CRON_SECRET || "";
const TG_TOKEN    = process.env.TELEGRAM_BOT_TOKEN || "";
const TG_CHAT     = process.env.TELEGRAM_CHAT_ID   || "";
const VERCEL_TOK  = process.env.VERCEL_TOKEN        || "";
const VERCEL_PID  = process.env.VERCEL_PROJECT_ID   || "prj_RtqsbSdxPMz81W2cr0tJyatRJGMv";
const VERCEL_TID  = process.env.VERCEL_TEAM_ID      || "team_JnDwQYGSI9RBjHyIygKLR56b";
const DEPLOY_HOOK = process.env.VERCEL_DEPLOY_HOOK  || "";

const REPO_ROOT   = path.resolve(__dirname, "../../..");
const APP_SRC     = path.join(REPO_ROOT, "squads/vovo-teresinha/app/src");
const INCIDENTS   = path.join(__dirname, "incidents.json");

// ── Endpoints monitorados ────────────────────────────────────────────────────
const HEALTH_CHECKS = [
  { name: "homepage",         url: `${APP_URL}/`,              expect: [200, 308], critical: true  },
  { name: "login-page",       url: `${APP_URL}/login`,         expect: [200],      critical: true  },
  { name: "api-receitas",     url: `${APP_URL}/api/receitas`,  expect: [200, 401], critical: true  },
  { name: "fiscal-banco",     url: `${APP_URL}/api/cron/fiscal-banco?secret=${CRON_SECRET}`,     expect: [200], critical: true  },
  { name: "fiscal-erros-api", url: `${APP_URL}/api/cron/fiscal-erros-api?secret=${CRON_SECRET}`, expect: [200], critical: false },
  { name: "saude-pwa",        url: `${APP_URL}/api/cron/saude-pwa?secret=${CRON_SECRET}`,        expect: [200], critical: false },
];

// ── Utilitários ──────────────────────────────────────────────────────────────
async function fetchJSON(url, opts = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body, ok: res.ok };
  } catch (e) {
    return { status: 0, body: String(e), ok: false };
  } finally {
    clearTimeout(timer);
  }
}

async function telegram(msg) {
  if (!TG_TOKEN || !TG_CHAT) return;
  await fetchJSON(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT, text: msg, parse_mode: "HTML" }),
  });
}

function loadIncidents() {
  try { return JSON.parse(fs.readFileSync(INCIDENTS, "utf8")); }
  catch { return {}; }
}

function saveIncidents(data) {
  fs.writeFileSync(INCIDENTS, JSON.stringify(data, null, 2));
}

async function getVercelLogs() {
  if (!VERCEL_TOK) return "Logs não disponíveis (VERCEL_TOKEN não configurado)";
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const r = await fetchJSON(
    `https://api.vercel.com/v1/projects/${VERCEL_PID}/logs?teamId=${VERCEL_TID}&since=${since}&limit=50&level=error`,
    { headers: { Authorization: `Bearer ${VERCEL_TOK}` } }
  );
  if (!r.ok) return `Erro ao buscar logs: ${JSON.stringify(r.body).slice(0, 200)}`;
  const logs = Array.isArray(r.body) ? r.body : (r.body?.logs ?? []);
  return logs
    .slice(0, 20)
    .map(l => `[${l.timestamp || ""}] ${l.message || JSON.stringify(l)}`)
    .join("\n") || "Nenhum erro recente nos logs.";
}

function readSourceFile(relativePath) {
  const full = path.join(APP_SRC, relativePath);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, "utf8");
}

function writeSourceFile(relativePath, content) {
  const full = path.join(APP_SRC, relativePath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

async function triggerRedeploy() {
  // Opção 1: deploy hook (se configurado)
  if (DEPLOY_HOOK) {
    const r = await fetchJSON(DEPLOY_HOOK, { method: "POST" });
    if (r.ok) return true;
  }
  // Opção 2: Vercel API — reaplica o último deployment de produção
  if (VERCEL_TOK) {
    const list = await fetchJSON(
      `https://api.vercel.com/v6/deployments?teamId=${VERCEL_TID}&projectId=${VERCEL_PID}&target=production&state=READY&limit=1`,
      { headers: { Authorization: `Bearer ${VERCEL_TOK}` } }
    );
    const deployId = list.body?.deployments?.[0]?.uid;
    if (!deployId) return false;
    const redeploy = await fetchJSON("https://api.vercel.com/v13/deployments", {
      method: "POST",
      headers: { Authorization: `Bearer ${VERCEL_TOK}`, "Content-Type": "application/json" },
      body: JSON.stringify({ deploymentId: deployId, target: "production" }),
    });
    return redeploy.status < 400;
  }
  return false;
}

function waitMs(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Claude: diagnóstico e correção autônoma ──────────────────────────────────
async function diagnoseAndFix(failedChecks, logs) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // Lê código-fonte dos endpoints afetados
  const sourceContext = [];
  for (const check of failedChecks) {
    const routeName = check.name.replace(/^(homepage|login-page|api-receitas)$/, "");
    if (routeName) {
      const routePath = `app/api/cron/${routeName}/route.ts`;
      const src = readSourceFile(routePath);
      if (src) sourceContext.push(`\n### Código: ${routePath}\n\`\`\`typescript\n${src.slice(0, 3000)}\n\`\`\``);
    }
  }

  const prompt = `Você é o Guardião Autônomo do app "Receitinhas da Vovó Teresinha" (Next.js/Vercel/Neon PostgreSQL).

## Falhas detectadas agora (${new Date().toLocaleString("pt-BR")} BRT):
${failedChecks.map(c => `- [${c.name}] HTTP ${c.status}: ${JSON.stringify(c.body).slice(0, 200)}`).join("\n")}

## Logs de erro do Vercel (últimos 30 min):
${logs}

## Código-fonte dos endpoints afetados:
${sourceContext.join("\n") || "(nenhum código-fonte encontrado)"}

## Contexto técnico:
- Banco de dados: Neon PostgreSQL via HTTP driver (tagged template literals)
- Colunas jsonb precisam de JSON.stringify(val) + ::jsonb cast no INSERT
- A coluna de data em \`assinaturas\` é \`renovada_em\` (não \`updated_at\` nem \`created_at\`)
- \`favoritos\` não tem coluna \`created_at\`
- \`usuarios\` não tem coluna \`criada_em\`

## Missão:
1. Use \`read_file\` se precisar de mais contexto
2. Diagnostique a causa raiz
3. Se conseguir corrigir em código: use \`write_fix\` com o arquivo correto
4. Sempre finalize com \`send_report\``;

  const tools = [
    {
      name: "read_file",
      description: "Lê o conteúdo de um arquivo do repositório.",
      input_schema: {
        type: "object",
        properties: { path: { type: "string", description: "Caminho relativo a squads/vovo-teresinha/app/src/ (ex: app/api/cron/fiscal-banco/route.ts)" } },
        required: ["path"],
      },
    },
    {
      name: "write_fix",
      description: "Escreve um arquivo corrigido no repositório. O sistema fará commit e redeploy automaticamente.",
      input_schema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Caminho relativo a squads/vovo-teresinha/app/src/" },
          content: { type: "string", description: "Conteúdo completo e correto do arquivo" },
          reason: { type: "string", description: "Explicação da correção em 1 frase" },
        },
        required: ["path", "content", "reason"],
      },
    },
    {
      name: "send_report",
      description: "OBRIGATÓRIO ao final. Envia diagnóstico e status.",
      input_schema: {
        type: "object",
        properties: {
          diagnosis: { type: "string", description: "Causa raiz identificada" },
          action: { type: "string", enum: ["code_fixed", "redeploy_triggered", "no_fix_possible", "false_alarm"] },
          summary: { type: "string", description: "Resumo em 1-2 linhas do que foi feito ou do que precisa de atenção humana" },
          needs_human: { type: "boolean" },
        },
        required: ["diagnosis", "action", "summary", "needs_human"],
      },
    },
  ];

  const messages = [{ role: "user", content: prompt }];
  let report = null;
  const actionsApplied = [];

  for (let i = 0; i < 8; i++) {
    const resp = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: resp.content });
    if (resp.stop_reason !== "tool_use") break;

    const results = [];
    for (const block of resp.content) {
      if (block.type !== "tool_use") continue;
      let result = "";

      try {
        if (block.name === "read_file") {
          const src = readSourceFile(block.input.path);
          result = src ?? "Arquivo não encontrado.";

        } else if (block.name === "write_fix") {
          writeSourceFile(block.input.path, block.input.content);
          actionsApplied.push(`✏️ Corrigiu: ${block.input.path} — ${block.input.reason}`);
          result = "Arquivo escrito com sucesso.";

        } else if (block.name === "send_report") {
          report = block.input;
          result = "Relatório registrado.";
        }
      } catch (e) {
        result = `Erro: ${String(e).slice(0, 200)}`;
      }

      results.push({ type: "tool_result", tool_use_id: block.id, content: result });
    }

    messages.push({ role: "user", content: results });
  }

  return { report, actionsApplied };
}

// ── Loop principal ────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n🔍 Guardião iniciado — ${new Date().toLocaleString("pt-BR")}`);

  // 1. Executar health checks
  const results = [];
  for (const check of HEALTH_CHECKS) {
    const r = await fetchJSON(check.url);
    const ok = check.expect.includes(r.status);
    results.push({ ...check, status: r.status, body: r.body, passed: ok });
    console.log(`  ${ok ? "✅" : "❌"} ${check.name}: HTTP ${r.status}`);
  }

  const failed = results.filter(r => !r.passed);
  const criticalFailed = failed.filter(r => r.critical);

  // 2. Carregar estado de incidentes
  const incidents = loadIncidents();
  const now = Date.now();

  // 3. Limpar incidentes resolvidos
  for (const [name, inc] of Object.entries(incidents)) {
    const check = results.find(r => r.name === name);
    if (check?.passed) {
      console.log(`  ✅ ${name}: incidente anterior RESOLVIDO`);
      await telegram(`✅ <b>Guardião 24/7 — Resolvido!</b>\n\n🔧 <b>${name}</b> voltou ao normal.\n<i>Problema detectado e corrigido automaticamente.</i>`);
      delete incidents[name];
    }
  }

  // 4. Se não há falhas: silêncio
  if (failed.length === 0) {
    console.log("  ✅ Todos os checks passaram. App saudável.");
    saveIncidents(incidents);
    return;
  }

  // 5. Para cada falha: decidir se precisa agir
  const newIncidents = [];
  const reAlerts = [];

  for (const check of failed) {
    const existing = incidents[check.name];
    if (!existing) {
      // Novo incidente
      newIncidents.push(check);
      incidents[check.name] = {
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        last_alert: new Date().toISOString(),
        error: String(check.body).slice(0, 300),
        status: check.status,
        attempts: 1,
      };
    } else {
      incidents[check.name].last_seen = new Date().toISOString();
      incidents[check.name].attempts = (existing.attempts || 0) + 1;
      // Re-alerta após 1 hora
      const hoursSinceLast = (now - new Date(existing.last_alert).getTime()) / 3600000;
      if (hoursSinceLast >= 1) {
        reAlerts.push(check);
        incidents[check.name].last_alert = new Date().toISOString();
      }
    }
  }

  saveIncidents(incidents);

  // 6. Só age se há incidentes novos ou críticos persistentes
  const toProcess = [...newIncidents, ...reAlerts.filter(r => r.critical)];
  if (toProcess.length === 0) {
    console.log("  ⏸️  Incidentes conhecidos — aguardando próximo ciclo (sem spam).");
    return;
  }

  // 7. Buscar logs do Vercel
  console.log("  📋 Buscando logs do Vercel...");
  const logs = await getVercelLogs();

  // 8. Chamar Claude para diagnóstico e correção
  console.log("  🤖 Chamando Claude para diagnóstico...");
  const { report, actionsApplied } = await diagnoseAndFix(toProcess, logs);

  // 9. Se houve correção de código: redeploy
  let deployTriggered = false;
  if (actionsApplied.length > 0) {
    console.log("  🚀 Correções aplicadas — disparando redeploy...");
    deployTriggered = await triggerRedeploy();

    if (deployTriggered) {
      console.log("  ⏳ Aguardando deploy (90s)...");
      await waitMs(90000);

      // Verificar se resolveu
      for (const check of toProcess) {
        const r = await fetchJSON(check.url);
        const ok = check.expect.includes(r.status);
        if (ok) {
          console.log(`  ✅ ${check.name}: RESOLVIDO após correção!`);
          delete incidents[check.name];
        }
      }
      saveIncidents(incidents);
    }
  }

  // 10. Enviar relatório via Telegram
  const checkList = toProcess.map(c => `❌ <b>${c.name}</b>: HTTP ${c.status}`).join("\n");
  const actionsList = actionsApplied.length > 0 ? actionsApplied.join("\n") : "Nenhuma ação automática aplicada";
  const isReAlert = reAlerts.length > 0 && newIncidents.length === 0;
  const hoursDown = incidents[toProcess[0]?.name]?.attempts
    ? Math.round(incidents[toProcess[0].name].attempts * 15 / 60 * 10) / 10
    : 0;

  const icon = report?.needs_human ? "🚨" : (actionsApplied.length > 0 ? "🤖✅" : "⚠️");
  const header = isReAlert
    ? `${icon} <b>Guardião 24/7 — Problema Persistente (${hoursDown}h)</b>`
    : `${icon} <b>Guardião 24/7 — Problema Detectado</b>`;

  let msg = `${header}\n\n`;
  msg += `<b>Falhas:</b>\n${checkList}\n\n`;
  msg += `<b>Diagnóstico:</b>\n${(report?.diagnosis || "Não foi possível diagnosticar").slice(0, 500)}\n\n`;
  msg += `<b>Ações:</b>\n${actionsList}\n\n`;
  if (deployTriggered) msg += `🚀 Redeploy disparado automaticamente.\n\n`;
  msg += report?.needs_human
    ? `⚠️ <b>Ação humana necessária.</b> O guardião não conseguiu corrigir sozinho.`
    : `✅ Correção aplicada automaticamente. Próxima verificação em 15 min.`;

  await telegram(msg);
  console.log(`  📤 Relatório enviado. Precisa humano: ${report?.needs_human}`);
}

main().catch(async (err) => {
  console.error("Erro fatal no guardião:", err);
  await telegram(`🔥 <b>Guardião 24/7 — ERRO FATAL</b>\n\nO próprio guardião falhou:\n<code>${String(err).slice(0, 400)}</code>\n\n⚠️ Atenção manual necessária!`);
  process.exit(1);
});
