"use client";

import Script from "next/script";

/**
 * AccessibilityWidget
 * --------------------
 * Loads the UserWay accessibility widget. UserWay renders its own
 * floating button + panel (high-contrast, font scaling, dyslexia font,
 * screen reader hints, etc.) directly into the DOM, so we don't render
 * any of our own UI here — the widget surface is owned by UserWay.
 *
 * If the env var is missing we render nothing, which keeps the layout
 * clean in dev/preview without breaking the app.
 */
const USERWAY_ACCOUNT = process.env.NEXT_PUBLIC_USERWAY_ACCOUNT ?? "";

export default function AccessibilityWidget() {
  if (!USERWAY_ACCOUNT) return null;

  return (
    <Script
      id="userway-widget"
      src="https://cdn.userway.org/widget.js"
      data-account={USERWAY_ACCOUNT}
      strategy="afterInteractive"
    />
  );
}
