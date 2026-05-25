import "server-only";
import fs from "node:fs/promises";
import path from "node:path";

export type Modality = { name: string; description: string };

export type TeamBio = {
  slug: string;
  full_name: string;
  credentials_suffix: string | null;
  role: string | null;
  photo_url: string | null;
  hero_headline: string | null;
  hero_intro: string | null;
  bio_paragraphs: string[];
  qualifications: string[];
  education: string[];
  approach_headline: string | null;
  approach_intro: string | null;
  modalities: Modality[];
  who_i_help_headline: string | null;
  who_i_help: string[];
  philosophy_paragraphs: string[];
  personal_interests: string | null;
  cta_headline: string | null;
  cta_subtext: string | null;
};

const CONTENT_DIR = path.join(process.cwd(), "src", "content", "team");

export async function getAllTeamBioSlugs(): Promise<string[]> {
  try {
    const files = await fs.readdir(CONTENT_DIR);
    return files
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
  } catch {
    return [];
  }
}

export async function getTeamBio(slug: string): Promise<TeamBio | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null;
  const filePath = path.join(CONTENT_DIR, `${slug}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const data = JSON.parse(raw) as TeamBio;
    return data;
  } catch {
    return null;
  }
}
