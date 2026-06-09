import Link from "next/link";

export default function PagamentoErro() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <div className="text-6xl mb-4">😔</div>
      <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--vovo-marrom)" }}>
        Pagamento não realizado
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--vovo-marrom-mid)" }}>
        Não foi possível processar o pagamento. Verifique seus dados e tente novamente, querida!
      </p>
      <div className="flex gap-3">
        <Link href="/assinar" className="btn-primary">
          Tentar novamente
        </Link>
        <Link href="/receitas" className="btn-secondary">
          Voltar
        </Link>
      </div>
    </div>
  );
}
