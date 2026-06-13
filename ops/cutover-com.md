# brightertomorrowtherapy.com cutover runbook (2026-06-12)

Pre-state: .cloud live (noindexed via SITE_URL env), .com on WordPress/Hostinger.
Cluster: 2.24.200.155. Ingress already has .com hosts; cert `bt-com-tls` pending DNS.

## Blocker to resolve first
The Hostinger API token in `bt-config` does NOT own the .com domain
(`[DNS:4002] Customer does not own brightertomorrowtherapy.com`). Get an API
token from the Hostinger account that registered the .com, or do step 2 in that
account's DNS panel manually.

## T-0 sequence
1. Confirm web deploy is the final image (`ops/deploy-changed.sh` already run).
2. DNS flip — change ONLY these records (apex A TTL is already 60s):
   - `@`   A     -> 2.24.200.155
   - `www` (replace CNAME www.brightertomorrowtherapy.com.cdn.hstgr.net) -> A 2.24.200.155
   - `admin` -> A 2.24.200.155 (new record)
   - DO NOT TOUCH: MX (Google Workspace), TXT/SPF (`include:_spf.google.com include:sendgrid.net include:_spf.paubox.com`), `_dmarc`, NS.
   API call (PUT, overwrite:true) prepared in agent report / k8s/41 comments.
3. Watch cert: `kubectl -n bt get certificate bt-com-tls -w` → READY=True (~2 min).
4. Flip env in k8s/30-web.yaml and apply + rollout:
   - SITE_URL=https://brightertomorrowtherapy.com
   - ADMIN_HOST_URL=https://admin.brightertomorrowtherapy.com
5. Verify on .com: run `ops/verify-seo.sh https://brightertomorrowtherapy.com production`
   (29-check suite: robots allow + sitemap line, sitemap 233 URLs on .com hostnames,
   NO noindex, canonicals, titles, legacy redirects, blog rendering, JSON-LD, real 404s).
6. Apply k8s/41-cloud-to-com-redirect.yaml → .cloud + www.cloud 301 to .com. Keep for months.
   (admin.cloud can keep working or redirect too — decide; ADMIN_HOST_URL now points at .com.)
7. WordPress hosting on Hostinger can be removed AFTER confirming .com serves from cluster
   (remember: email is Google Workspace via MX, unaffected; SendGrid/Paubox SPF preserved).
8. User action: Google Search Console (.com property) → submit https://brightertomorrowtherapy.com/sitemap.xml.
   Monitor coverage/404s for 4–8 weeks.

## Accepted losses (deliberate)
- /wp-content/uploads/* image URLs 404 (no mapping; image-search traffic negligible).
- 485 /tag/* archives 301 to /blog (thin content consolidation).
