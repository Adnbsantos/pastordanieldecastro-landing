import "./globals.css";

export const metadata = {
  title: "Pastor Daniel de Castro — Cadastro de Colaborador Temporário",
  description: "Cadastro de colaboradores temporários da campanha do Pastor Daniel de Castro",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
