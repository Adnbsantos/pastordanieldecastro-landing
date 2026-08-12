import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

const BUCKET = "danieldecastro-docs";

// Gera URLs assinadas de upload para o navegador enviar os arquivos
// DIRETO pro Supabase Storage, sem passar pela função da Vercel — assim
// não existe mais limite de 4,5 MB por requisição (esse limite é da
// Vercel, não do Supabase). A função da Vercel só troca mensagens de
// texto pequenas com o navegador; quem recebe o arquivo pesado é o
// Supabase diretamente.
export async function POST(req: NextRequest) {
  try {
    const { cpf } = await req.json();
    if (!cpf) {
      return NextResponse.json({ error: "CPF é obrigatório" }, { status: 400 });
    }

    const folder = `${String(cpf).replace(/\D/g, "")}-${Date.now()}`;
    const arquivos = {
      foto: `${folder}/foto.jpg`,
      documento: `${folder}/documento`,
      certidao_tse: `${folder}/certidao_tse.pdf`,
    };

    const urls: Record<string, { path: string; token: string; signedUrl: string }> = {};

    for (const [chave, path] of Object.entries(arquivos)) {
      const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
      if (error || !data) throw error ?? new Error(`Falha ao gerar URL para ${chave}`);
      urls[chave] = { path, token: data.token, signedUrl: data.signedUrl };
    }

    return NextResponse.json({ folder, urls });
  } catch (err: any) {
    console.error("Erro ao gerar URLs de upload:", err);
    return NextResponse.json({ error: err.message ?? "Erro inesperado" }, { status: 500 });
  }
}
