import { connection } from "next/server";
import { getCurrentOrg } from "@/lib/queries";
import { NavLink } from "./nav-link";

const links = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/inbox", label: "Inbox" },
  { href: "/contacts", label: "Contacts" },
  { href: "/agent", label: "Agent" },
];

export async function Sidebar() {
  await connection();
  const org = await getCurrentOrg();
  return (
    <aside className="w-56 shrink-0 border-r border-stone-200 bg-white p-5 flex flex-col gap-6">
      <div>
        <div className="text-xs uppercase tracking-wide text-stone-500">Business</div>
        <div className="font-semibold">{org.name}</div>
      </div>
      <nav className="flex flex-col gap-1">
        {links.map((l) => (
          <NavLink key={l.href} href={l.href}>
            {l.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}
