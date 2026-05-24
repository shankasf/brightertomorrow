// Kebab-case slug from a therapist's display name.
// Strips "Dr. " prefix and any punctuation so the slug matches the URL
// scheme used on brightertomorrowtherapy.com (e.g. "/tony-martinez/").
export function therapistSlug(fullName: string): string {
  return fullName
    .toLowerCase()
    .replace(/^dr\.\s+/i, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .split(/\s+/)
    .join("-");
}
