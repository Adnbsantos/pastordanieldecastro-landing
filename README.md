# danieldecastro-landing

Cadastro de colaboradores temporários — campanha Zé Humberto.

## O que já está pronto
- `app/page.tsx` — formulário completo (dados, endereço, Pix, upload de foto/RG/CNH/certidão TSE, termo com leitura completa, assinatura)
- `app/api/geo/route.ts` — detecção de RA por GPS (reaproveita `regioes_administrativas`)
- `app/api/submit/route.ts` — salva no Supabase, sobe os anexos, aciona o worker do dossiê
- `supabase/schema.sql` — tabela `candidatos_zehumberto`
- `worker/dossie.js` — esqueleto do worker Railway (geração do dossiê + envio por e-mail)

## Passos para colocar no ar

1. **Supabase**: rodar `supabase/schema.sql` no projeto `jhtzfewaqbrjaglusftc` e criar o bucket `zehumberto-docs` (privado).
2. **GitHub**: criar repo `danieldecastro-landing` e subir este código.
3. **Vercel**: importar o repo, configurar as variáveis de `.env.example`, adicionar o domínio `zehumberto.pulsodf.com.br` nas configurações do projeto — a Vercel vai gerar um CNAME específico.
4. **Cloudflare**: com o CNAME em mãos, criar o registro DNS para `zehumberto.pulsodf.com.br` apontando pra ele (mesmo padrão de `app.`, `crm.` e `geracao.`).
5. **Railway**: publicar `worker/dossie.js` como serviço (completar a implementação dos 6 passos comentados no arquivo — geração de PDF, extração da certidão TSE, envio via Resend).
6. Definir `DOSSIE_WORKER_URL` na Vercel apontando pro serviço do Railway.

## Pendências de implementação no worker
- Preenchimento do termo a partir do modelo docx já aprovado
- Extração de texto da certidão TSE (título, zona/seção, local de votação)
- Conversão docx → PDF e merge dos anexos num dossiê único
- Envio do e-mail via Resend para `adnbsantos@gmail.com`

<!-- trigger redeploy 2026-08-11T13:28:16Z -->
<!-- fix author email 2026-08-11T13:29:50Z -->
