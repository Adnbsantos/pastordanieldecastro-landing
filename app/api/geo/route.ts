import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Mesmo padrão de auto-detecção de RA/Setor já usado em geracao.pulsodf.com.br
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: NextRequest) {
  const { latitude, longitude } = await req.json();

  if (!latitude || !longitude) {
    return NextResponse.json({ error: "latitude e longitude são obrigatórias" }, { status: 400 });
  }

  // TODO: substituir por lookup geoespacial real (PostGIS ou polígono por RA)
  // Por ora, aproxima pelo bairro/RA mais próximo cadastrado em regioes_administrativas/bairros
  const { data: regioes, error } = await supabase
    .from("regioes_administrativas")
    .select("nome, latitude, longitude")
    .limit(37);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  let maisProxima = null;
  let menorDistancia = Infinity;

  for (const ra of regioes ?? []) {
    const d = Math.hypot(ra.latitude - latitude, ra.longitude - longitude);
    if (d < menorDistancia) {
      menorDistancia = d;
      maisProxima = ra;
    }
  }

  return NextResponse.json({
    ra: maisProxima?.nome ?? null,
    setor: null, // preenchido quando o polígono de setor estiver disponível
  });
}
