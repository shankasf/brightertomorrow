import { SITE_URL, SITE_NAME } from "@/lib/seo";

// ─────────────────────────────────────────────────────────────────────────────
// Structured data (JSON-LD) helpers.
//
// <JsonLd> renders a single <script type="application/ld+json"> with the JSON
// safely serialized. We escape "<" to "<" so a stray "</script>" or other
// markup inside a string value can never break out of the script context (the
// one real XSS vector for inline JSON-LD). React does NOT escape children of a
// raw <script>, so this manual escape is required.
//
// Server-only by design (no "use client") — JSON-LD is static markup that the
// crawler reads from the initial HTML; there is no reason to ship it to the
// client runtime.
// ─────────────────────────────────────────────────────────────────────────────

export function JsonLd({ data }: { data: object }) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}

// Resolve a /public path (or already-absolute URL) to an absolute URL against
// the runtime SITE_URL. Returns the input unchanged if it's already absolute.
export function absUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return `${SITE_URL}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
}

// ── Shared constants used across multiple graphs ─────────────────────────────

const TELEPHONE = "+17252386990";
const EMAIL = "admin@brightertomorrowtherapy.com";
const LOGO_PATH = "/brand/logo.png";

const SAME_AS = [
  "https://www.instagram.com/brightertomorrowlv",
  "https://www.facebook.com/Forabettertomorrowlv",
];

// Mo–Fr 09:00–20:00, Sa–Su 10:00–16:00.
const OPENING_HOURS = [
  {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
    opens: "09:00",
    closes: "20:00",
  },
  {
    "@type": "OpeningHoursSpecification",
    dayOfWeek: ["Saturday", "Sunday"],
    opens: "10:00",
    closes: "16:00",
  },
];

/**
 * Homepage @graph: the practice (MedicalBusiness + LocalBusiness, additionalType
 * MentalHealthBusiness) as the parent Organization, with each physical office
 * modeled as a MedicalClinic `department`. The Durango office carries verified
 * geo coordinates from the old site's maps link; the Russell Rd office has no
 * verified coordinates anywhere in our data, so we intentionally omit its geo
 * rather than invent one. Also emits the WebSite node.
 */
export function homepageGraph(): object {
  const orgId = `${SITE_URL}/#organization`;

  const russellAddress = {
    "@type": "PostalAddress",
    streetAddress: "3430 E Russell Rd Ste 315",
    addressLocality: "Las Vegas",
    addressRegion: "NV",
    postalCode: "89120",
    addressCountry: "US",
  };

  const durangoAddress = {
    "@type": "PostalAddress",
    streetAddress: "6955 N Durango Dr Unit 1004",
    addressLocality: "Las Vegas",
    addressRegion: "NV",
    postalCode: "89149",
    addressCountry: "US",
  };

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": ["MedicalBusiness", "LocalBusiness"],
        "@id": orgId,
        additionalType: "https://schema.org/MentalHealthBusiness",
        name: SITE_NAME,
        url: SITE_URL,
        telephone: TELEPHONE,
        email: EMAIL,
        logo: absUrl(LOGO_PATH),
        image: absUrl(LOGO_PATH),
        priceRange: "$$",
        address: [russellAddress, durangoAddress],
        sameAs: SAME_AS,
        openingHoursSpecification: OPENING_HOURS,
        department: [
          {
            "@type": "MedicalClinic",
            name: `${SITE_NAME} — East Russell Road`,
            telephone: TELEPHONE,
            email: EMAIL,
            parentOrganization: { "@id": orgId },
            address: russellAddress,
            openingHoursSpecification: OPENING_HOURS,
            // No verified geo for this office — intentionally omitted.
          },
          {
            "@type": "MedicalClinic",
            name: `${SITE_NAME} — North Durango Drive`,
            telephone: TELEPHONE,
            email: EMAIL,
            parentOrganization: { "@id": orgId },
            address: durangoAddress,
            geo: {
              "@type": "GeoCoordinates",
              latitude: 36.2870309,
              longitude: -115.2891405,
            },
            openingHoursSpecification: OPENING_HOURS,
          },
        ],
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: SITE_NAME,
        url: SITE_URL,
        publisher: { "@id": orgId },
      },
    ],
  };
}

/** Reference to the org node, for linking Person.worksFor etc. */
export function orgRef(): object {
  return {
    "@type": "Organization",
    "@id": `${SITE_URL}/#organization`,
    name: SITE_NAME,
    url: SITE_URL,
  };
}

/** Person node for a therapist bio page. */
export function therapistPerson(input: {
  slug: string;
  name: string;
  jobTitle?: string | null;
  image?: string | null;
}): object {
  const url = `${SITE_URL}/team/${input.slug}`;
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": `${url}#person`,
    name: input.name,
    ...(input.jobTitle ? { jobTitle: input.jobTitle } : {}),
    ...(input.image ? { image: absUrl(input.image) } : {}),
    url,
    worksFor: orgRef(),
  };
}

/** Home > Team > <Name> breadcrumb for a therapist bio page. */
export function therapistBreadcrumb(input: { slug: string; name: string }): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Our Team", item: `${SITE_URL}/team` },
      {
        "@type": "ListItem",
        position: 3,
        name: input.name,
        item: `${SITE_URL}/team/${input.slug}`,
      },
    ],
  };
}
