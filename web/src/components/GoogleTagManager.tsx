"use client";

import Script from "next/script";

// Google Tag Manager for the public, canonical production host only — never on
// /admin and never on preview hosts (gated in layout.tsx, same as GA4).
//
// HIPAA note: GTM is a *container* that can fire arbitrary downstream tags, so
// whatever is configured in the GTM UI must follow the same rules as our
// hardened GA4 tag — no PHI, no form-interaction tracking on the chat widget /
// insurance / booking forms, no ad personalization. Keep the container clean.
//
// The <head> loader and the <noscript> iframe are the two standard GTM snippets;
// the loader runs afterInteractive so it never blocks first paint.
export default function GoogleTagManager({ containerId }: { containerId: string }) {
  if (!containerId) return null;

  return (
    <>
      <Script id="gtm-init" strategy="afterInteractive">
        {`
          (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
          new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
          j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
          'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
          })(window,document,'script','dataLayer','${containerId}');
        `}
      </Script>
    </>
  );
}

// Standard GTM <noscript> fallback. Rendered as the first child of <body> so it
// sits immediately after the opening tag, per Google's install instructions.
export function GoogleTagManagerNoscript({ containerId }: { containerId: string }) {
  if (!containerId) return null;

  return (
    <noscript>
      <iframe
        src={`https://www.googletagmanager.com/ns.html?id=${containerId}`}
        height="0"
        width="0"
        style={{ display: "none", visibility: "hidden" }}
      />
    </noscript>
  );
}
