"use client";

import Script from "next/script";

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
