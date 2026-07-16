/**
 * Guardião 24/7 — Vovó Teresinha
 * Roda a cada 15 minutos via GitHub Actions.
 * Detecta falhas → chama Groq/Cerebras (Llama 3.3 70B) → aplica correções → avisa só o que foi resolvido.
 * Anthropic removido em 16/07/2026 (mesmo motivo do restante do squad): chave excluída pelo
 * usuário para parar cobrança recorrente. Como este script escreve arquivo direto no disco do
 * runner (sem passar pela validação de compilação do claude-revisor), validarAntesDeEscrever()
 * abaixo é a rede de segurança real — ver o incidente de lib/agente-falha.ts que motivou o
 * mesmo tipo de proteção no claude-revisor.
 */

const ts = require("typescript");
const fs = require("fs");
const path = require("path");

const APP_URL     = process.env.APP_URL     || "https://receitinhas-vovo-teresinha.vercel.app";
const CRON_SECRET = process.env.CRON_SECRET || "";
const TG_TOKEN    = process.env.TELEGRAM_BOT_TOKEN || "";
const TG_CHAT     = process.env.TELEGRAM_CHAT_ID   || "";
const VERCEL_TOK  = process.env.VERCEL_TOKEN        || "";
const VERCEL_PID  = process.env.VERCEL_PROJECT_ID   || "prj_RtqsbSdxPMz81W2cr0tJyatRJGMv";
const VERCEL_TID  = process.env.VERCEL_TEAM_ID      || "team_JnDwQYGSI9RBjHyIygKLR56b";

const GROQ_API_KEY = process.env.GROQ_API_KEY || "";
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY || "";
const MODELO_LLAMA_GROQ = "llama-3.3-70b-versatile";
const MODELO_LLAMA_CEREBRAS = "llama-3.3-70b";

const REPO_ROOT = path.resolve(__dirname, "../../..");
const APP_SRC   = path.join(REPO_ROOT, "squads/vovo-teresinha/app/src");
const INCIDENTS = path.join(__dirname, "incidents.json");

// Gera entrada para agente cron
const cron = (name, critical = false) => ({
  name,
  url: `${APP_URL}/api/cron/${name}`,
  headers: { Authorization: `Bearer ${CRON_SECRET}` },
  expect: [200],
  critical,
});

