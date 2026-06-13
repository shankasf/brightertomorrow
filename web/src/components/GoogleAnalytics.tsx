"use client";

import Script from "next/script";

// Hardened GA4 tag for a HIPAA-covered site. We load gtag.js but configure it
// to minimize identifiability:
//   • Google Signals OFF        — no cross-device/demographics join
//   • ad personalization OFF    — no advertising use of the data
//   • consent mode denies ad storage by default
// IP is truncated by GA4 server-side automatically (not configurable/needed).
//
// IMPORTANT (set in the GA4 UI, not here): in Admin → Data Streams → Enhanced
// Measurement, turn OFF "Form interactions". The chat widget, insurance/coverage
// modal, and booking flow are real <form>s; with that toggle on, GA would log
// form_start/form_submit on PHI-collecting forms. Field values are never sent,
// but the interaction itself should not be tracked on a health site.
//
// The component is only rendered by the layout when a Measurement ID is present
// AND we're on the canonical production host, so previews/admin never load it.
export default function GoogleAnalytics({ measurementId }: { measurementId: string }) {
  if (!measurementId) return null;

  return (
    <>
      <Script
        id="ga4-src"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
          gtag('consent', 'default', {
            ad_storage: 'denied',
            ad_user_data: 'denied',
            ad_personalization: 'denied'
          });
          gtag('config', '${measurementId}', {
            anonymize_ip: true,
            allow_google_signals: false,
            allow_ad_personalization_signals: false
          });
        `}
      </Script>
    </>
  );
}
