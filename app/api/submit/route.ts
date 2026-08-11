import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Endpoint do worker no Railway responsável por:
// 1) preencher o termo com os dados, 2) montar o dossiê (termo + ficha + anexos),
// 3) enviar por e-mail para adnbsantos@gmail.com
const DOSSIE_WORKER_URL = process.env.DOSSIE_WORKER_URL!;

async function uploadFile(file: File, path: string) {
  const bytes = await file.arrayBuffer();
  const { error } = await supabase.storage
    .from("danieldecastro-docs")
    .upload(path, bytes, { contentType: file.type, upsert: true });
  if (error) throw error;
  return path;
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();

    const nome_completo = form.get("nome_completo") as string;
    const cpf = form.get("cpf") as string;
    const data_nascimento = form.get("data_nascimento") as string;
    const endereco = form.get("endereco") as string;
    const bairro = form.get("bairro") as string;
    const cep = form.get("cep") as string;
    const cidade = form.get("cidade") as string;
    const uf = form.get("uf") as string;
    const whatsapp = form.get("whatsapp") as string;
    const instagram = form.get("instagram") as string;
    const chave_pix = form.get("chave_pix") as string;
    const ra_detectada = form.get("ra_detectada") as string;
    const setor_detectado = form.get("setor_detectado") as string;
    const latitude = form.get("latitude") ? Number(form.get("latitude")) : null;
    const longitude = form.get("longitude") ? Number(form.get("longitude")) : null;
    const termo_aceito = form.get("termo_aceito") === "true";

    if (!termo_aceito) {
      return NextResponse.json({ error: "É necessário concordar com os termos." }, { status: 400 });
    }

    const foto = form.get("foto") as File | null;
    const documento = form.get("documento") as File | null;
    const certidaoTse = form.get("certidao_tse") as File | null;

    if (!foto || !documento || !certidaoTse) {
      return NextResponse.json(
        { error: "Foto, documento com foto e certidão do TSE são obrigatórios." },
        { status: 400 }
      );
    }

    const folder = `${cpf.replace(/\D/g, "")}-${Date.now()}`;
    const foto_path = await uploadFile(foto, `${folder}/foto.jpg`);
    const documento_path = await uploadFile(documento, `${folder}/documento.pdf`);
    const certidao_tse_path = await uploadFile(certidaoTse, `${folder}/certidao_tse.pdf`);

    const ip = req.headers.get("x-forwarded-for") ?? "desconhecido";
    const userAgent = req.headers.get("user-agent") ?? "desconhecido";

    const { data: candidato, error: insertError } = await supabase
      .from("candidatos_danieldecastro")
      .insert({
        nome_completo,
        cpf,
        data_nascimento,
        endereco,
        bairro,
        cep,
        cidade,
        uf,
        whatsapp,
        instagram,
        chave_pix,
        ra_detectada,
        setor_detectado,
        latitude,
        longitude,
        foto_path,
        documento_path,
        certidao_tse_path,
        termo_aceito: true,
        termo_aceito_em: new Date().toISOString(),
        termo_aceito_ip: ip,
        termo_aceito_user_agent: userAgent,
      })
      .select()
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        return NextResponse.json(
          { error: "Já existe um cadastro com esse CPF. Se você já se cadastrou antes, não precisa enviar de novo." },
          { status: 409 }
        );
      }
      throw insertError;
    }

    // Aciona a montagem do dossiê e o envio por e-mail.
    // IMPORTANTE: precisa de await aqui — em ambiente serverless (Vercel), uma chamada
    // "fire-and-forget" pode ser interrompida assim que a função retorna a resposta.
    try {
      await fetch(DOSSIE_WORKER_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ candidatoId: candidato.id }),
      });
    } catch (err) {
      console.error("Falha ao acionar worker do dossiê:", err);
    }

    return NextResponse.json({ ok: true, id: candidato.id });
  } catch (err: any) {
    console.error(err);
    return NextResponse.json({ error: err.message ?? "Erro inesperado" }, { status: 500 });
  }
}