const HEALTH_CHECKS = [
  // ── App (críticos) ──────────────────────────────────────────────
  { name: "homepage",     url: `${APP_URL}/`,             expect: [200, 308], critical: true },
  { name: "login-page",   url: `${APP_URL}/login`,        expect: [200],      critical: true },
  { name: "api-receitas", url: `${APP_URL}/api/receitas`, expect: [200, 401], critical: true },

  // ── Fiscais (críticos — monitoram saúde financeira) ─────────────
  cron("fiscal-banco",       true),
  cron("fiscal-diario",      true),
  cron("fiscal-erros-api",   true),
  cron("fiscal-login",       true),
  cron("fiscal-pagamentos",  true),

  // ── Core do negócio ─────────────────────────────────────────────
  cron("trial-expirando",    true),
  cron("agente-assinaturas", true),
  cron("push-diario",        true),
  cron("criador-receitas",   true),
  cron("saude-pwa",          true),

  // ── Gerentes ────────────────────────────────────────────────────
  cron("gerente-operacoes"),
  cron("gerente-financeiro"),
  cron("gerente-tecnico"),
  cron("gerente-conteudo"),
  cron("gerente-clientes"),
  cron("ceo-relatorio"),

  // ── Retenção e marketing ────────────────────────────────────────
  cron("cacador-desistentes"),
  cron("preditor-churn"),
  cron("campanha-recuperacao"),
  cron("disparador-campanhas"),
  cron("engajamento"),
  cron("bonus-sazonal"),

  // ── Relatórios e análise ────────────────────────────────────────
  cron("monitor-relatorios"),
  cron("previsao-receita"),
  cron("performance"),
  cron("reputacao-email"),
  cron("observador-mercado"),

  // ── WhatsApp ────────────────────────────────────────────────────
  cron("whatsapp-fila"),
  cron("publicador-wpp"),
  cron("recepcionista-wpp"),
  cron("conversor-wpp"),
  cron("moderacao-grupo"),
  cron("respondedor-vovo-wpp"),

  // ── Afiliados ───────────────────────────────────────────────────
  cron("calculador-comissao"),
  cron("confirmador-comissao"),
  cron("anti-fraude-afiliados"),
  cron("pagamento-afiliados"),

  // ── Personal / alunas ───────────────────────────────────────────
  cron("monitor-alunas"),
  cron("personalizador-alunas"),
  cron("curador-receitas-personal"),

  // ── Infra e segurança ───────────────────────────────────────────
  cron("backup-monitor"),
  cron("circuit-breaker"),
  cron("fila-dlq"),
  cron("guardiao-seguranca"),
  cron("rotador-senhas"),
  cron("rotacao-receitas-free"),
  cron("compliance-lgpd"),

  // ── Setup (roda uma vez, só verifica se responde) ───────────────
  cron("setup-afiliados-db"),
  cron("setup-falhas-db"),
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

// Verifica se algum cron foi desativado pelo Vercel e força redeploy
async function verificarCronsDesativados() {
  if (!VERCEL_TOK) return;
  const r = await fetchJSON(
    `https://api.vercel.com/v1/deployments/${VERCEL_PID}/crons?teamId=${VERCEL_TID}`,
    { headers: { Authorization: `Bearer ${VERCEL_TOK}` } }
  );
  if (!r.ok || !Array.isArray(r.body?.crons)) return;
  const desativados = r.body.crons.filter(c => c.state === "disabled" || c.state === "error");
  if (desativados.length > 0) {
    console.log(`  ⚠️ ${desativados.length} cron(s) desativado(s) pelo Vercel — forçando redeploy`);
    await triggerRedeploy();
  }
}

async function getVercelLogs() {
  if (!VERCEL_TOK) return "Logs não disponíveis";
  const since = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const r = await fetchJSON(
    `https://api.vercel.com/v1/projects/${VERCEL_PID}/logs?teamId=${VERCEL_TID}&since=${since}&limit=50&level=error`,
    { headers: { Authorization: `Bearer ${VERCEL_TOK}` } }
  );
  if (!r.ok) return `Erro ao buscar logs: ${JSON.stringify(r.body).slice(0, 200)}`;
  const logs = Array.isArray(r.body) ? r.body : (r.body?.logs ?? []);
  return logs.slice(0, 20).map(l => `[${l.timestamp || ""}] ${l.message || JSON.stringify(l)}`).join("\n") || "Nenhum erro recente.";
}

function readSourceFile(relativePath) {
  const full = path.join(APP_SRC, relativePath);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, "utf8");
}

