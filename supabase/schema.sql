-- Tabela para os cadastros de colaboradores temporários da campanha Zé Humberto
-- Roda no mesmo projeto Supabase do ecossistema Pulso DF (jhtzfewaqbrjaglusftc)

create table if not exists candidatos_danieldecastro (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),

  -- Dados do termo (os 8 campos do contrato)
  nome_completo text not null,
  cpf text not null,
  data_nascimento date not null,
  endereco text not null,
  bairro text not null,
  cep text not null,
  cidade text not null,
  uf text not null,

  -- Dados adicionais da ficha interna
  whatsapp text,
  instagram text,
  chave_pix text,

  -- Localização auto-detectada por GPS (mesmo padrão do pulso-landing)
  ra_detectada text,
  setor_detectado text,
  latitude double precision,
  longitude double precision,

  -- Documentos anexados (paths no Supabase Storage)
  foto_path text,
  documento_path text,
  certidao_tse_path text,

  -- Extraído da certidão TSE (ficha interna, uso restrito)
  titulo_eleitor text,
  zona_eleitoral text,
  secao_eleitoral text,
  regularidade_eleitoral text,
  local_votacao text,

  -- Assinatura eletrônica simples
  termo_aceito boolean default false,
  termo_aceito_em timestamptz,
  termo_aceito_ip text,
  termo_aceito_user_agent text,

  -- Dossiê final
  dossie_pdf_path text,
  dossie_enviado_em timestamptz,
  status text default 'recebido' -- recebido | em_analise | aprovado | contratado
);

-- CPF não pode se repetir na mesma campanha
create unique index if not exists candidatos_danieldecastro_cpf_idx on candidatos_danieldecastro (cpf);

-- Storage bucket (rodar separadamente no painel do Supabase se ainda não existir)
-- insert into storage.buckets (id, name, public) values ('danieldecastro-docs', 'danieldecastro-docs', false);
