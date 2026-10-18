import { Suspense } from "react";
import { Sidebar } from "@/components/sidebar";

export default function ConsoleLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <Suspense fallback={<aside className="w-56 shrink-0 border-r border-stone-200" />}>
        <Sidebar />
      </Suspense>
      <main className="flex-1 min-w-0 p-8">{children}</main>
    </>
  );
}