// Bloqueia escritas que quebrariam o build antes de irem pro disco do runner (que o workflow
// commita e pusha direto, sem CI no meio). Mesmo padrão de validarAntesDeCommitar do claude-revisor.
function validarAntesDeEscrever(caminho, codigoNovo, codigoAntigo) {
  if (codigoNovo.includes("```")) {
    return { ok: false, motivo: "markdown residual no código (cerca não removida)" };
  }
  if (codigoAntigo && codigoNovo.trim().length < codigoAntigo.trim().length * 0.5) {
    return { ok: false, motivo: "conteúdo novo tem menos da metade do tamanho original (risco de truncamento)" };
  }
  if (caminho.endsWith(".ts") || caminho.endsWith(".tsx")) {
    const resultado = ts.transpileModule(codigoNovo, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
      },
      reportDiagnostics: true,
    });
    const erros = (resultado.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
    if (erros.length > 0) {
      const msg = erros.map(e => ts.flattenDiagnosticMessageText(e.messageText, " ")).join("; ");
      return { ok: false, motivo: `erro de sintaxe TypeScript: ${msg.substring(0, 200)}` };
    }
    if (codigoAntigo) {
      const exportsAntigos = [...codigoAntigo.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map(m => m[1]);
      const exportsNovos = new Set([...codigoNovo.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map(m => m[1]));
      const perdidos = exportsAntigos.filter(nome => !exportsNovos.has(nome));
      if (perdidos.length > 0) {
        return { ok: false, motivo: `removeria export(s) usados por outros arquivos: ${perdidos.join(", ")}` };
      }
    }
  }
  return { ok: true };
}

function writeSourceFile(relativePath, content) {
  // Bloquear caminhos que começam com src/ para evitar criar src/src/ duplicado
  const cleaned = relativePath.replace(/^src[\\/]/, "");
  const full = path.join(APP_SRC, cleaned);
  // Garantir que o arquivo fica dentro de APP_SRC
  if (!full.startsWith(APP_SRC)) {
    throw new Error(`Caminho fora de APP_SRC: ${full}`);
  }
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, "utf8");
}

async function triggerRedeploy() {
  if (!VERCEL_TOK) return false;
  const list = await fetchJSON(
    `https://api.vercel.com/v6/deployments?teamId=${VERCEL_TID}&projectId=${VERCEL_PID}&target=production&state=READY&limit=1`,
    { headers: { Authorization: `Bearer ${VERCEL_TOK}` } }
  );
  const deployId = list.body?.deployments?.[0]?.uid;
  if (!deployId) return false;
  const r = await fetchJSON("https://api.vercel.com/v13/deployments", {
    method: "POST",
    headers: { Authorization: `Bearer ${VERCEL_TOK}`, "Content-Type": "application/json" },
    body: JSON.stringify({ deploymentId: deployId, target: "production" }),
  });
  return r.status < 400;
}

