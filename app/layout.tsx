import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Energia Operativa",
  description: "Console operativa italiana per EE e GAS con dati autorizzati dal server.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="it" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}<small className="app-build" aria-label="Versione">Versione {(process.env.VERCEL_GIT_COMMIT_SHA ?? "locale").slice(0, 7)}</small></body>
    </html>
  );
}
