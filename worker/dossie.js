// Worker Railway: monta o dossiê (termo preenchido + ficha + anexos) e envia por e-mail
// Reaproveita o mesmo padrão de infra do worker de IA já rodando no Railway.

const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const Docxtemplater = require("docxtemplater");
const PizZip = require("pizzip");
const { PDFDocument, StandardFonts } = require("pdf-lib");
const pdfParse = require("pdf-parse");
const { Resend } = require("resend");
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const app = express();
app.use(express.json());

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);
const resend = new Resend(process.env.RESEND_API_KEY);
const DOSSIE_EMAIL_TO = process.env.DOSSIE_EMAIL_TO || "adnbsantos@gmail.com";

function formatarDataBR(iso) {
  if (!iso) return "";
  const partes = String(iso).split("-");
  if (partes.length !== 3) return iso;
  const [ano, mes, dia] = partes;
  return `${dia}/${mes}/${ano}`;
}

function formatarDataHoraBR(isoTimestamp) {
  if (!isoTimestamp) return "";
  const d = new Date(isoTimestamp);
  const data = d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  const hora = d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  return `${data} às ${hora} (horário de Brasília)`;
}

// Mapa oficial Zona Eleitoral -> RA, conforme TRE-DF
// (https://www.tre-df.jus.br/servicos-eleitorais/contatos-cartorios-eleitorais)
const ZONA_PARA_RA = {
  1: "Asa Sul (Plano Piloto)",
  2: "Paranoá",
  3: "Taguatinga Norte",
  4: "Santa Maria",
  5: "Sobradinho",
  6: "Planaltina",
  7: null, // zona extinta
  8: "Ceilândia Centro",
  9: "Guará",
  10: "Núcleo Bandeirante",
  11: "Cruzeiro",
  12: null, // zona extinta
  13: "Samambaia",
  14: "Asa Norte (Plano Piloto)",
  15: "Águas Claras",
  16: "Ceilândia Norte",
  17: "Gama",
  18: "Lago Sul",
  19: "Taguatinga Norte",
  20: "Ceilândia Sul",
  21: "Recanto das Emas",
};

function raDaZona(zona) {
  if (!zona) return null;
  const numero = parseInt(String(zona).replace(/^0+/, ""), 10);
  return ZONA_PARA_RA[numero] || null;
}

function preencherTermo(templatePath, dados) {
  const content = fs.readFileSync(templatePath, "binary");
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
  doc.render({
    nome_completo: dados.nome_completo,
    cpf: dados.cpf,
    data_nascimento: formatarDataBR(dados.data_nascimento),
    endereco: dados.endereco,
    bairro: dados.bairro,
    cep: dados.cep,
    cidade: dados.cidade,
    uf: dados.uf,
    termo_aceito_em: formatarDataHoraBR(dados.termo_aceito_em),
    termo_aceito_ip: dados.termo_aceito_ip || "não registrado",
    id_cadastro: dados.id,
    regularidade_eleitoral: dados.regularidade_eleitoral || "não verificada",
    titulo_eleitor: dados.titulo_eleitor || "—",
  });
  return doc.getZip().generate({ type: "nodebuffer" });
}

function docxParaPdf(docxBuffer, workDir) {
  const docxPath = path.join(workDir, "termo.docx");
  fs.writeFileSync(docxPath, docxBuffer);
  execSync(`soffice --headless --convert-to pdf --outdir "${workDir}" "${docxPath}"`, {
    stdio: "ignore",
  });
  return fs.readFileSync(path.join(workDir, "termo.pdf"));
}