function waitMs(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Groq/Cerebras: tool-use agêntico (formato OpenAI-compatible) ─────────────
// Mesmo padrão de squads/vovo-teresinha/app/src/lib/ai.ts (gerarComFerramentas), duplicado aqui
// porque este script .cjs roda isolado no runner do GitHub Actions e não importa o app Next.js.

async function rodarLoopFerramentas(url, apiKey, modelo, promptInicial, ferramentas, executar, nomeFerramentaFinal, maxIteracoes) {
  const messages = [{ role: "user", content: promptInicial }];
  let relatorioFinal = null;
  const acoesAplicadas = [];

  for (let i = 0; i < maxIteracoes; i++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelo, messages, tools: ferramentas, max_tokens: 4096 }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) throw new Error(`${url} ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("Resposta sem choices[0].message");

    const chamadas = msg.tool_calls || [];
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: chamadas });
    if (chamadas.length === 0) break;

    for (const chamada of chamadas) {
      const nome = chamada.function.name;
      let args = {};
      try { args = JSON.parse(chamada.function.arguments || "{}"); } catch { /* argumentos malformados, segue vazio */ }

      let resultado;
      try {
        resultado = await executar(nome, args, acoesAplicadas);
      } catch (err) {
        resultado = `Erro: ${String(err).slice(0, 200)}`;
      }

      if (nome === nomeFerramentaFinal) relatorioFinal = args;

      messages.push({
        role: "tool",
        tool_call_id: chamada.id,
        content: typeof resultado === "string" ? resultado : JSON.stringify(resultado),
      });
    }

    if (relatorioFinal) break;
  }

  return { relatorioFinal, acoesAplicadas };
}

async function gerarComFerramentas({ promptInicial, ferramentas, executar, nomeFerramentaFinal, maxIteracoes = 10 }) {
  const erros = [];

  if (GROQ_API_KEY) {
    try {
      return await rodarLoopFerramentas(
        "https://api.groq.com/openai/v1/chat/completions", GROQ_API_KEY, MODELO_LLAMA_GROQ,
        promptInicial, ferramentas, executar, nomeFerramentaFinal, maxIteracoes
      );
    } catch (err) { erros.push(`Groq: ${String(err)}`); }
  }

  if (CEREBRAS_API_KEY) {
    try {
      return await rodarLoopFerramentas(
        "https://api.cerebras.ai/v1/chat/completions", CEREBRAS_API_KEY, MODELO_LLAMA_CEREBRAS,
        promptInicial, ferramentas, executar, nomeFerramentaFinal, maxIteracoes
      );
    } catch (err) { erros.push(`Cerebras: ${String(err)}`); }
  }

  throw new Error(`Groq e Cerebras falharam — ${erros.join(" | ")}`);
}

// ── Diagnóstico e correção autônoma ───────────────────────────────────────────

async function diagnoseAndFix(failedChecks, logs) {
  const sourceContext = [];
  for (const check of failedChecks) {
    const routeName = check.name.replace(/^(homepage|login-page|api-receitas)$/, "");
    if (routeName) {
      const src = readSourceFile(`app/api/cron/${routeName}/route.ts`);
      if (src) sourceContext.push(`\n### ${routeName}/route.ts\n\`\`\`typescript\n${src.slice(0, 3000)}\n\`\`\``);
    }
  }

  const prompt = `Você é o Guardião Autônomo do app "Receitinhas da Vovó Teresinha" (Next.js/Vercel/Neon PostgreSQL).

## Falhas detectadas (${new Date().toLocaleString("pt-BR")} BRT):
${failedChecks.map(c => `- [${c.name}] HTTP ${c.status}: ${JSON.stringify(c.body).slice(0, 200)}`).join("\n")}

## Logs de erro Vercel (últimos 30 min):
${logs}

## Código dos endpoints afetados:
${sourceContext.join("\n") || "(nenhum encontrado)"}

## Contexto técnico:
- Banco: Neon PostgreSQL via HTTP driver (tagged template literals)
- Coluna de data em \`assinaturas\`: \`renovada_em\` (não \`updated_at\` nem \`created_at\`)
- Colunas jsonb: usar JSON.stringify(val)::jsonb nos INSERTs
- \`favoritos\` não tem \`created_at\`, \`usuarios\` não tem \`criada_em\`

## Missão:
1. Use \`read_file\` para mais contexto se necessário
2. Diagnostique a causa raiz
3. Use \`write_fix\` para corrigir em código — o campo "content" deve ser o arquivo completo
   corrigido, em TypeScript puro, SEM cercas de markdown (sem \`\`\`) e sem explicação junto
4. Finalize com \`send_report\``;

  const ferramentas = [
    {
      type: "function",
      function: {
        name: "read_file",
        description: "Lê arquivo do repositório.",
        parameters: {
          type: "object",
          properties: { path: { type: "string", description: "Caminho relativo a squads/vovo-teresinha/app/src/" } },
          required: ["path"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "write_fix",
        description: "Escreve arquivo corrigido. Commit e redeploy serão feitos automaticamente.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string" },
            content: { type: "string" },
            reason: { type: "string", description: "Explicação da correção em 1 frase" },
          },
          required: ["path", "content", "reason"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "send_report",
        description: "OBRIGATÓRIO ao final.",
        parameters: {
          type: "object",
          properties: {
            diagnosis: { type: "string" },
            action: { type: "string", enum: ["code_fixed", "redeploy_triggered", "no_fix_possible", "false_alarm"] },
            summary: { type: "string" },
            fixed_items: { type: "array", items: { type: "string" }, description: "Lista do que foi corrigido" },
            needs_human: { type: "boolean" },
          },
          required: ["diagnosis", "action", "summary", "fixed_items", "needs_human"],
        },
      },
    },
  ];

  const actionsApplied = [];

  const executarFerramenta = async (nome, args) => {
    if (nome === "read_file") {
      return readSourceFile(args.path) ?? "Arquivo não encontrado.";
    }
    if (nome === "write_fix") {
      const codigoLimpo = String(args.content).replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```\s*$/, "").trim();
      const codigoAntigo = readSourceFile(args.path.replace(/^src[\\/]/, "")) || "";
      const validacao = validarAntesDeEscrever(args.path, codigoLimpo, codigoAntigo);
      if (!validacao.ok) {
        return `Fix BLOQUEADO antes de escrever (${validacao.motivo}) — revise e tente write_fix de novo.`;
      }
      writeSourceFile(args.path, codigoLimpo);
      actionsApplied.push({ path: args.path, reason: args.reason });
      return "Arquivo escrito.";
    }
    if (nome === "send_report") {
      return "Relatório registrado.";
    }
    return `Ferramenta desconhecida: ${nome}`;
  };

  const { relatorioFinal } = await gerarComFerramentas({
    promptInicial: prompt,
    ferramentas,
    executar: executarFerramenta,
    nomeFerramentaFinal: "send_report",
    maxIteracoes: 10,
  });

  return { report: relatorioFinal, actionsApplied };
}

// ── Health check de rotas de usuário (servidor-para-servidor) ────────────────
async function verificarRotasUsuario() {
  const r = await fetchJSON(
    `${APP_URL}/api/cron/health-usuario`,
    { headers: { Authorization: `Bearer ${CRON_SECRET}` } }
  );
  if (!r.ok) {
    console.log(`  ⚠️  health-usuario falhou: HTTP ${r.status}`);
    return [];
  }
  const falhas = [];
  for (const check of (r.body?.checks || [])) {
    const icon = check.ok ? "✅" : "❌";
    console.log(`  ${icon} user:${check.nome}${check.erro ? ": " + check.erro : ""}`);
    if (!check.ok) {
      falhas.push({
        name: `user:${check.nome}`,
        url: `${APP_URL}/api/cron/health-usuario`,
        status: 500,
        body: { erro: check.erro },
        critical: true,
        expect: [200],
        passed: false,
        headers: {},
      });
    }
  }
  return falhas;
}

// ── Loop principal ────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🔍 Guardião iniciado — ${new Date().toLocaleString("pt-BR")}`);

  // 0. Verificar se algum cron foi desativado pelo Vercel
  await verificarCronsDesativados();

  // 1. Health checks de crons — paralelo em lotes de 10
  const results = [];
  const BATCH = 10;
  for (let i = 0; i < HEALTH_CHECKS.length; i += BATCH) {
    const lote = HEALTH_CHECKS.slice(i, i + BATCH);
    const loteRes = await Promise.all(lote.map(async (check) => {
      const opts = check.headers ? { headers: check.headers } : {};
      const r = await fetchJSON(check.url, opts);
      const ok = check.expect.includes(r.status);
      console.log(`  ${ok ? "✅" : "❌"} ${check.name}: HTTP ${r.status}`);
      return { ...check, status: r.status, body: r.body, passed: ok };
    }));
    results.push(...loteRes);
  }

  // 3. Health checks de rotas de usuário (servidor-para-servidor)
  console.log("  👤 Testando rotas de usuário...");
  const falhasUsuario = await verificarRotasUsuario();
  results.push(...falhasUsuario);

  const failed = results.filter(r => !r.passed);
  const incidents = loadIncidents();
  const now = Date.now();

  // 2. Registrar resoluções (incidentes que passaram)
  const resolved = [];
  for (const [name, inc] of Object.entries(incidents)) {
    if (results.find(r => r.name === name)?.passed) {
      console.log(`  ✅ ${name}: resolvido`);
      resolved.push({ name, duration: Math.round((now - new Date(inc.first_seen).getTime()) / 60000) });
      delete incidents[name];
    }
  }

  // 3. App saudável — silêncio total
  if (failed.length === 0) {
    console.log("  ✅ App saudável.");
    // Avisa resoluções se havia incidentes anteriores
    if (resolved.length > 0) {
      const list = resolved.map(r => `• <b>${r.name}</b> (ficou fora por ~${r.duration} min)`).join("\n");
      await telegram(`✅ <b>Guardião — Tudo Resolvido</b>\n\n${list}\n\n<i>Correção aplicada automaticamente.</i>`);
    }
    saveIncidents(incidents);
    return;
  }

  // 4. Classificar falhas novas vs conhecidas
  const newFails = [];
  for (const check of failed) {
    if (!incidents[check.name]) {
      newFails.push(check);
      incidents[check.name] = {
        first_seen: new Date().toISOString(),
        last_seen: new Date().toISOString(),
        attempts: 1,
        status: check.status,
      };
    } else {
      incidents[check.name].last_seen = new Date().toISOString();
      incidents[check.name].attempts = (incidents[check.name].attempts || 0) + 1;
    }
  }

  saveIncidents(incidents);

  // 5. Só processa se há falhas novas ou críticas com muitas tentativas sem sucesso (>8 ciclos = 2h)
  const stuck = failed.filter(c => incidents[c.name]?.attempts > 8 && c.critical);
  const toProcess = [...newFails, ...stuck.filter(c => !newFails.find(n => n.name === c.name))];

  if (toProcess.length === 0) {
    console.log("  ⏸️  Trabalhando nos incidentes conhecidos...");
    return;
  }

  // 6. Buscar logs e chamar Claude
  console.log("  📋 Buscando logs do Vercel...");
  const logs = await getVercelLogs();

  console.log("  🤖 Claude diagnosticando e corrigindo...");
  const { report, actionsApplied } = await diagnoseAndFix(toProcess, logs);

  // 7. Se houve correção de código: commit (pelo workflow) + redeploy
  let deployTriggered = false;
  if (actionsApplied.length > 0) {
    console.log("  🚀 Correções aplicadas — redeploy...");
    deployTriggered = await triggerRedeploy();

    if (deployTriggered) {
      console.log("  ⏳ Aguardando deploy (90s)...");
      await waitMs(90000);

      // Verificar se resolveu após redeploy
      const stillFailed = [];
      for (const check of toProcess) {
        const r = await fetchJSON(check.url);
        const ok = check.expect.includes(r.status);
        if (ok) {
          console.log(`  ✅ ${check.name}: RESOLVIDO!`);
          delete incidents[check.name];
        } else {
          stillFailed.push(check.name);
        }
      }
      saveIncidents(incidents);

      // Telegram APENAS com o que foi resolvido
      const fixedNames = toProcess.filter(c => !stillFailed.includes(c.name));
      if (fixedNames.length > 0) {
        const list = fixedNames.map(c => `• <b>${c.name}</b>`).join("\n");
        const fixes = actionsApplied.map(a => `  ↳ ${a.reason}`).join("\n");
        await telegram(`✅ <b>Guardião — Corrigido Automaticamente</b>\n\n${list}\n\n${fixes}`);
      }

      // Se ainda tem falhas após correção e redeploy: aviso mínimo (sem detalhe técnico)
      if (stillFailed.length > 0 && stuck.length > 0) {
        const list = stillFailed.map(n => `• ${n}`).join("\n");
        await telegram(`⚠️ <b>Guardião — Não Consegui Corrigir</b>\n\n${list}\n\n<i>Continuando tentativas a cada 15 min.</i>`);
      }
    }
  }

  console.log(`  📊 Pronto. Corrigidos: ${actionsApplied.length} | Deploy: ${deployTriggered}`);
}

main().catch(async (err) => {
  console.error("Erro fatal:", err);
  // Falha do próprio guardião — avisa (único alerta de problema que chega)
  await telegram(`🔥 <b>Guardião falhou</b>\n<code>${String(err).slice(0, 300)}</code>`);
  process.exit(1);
});
