import { permanentRedirect } from "next/navigation";

// The therapist-match quiz now lives in-house at /get-scheduled (quiz → matched
// clinicians → insurance → booking), replacing the old JotForm questionnaire.
// 308-redirect this legacy URL so any inbound links / SEO equity carry over.
export default function TherapistsMatchQuizPage() {
  permanentRedirect("/get-scheduled");
}
