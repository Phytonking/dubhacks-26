"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  const active = usePathname().startsWith(href);
  return (
    <Link
      href={href}
      className={`rounded-md px-3 py-1.5 text-sm ${
        active ? "bg-emerald-50 text-emerald-900 font-medium" : "text-stone-600 hover:bg-stone-100"
      }`}
    >
      {children}
    </Link>
  );
}
