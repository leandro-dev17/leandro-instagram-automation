export default function PrivacidadePage() {
  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: "40px 24px", fontFamily: "system-ui, sans-serif", color: "#fff", background: "#0d0d1a", minHeight: "100vh" }}>
      <h1 style={{ color: "#ffd700", fontSize: 28, marginBottom: 8 }}>Política de Privacidade</h1>
      <p style={{ color: "#aaa", marginBottom: 32 }}>Última atualização: junho de 2026</p>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ color: "#ffd700", fontSize: 20, marginBottom: 8 }}>1. Informações que coletamos</h2>
        <p style={{ color: "#ccc", lineHeight: 1.7 }}>
          Coletamos nome, e-mail e número de telefone para processamento de assinaturas e entrega do conteúdo via WhatsApp. Dados de pagamento são processados diretamente pelo Mercado Pago e não armazenamos dados financeiros.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ color: "#ffd700", fontSize: 20, marginBottom: 8 }}>2. Como usamos suas informações</h2>
        <p style={{ color: "#ccc", lineHeight: 1.7 }}>
          Suas informações são usadas exclusivamente para: gerenciar sua assinatura, enviar conteúdo político conservador via WhatsApp, e comunicações relacionadas ao serviço Alerta Patriota.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ color: "#ffd700", fontSize: 20, marginBottom: 8 }}>3. Compartilhamento de dados</h2>
        <p style={{ color: "#ccc", lineHeight: 1.7 }}>
          Não vendemos ou compartilhamos seus dados pessoais com terceiros, exceto quando necessário para operação do serviço (processamento de pagamentos via Mercado Pago, envio de mensagens via WhatsApp Business API).
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ color: "#ffd700", fontSize: 20, marginBottom: 8 }}>4. Instagram e Facebook</h2>
        <p style={{ color: "#ccc", lineHeight: 1.7 }}>
          Utilizamos a API do Meta (Facebook/Instagram) exclusivamente para publicar conteúdo informativo nas páginas oficiais do Alerta Patriota. Não coletamos dados de usuários através dessas plataformas.
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ color: "#ffd700", fontSize: 20, marginBottom: 8 }}>5. Seus direitos</h2>
        <p style={{ color: "#ccc", lineHeight: 1.7 }}>
          Você pode solicitar acesso, correção ou exclusão dos seus dados a qualquer momento pelo e-mail: <a href="mailto:contato@alertapatriota.com.br" style={{ color: "#ffd700" }}>contato@alertapatriota.com.br</a>
        </p>
      </section>

      <section style={{ marginBottom: 28 }}>
        <h2 style={{ color: "#ffd700", fontSize: 20, marginBottom: 8 }}>6. Contato</h2>
        <p style={{ color: "#ccc", lineHeight: 1.7 }}>
          Alerta Patriota — bionexusdigital@gmail.com<br />
          <a href="https://alertapatriota.vercel.app" style={{ color: "#ffd700" }}>alertapatriota.vercel.app</a>
        </p>
      </section>
    </div>
  );
}
