"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Receita = {
  id: number;
  titulo: string;
  descricao: string;
  categoria: string;
  tempo_preparo: number;
  calorias: number | null;
  porcoes: number;
  foto_url: string | null;
  ingredientes: string;
  modo_preparo: string;
  dica_vovo: string | null;
  proteina: number | null;
  carboidratos: number | null;
  gordura: number | null;
  fibras: number | null;
  is_premium: boolean;
  is_free_rotativa: boolean;
  is_personal: boolean;
  tags_restricao: string[];
};

const FORM_VAZIO = {
  titulo: "", descricao: "", categoria: "pratos_principais",
  ingredientes: "", modo_preparo: "", tempo_preparo: 30,
  calorias: "", porcoes: 4, foto_url: "",
  dica_vovo: "", proteina: "", carboidratos: "", gordura: "", fibras: "",
  is_premium: true, is_free_rotativa: false, is_personal: false,
  tags_restricao: [] as string[],
};

const TAGS_OPTIONS = ["sem_gluten", "sem_lactose", "low_carb", "sem_acucar", "vegano", "vegetariano", "proteica"];
const CATEGORIAS = ["cafe_manha","pratos_principais","lanches_snacks","doces_sobremesas","saladas","sopas_caldos","sucos_molhos","bolos_tortas"];

