// Secure-form templates. Pure data: imported by the web app (renders and validates) and by the agent (allow-list of what it may send).
// Rule enforced by tests: a field the agent may see (agentVisible) is never sensitive.
export type FieldType = "text" | "textarea" | "email" | "tel" | "date" | "select";
export type FormField = { key: string; label: string; type: FieldType; required: boolean; sensitive: boolean; agentVisible: boolean; options?: string[]; maxLength?: number };
export type FormTemplate = { key: string; title: string; intro: string; fields: FormField[]; expiryMinutes: number; stepUp: boolean };

const f = (key: string, label: string, type: FieldType, o: Partial<FormField> = {}): FormField =>
  ({ key, label, type, required: true, sensitive: false, agentVisible: false, maxLength: type === "textarea" ? 1000 : 200, ...o });

export const FORM_TEMPLATES: Record<string, FormTemplate> = {
  contact_details: {
    key: "contact_details", title: "Your contact details", expiryMinutes: 30, stepUp: false,
    intro: "Share how we can reach you. Only the business team can see what you enter here.",
    fields: [
      f("full_name", "Full name", "text", { agentVisible: true }),
      f("email", "Email address", "email", { sensitive: true }),
      f("mailing_address", "Mailing address", "textarea", { sensitive: true, required: false }),
      f("preferred_contact", "Best way to reach you", "select", { options: ["Text", "Phone call", "Email"], agentVisible: true }),
    ],
  },
  service_intake: {
    key: "service_intake", title: "Service request", expiryMinutes: 60, stepUp: false,
    intro: "Tell us what you need and when. We will confirm by message.",
    fields: [
      f("what", "What do you need?", "text", { agentVisible: true }),
      f("details", "Details", "textarea", { agentVisible: true, required: false }),
      f("preferred_day", "Preferred day", "select", { options: ["Weekday", "Saturday", "Any day"], agentVisible: true }),
      f("alt_phone", "Another phone number (optional)", "tel", { sensitive: true, required: false }),
    ],
  },
  callback_request: {
    key: "callback_request", title: "Request a call back", expiryMinutes: 120, stepUp: false,
    intro: "A person will call you. Tell us when works best.",
    fields: [
      f("topic", "What is it about?", "text", { agentVisible: true }),
      f("best_time", "Best time", "select", { options: ["Morning", "Afternoon", "Evening"], agentVisible: true }),
      f("phone", "Number to call", "tel", { sensitive: true }),
    ],
  },
};
export const FORM_KEYS = Object.keys(FORM_TEMPLATES);
