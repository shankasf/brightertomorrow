import { q } from "./db";

export type SiteSettings = {
  brand_name: string;
  tagline: string | null;
  primary_phone: string | null;
  primary_email: string | null;
  primary_color: string;
  text_color: string;
  muted_color: string;
  surface_color: string;
  logo_url: string | null;
  hero_image_url: string | null;
  hero_images: string[];
  business_hours: Record<string, string>;
  social: Record<string, string>;
};

export type NavItem = {
  id: number;
  parent_id: number | null;
  label: string;
  href: string;
  position: number;
  location: "header" | "footer";
  children?: NavItem[];
};

export type Service = {
  id: number; slug: string; title: string;
  short_desc: string | null; long_desc: string | null;
  image_url: string | null; position: number;
};

export type Specialty = {
  id: number; slug: string; title: string;
  short_desc: string | null; long_desc: string | null;
  image_url: string | null; inline_image_url: string | null;
  subheadline: string | null; position: number;
};

export type TeamGroup = { id: number; slug: string; title: string; description: string | null; position: number };
export type TeamMember = {
  id: number; group_id: number | null; full_name: string;
  credentials: string | null; role: string | null; bio: string | null;
  photo_url: string | null;
  office_locations: string[];
  pricing_tier: string | null;
  network_status: string | null;
  specialties: string[];
};

export type Testimonial = { id: number; author: string; quote: string; rating: number | null; position: number };
export type Faq = { id: number; question: string; answer: string; category: string | null; position: number };
export type Stat = { id: number; label: string; value: string; suffix: string | null; position: number };

export type BlogPost = {
  id: number; slug: string; title: string; excerpt: string | null;
  body_md: string | null; cover_url: string | null; author: string | null;
  published_at: string;
};

export type Location = {
  id: number; name: string; address1: string | null; city: string | null;
  state: string | null; postal_code: string | null; phone: string | null;
  is_telehealth: boolean;
};

export async function getSiteSettings(): Promise<SiteSettings> {
  const { rows } = await q<SiteSettings>(`SELECT brand_name, tagline, primary_phone, primary_email,
      primary_color, text_color, muted_color, surface_color, logo_url, hero_image_url,
      COALESCE(hero_images, '[]'::jsonb) AS hero_images,
      business_hours, social FROM bt.site_settings WHERE id = 1`);
  return rows[0];
}

export async function getNav(location: "header" | "footer" = "header"): Promise<NavItem[]> {
  const { rows } = await q<NavItem>(
    `SELECT id, parent_id, label, href, position, location FROM bt.nav_items
     WHERE location = $1 ORDER BY position`, [location]);
  const byParent = new Map<number | null, NavItem[]>();
  for (const r of rows) {
    const arr = byParent.get(r.parent_id) ?? [];
    arr.push({ ...r });
    byParent.set(r.parent_id, arr);
  }
  const top = byParent.get(null) ?? [];
  for (const t of top) t.children = byParent.get(t.id) ?? [];
  return top;
}

export async function getServices(limit?: number): Promise<Service[]> {
  const { rows } = await q<Service>(
    `SELECT id, slug, title, short_desc, long_desc, image_url, position
     FROM bt.services WHERE published ORDER BY position ${limit ? "LIMIT $1" : ""}`,
    limit ? [limit] : undefined);
  return rows;
}
export async function getServiceBySlug(slug: string): Promise<Service | null> {
  const { rows } = await q<Service>(
    `SELECT id, slug, title, short_desc, long_desc, image_url, position
     FROM bt.services WHERE slug = $1 AND published`, [slug]);
  return rows[0] ?? null;
}

export async function getSpecialties(): Promise<Specialty[]> {
  const { rows } = await q<Specialty>(
    `SELECT id, slug, title, short_desc, long_desc, image_url, inline_image_url, subheadline, position
     FROM bt.specialties WHERE published ORDER BY position`);
  return rows;
}
export async function getSpecialtyBySlug(slug: string): Promise<Specialty | null> {
  const { rows } = await q<Specialty>(
    `SELECT id, slug, title, short_desc, long_desc, image_url, inline_image_url, subheadline, position
     FROM bt.specialties WHERE slug = $1 AND published`, [slug]);
  return rows[0] ?? null;
}

export async function getTeamGroups(): Promise<TeamGroup[]> {
  const { rows } = await q<TeamGroup>(
    `SELECT id, slug, title, description, position FROM bt.team_groups ORDER BY position`);
  return rows;
}
export async function getTeamMembers(): Promise<TeamMember[]> {
  const { rows } = await q<TeamMember>(
    `SELECT id, group_id, full_name, credentials, role, bio, photo_url,
            office_locations, pricing_tier, network_status, specialties
     FROM bt.team_members WHERE published ORDER BY position`);
  return rows;
}

export async function getTestimonials(): Promise<Testimonial[]> {
  const { rows } = await q<Testimonial>(
    `SELECT id, author, quote, rating, position FROM bt.testimonials
     WHERE published ORDER BY position`);
  return rows;
}

export async function getFaqs(): Promise<Faq[]> {
  const { rows } = await q<Faq>(
    `SELECT id, question, answer, category, position FROM bt.faqs
     WHERE published ORDER BY position`);
  return rows;
}

export async function getStats(): Promise<Stat[]> {
  const { rows } = await q<Stat>(
    `SELECT id, label, value::text, suffix, position FROM bt.stats ORDER BY position`);
  return rows;
}

export async function getBlogPosts(limit?: number): Promise<BlogPost[]> {
  const { rows } = await q<BlogPost>(
    `SELECT id, slug, title, excerpt, body_md, cover_url, author,
            to_char(published_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS published_at
     FROM bt.blog_posts WHERE published ORDER BY published_at DESC
     ${limit ? "LIMIT $1" : ""}`, limit ? [limit] : undefined);
  return rows;
}
export async function getBlogBySlug(slug: string): Promise<BlogPost | null> {
  const { rows } = await q<BlogPost>(
    `SELECT id, slug, title, excerpt, body_md, cover_url, author,
            to_char(published_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS published_at
     FROM bt.blog_posts WHERE slug = $1 AND published`, [slug]);
  return rows[0] ?? null;
}

export type PressMention = { id: number; outlet: string; title: string | null; url: string; logo_url: string | null; position: number };
export type Podcast = { show_name: string; host: string | null; tagline: string | null; listen_url: string | null; cover_url: string | null };
export type FreeResource = { id: number; kind: string; title: string; description: string | null; image_url: string | null; cta_label: string | null; cta_url: string | null; position: number };

export async function getPressMentions(): Promise<PressMention[]> {
  const { rows } = await q<PressMention>(
    `SELECT id, outlet, title, url, logo_url, position FROM bt.press_mentions
     WHERE published ORDER BY position`);
  return rows;
}
export async function getPodcast(): Promise<Podcast | null> {
  const { rows } = await q<Podcast>(
    `SELECT show_name, host, tagline, listen_url, cover_url FROM bt.podcast WHERE id = 1`);
  return rows[0] ?? null;
}
export async function getFreeResources(): Promise<FreeResource[]> {
  const { rows } = await q<FreeResource>(
    `SELECT id, kind, title, description, image_url, cta_label, cta_url, position
     FROM bt.free_resources WHERE published ORDER BY position`);
  return rows;
}

export async function getLocations(): Promise<Location[]> {
  const { rows } = await q<Location>(
    `SELECT id, name, address1, city, state, postal_code, phone, is_telehealth
     FROM bt.locations ORDER BY position`);
  return rows;
}