async function extrairDadosCertidao(pdfBuffer) {
  const { text } = await pdfParse(pdfBuffer);
  const tituloMatch = text.match(/(\d{4}\s?\d{4}\s?\d{4})/);
  const zonaMatch = text.match(/Zona[:\s]+(\d+)/i);
  const secaoMatch = text.match(/Se[cç][aã]o[:\s]+(\d+)/i);
  // A certidão de quitação eleitoral não traz o local de votação (escola/endereço) —
  // isso só existe numa consulta separada no TSE (com CAPTCHA, não automatizável).
  // O que a certidão realmente traz é o Município/UF onde a pessoa está registrada,
  // que é o dado equivalente disponível para "onde a pessoa vota".
  const municipioMatch = text.match(/Munic[ií]pio:\s*\d*\s*-?\s*([^\n]+)/i);
  const ufMatch = text.match(/\bUF:\s*([A-Z]{2})\b/);
  const regularSim = /quite|regular|nada consta/i.test(text);

  const municipio = municipioMatch ? municipioMatch[1].trim() : null;
  const uf = ufMatch ? ufMatch[1].trim() : null;

  return {
    titulo_eleitor: tituloMatch ? tituloMatch[1] : null,
    zona_eleitoral: zonaMatch ? zonaMatch[1] : null,
    secao_eleitoral: secaoMatch ? secaoMatch[1] : null,
    local_votacao: municipio ? `${municipio}${uf ? " - " + uf : ""}` : null,
    regularidade_eleitoral: regularSim ? "Regular" : "Verificar manualmente",
  };
}

async function gerarFichaPdf(dados, fotoBuffer) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const tituloTexto = "Ficha de Cadastro";
  const tituloTamanho = 16;
  const tituloLargura = fontBold.widthOfTextAtSize(tituloTexto, tituloTamanho);
  page.drawText(tituloTexto, { x: (595 - tituloLargura) / 2, y: 780, size: tituloTamanho, font: fontBold });

  let y = 620;

  if (fotoBuffer) {
    try {
      const img = fotoBuffer[0] === 0xff ? await pdfDoc.embedJpg(fotoBuffer) : await pdfDoc.embedPng(fotoBuffer);
      // Formato 3x4 (proporção padrão de foto de documento)
      const largura = 105;
      const altura = 140;
      const xCentralizado = (595 - largura) / 2;
      page.drawImage(img, { x: xCentralizado, y: 730 - altura, width: largura, height: altura });
      y = 730 - altura - 40;
    } catch (e) {
      console.error("Falha ao embutir foto:", e.message);
    }
  }

  const raVotacao = raDaZona(dados.zona_eleitoral);

  const linhas = [
    ["Nome completo", dados.nome_completo],
    ["CPF", dados.cpf],
    ["Data de nascimento", formatarDataBR(dados.data_nascimento)],
    ["WhatsApp", dados.whatsapp],
    ["Instagram", dados.instagram],
    ["Endereço", `${dados.endereco}, ${dados.bairro}`],
    ["CEP / Cidade / UF", `${dados.cep} — ${dados.cidade}/${dados.uf}`],
    ["Chave Pix", dados.chave_pix],
    ["", ""],
    ["— Uso interno / TSE —", ""],
    ["Título de eleitor", dados.titulo_eleitor || "—"],
    ["Zona / Seção", `${dados.zona_eleitoral || "—"} / ${dados.secao_eleitoral || "—"}`],
    ["Regularidade eleitoral", dados.regularidade_eleitoral || "—"],
    ["RA de votação", raVotacao || "Não identificada — verificar manualmente"],
  ];

  for (const [label, valor] of linhas) {
    if (label) {
      page.drawText(`${label}:`, { x: 50, y, size: 10, font: fontBold });
      page.drawText(String(valor ?? "—"), { x: 220, y, size: 10, font });
    }
    y -= 20;
  }

  return Buffer.from(await pdfDoc.save());
}

async function montarDossie(termoPdf, fichaPdf, anexosPdf) {
  const dossie = await PDFDocument.create();
  for (const buf of [termoPdf, fichaPdf, ...anexosPdf]) {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await dossie.copyPages(src, src.getPageIndices());
    pages.forEach((p) => dossie.addPage(p));
  }
  return Buffer.from(await dossie.save());
}

