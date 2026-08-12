"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

const TERMO_RESUMO =
  "Prestação de serviço temporário, sem vínculo empregatício - Vigência 16/08/2026 a 04/10/2026.";

// Fotos de câmera de celular costumam vir com 4-8 MB, e a Vercel rejeita
// requisições acima de 4,5 MB antes mesmo de chegar no nosso código —
// sem deixar rastro nenhum e com uma mensagem de erro genérica. Por isso
// comprimimos qualquer imagem no navegador antes de enviar.
async function comprimirImagem(file: File, larguraMaxima = 1000, qualidade = 0.6): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, larguraMaxima / bitmap.width);
  const largura = Math.round(bitmap.width * escala);
  const altura = Math.round(bitmap.height * escala);

  const canvas = document.createElement("canvas");
  canvas.width = largura;
  canvas.height = altura;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, largura, altura);

  const blob: Blob | null = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", qualidade)
  );
  if (!blob) return file;

  // Se por algum motivo a versão comprimida ficou maior (imagem já pequena),
  // mantém o arquivo original.
  if (blob.size >= file.size) return file;

  return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
}

const TERMO_COMPLETO = `TERMO DE CONCORDÂNCIA E CONTRATO DE PRESTAÇÃO DE SERVIÇO TEMPORÁRIO DE CAMPANHA

CONTRATANTE: Mais Soluções Integradas, CNPJ 38.292.139/0001-29, atuando em apoio operacional à campanha do candidato Pastor Daniel de Castro.
CONTRATADO(A): pessoa física qualificada neste cadastro.

CLÁUSULA 1ª — DO OBJETO
Prestação de serviço temporário de apoio operacional à campanha, incluindo mobilização, divulgação e tarefas correlatas.

CLÁUSULA 2ª — DA VIGÊNCIA
De 16 de agosto de 2026 a 04 de outubro de 2026, podendo ser encerrado antecipadamente mediante aviso prévio de 48 horas.

CLÁUSULA 3ª — DO VALOR
R$ 2.250,00 (dois mil, duzentos e cinquenta reais), pago via Pix na chave informada neste cadastro — que deve ser obrigatoriamente do(a) próprio(a) contratado(a).

CLÁUSULA 4ª — DA NATUREZA DA RELAÇÃO
Este termo não caracteriza vínculo empregatício.

CLÁUSULA 5ª — DA CONFIDENCIALIDADE E DADOS PESSOAIS
Os dados pessoais são tratados conforme a LGPD (Lei nº 13.709/2018), usados exclusivamente para este cadastro.

CLÁUSULA 6ª — DO FORO
Fica eleito o foro da Circunscrição Especial Judiciária de Brasília/DF.`;

function maskCPF(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 11);
  return d
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d)/, "$1.$2")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

function maskWhatsapp(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 11);
  if (d.length <= 10) {
    return d
      .replace(/(\d{2})(\d)/, "($1) $2")
      .replace(/(\d{4})(\d{1,4})$/, "$1-$2");
  }
  return d
    .replace(/(\d{2})(\d)/, "($1) $2")
    .replace(/(\d{5})(\d{1,4})$/, "$1-$2");
}

function maskCEP(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 8);
  return d.replace(/(\d{5})(\d{1,3})$/, "$1-$2");
}

function maskDataNascimento(value: string) {
  const d = value.replace(/\D/g, "").slice(0, 8);
  return d
    .replace(/(\d{2})(\d)/, "$1/$2")
    .replace(/(\d{2})(\d{1,4})$/, "$1/$2");
}

function maskInstagram(value: string) {
  const semArroba = value.replace(/@/g, "").replace(/[^a-zA-Z0-9._]/g, "");
  return semArroba ? `@${semArroba}` : "";
}

function dataNascimentoParaISO(valor: string) {
  const [dia, mes, ano] = valor.split("/");
  if (!dia || !mes || !ano || ano.length < 4) return "";
  return `${ano}-${mes}-${dia}`;
}

