import Link from "next/link";

export default function PagamentoPendente() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 text-center" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <div className="text-6xl mb-4">⏳</div>
      <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--vovo-marrom)" }}>
        Pagamento em processamento
      </h1>
      <p className="text-sm mb-6" style={{ color: "var(--vovo-marrom-mid)" }}>
        Estamos aguardando a confirmação do pagamento. Você receberá um aviso assim que for processado!
      </p>
      <Link href="/receitas" className="btn-primary">
        Voltar às receitas
      </Link>
    </div>
  );
}
