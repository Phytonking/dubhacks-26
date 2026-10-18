"use server";

import { ObjectId } from "mongodb";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { revealField } from "@/lib/forms-core";
import { checkPassword, endOwnerSession, isOwner, startOwnerSession } from "@/lib/owner-gate";
import { getCurrentOrg } from "@/lib/queries";

export async function loginOwner(_p: { error?: string }, fd: FormData): Promise<{ error?: string }> {
  await new Promise((r) => setTimeout(r, 400));   // slow down password guessing
  if (!checkPassword(String(fd.get("password") ?? ""))) return { error: "Wrong password." };
  await startOwnerSession(); redirect("/forms");
}
export async function logoutOwner() { await endOwnerSession(); redirect("/forms/login"); }

export type Revealed = { value?: string; error?: string };
export async function reveal(submissionId: string, field: string, _p: Revealed): Promise<Revealed> {
  if (!(await isOwner())) return { error: "Not signed in." };
  const key = process.env.FORM_ENC_KEY; if (!key || !ObjectId.isValid(submissionId)) return { error: "Unavailable." };
  const org = await getCurrentOrg();
  try {
    const v = await revealField(await getDb(), { orgId: org._id, submissionId: new ObjectId(submissionId), field, userId: null, masterKey: key });   // writes the access log first
    return v === null ? { error: "Not found." } : { value: v };
  } catch { return { error: "Could not decrypt." }; }
}
