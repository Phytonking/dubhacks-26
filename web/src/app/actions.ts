"use server";

import { ObjectId } from "mongodb";
import { revalidatePath } from "next/cache";
import { collections } from "@/lib/db";
import { getCurrentOrg } from "@/lib/queries";

export async function setConversationMode(formData: FormData) {
  const id = String(formData.get("id"));
  const mode = formData.get("mode") === "human" ? "human" : "agent";
  if (!ObjectId.isValid(id)) return;
  const org = await getCurrentOrg();
  const { conversations } = await collections();
  await conversations.updateOne({ _id: new ObjectId(id), orgId: org._id }, { $set: { mode } });
  revalidatePath("/inbox");
}

export async function saveAgentSettings(formData: FormData) {
  const org = await getCurrentOrg();
  const { orgs, agents } = await collections();
  const text = (k: string) => String(formData.get(k) ?? "").trim();
  const maxDiscount = Math.min(100, Math.max(0, Number(formData.get("maxDiscountPct")) || 0));

  await orgs.updateOne(
    { _id: org._id },
    { $set: { productDescription: text("productDescription"), brandVoice: text("brandVoice"), hours: text("hours") } },
  );
  await agents.updateOne(
    { orgId: org._id },
    {
      $set: {
        persona: text("persona"),
        "guardrails.maxDiscountPct": maxDiscount,
        "guardrails.escalateOn": text("escalateOn").split(",").map((s) => s.trim()).filter(Boolean),
        updatedAt: new Date(),
      },
    },
  );
  revalidatePath("/agent");
}
