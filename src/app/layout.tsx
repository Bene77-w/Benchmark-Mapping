import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { MainNav, NavLinks } from "@/components/main-nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Benchmark-Mapping",
  description: "Lokaler Benchmark für das Mapping von Kongress-Units auf Industries",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="de" className="h-full font-sans antialiased">
      <body className="flex min-h-full flex-col">
        <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <div className="mx-auto flex max-w-6xl items-center gap-6 px-6 py-2.5">
            <Link href="/" className="flex shrink-0 items-center gap-2 font-semibold tracking-tight">
              <span
                aria-hidden
                className="grid size-7 place-items-center rounded-lg bg-primary text-xs font-bold text-primary-foreground"
              >
                BM
              </span>
              Benchmark-Mapping
            </Link>
            <Suspense fallback={<NavLinks pathname={null} />}>
              <MainNav />
            </Suspense>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
