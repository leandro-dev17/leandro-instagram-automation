/**
 * monitor-github.cjs — Monitor diário de campanhas Meta Ads
 *
 * Roda via GitHub Actions todo dia às 08:00 BRT.
 * Usa apenas módulos nativos do Node.js — sem dependências externas.
 *
 * Env vars necessárias (GitHub Secrets):
 *   META_ADS_ACCESS_TOKEN   — token de acesso à Marketing API
 *   META_AD_ACCOUNT_ID      — ID da conta (formato: act_XXXXXXXXXX)
 *   TELEGRAM_BOT_TOKEN      — token do bot Telegram
 *   TELEGRAM_CHAT_ID        — chat_id do destinatário
 *   META_ADS_MONTHLY_BUDGET — orçamento mensal em reais (ex: 800)
 */

'use strict';

const https = require('https');

// ── Credenciais ─────────────────────────────────────────────────────────────
const TOKEN          = process.env.META_ADS_ACCESS_TOKEN;
const ACCOUNT_ID     = process.env.META_AD_ACCOUNT_ID;      // act_XXXXXXXXXX
const TG_TOKEN       = process.env.TELEGRAM_BOT_TOKEN;
const TG_CHAT        = process.env.TELEGRAM_CHAT_ID;
const MONTHLY_BUDGET = parseFloat(process.env.META_ADS_MONTHLY_BUDGET || '0');

