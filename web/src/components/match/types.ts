// Shared types for the therapist-match feature. These mirror the gateway's
// snake_case JSON contract (CONTRACT.md) exactly — DO NOT camelCase any field
// that crosses the wire, or the bindings silently fail.

/** A single selectable option inside a quiz question. `icon` is an emoji. */
export type MatchOption = {
  value: string;
  label: string;
  desc?: string;
  icon?: string;
};

/** One quiz step. `in_person_only` steps are skipped unless modality is
 *  "in-person" (mirrors the FLOW_BASE buildFlow logic). */
export type MatchQuestion = {
  id: string; // "type" | "modality" | "location" | "insurance" (data-driven)
  question: string;
  sub?: string;
  in_person_only?: boolean;
  options: MatchOption[];
};

/** The admin-editable quiz definition returned by /v1/match/options. */
export type MatchConfig = {
  questions: MatchQuestion[];
  intro_eyebrow?: string;
  intro_title?: string;
  intro_sub?: string;
};

export type MatchOptionsResponse = {
  ok: boolean;
  config: MatchConfig;
};

/** The four non-PHI answers collected by the quiz. */
export type MatchAnswers = {
  type?: string;
  modality?: string;
  location?: string;
  insurance?: string;
};

/** A clinician record (public info). Shape per CONTRACT.md. */
export type Clinician = {
  slug: string;
  name: string;
  credentials: string;
  initials: string;
  types: string[];
  locations: string[];
  telehealth: boolean;
  specialties: string[];
  rate: string;
  in_network: boolean;
  staff_id: number;
  photo_url: string;
  active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
};

/** A matched clinician carries a human-readable reason from the Match() fn. */
export type MatchResult = Clinician & { match_reason?: string };

export type MatchTherapistsRequest = {
  channel?: "web" | "chat" | "voice";
  answers: MatchAnswers;
};

export type MatchTherapistsResponse = {
  ok: boolean;
  match_uuid: string;
  result_count: number;
  results: MatchResult[];
};

export type MatchPickedRequest = {
  match_uuid: string;
  picked_slug: string;
};

// ── Admin-only shapes ──────────────────────────────────────────────────────
export type ClinicianListResponse = { items: Clinician[]; total: number };

export type MatchConfigResponse = { config: MatchConfig };

export type MatchStats = {
  total: number;
  by_type: Record<string, number>;
  by_modality: Record<string, number>;
  by_location: Record<string, number>;
  by_insurance: Record<string, number>;
  no_result_count: number;
  pick_through_count: number;
  top_picked: { slug: string; count: number }[];
};
