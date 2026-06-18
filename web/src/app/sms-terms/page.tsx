import type { ReactNode } from "react";
import Reveal from "@/components/Reveal";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "SMS Terms & Conditions",
  description:
    "Terms and conditions for the Brighter Tomorrow Therapy text messaging program: program description, message frequency, rates, opt-out (STOP), and help (HELP).",
  path: "/sms-terms",
});

type Block =
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] };

// Inline formatting: **bold** and [label](href).
function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*(.+?)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
  let last = 0;
  let key = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) {
      out.push(
        <strong key={key++} className="font-semibold text-ink">
          {m[1]}
        </strong>
      );
    } else {
      out.push(
        <a key={key++} href={m[3]} className="text-brand underline">
          {m[2]}
        </a>
      );
    }
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const CONTENT: Block[] = [
  {
    kind: "p",
    text:
      "These Terms & Conditions govern the SMS/text messaging program operated by For A Better Tomorrow, DBA Brighter Tomorrow Therapy (“Brighter Tomorrow Therapy,” “we,” “us”). By opting in, you agree to these terms.",
  },
  { kind: "h2", text: "Program description" },
  {
    kind: "p",
    text:
      "The Brighter Tomorrow Therapy text messaging program sends messages such as appointment confirmations, reminders, and scheduling updates, along with occasional practice updates and offers. Message bodies contain no clinical or health information — only the practice name and appointment date and time.",
  },
  { kind: "h2", text: "Message frequency" },
  {
    kind: "p",
    text: "Message frequency varies based on your interactions with the practice.",
  },
  { kind: "h2", text: "Cost" },
  {
    kind: "p",
    text:
      "Message and data rates may apply depending on your mobile carrier and plan. Brighter Tomorrow Therapy does not charge for the text messages themselves.",
  },
  { kind: "h2", text: "How to opt out" },
  {
    kind: "p",
    text:
      "You can cancel the SMS service at any time by replying **STOP** to any message you receive from us. After you send STOP, we will send a one-time confirmation and you will no longer receive text messages. To rejoin later, reply START.",
  },
  { kind: "h2", text: "How to get help" },
  {
    kind: "p",
    text:
      "For help at any time, reply **HELP** to any message, call us at 725-238-6990, or visit our [contact page](/contact).",
  },
  { kind: "h2", text: "Consent" },
  {
    kind: "p",
    text:
      "Consent to receive text messages is not a condition of purchasing any goods or services. We collect two separate consents, and you may agree to either, both, or neither: (1) appointment texts — confirmations, reminders, and schedule changes; and (2) marketing texts — occasional practice updates and outreach. Marketing consent is always optional and is collected separately from appointment consent. You provide your mobile number and opt in through our website consent checkboxes, verbally with our staff or scheduling assistant, by texting a keyword to our number, or on an in-person intake form. Messages are recurring and automated.",
  },
  { kind: "h2", text: "Carrier disclaimer" },
  {
    kind: "p",
    text:
      "Mobile carriers are not liable for delayed or undelivered messages. Message delivery is subject to carrier and device availability.",
  },
  { kind: "h2", text: "Privacy" },
  {
    kind: "p",
    text:
      "We do not sell or share your mobile opt-in data or consent with third parties. See our [Privacy Policy](/privacy-policy) for full details on how we collect, use, and protect your information.",
  },
  { kind: "h2", text: "Support contact" },
  {
    kind: "p",
    text:
      "Brighter Tomorrow Therapy — phone 725-238-6990 — [brightertomorrowtherapy.com/contact](/contact).",
  },
];

export default function SmsTermsPage() {
  return (
    <>
      <section className="bg-cream-alt relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-grid opacity-[0.06]" />
        <div className="container-narrow relative py-20 sm:py-28 text-center">
          <Reveal>
            <span className="eyebrow center">Legal</span>
            <h1 className="mt-6 display text-4xl sm:text-5xl md:text-6xl text-ink">
              SMS <span className="italic-accent">Terms &amp; Conditions</span>
            </h1>
            <p className="mt-6 text-ink-muted text-lg max-w-2xl mx-auto">
              Terms for the Brighter Tomorrow Therapy text messaging program.
            </p>
          </Reveal>
        </div>
      </section>

      <section className="section bg-white">
        <div className="container-narrow">
          <Reveal>
            <div className="space-y-6">
              {CONTENT.map((b, i) => {
                switch (b.kind) {
                  case "h2":
                    return (
                      <h2 key={i} className="display text-2xl sm:text-3xl text-ink mt-10 first:mt-0">
                        {b.text}
                      </h2>
                    );
                  case "ul":
                    return (
                      <ul key={i} className="space-y-2 list-disc pl-6 text-ink-muted leading-relaxed marker:text-brand">
                        {b.items.map((it, j) => (
                          <li key={j}>{it}</li>
                        ))}
                      </ul>
                    );
                  default:
                    return (
                      <p key={i} className="text-ink-muted leading-[1.85]">
                        {renderInline(b.text)}
                      </p>
                    );
                }
              })}
            </div>
          </Reveal>
        </div>
      </section>
    </>
  );
}
