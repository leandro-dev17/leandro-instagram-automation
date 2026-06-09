import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Receitinhas da Vovó Teresinha",
  description: "Centenas de receitas gostosas com o carinho de uma avó amorosa! 💕",
  manifest: "/manifest.json",
  icons: { icon: "/selo-vovo.png", apple: "/selo-vovo.png" },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Receitinhas da Vovó",
  },
  openGraph: {
    type: "website",
    url: "https://receitinhas-vovo-teresinha.vercel.app",
    title: "Receitinhas da Vovó Teresinha",
    description: "Centenas de receitas gostosas com o carinho de uma avó amorosa! 💕",
    siteName: "Receitinhas da Vovó Teresinha",
    images: [
      {
        url: "https://receitinhas-vovo-teresinha.vercel.app/selo-vovo.png",
        width: 400,
        height: 400,
        alt: "Receitinhas da Vovó Teresinha",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Receitinhas da Vovó Teresinha",
    description: "Centenas de receitas gostosas com o carinho de uma avó amorosa! 💕",
  },
};

export const viewport: Viewport = {
  themeColor: "#C8806A",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR" className="h-full">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `if ('serviceWorker' in navigator) { window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {})); }`,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);})(window,document,"clarity","script","wp6s8omcqp");`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col antialiased">{children}</body>
    </html>
  );
}