export default function Home() {
  const [form, setForm] = useState({
    nome_completo: "",
    cpf: "",
    data_nascimento: "",
    whatsapp: "",
    instagram: "",
    endereco: "",
    bairro: "",
    cep: "",
    cidade: "",
    uf: "",
    chave_pix: "",
  });
  const [foto, setFoto] = useState<File | null>(null);
  const [documento, setDocumento] = useState<File | null>(null);
  const [comprimindoFoto, setComprimindoFoto] = useState(false);
  const [comprimindoDocumento, setComprimindoDocumento] = useState(false);
  const [certidaoTse, setCertidaoTse] = useState<File | null>(null);
  const [geo, setGeo] = useState<{ ra: string | null; setor: string | null; lat: number | null; lng: number | null }>({
    ra: null,
    setor: null,
    lat: null,
    lng: null,
  });
  const [mostrarTermoCompleto, setMostrarTermoCompleto] = useState(false);
  const [aceitouTermo, setAceitouTermo] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [status, setStatus] = useState<"idle" | "sucesso" | "erro">("idle");
  const [erroMsg, setErroMsg] = useState<string>("");
  const [ras, setRas] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/ras")
      .then((r) => r.json())
      .then((d) => setRas(d.ras ?? []))
      .catch(() => setRas([]));
  }, []);

  useEffect(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(async (pos) => {
      const { latitude, longitude } = pos.coords;
      try {
        const res = await fetch("/api/geo", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ latitude, longitude }),
        });
        const data = await res.json();
        setGeo({ ra: data.ra, setor: data.setor, lat: latitude, lng: longitude });
      } catch {
        setGeo((g) => ({ ...g, lat: latitude, lng: longitude }));
      }
    });
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const { name, value } = e.target;
    let masked = value;
    if (name === "cpf") masked = maskCPF(value);
    else if (name === "whatsapp") masked = maskWhatsapp(value);
    else if (name === "cep") masked = maskCEP(value);
    else if (name === "data_nascimento") masked = maskDataNascimento(value);
    else if (name === "instagram") masked = maskInstagram(value);
    setForm({ ...form, [name]: masked });
  }

  function handleRaChange(e: React.ChangeEvent<HTMLSelectElement>) {
    setForm({ ...form, cidade: e.target.value, uf: "DF" });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!aceitouTermo || !foto || !documento || !certidaoTse) return;

    setEnviando(true);
    setStatus("idle");

    try {
      // 1) Pede 3 URLs assinadas de upload — essa chamada é só texto (JSON
      // pequeno), nunca esbarra em limite de tamanho.
      const resUrls = await fetch("/api/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpf: form.cpf }),
      });
      const dadosUrls = await resUrls.json().catch(() => ({}));
      if (!resUrls.ok) {
        setErroMsg(dadosUrls.error || "Não foi possível preparar o envio dos documentos.");
        setStatus("erro");
        return;
      }

      // 2) Sobe cada arquivo DIRETO pro Supabase Storage, usando a URL
      // assinada — o arquivo nunca passa pela função da Vercel, então o
      // limite de 4,5 MB dela deixa de existir.
      const uploads: [File, { path: string; token: string }][] = [
        [foto, dadosUrls.urls.foto],
        [documento, dadosUrls.urls.documento],
        [certidaoTse, dadosUrls.urls.certidao_tse],
      ];

      for (const [arquivo, alvo] of uploads) {
        const { error } = await supabase.storage
          .from("danieldecastro-docs")
          .uploadToSignedUrl(alvo.path, alvo.token, arquivo);
        if (error) throw error;
      }

      // 3) Envia só os dados de texto + os caminhos dos arquivos já
      // enviados — payload pequeno, sem risco de estourar limite.
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          data_nascimento: dataNascimentoParaISO(form.data_nascimento),
          ra_detectada: geo.ra ?? "",
          setor_detectado: geo.setor ?? "",
          latitude: geo.lat,
          longitude: geo.lng,
          termo_aceito: true,
          foto_path: dadosUrls.urls.foto.path,
          documento_path: dadosUrls.urls.documento.path,
          certidao_tse_path: dadosUrls.urls.certidao_tse.path,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErroMsg(json.error || "Não foi possível concluir o envio. Tente novamente.");
        setStatus("erro");
        return;
      }
      setStatus("sucesso");
    } catch (err: any) {
      console.error(err);
      setErroMsg("Não foi possível enviar. Verifique sua conexão e tente novamente.");
      setStatus("erro");
    } finally {
      setEnviando(false);
    }
  }

  if (status === "sucesso") {
    return (
      <main className="min-h-screen flex items-center justify-center bg-[#EAF2FB] p-6">
        <div className="max-w-md text-center bg-white rounded-xl p-8 border border-[#D3D1C7]">
          <h1 className="text-lg font-medium text-[#1B2559] mb-2">Cadastro enviado!</h1>
          <p className="text-sm text-[#5F5E5A]">
            Recebemos seus dados e documentos. Em breve nossa equipe entra em contato pelo WhatsApp.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#EAF2FB]">
      <form onSubmit={handleSubmit} className="max-w-lg mx-auto">
        <div className="bg-[#1B2559] px-5 pt-5 pb-10 text-center">
          <div className="text-[#F0C24A] text-base font-bold tracking-wide">CADASTRO DE COLABORADOR TEMPORÁRIO</div>
          <img src="/logo-daniel.png" alt="Pastor Daniel de Castro" className="h-16 mx-auto mt-3" />
        </div>

        <div className="flex justify-center -mt-8">
          <div className="w-24 h-24 rounded-full border-4 border-white overflow-hidden bg-[#1B2559]">
            <img src="/mascote-daniel.png" alt="Pastor Daniel de Castro" className="w-full h-full object-cover" />
          </div>
        </div>

        <section className="bg-white mx-4 mt-2 rounded-xl p-5 border border-[#D3D1C7]">
          <h2 className="text-sm font-medium text-[#1B2559] mb-3">Seus dados</h2>
          <input name="nome_completo" placeholder="Nome completo" required onChange={handleChange}
            className="w-full mb-2 border rounded-lg px-3 py-2 text-sm" />
          <div className="flex gap-2 mb-2">
            <input name="cpf" placeholder="CPF" required value={form.cpf} onChange={handleChange}
              inputMode="numeric" maxLength={14}
              className="flex-1 border rounded-lg px-3 py-2 text-sm" />
            <input name="data_nascimento" placeholder="dd/mm/aaaa" required value={form.data_nascimento} onChange={handleChange}
              inputMode="numeric" maxLength={10}
              className="flex-1 border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2">
            <input name="whatsapp" placeholder="WhatsApp" value={form.whatsapp} onChange={handleChange}
              inputMode="numeric" maxLength={15}
              className="flex-1 border rounded-lg px-3 py-2 text-sm" />
            <input name="instagram" placeholder="@seu_instagram" value={form.instagram} onChange={handleChange}
              className="flex-1 border rounded-lg px-3 py-2 text-sm" />
          </div>

          <h2 className="text-sm font-medium text-[#1B2559] mt-4 mb-3">Endereço</h2>
          <input name="endereco" placeholder="Endereço" required onChange={handleChange}
            className="w-full mb-2 border rounded-lg px-3 py-2 text-sm" />
          <div className="flex gap-2 mb-2">
            <input name="bairro" placeholder="Bairro" required value={form.bairro} onChange={handleChange}
              className="flex-1 border rounded-lg px-3 py-2 text-sm" />
            <input name="cep" placeholder="CEP" required value={form.cep} onChange={handleChange}
              inputMode="numeric" maxLength={9}
              className="flex-1 border rounded-lg px-3 py-2 text-sm" />
          </div>
          <div className="flex gap-2 mb-3">
            <select name="cidade" required value={form.cidade} onChange={handleRaChange}
              className="flex-1 border rounded-lg px-3 py-2 text-sm bg-white">
              <option value="">Selecione a RA...</option>
              {ras.map((ra) => (
                <option key={ra} value={ra}>{ra}</option>
              ))}
            </select>
            <input name="uf" placeholder="UF" value={form.uf} readOnly maxLength={2} required
              className="w-16 border rounded-lg px-3 py-2 text-sm bg-[#F5F4F0] text-[#5F5E5A]" />
          </div>
          {geo.ra && (
            <div className="bg-[#E9ECF7] rounded-lg px-3 py-2 text-xs text-[#1B2559]">
              Localização detectada: RA {geo.ra}{geo.setor ? ` · Setor ${geo.setor}` : ""}
            </div>
          )}
        </section>

        <section className="bg-white mx-4 mt-4 rounded-xl p-5 border border-[#D3D1C7]">
          <h2 className="text-sm font-medium text-[#1B2559] mb-3">Dados bancários para pagamento</h2>
          <input name="chave_pix" placeholder="ID Pix" required onChange={handleChange}
            className="w-full mb-2 border rounded-lg px-3 py-2 text-sm" />
          <p className="text-xs text-[#993C1D]">A chave Pix deve ser obrigatoriamente do(a) próprio(a) contratado(a).</p>
        </section>

        <section className="bg-white mx-4 mt-4 rounded-xl p-5 border border-[#D3D1C7]">
          <h2 className="text-sm font-medium text-[#1B2559] mb-3">Documentos</h2>
          <div className="flex gap-2 mb-2">
            <label className={`flex-1 border rounded-lg p-3 text-center text-xs cursor-pointer ${
              foto ? "border-green-500 bg-green-50 text-green-800" : "border-dashed border-[#B4B2A9]"
            }`}>
              {comprimindoFoto ? (
                <span className="text-[#5F5E5A]">Otimizando foto...</span>
              ) : foto ? (
                <span className="flex flex-col items-center gap-1">
                  <span className="text-green-600 text-base leading-none">✓</span>
                  <span className="truncate max-w-full">{foto.name}</span>
                  <span className="text-[10px] text-green-700">Anexado — toque para trocar</span>
                </span>
              ) : (
                "Sua foto aqui"
              )}
              <input type="file" accept="image/*" capture="user" className="hidden"
                onChange={async (e) => {
                  const arquivo = e.target.files?.[0] ?? null;
                  if (!arquivo) { setFoto(null); return; }
                  setComprimindoFoto(true);
                  try {
                    setFoto(await comprimirImagem(arquivo));
                  } finally {
                    setComprimindoFoto(false);
                  }
                }} required />
            </label>
            <label className={`flex-1 border rounded-lg p-3 text-center text-xs cursor-pointer ${
              documento ? "border-green-500 bg-green-50 text-green-800" : "border-dashed border-[#B4B2A9]"
            }`}>
              {comprimindoDocumento ? (
                <span className="text-[#5F5E5A]">Otimizando...</span>
              ) : documento ? (
                <span className="flex flex-col items-center gap-1">
                  <span className="text-green-600 text-base leading-none">✓</span>
                  <span className="truncate max-w-full">{documento.name}</span>
                  <span className="text-[10px] text-green-700">Anexado — toque para trocar</span>
                </span>
              ) : (
                "RG ou CNH"
              )}
              <input type="file" accept="image/*,application/pdf" className="hidden"
                onChange={async (e) => {
                  const arquivo = e.target.files?.[0] ?? null;
                  if (!arquivo) { setDocumento(null); return; }
                  setComprimindoDocumento(true);
                  try {
                    setDocumento(await comprimirImagem(arquivo));
                  } finally {
                    setComprimindoDocumento(false);
                  }
                }} required />
            </label>
          </div>
          <label className={`block border rounded-lg p-3 text-center cursor-pointer ${
            certidaoTse ? "border-green-500 bg-green-50" : "border-dashed border-[#F0C24A] bg-[#FAEEDA]"
          }`}>
            {certidaoTse ? (
              <span className="flex flex-col items-center gap-1">
                <span className="text-green-600 text-base leading-none">✓</span>
                <span className="block text-xs font-medium text-green-800">{certidaoTse.name}</span>
                <span className="block text-[11px] text-green-700">Anexado — toque para trocar</span>
              </span>
            ) : (
              <>
                <span className="block text-xs font-medium text-[#412402]">Certidão de quitação eleitoral (TSE)</span>
                <span className="block text-[11px] text-[#854F0B] mt-1">Anexar PDF emitido no autoatendimento do TSE</span>
              </>
            )}
            <input type="file" accept="application/pdf" className="hidden"
              onChange={(e) => setCertidaoTse(e.target.files?.[0] ?? null)} required />
          </label>
        </section>

        <section className="bg-white mx-4 mt-4 rounded-xl p-5 border border-[#D3D1C7]">
          <h2 className="text-sm font-medium text-[#1B2559] mb-2">
            Termo de concordância e contrato de prestação de serviço temporário de campanha
          </h2>
          <p className="text-xs text-[#5F5E5A] leading-relaxed">{TERMO_RESUMO}</p>
          <button type="button" onClick={() => setMostrarTermoCompleto((v) => !v)}
            className="text-xs text-[#0C447C] mt-2 underline">
            {mostrarTermoCompleto ? "Ocultar termos" : "Ler termos completos"}
          </button>
          {mostrarTermoCompleto && (
            <pre className="whitespace-pre-wrap text-[11px] text-[#3A3A38] bg-[#F5F4F0] rounded-lg p-3 mt-2 max-h-64 overflow-y-auto">
              {TERMO_COMPLETO}
            </pre>
          )}
          <label className="flex items-center gap-2 mt-3 text-xs text-[#1B2559]">
            <input type="checkbox" checked={aceitouTermo} onChange={(e) => setAceitouTermo(e.target.checked)} />
            Li e concordo com os termos acima
          </label>
        </section>

        <div className="px-4 py-5">
          <button type="submit" disabled={!aceitouTermo || enviando || comprimindoFoto || comprimindoDocumento}
            className="w-full bg-[#F0C24A] text-[#412402] font-medium py-3 rounded-lg text-sm disabled:opacity-50">
            {enviando ? "Enviando..." : "Assinar termo digitalmente"}
          </button>
          {status === "erro" && (
            <p className="text-xs text-red-600 mt-2 text-center">
              {erroMsg}
            </p>
          )}
        </div>
      </form>
    </main>
  );
}