app.post("/gerar-dossie", async (req, res) => {
  const { candidatoId } = req.body;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "dossie-"));

  try {
    const { data: candidato, error } = await supabase
      .from("candidatos_danieldecastro")
      .select("*")
      .eq("id", candidatoId)
      .single();
    if (error) throw error;

    const baixar = async (p) => {
      const { data, error } = await supabase.storage.from("danieldecastro-docs").download(p);
      if (error) throw error;
      return Buffer.from(await data.arrayBuffer());
    };

    const [fotoBuffer, documentoBuffer, certidaoBuffer] = await Promise.all([
      baixar(candidato.foto_path),
      baixar(candidato.documento_path),
      baixar(candidato.certidao_tse_path),
    ]);

    const dadosCertidao = await extrairDadosCertidao(certidaoBuffer);
    const dadosCompletos = { ...candidato, ...dadosCertidao };

    await supabase.from("candidatos_danieldecastro").update(dadosCertidao).eq("id", candidatoId);

    const templatePath = path.join(__dirname, "templates", "termo_temporario.docx");
    const termoDocx = preencherTermo(templatePath, dadosCompletos);
    const termoPdf = docxParaPdf(termoDocx, workDir);

    const fichaPdf = await gerarFichaPdf(dadosCompletos, fotoBuffer);

    const anexos = [];
    for (const buf of [documentoBuffer, certidaoBuffer]) {
      const isPdf = buf.slice(0, 4).toString() === "%PDF";
      if (isPdf) {
        anexos.push(buf);
      } else {
        const imgPdf = await PDFDocument.create();
        const page = imgPdf.addPage([595, 842]);
        const img = buf[0] === 0xff ? await imgPdf.embedJpg(buf) : await imgPdf.embedPng(buf);
        const scale = Math.min(500 / img.width, 750 / img.height);
        page.drawImage(img, { x: 50, y: 50, width: img.width * scale, height: img.height * scale });
        anexos.push(Buffer.from(await imgPdf.save()));
      }
    }

    const dossiePdf = await montarDossie(termoPdf, fichaPdf, anexos);

    const dossiePath = `${candidatoId}/dossie.pdf`;
    await supabase.storage.from("danieldecastro-docs").upload(dossiePath, dossiePdf, {
      contentType: "application/pdf",
      upsert: true,
    });

    const enviarEmail = () =>
      resend.emails.send({
        from: "Pastor Daniel de Castro <onboarding@resend.dev>",
        to: DOSSIE_EMAIL_TO,
        subject: `Novo cadastro: ${candidato.nome_completo}`,
        text: `Novo colaborador temporário cadastrado: ${candidato.nome_completo} (CPF ${candidato.cpf}). Dossiê completo em anexo.`,
        attachments: [{ filename: `dossie_${candidato.cpf}.pdf`, content: dossiePdf.toString("base64") }],
      });

    // Envia duas vezes (disparos independentes) para reduzir o risco de um envio
    // isolado cair em spam ou ser perdido — aumenta a chance de pelo menos um chegar.
    const [envio1, envio2] = await Promise.all([enviarEmail(), enviarEmail()]);

    const idsEnviados = [envio1, envio2]
      .filter((e) => !e.error && e.data?.id)
      .map((e) => e.data.id);

    if (idsEnviados.length === 0) {
      console.error(
        "Resend retornou erro nos dois disparos:",
        JSON.stringify(envio1.error),
        JSON.stringify(envio2.error)
      );
      await supabase
        .from("candidatos_danieldecastro")
        .update({ dossie_pdf_path: dossiePath })
        .eq("id", candidatoId);
      return res.status(502).json({
        ok: false,
        error: "Falha ao enviar e-mail nos dois disparos",
        detalhe: [envio1.error, envio2.error],
      });
    }

    console.log("E-mail enviado com sucesso via Resend. IDs:", idsEnviados.join(", "));

    await supabase
      .from("candidatos_danieldecastro")
      .update({ dossie_pdf_path: dossiePath, dossie_enviado_em: new Date().toISOString() })
      .eq("id", candidatoId);

    res.json({ ok: true, candidatoId, resendIds: idsEnviados });
  } catch (err) {
    console.error("Erro ao gerar dossiê:", err);
    res.status(500).json({ error: err.message });
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Worker do dossiê rodando na porta ${PORT}`));
