#!/bin/bash
# SEO verification suite. Usage: ./verify_seo.sh https://brightertomorrowtherapy.cloud preview
#                            or: ./verify_seo.sh https://brightertomorrowtherapy.com  production
HOST="$1"; MODE="$2"; UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36"
pass=0; fail=0
chk() { local desc="$1" got="$2" want="$3"
  if [[ "$got" == *"$want"* ]]; then echo "PASS: $desc"; pass=$((pass+1));
  else echo "FAIL: $desc — wanted [$want] got [$got]"; fail=$((fail+1)); fi }

# 1. robots.txt
R=$(curl -s -A "$UA" "$HOST/robots.txt")
if [ "$MODE" = "production" ]; then
  chk "robots allows crawl" "$R" "Disallow: /admin"
  chk "robots sitemap line" "$R" "Sitemap: $HOST/sitemap.xml"
else
  chk "robots disallows all (preview)" "$R" "Disallow: /"
fi

# 2. sitemap
S=$(curl -s -A "$UA" "$HOST/sitemap.xml"); N=$(grep -o "<loc>" <<<"$S" | wc -l)
echo "INFO: sitemap entries: $N"
[ "$N" -ge 200 ] && { echo "PASS: sitemap >=200 entries"; pass=$((pass+1)); } || { echo "FAIL: sitemap only $N"; fail=$((fail+1)); }
chk "sitemap hostnames" "$S" "<loc>$HOST/"

# 3. homepage meta
H=$(curl -s -A "$UA" "$HOST/")
if [ "$MODE" = "production" ]; then
  if grep -q 'name="robots" content="noindex' <<<"$H"; then echo "FAIL: homepage noindexed in production!"; fail=$((fail+1)); else echo "PASS: homepage indexable"; pass=$((pass+1)); fi
else
  chk "homepage noindex (preview)" "$H" 'noindex'
fi
chk "homepage canonical" "$H" "rel=\"canonical\" href=\"$HOST"
chk "homepage og:title" "$H" 'property="og:title"'
chk "homepage JSON-LD MedicalBusiness" "$H" 'MedicalBusiness'
chk "homepage local title" "$H" "<title>Therapy in Las Vegas"

# 4. per-page titles
for p in "/services/individual-therapy|Individual Therapy in Las Vegas" "/specialties/grief-counseling|Grief Counseling in Las Vegas" "/fees-insurance|Fees"; do
  path="${p%%|*}"; want="${p##*|}"
  T=$(curl -s -A "$UA" "$HOST$path" | grep -o "<title>[^<]*" | head -1)
  chk "title $path" "$T" "$want"
done

# 5. legacy redirects (single-host)
for r in "/couples-counseling/|/services/couples-counseling" "/lorenthia-clayton/|/team/lorenthia-clayton" "/tag/anxiety/|/blog" "/e-russell-team/|/team" "/our-story/|/story"; do
  src="${r%%|*}"; dst="${r##*|}"
  F=$(curl -sL -o /dev/null -A "$UA" -w "%{url_effective} %{http_code}" "$HOST$src")
  chk "redirect $src" "$F" "$dst 200"
done

# 6. blog rendering
B=$(curl -s -A "$UA" "$HOST/blog/the-journey-to-self-discovery-how-individual-therapy-can-help")
H3=$(grep -o "<h3" <<<"$B" | wc -l); echo "INFO: blog h3 count: $H3"
[ "$H3" -gt 0 ] && { echo "PASS: blog H3s render"; pass=$((pass+1)); } || { echo "FAIL: no H3s"; fail=$((fail+1)); }
if grep -q '### ' <<<"$B"; then echo "FAIL: literal ### in blog"; fail=$((fail+1)); else echo "PASS: no literal ###"; pass=$((pass+1)); fi
if grep -qE '\[[A-Za-z ]+\]\(http' <<<"$B"; then echo "FAIL: literal [text](url) in blog"; fail=$((fail+1)); else echo "PASS: no literal markdown links"; pass=$((pass+1)); fi
chk "blog BlogPosting JSON-LD" "$B" 'BlogPosting'
chk "blog og:type article" "$B" 'property="og:type" content="article"'

# 7. team page metadata + person schema
TM=$(curl -s -A "$UA" "$HOST/team/lorenthia-clayton")
chk "team person JSON-LD" "$TM" '"Person"'
chk "team canonical" "$TM" "canonical"

# 8. 404 behavior
C=$(curl -s -o /dev/null -A "$UA" -w "%{http_code}" "$HOST/this-does-not-exist-xyz")
chk "garbage URL is 404" "$C" "404"
for p in /team/no-such-person /services/zzz-unknown /specialties/zzz-unknown /category/zzz-unknown /blog/zzz-unknown; do
  C2=$(curl -s -o /dev/null -A "$UA" -w "%{http_code}" "$HOST$p")
  chk "unknown slug 404: $p" "$C2" "404"
done

echo "=============================="
echo "RESULT: $pass passed, $fail failed"
