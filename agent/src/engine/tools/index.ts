import type { Tool } from "../types";
import { consent_record, contact_update_stage, handoff_escalate, knowledge_search, memory_commit, memory_remember, owner_notify, text_send_info } from "./core";
import { forms_send_secure_form, forms_status } from "./forms";
import { contact_options } from "./reach";
import { customer_profile_update } from "./intake";
import { tmo_context } from "./tmo";
import { tmo_catalog } from "./tmo-catalog";
import { verify_check_code, verify_send_code } from "./verify";

export const ALL_TOOLS: Tool[] = [
  knowledge_search, memory_remember, memory_commit, contact_update_stage, consent_record, owner_notify, handoff_escalate,
  text_send_info, verify_send_code, verify_check_code, forms_send_secure_form, forms_status, contact_options, tmo_context, tmo_catalog, customer_profile_update,
];
const NAME = /^[a-zA-Z0-9_-]{1,64}$/;
export function validateRegistry(tools: Tool[]): void {
  const seen = new Set<string>();
  for (const t of tools) {
    if (!NAME.test(t.name)) throw new Error(`tool name "${t.name}" is not a valid function name (letters, digits, _ and - only)`);
    if (seen.has(t.name)) throw new Error(`duplicate tool "${t.name}"`);
    seen.add(t.name);
  }
}
validateRegistry(ALL_TOOLS);
export const toolByName = (tools: Tool[], name: string) => tools.find((t) => t.name === name);
