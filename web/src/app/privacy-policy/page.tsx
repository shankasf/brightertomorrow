import Reveal from "@/components/Reveal";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Privacy Policy",
  description:
    "How Brighter Tomorrow Therapy collects, uses, and protects information gathered through our website and online communication channels.",
  path: "/privacy-policy",
});

type Block =
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] };

const CONTENT: Block[] = [
  { kind: "p", text: "For A Better Tomorrow, DBA, Brighter Tomorrow Therapy" },
  {
    kind: "p",
    text:
      "At Brighter Tomorrow Therapy, accessible through www.brightertomorrowtherapy.com, protecting the privacy and confidentiality of our website visitors and clients is extremely important to us. This Privacy Policy explains the types of information we collect, how we use it, and how we protect it.",
  },
  {
    kind: "p",
    text:
      "If you have any questions or would like additional information about this Privacy Policy, please contact our office directly.",
  },
  { kind: "h2", text: "Information Collected Through Website Activity" },
  {
    kind: "p",
    text:
      "Like most websites, Brighter Tomorrow Therapy uses standard log files and analytics tools to understand how visitors interact with our website. The information collected may include:",
  },
  {
    kind: "ul",
    items: [
      "Internet Protocol (IP) address",
      "Browser type",
      "Internet Service Provider (ISP)",
      "Date and time of website visit",
      "Referring or exit pages",
      "Pages viewed on the website",
      "General website navigation patterns",
    ],
  },
  { kind: "p", text: "This information is used only for purposes such as:" },
  {
    kind: "ul",
    items: [
      "Improving website performance",
      "Understanding user engagement and website traffic",
      "Enhancing the user experience",
      "Maintaining website security and functionality",
    ],
  },
  { kind: "p", text: "This data is not linked to personally identifiable information." },
  { kind: "h2", text: "Cookies and Website Experience" },
  {
    kind: "p",
    text:
      "The website may use cookies or similar technologies to improve your browsing experience. Cookies may store information such as visitor preferences, pages accessed on the website, and browser type and device information. This information helps improve website functionality and tailor content to better serve visitors. Most web browsers allow you to disable cookies through your browser settings if you prefer.",
  },
  { kind: "h2", text: "Third-Party Websites" },
  {
    kind: "p",
    text:
      "The website may contain links to external websites or resources. Brighter Tomorrow Therapy is not responsible for the privacy practices or policies of third-party websites. Visitors are encouraged to review the privacy policies of any external sites they access.",
  },
  { kind: "h2", text: "Children's Online Privacy" },
  {
    kind: "p",
    text:
      "Brighter Tomorrow Therapy does not knowingly collect personally identifiable information from children under the age of 13 through our website. If a parent or guardian believes that their child has provided personal information through the website, they are encouraged to contact the practice immediately so the information can be removed from records.",
  },
  { kind: "h2", text: "Use of Phone Numbers and Text Messaging" },
  {
    kind: "p",
    text:
      "For A Better Tomorrow, DBA, Brighter Tomorrow Therapy may communicate with clients and prospective clients through phone calls or text messaging for purposes related to care and practice operations. These communications may include:",
  },
  {
    kind: "ul",
    items: [
      "Appointment confirmations or reminders",
      "Scheduling updates",
      "Requests to complete intake paperwork or assessments",
      "General practice communication",
    ],
  },
  {
    kind: "p",
    text: "Message and data rates may apply depending on your mobile carrier.",
  },
  { kind: "h2", text: "Protection of Personal Information" },
  {
    kind: "p",
    text:
      "Brighter Tomorrow Therapy does not sell, rent, or share your personal information with third parties without your explicit consent, except when disclosure is required by law or necessary to provide services. All information collected is kept confidential and used only for the purposes you have agreed to. Text messaging originator opt-in data and consent will never be shared with third parties.",
  },
  { kind: "h2", text: "Text Messaging Consent and Opt-In" },
  {
    kind: "p",
    text:
      "By providing your phone number and opting in to receive communications from Brighter Tomorrow Therapy, you consent to receive text messages related to practice services and scheduling. Your consent will always be obtained before text communication begins, and you will be informed about the types of messages you may receive.",
  },
  { kind: "h2", text: "Opting Out of Text Messages" },
  {
    kind: "p",
    text:
      "You may opt out of receiving text messages from Brighter Tomorrow Therapy at any time. To stop receiving text communications, simply reply STOP to any text message you receive from the practice. After opting out, you will no longer receive text messages unless you provide new consent.",
  },
  { kind: "h2", text: "Online Policy Scope" },
  {
    kind: "p",
    text:
      "This Privacy Policy applies only to information collected through our website and online communication channels. It does not apply to information collected offline, during therapy sessions, or through other clinical documentation systems governed by HIPAA privacy regulations.",
  },
  { kind: "h2", text: "Consent" },
  {
    kind: "p",
    text:
      "By using the website, you acknowledge that you have read and agree to this Privacy Policy.",
  },
];

export default function PrivacyPolicyPage() {
  return (
    <>
      <section className="bg-cream-alt relative overflow-hidden">
        <div aria-hidden className="absolute inset-0 bg-grid opacity-[0.06]" />
        <div className="container-narrow relative py-20 sm:py-28 text-center">
          <Reveal>
            <span className="eyebrow center">Legal</span>
            <h1 className="mt-6 display text-4xl sm:text-5xl md:text-6xl text-ink">
              Privacy <span className="italic-accent">Policy</span>
            </h1>
            <p className="mt-6 text-ink-muted text-lg max-w-2xl mx-auto">
              How we collect, use, and protect information gathered through our website.
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
                        {b.text}
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