export default function AdminReceitasPage() {
  const [receitas, setReceitas] = useState<Receita[]>([]);
  const [busca, setBusca] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [mostraForm, setMostraForm] = useState(false);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [form, setForm] = useState(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [uploadando, setUploadando] = useState(false);
  const [autoTagging, setAutoTagging] = useState(false);
  const [autoTagResult, setAutoTagResult] = useState("");
  const [filtroPersonal, setFiltroPersonal] = useState(false);

  function carregar() {
    setCarregando(true);
    const params = new URLSearchParams();
    if (busca) params.set("busca", busca);
    if (filtroPersonal) params.set("personal", "1");
    fetch(`/api/admin/receitas?${params}`)
      .then((r) => r.json())
      .then((data) => { setReceitas(data.dados || []); setCarregando(false); })
      .catch(() => setCarregando(false));
  }

  useEffect(() => { carregar(); }, [filtroPersonal]);

  function novaReceita() {
    setEditandoId(null);
    setForm(FORM_VAZIO);
    setErro("");
    setMostraForm(true);
  }

  function editarReceita(r: Receita) {
    setEditandoId(r.id);
    setForm({
      titulo: r.titulo,
      descricao: r.descricao || "",
      categoria: r.categoria,
      ingredientes: r.ingredientes || "",
      modo_preparo: r.modo_preparo || "",
      tempo_preparo: r.tempo_preparo,
      calorias: r.calorias ? String(r.calorias) : "",
      porcoes: r.porcoes || 4,
      foto_url: r.foto_url || "",
      dica_vovo: r.dica_vovo || "",
      proteina: r.proteina ? String(r.proteina) : "",
      carboidratos: r.carboidratos ? String(r.carboidratos) : "",
      gordura: r.gordura ? String(r.gordura) : "",
      fibras: r.fibras ? String(r.fibras) : "",
      is_premium: r.is_premium,
      is_free_rotativa: r.is_free_rotativa,
      is_personal: r.is_personal,
      tags_restricao: r.tags_restricao || [],
    });
    setErro("");
    setMostraForm(true);
  }

  function toggleTag(tag: string) {
    setForm((f) => ({
      ...f,
      tags_restricao: f.tags_restricao.includes(tag)
        ? f.tags_restricao.filter((t) => t !== tag)
        : [...f.tags_restricao, tag],
    }));
  }

  async function uploadFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadando(true);
    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
    const data = await res.json();
    if (data.dados?.url) setForm((f) => ({ ...f, foto_url: data.dados.url }));
    setUploadando(false);
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro("");
    const payload = {
      ...form,
      calorias: form.calorias ? parseInt(form.calorias as string) : null,
      proteina: form.proteina ? parseFloat(form.proteina as string) : null,
      carboidratos: form.carboidratos ? parseFloat(form.carboidratos as string) : null,
      gordura: form.gordura ? parseFloat(form.gordura as string) : null,
      fibras: form.fibras ? parseFloat(form.fibras as string) : null,
      dica_vovo: form.dica_vovo || null,
    };

    const url = editandoId ? `/api/admin/receitas/${editandoId}` : "/api/admin/receitas";
    const method = editandoId ? "PUT" : "POST";

    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      setMostraForm(false);
      setEditandoId(null);
      setForm(FORM_VAZIO);
      carregar();
    } else {
      const data = await res.json();
      setErro(data.erro || "Erro ao salvar");
    }
    setSalvando(false);
  }

  async function autoTagReceitas() {
    if (!confirm("Analisar ingredientes das 400 receitas e marcar veganas/vegetarianas automaticamente?")) return;
    setAutoTagging(true);
    setAutoTagResult("");
    try {
      const res = await fetch("/api/admin/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "tag_receitas" }),
      });
      const data = await res.json();
      if (res.ok) {
        setAutoTagResult(`✅ Vegetarianas: ${data.dados.vegetariano_tagged} | Veganas: ${data.dados.vegano_tagged}`);
        carregar();
      } else {
        setAutoTagResult(`❌ ${data.erro}`);
      }
    } catch {
      setAutoTagResult("❌ Erro de conexão");
    } finally {
      setAutoTagging(false);
    }
  }

  async function excluir(id: number) {
    if (!confirm("Excluir esta receita? Esta ação não pode ser desfeita.")) return;
    await fetch(`/api/admin/receitas/${id}`, { method: "DELETE" });
    carregar();
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <header className="px-4 py-3 flex items-center justify-between shadow-sm" style={{ backgroundColor: "var(--vovo-marrom)" }}>
        <div className="flex items-center gap-3">
          <Link href="/admin" className="text-white text-lg">←</Link>
          <span className="text-white font-bold">🍳 Receitas</span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={autoTagReceitas}
            disabled={autoTagging}
            className="text-white text-xs font-semibold bg-white bg-opacity-20 px-3 py-1 rounded-lg"
            title="Analisa ingredientes e marca receitas veganas/vegetarianas automaticamente"
          >
            {autoTagging ? "⏳" : "🏷️ Auto-tag"}
          </button>
          <button onClick={novaReceita} className="text-white text-sm font-semibold bg-white bg-opacity-20 px-3 py-1 rounded-lg">+ Nova</button>
        </div>
      </header>

      <div className="px-4 pt-4 max-w-3xl mx-auto">
        {autoTagResult && (
          <div className="mb-3 text-sm font-medium text-center p-2 rounded-xl"
            style={{ backgroundColor: autoTagResult.startsWith("✅") ? "#f0fdf4" : "#fef2f2", color: autoTagResult.startsWith("✅") ? "#16a34a" : "#dc2626" }}>
            {autoTagResult}
          </div>
        )}
        <div className="flex gap-2 mb-3">
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && carregar()}
            placeholder="Buscar receitas..."
            className="input-field flex-1"
          />
          <button onClick={carregar} className="btn-primary px-4">🔍</button>
        </div>
        <button
          onClick={() => setFiltroPersonal((v) => !v)}
          className="mb-4 text-xs font-semibold px-3 py-1.5 rounded-full transition-all"
          style={{
            backgroundColor: filtroPersonal ? "#2563eb" : "#eff6ff",
            color: filtroPersonal ? "white" : "#2563eb",
            border: "1px solid #2563eb",
          }}
        >
          🏋️ {filtroPersonal ? "Mostrando só Personal" : "Filtrar: Personal"}
        </button>

        {carregando ? (
          <div className="text-center py-12"><div className="text-4xl animate-bounce">🍳</div></div>
        ) : (
          <div className="space-y-2">
            {receitas.map((r) => (
              <div key={r.id} className="card p-3 flex items-center gap-3">
                {r.foto_url && (
                  <img src={r.foto_url} alt={r.titulo} className="w-12 h-12 rounded-xl object-cover flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm truncate" style={{ color: "var(--vovo-marrom)" }}>{r.titulo}</p>
                  <p className="text-xs" style={{ color: "var(--vovo-lock)" }}>
                    {r.categoria.replace(/_/g, " ")} • {r.tempo_preparo}min
                    {r.is_free_rotativa ? <span className="text-green-600"> • FREE</span> : null}
                    {r.is_personal ? <span className="text-blue-600"> • PERSONAL</span> : null}
                    {r.is_premium && !r.is_free_rotativa ? <span className="text-purple-600"> • PREMIUM</span> : null}
                  </p>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <button
                    onClick={() => editarReceita(r)}
                    className="text-xs px-2 py-1 rounded-lg"
                    style={{ backgroundColor: "#eff6ff", color: "#2563eb" }}
                  >
                    ✏️
                  </button>
                  <button
                    onClick={() => excluir(r.id)}
                    className="text-xs px-2 py-1 rounded-lg"
                    style={{ backgroundColor: "#fee2e2", color: "#dc2626" }}
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {mostraForm && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 overflow-y-auto">
          <div className="bg-white min-h-screen max-w-lg mx-auto p-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold" style={{ color: "var(--vovo-marrom)" }}>
                {editandoId ? "✏️ Editar Receita" : "✨ Nova Receita"}
              </h2>
              <button onClick={() => { setMostraForm(false); setEditandoId(null); }}>✕</button>
            </div>

            {erro && <p className="text-sm text-red-600 mb-3 p-2 bg-red-50 rounded">{erro}</p>}

            <form onSubmit={salvar} className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>Título *</label>
                <input type="text" value={form.titulo} onChange={(e) => setForm(f => ({ ...f, titulo: e.target.value }))} className="input-field" required />
              </div>

              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>Descrição *</label>
                <input type="text" value={form.descricao} onChange={(e) => setForm(f => ({ ...f, descricao: e.target.value }))} className="input-field" required />
              </div>

              {/* Foto */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>Foto da receita</label>
                {form.foto_url && (
                  <div className="mb-2 relative w-full h-32 rounded-xl overflow-hidden">
                    <img src={form.foto_url} alt="preview" className="w-full h-full object-cover" />
                    <button type="button" onClick={() => setForm(f => ({ ...f, foto_url: "" }))}
                      className="absolute top-1 right-1 bg-white rounded-full px-1.5 py-0.5 text-xs" style={{ color: "#dc2626" }}>✕</button>
                  </div>
                )}
                <div className="flex gap-2">
                  <label className="flex-1 flex items-center justify-center gap-2 py-2 rounded-xl cursor-pointer text-xs font-medium"
                    style={{ backgroundColor: uploadando ? "#f0ebe5" : "var(--vovo-marrom)", color: "white" }}>
                    {uploadando ? "Enviando..." : "📷 Upload"}
                    <input type="file" accept="image/*" className="hidden" onChange={uploadFoto} disabled={uploadando} />
                  </label>
                  <input type="url" value={form.foto_url} onChange={(e) => setForm(f => ({ ...f, foto_url: e.target.value }))}
                    className="input-field flex-1 text-xs" placeholder="ou cole uma URL" />
                </div>
              </div>

              {/* Categoria */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>Categoria *</label>
                <select value={form.categoria} onChange={(e) => setForm(f => ({ ...f, categoria: e.target.value }))} className="input-field">
                  {CATEGORIAS.map((c) => <option key={c} value={c}>{c.replace(/_/g, " ")}</option>)}
                </select>
              </div>

              {/* Ingredientes */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>Ingredientes * (um por linha)</label>
                <textarea value={form.ingredientes} onChange={(e) => setForm(f => ({ ...f, ingredientes: e.target.value }))} className="input-field resize-none" rows={5} required />
              </div>

              {/* Modo de preparo */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>Modo de Preparo *</label>
                <textarea value={form.modo_preparo} onChange={(e) => setForm(f => ({ ...f, modo_preparo: e.target.value }))} className="input-field resize-none" rows={6} required />
              </div>

              {/* Dica da Vovó */}
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>💌 Dica da Vovó</label>
                <textarea value={form.dica_vovo} onChange={(e) => setForm(f => ({ ...f, dica_vovo: e.target.value }))} className="input-field resize-none" rows={3} placeholder="Um segredinho da vovó..." />
              </div>

              {/* Números */}
              <div className="grid grid-cols-3 gap-2">
                {[{ key: "tempo_preparo", label: "Tempo (min)" }, { key: "calorias", label: "Calorias" }, { key: "porcoes", label: "Porções" }].map(({ key, label }) => (
                  <div key={key}>
                    <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>{label}</label>
                    <input type="number" value={(form as Record<string, unknown>)[key] as string} onChange={(e) => setForm(f => ({ ...f, [key]: e.target.value }))} className="input-field" />
                  </div>
                ))}
              </div>

              {/* Macros */}
              <div>
                <p className="text-xs font-medium mb-2" style={{ color: "var(--vovo-marrom)" }}>🔒 Info nutricional (por porção, gramas)</p>
                <div className="grid grid-cols-4 gap-2">
                  {[{ key: "proteina", label: "Proteína" }, { key: "carboidratos", label: "Carbos" }, { key: "gordura", label: "Gordura" }, { key: "fibras", label: "Fibras" }].map(({ key, label }) => (
                    <div key={key}>
                      <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-lock)" }}>{label}</label>
                      <input type="number" step="0.1" value={(form as Record<string, unknown>)[key] as string} onChange={(e) => setForm(f => ({ ...f, [key]: e.target.value }))} className="input-field text-xs" placeholder="g" />
                    </div>
                  ))}
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="block text-xs font-medium mb-2" style={{ color: "var(--vovo-marrom)" }}>Tags de restrição</label>
                <div className="flex flex-wrap gap-2">
                  {TAGS_OPTIONS.map((tag) => (
                    <button key={tag} type="button" onClick={() => toggleTag(tag)}
                      className="text-xs px-2 py-1 rounded-full transition-colors"
                      style={{ backgroundColor: form.tags_restricao.includes(tag) ? "var(--vovo-verde)" : "#f0ebe5", color: form.tags_restricao.includes(tag) ? "white" : "var(--vovo-marrom-mid)" }}>
                      {tag.replace(/_/g, " ")}
                    </button>
                  ))}
                </div>
              </div>

              {/* Flags */}
              <div className="flex gap-4 flex-wrap p-3 rounded-xl" style={{ backgroundColor: "#f8f4f0" }}>
                {[{ key: "is_premium", label: "🔒 Premium" }, { key: "is_free_rotativa", label: "🆓 Free rotativa" }, { key: "is_personal", label: "💪 Personal" }].map(({ key, label }) => (
                  <label key={key} className="flex items-center gap-2 text-xs cursor-pointer font-medium" style={{ color: "var(--vovo-marrom)" }}>
                    <input type="checkbox" checked={!!form[key as keyof typeof form]}
                      onChange={(e) => setForm(f => ({ ...f, [key]: e.target.checked }))} className="accent-[var(--vovo-rosa)]" />
                    {label}
                  </label>
                ))}
              </div>

              <div className="flex gap-2 pt-2 pb-8">
                <button type="button" onClick={() => { setMostraForm(false); setEditandoId(null); }} className="btn-secondary flex-1">Cancelar</button>
                <button type="submit" disabled={salvando} className="btn-primary flex-1">
                  {salvando ? "Salvando..." : editandoId ? "Salvar alterações" : "Criar receita"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
