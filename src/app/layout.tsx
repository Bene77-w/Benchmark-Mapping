import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Benchmark-Mapping",
  description: "Lokaler Benchmark für das Mapping von Kongress-Units auf Industries",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de" className="h-full font-sans antialiased">
      <body className="flex min-h-full flex-col">
        <header className="border-b">
          <nav className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-3 text-sm">
            <Link href="/" className="font-semibold">
              Benchmark-Mapping
            </Link>
            <Link href="/snapshot" className="text-muted-foreground hover:text-foreground">
              Snapshot
            </Link>
            <Link href="/prompt" className="text-muted-foreground hover:text-foreground">
              Prompt
            </Link>
            <Link href="/laeufe" className="text-muted-foreground hover:text-foreground">
              Läufe
            </Link>
            <Link href="/modelle" className="text-muted-foreground hover:text-foreground">
              Modelle
            </Link>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
