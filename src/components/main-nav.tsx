"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/snapshot", label: "Snapshot" },
  { href: "/prompt", label: "Prompt" },
  { href: "/laeufe", label: "Läufe" },
  { href: "/auswertung", label: "Auswertung" },
  { href: "/gold", label: "Gold" },
  { href: "/modelle", label: "Modelle" },
] as const;

/** Aktive Navigation; braucht `<Suspense>` (cacheComponents), Fallback ist `NavLinks` ohne Markierung. */
export function MainNav() {
  return <NavLinks pathname={usePathname()} />;
}

export function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <nav className="flex items-center gap-1 overflow-x-auto text-sm">
      {ITEMS.map((item) => {
        const active = pathname !== null && (pathname === item.href || pathname.startsWith(`${item.href}/`));
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 font-medium transition-colors",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
