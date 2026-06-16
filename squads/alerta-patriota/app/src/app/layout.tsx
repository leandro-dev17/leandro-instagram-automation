import type { Metadata } from "next";
import { Bebas_Neue, Inter } from "next/font/google";
import "./globals.css";

const bebasNeue = Bebas_Neue({
  weight: "400",
  subsets: ["latin"],
  display: "swap",
  variable: "--font-bebas",
});

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Alerta Patriota — O que realmente está acontecendo no Brasil",
  description: "Receba as notícias que a mídia esconde. Sem filtro, sem censura. Grupo exclusivo no WhatsApp com curadoria diária do Capitão Braga.",
  manifest: "/manifest.json",
  themeColor: "#1a1a2e",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" className={`${bebasNeue.variable} ${inter.variable}`}>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body className="min-h-screen bg-[#1a1a2e] text-white antialiased">
        {children}
      </body>
    </html>
  );
}