if (!TOKEN || !ACCOUNT_ID) {
  console.log('[Monitor] META_ADS_ACCESS_TOKEN ou META_AD_ACCOUNT_ID não configurados — abortando.');
  process.exit(0);
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────
function apiGet(path) {
  return new Promise((resolve, reject) => {
    const url = `https://graph.facebook.com/v21.0${path}`;
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`JSON inválido: ${data.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: 'graph.facebook.com',
      path: `/v21.0${path}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`JSON inválido: ${data.slice(0, 200)}`)); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function sendTelegram(html) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ chat_id: TG_CHAT, text: html, parse_mode: 'HTML' });
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${TG_TOKEN}/sendMessage`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    };
    const req = https.request(options, res => {
      res.on('data', () => {});
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.setTimeout(10000, () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
    req.write(body);
    req.end();
  });
}

// ── Helpers de data ──────────────────────────────────────────────────────────
function today()      { return new Date().toISOString().slice(0, 10); }
function firstOfMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function daysInMonth() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); }
function dayOfMonth()  { return new Date().getDate(); }

// ── Lógica principal ─────────────────────────────────────────────────────────
async function main() {
  const dateStr = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`[Monitor] Iniciando verificação — ${dateStr}`);

  // 1. Buscar campanhas ativas
  const campaignsRes = await apiGet(
    `/${ACCOUNT_ID}/campaigns?fields=id,name,status,effective_status,objective&access_token=${TOKEN}`
  );

  if (campaignsRes.error) {
    const errMsg = campaignsRes.error.message || 'erro desconhecido';
    console.log(`[Monitor] Erro na API Meta: ${errMsg}`);
    if (TG_TOKEN && TG_CHAT) {
      await sendTelegram(
        `🔴 <b>BioNexus Ads — ERRO ${dateStr}</b>\n\n` +
        `Falha ao conectar com a API Meta Ads:\n<code>${errMsg}</code>\n\n` +
        `Verifique se o META_ADS_ACCESS_TOKEN está válido.`
      );
    }
    process.exit(0);
  }

  const activeCampaigns = (campaignsRes.data || []).filter(c =>
    c.effective_status === 'ACTIVE' || c.effective_status === 'CAMPAIGN_PAUSED'
  ).filter(c => c.status === 'ACTIVE');

  // 2. Sem campanhas ativas → silêncio total
  if (activeCampaigns.length === 0) {
    console.log('[Monitor] Nenhuma campanha ativa — encerrando silenciosamente.');
    process.exit(0);
  }

  console.log(`[Monitor] ${activeCampaigns.length} campanha(s) ativa(s) encontrada(s).`);

  // 3. Para cada campanha ativa, buscar insights e anúncios
  const reports = [];
  const autoActions = [];

  for (const campaign of activeCampaigns) {
    // Insights dos últimos 3 dias
    const insightsRes = await apiGet(
      `/${campaign.id}/insights?fields=spend,impressions,clicks,ctr,cpm,frequency,actions,reach&date_preset=last_3d&access_token=${TOKEN}`
    );
    const ins = insightsRes.data?.[0] || {};

    // Leads (offsite ou native)
    const actions = ins.actions || [];
    const leads = actions.find(a =>
      a.action_type === 'lead' ||
      a.action_type === 'offsite_conversion.fb_pixel_lead' ||
      a.action_type === 'onsite_conversion.lead_grouped'
    );
    const leadCount  = leads ? parseInt(leads.value, 10) : 0;
    const spend      = parseFloat(ins.spend || 0);
    const cpl        = leadCount > 0 ? spend / leadCount : null;
    const ctr        = parseFloat(ins.ctr || 0);
    const frequency  = parseFloat(ins.frequency || 0);
    const impressions = parseInt(ins.impressions || 0, 10);

    // Anúncios da campanha
    const adsRes = await apiGet(
      `/${ACCOUNT_ID}/ads?fields=id,name,status,effective_status&campaign_id=${campaign.id}&access_token=${TOKEN}`
    );
    const ads = adsRes.data || [];
    const disapproved = ads.filter(a => a.effective_status === 'DISAPPROVED');
    const activeAds   = ads.filter(a => a.effective_status === 'ACTIVE');

    // Auto-ação: pausar anúncios reprovados
    for (const ad of disapproved) {
      try {
        await apiPost(`/${ad.id}?access_token=${TOKEN}`, { status: 'PAUSED' });
        autoActions.push(`✅ Anúncio reprovado pausado: <i>${ad.name}</i>`);
        console.log(`[Monitor] Pausou anúncio reprovado: ${ad.name}`);
      } catch (e) {
        autoActions.push(`⚠️ Falha ao pausar anúncio reprovado: <i>${ad.name}</i>`);
      }
    }

    // Determinar saúde
    let health = '🟢';
    const warnings = [];

    if (disapproved.length > 0) {
      health = '🔴';
      warnings.push(`${disapproved.length} anúncio(s) reprovado(s) — pausado(s) automaticamente`);
    }
    if (ctr > 0 && ctr < 0.8 && impressions >= 500) {
      if (health === '🟢') health = '🟡';
      warnings.push(`CTR ${ctr.toFixed(1)}% abaixo de 0,8% (${impressions.toLocaleString('pt-BR')} impressões)`);
    }
    if (frequency > 3.5) {
      health = '🔴';
      warnings.push(`Frequência ${frequency.toFixed(1)} — fadiga criativa (limite: 3.5)`);
    } else if (frequency > 2.5) {
      if (health === '🟢') health = '🟡';
      warnings.push(`Frequência ${frequency.toFixed(1)} — monitorar`);
    }
    if (activeAds.length === 0 && disapproved.length === 0) {
      if (health === '🟢') health = '🟡';
      warnings.push('Nenhum anúncio ativo — verificar entrega');
    }

    reports.push({ campaign, spend, leadCount, cpl, ctr, frequency, impressions, activeAds, disapproved, health, warnings });
  }

  // 4. Orçamento mensal
  let budgetLine = '';
  let budgetHealth = '🟢';
  if (MONTHLY_BUDGET > 0) {
    const monthSpendRes = await apiGet(
      `/${ACCOUNT_ID}/insights?fields=spend&time_range={"since":"${firstOfMonth()}","until":"${today()}"}&access_token=${TOKEN}`
    );
    const monthSpend = parseFloat(monthSpendRes.data?.[0]?.spend || 0);
    const pctBudget  = MONTHLY_BUDGET > 0 ? (monthSpend / MONTHLY_BUDGET) * 100 : 0;
    const pctMonth   = (dayOfMonth() / daysInMonth()) * 100;

    if (pctBudget >= 90 && pctMonth < 80) { budgetHealth = '🔴'; }
    else if (pctBudget >= 80 && pctMonth < 75) { budgetHealth = '🟡'; }

    budgetLine = `\n💰 <b>Orçamento ${new Date().toLocaleString('pt-BR', { month: 'long' })}:</b> ` +
      `R$${monthSpend.toFixed(0)}/R$${MONTHLY_BUDGET.toFixed(0)} ` +
      `(${pctBudget.toFixed(0)}%) ${budgetHealth}`;
  }

  // 5. Status geral
  const hasRed    = reports.some(r => r.health === '🔴') || budgetHealth === '🔴';
  const hasYellow = reports.some(r => r.health === '🟡') || budgetHealth === '🟡';
  const globalStatus = hasRed ? '🚨 ALERTA' : hasYellow ? '⚠️ Atenção' : '✅ Saudável';

  // 6. Montar mensagem Telegram
  const lines = [];
  lines.push(`📡 <b>BioNexus Ads — ${globalStatus}</b>`);
  lines.push(`📅 ${dateStr} 08:00`);
  lines.push('');

  for (const r of reports) {
    const cplStr = r.cpl != null ? `CPL R$${r.cpl.toFixed(2)}` : 'sem leads ainda';
    const ctrStr = r.ctr > 0 ? `CTR ${r.ctr.toFixed(1)}%` : 'CTR —';
    lines.push(`${r.health} <b>${r.campaign.name}</b>`);
    lines.push(`   ${cplStr} · ${r.leadCount} leads · ${ctrStr} · Freq ${r.frequency.toFixed(1)}`);
    for (const w of r.warnings) {
      lines.push(`   ⚠️ ${w}`);
    }
  }

  if (budgetLine) lines.push(budgetLine);

  if (autoActions.length > 0) {
    lines.push('');
    lines.push('<b>Ações automáticas:</b>');
    for (const a of autoActions) lines.push(`   ${a}`);
  }

  const needsAttention = reports.flatMap(r => r.warnings).filter(w =>
    w.includes('reprovado') || w.includes('fadiga') || w.includes('ativo')
  );
  if (needsAttention.length > 0) {
    lines.push('');
    lines.push('<b>Sua atenção:</b>');
    lines.push('   Abra a conversa no Claude Code para corrigir os alertas acima.');
  }

  lines.push('');
  lines.push('<i>Próxima verificação amanhã 08:00</i>');

  const message = lines.join('\n');
  console.log('[Monitor] Enviando Telegram...');
  const sent = await sendTelegram(message);
  console.log(sent ? '[Monitor] Telegram enviado ✅' : '[Monitor] Falha no Telegram ⚠️');
}

main().catch(err => {
  console.error('[Monitor] ERRO FATAL:', err.message);
  process.exit(1);
});
