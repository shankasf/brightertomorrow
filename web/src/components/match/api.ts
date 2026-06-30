// Single source of truth for the match feature's network calls + flow logic.
// Both /get-scheduled and the chat widget consume these — no duplicated filter
// or fetch logic anywhere else (DRY / SRP).

import type {
  Clinician,
  MatchAnswers,
  MatchConfig,
  MatchOptionsResponse,
  MatchPickedRequest,
  MatchQuestion,
  MatchTherapistsRequest,
  MatchTherapistsResponse,
} from "./types";

// Built-in fallback so the quiz never hard-fails if the gateway's
// /v1/match/options is unreachable or still being seeded. Mirrors the gateway's
// DEFAULT_CONFIG (the FLOW_BASE ported from therapist-match.html).
export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  intro_eyebrow: "Find your therapist",
  intro_title: "Let's find the right fit for you.",
  intro_sub: "Answer a few quick questions and we'll match you with clinicians who fit your needs.",
  questions: [
    {
      id: "type",
      question: "What type of support are you looking for?",
      sub: "Choose the option that best fits your needs.",
      options: [
        { value: "therapy", label: "Therapy", desc: "Individual sessions for adults 18+", icon: "🧠" },
        { value: "teen", label: "Teen therapy", desc: "Support for ages 13–17", icon: "🌱" },
        { value: "child", label: "Child therapy", desc: "Specialized care for ages 3–12", icon: "🎨" },
        { value: "couples", label: "Couples therapy", desc: "For partners navigating challenges together", icon: "💬" },
        { value: "reiki", label: "Reiki energy healing", desc: "Holistic mind-body wellness sessions", icon: "✨" },
      ],
    },
    {
      id: "modality",
      question: "How would you like to meet with your therapist?",
      sub: "Both options are available across Nevada.",
      options: [
        { value: "telehealth", label: "Telehealth", desc: "Secure video sessions from anywhere in Nevada", icon: "💻" },
        { value: "in-person", label: "In person", desc: "Visit one of our two Las Vegas locations", icon: "🏢" },
        { value: "either", label: "Either works for me", desc: "I'm flexible on format", icon: "🔄" },
      ],
    },
    {
      id: "location",
      question: "Which location works best for you?",
      sub: "Both locations offer the same high-quality care.",
      in_person_only: true,
      options: [
        { value: "e-russell", label: "E Russell Rd", desc: "3430 E Russell Rd, Ste 315 — Las Vegas, NV 89120", icon: "📍" },
        { value: "n-durango", label: "N Durango Dr", desc: "6955 N Durango Dr, Unit 1004 — Las Vegas, NV 89149", icon: "📍" },
      ],
    },
    {
      id: "insurance",
      question: "Do you have a preference on insurance?",
      sub: "This helps us match you with the right clinician.",
      options: [
        { value: "in-network", label: "I want to use insurance", desc: "Most major plans accepted", icon: "🪪" },
        { value: "private-pay", label: "I'll pay out of pocket", desc: "Reduced rates available", icon: "💳" },
        { value: "no-pref", label: "No preference", desc: "Show me all available therapists", icon: "👐" },
      ],
    },
  ],
};

/**
 * Ordered list of questions to actually show for the given answers. `in_person_only`
 * steps appear only when modality === "in-person" (the buildFlow rule from the
 * reference HTML). Single source — both the stepper and the inline chat quiz use it.
 */
export function buildFlow(config: MatchConfig, answers: MatchAnswers): MatchQuestion[] {
  return config.questions.filter((q) => {
    if (q.in_person_only) return answers.modality === "in-person";
    return true;
  });
}

/** Look up an option's display label by question id + value (for summaries). */
export function labelFor(config: MatchConfig, qid: string, value: string | undefined): string {
  if (!value) return "";
  const q = config.questions.find((x) => x.id === qid);
  return q?.options.find((o) => o.value === value)?.label ?? value;
}

/** A short human-readable recap of the answers, e.g. for posting back into chat. */
export function summarizeAnswers(config: MatchConfig, answers: MatchAnswers): string {
  const parts: string[] = [];
  if (answers.type) parts.push(`Type: ${labelFor(config, "type", answers.type)}`);
  if (answers.modality) parts.push(`Format: ${labelFor(config, "modality", answers.modality)}`);
  if (answers.location) parts.push(`Location: ${labelFor(config, "location", answers.location)}`);
  if (answers.insurance) parts.push(`Insurance: ${labelFor(config, "insurance", answers.insurance)}`);
  return parts.join(" · ");
}

/**
 * Resolve which booking link to send a visitor to after they pick a clinician.
 *
 * The admin manages two links per clinician (virtual / in-person). We pick by
 * the visitor's chosen format, fall back to the clinician's other link if one
 * is blank, and finally to the practice-wide Jane URL — so a provider with no
 * links set (or who hasn't been mapped yet) still books cleanly, and a leaver's
 * stale links simply vanish with their archived record.
 *   - modality "telehealth"      → virtual, else in-person, else fallback
 *   - modality "in-person"       → in-person, else virtual, else fallback
 *   - "either" / unset           → in-person, else virtual, else fallback
 */
export function resolveBookingUrl(
  clinician: Pick<Clinician, "booking_url_virtual" | "booking_url_in_person"> | null | undefined,
  modality: string | undefined,
  fallback: string,
): string {
  const virtual = clinician?.booking_url_virtual?.trim() || "";
  const inPerson = clinician?.booking_url_in_person?.trim() || "";
  if (modality === "telehealth") return virtual || inPerson || fallback;
  // "in-person", "either", or unset all prefer the in-person link first.
  return inPerson || virtual || fallback;
}

/** Prettify a location slug ("e-russell" → "E Russell") for card subtitles. */
export function prettyLocation(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ── Public network calls (same-origin; routed to the gateway by the cluster) ──

export async function fetchMatchOptions(signal?: AbortSignal): Promise<MatchConfig> {
  const r = await fetch("/v1/match/options", { signal });
  if (!r.ok) throw new Error(`match options failed: ${r.status}`);
  const data = (await r.json()) as MatchOptionsResponse;
  if (!data?.config?.questions?.length) throw new Error("empty match config");
  return data.config;
}

export async function postMatchTherapists(
  req: MatchTherapistsRequest,
): Promise<MatchTherapistsResponse> {
  const r = await fetch("/v1/match/therapists", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(req),
  });
  if (!r.ok) throw new Error(`match therapists failed: ${r.status}`);
  return (await r.json()) as MatchTherapistsResponse;
}

/** Fire-and-forget pick-through ping — never blocks the UI or surfaces errors. */
export function postMatchPicked(req: MatchPickedRequest): void {
  if (!req.match_uuid || !req.picked_slug) return;
  try {
    void fetch("/v1/match/picked", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(req),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // best-effort analytics only
  }
}
