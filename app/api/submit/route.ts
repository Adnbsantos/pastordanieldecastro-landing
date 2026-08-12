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

// Os arquivos já foram enviados DIRETO pro Supabase Storage pelo navegador
// (via /api/upload-url + URLs assinadas), então aqui só recebemos os
// caminhos (texto) — nunca mais o binário dos arquivos. Isso elimina o
// limite de 4,5 MB por requisição da Vercel, que antes derrubava envios
// com foto grande sem deixar nenhum rastro no servidor.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
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
      termo_aceito,
      foto_path,
      documento_path,
      certidao_tse_path,
    } = body;

    if (!termo_aceito) {
      return NextResponse.json({ error: "É necessário concordar com os termos." }, { status: 400 });
    }

    if (!foto_path || !documento_path || !certidao_tse_path) {
      return NextResponse.json(
        { error: "Foto, documento com foto e certidão do TSE são obrigatórios." },
        { status: 400 }
      );
    }

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
        latitude: latitude ?? null,
        longitude: longitude ?? null,
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

