import {
  FiPhone, FiMail, FiClock, FiMapPin, FiFacebook, FiInstagram,
} from "react-icons/fi";
import ContactReplicaForm from "@/components/ContactReplicaForm";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Contact Us in Las Vegas, NV",
  description:
    "Get in touch with Brighter Tomorrow Therapy. Call, email, or send a message — two Las Vegas offices plus telehealth. We'll reach out shortly to book your appointment.",
  path: "/contact",
});

const FACEBOOK = "https://web.facebook.com/Forabettertomorrowlv";
const INSTAGRAM = "https://www.instagram.com/brightertomorrowlv/";
const FEEDBACK_FORM = "https://form.jotform.com/253078628049364";

const OFFICES = [
  {
    label: "3430 E Russell Rd Ste 315, Las Vegas, Nevada 89120",
    map: "https://maps.google.com/maps?q=3430%20E%20Russell%20Rd%20Ste%20315%20Las%20Vegas%2C%20Nevada%2089120&t=m&z=15&output=embed&iwloc=near",
  },
  {
    label: "6955 N Durango Drive, unit 1004, Las Vegas, Nevada 89149",
    map: "https://maps.google.com/maps?q=6955%20N%20Durango%20Drive%2C%20unit%201004%20Las%20Vegas%2089149&t=m&z=15&output=embed&iwloc=near",
  },
] as const;

function InfoIcon({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-hidden
      className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full border"
      style={{ borderColor: "#E1B878", color: "#E1B878" }}
    >
      {children}
    </span>
  );
}

export default function ContactPage() {
  return (
    <>
      {/* ───────────────────────── HERO ───────────────────────── */}
      <section
        className="relative isolate flex items-center justify-center overflow-hidden bg-cover bg-center"
        style={{
          minHeight: "clamp(420px, 60vh, 600px)",
          backgroundImage: "url('/contact/hero.jpg')",
        }}
      >
        <div
          aria-hidden
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(25,39,53,0.55) 0%, rgba(25,39,53,0.66) 100%)",
          }}
        />
        <div className="container-x relative py-24 text-center">
          <h1 className="display text-white" style={{ fontSize: "clamp(2.75rem, 6vw, 4.25rem)" }}>
            <span style={{ color: "#E1B878" }}>Contact</span> Us
          </h1>
        </div>
      </section>

      {/* ──────────────── TWO-COLUMN: FORM + INFO ──────────────── */}
      <section className="section bg-cream-alt">
        <div className="container-x">
          <div className="grid grid-cols-1 gap-12 lg:grid-cols-12 lg:gap-14">
            {/* LEFT — form */}
            <div className="lg:col-span-7">
              <ContactReplicaForm />

              <p className="mt-6 text-[14px] leading-relaxed text-red-700">
                Please do not write, email or text any private health information. If you are
                experiencing a clinical emergency, please dial 911 or go to your nearest emergency room
              </p>
            </div>

            {/* RIGHT — contact info + complaint */}
            <div className="lg:col-span-5">
              <h2 className="display text-4xl text-ink sm:text-[2.75rem]">
                <span className="italic-accent">Get in Touch</span>
              </h2>
              <p className="mt-4 leading-relaxed text-ink-muted">
                Fill out the form to book an appointment with us. We will contact you shortly.
              </p>

              <div className="mt-9 space-y-7">
                {/* Call Us */}
                <div className="flex items-start gap-4">
                  <InfoIcon><FiPhone size={18} /></InfoIcon>
                  <div className="min-w-0">
                    <h3 className="font-display text-lg font-semibold text-ink">Call Us</h3>
                    <p className="mt-1 text-[15px] leading-relaxed text-ink-muted">
                      Service Hours: Monday - Friday 9:00am to 5:00pm. Sat - Sun: Closed.
                    </p>
                    <a
                      href="tel:+17252386990"
                      className="mt-1 inline-block text-[15px] font-medium text-brand-700 hover:underline"
                    >
                      725-238-6990
                    </a>
                  </div>
                </div>

                {/* Email Us */}
                <div className="flex items-start gap-4">
                  <InfoIcon><FiMail size={18} /></InfoIcon>
                  <div className="min-w-0">
                    <h3 className="font-display text-lg font-semibold text-ink">Email Us</h3>
                    <a
                      href="mailto:admin@brightertomorrowtherapy.com"
                      className="mt-1 inline-block text-[15px] text-brand-700 hover:underline [overflow-wrap:anywhere]"
                    >
                      admin@brightertomorrowtherapy.com
                    </a>
                  </div>
                </div>

                {/* Opening Hours */}
                <div className="flex items-start gap-4">
                  <InfoIcon><FiClock size={18} /></InfoIcon>
                  <div className="min-w-0">
                    <h3 className="font-display text-lg font-semibold text-ink">Opening Hours</h3>
                    <p className="mt-1 text-[15px] leading-relaxed text-ink-muted">
                      Mon - Fri: 9:00 am to 8:00 pm
                      <br />
                      Sat - Sun: 10:00 am to 4:00 pm
                    </p>
                  </div>
                </div>

                {/* Addresses */}
                <div className="flex items-start gap-4">
                  <InfoIcon><FiMapPin size={18} /></InfoIcon>
                  <div className="min-w-0">
                    <h3 className="font-display text-lg font-semibold text-ink">Addresses</h3>
                    <p className="mt-1 text-[15px] leading-relaxed text-ink-muted">
                      3430 E Russell Rd Ste 315, Las Vegas, Nevada 89120
                    </p>
                    <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">
                      6955 N Durango Drive, unit 1004, Las Vegas, Nevada 89149
                    </p>
                    <p className="mt-2 text-[15px] leading-relaxed text-ink-muted">Telehealth</p>
                  </div>
                </div>
              </div>

              {/* Follow Us */}
              <div className="mt-9">
                <h3 className="font-display text-lg font-semibold text-ink">Follow Us On</h3>
                <div className="mt-3 flex items-center gap-3">
                  <a
                    href={FACEBOOK}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Facebook"
                    className="grid h-10 w-10 place-items-center rounded-full border text-brand transition hover:bg-brand hover:text-white"
                    style={{ borderColor: "#E1B878" }}
                  >
                    <FiFacebook size={18} />
                  </a>
                  <a
                    href={INSTAGRAM}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Instagram"
                    className="grid h-10 w-10 place-items-center rounded-full border text-brand transition hover:bg-brand hover:text-white"
                    style={{ borderColor: "#E1B878" }}
                  >
                    <FiInstagram size={18} />
                  </a>
                </div>
              </div>

              {/* Complaint / Feedback */}
              <div className="mt-11">
                <h2 className="display text-3xl text-ink sm:text-[2rem]">
                  Have a Complaint or Feedback?
                </h2>
                <div className="mt-5 space-y-4 leading-relaxed text-ink-muted">
                  <p>
                    At Brighter Tomorrow Therapy, we are committed to providing compassionate,
                    high-quality care that supports each client&apos;s growth and healing journey. Our
                    therapists continuously engage in supervision, training, and professional
                    development to ensure they are offering the best possible care for your unique
                    needs. We also recognize that therapists are human first, and we deeply value
                    mutual grace and understanding as we walk alongside you in your healing process.
                  </p>
                  <p>
                    If you are receiving services with one of our therapists, our greatest hope is that
                    you feel safe and supported in sharing any feedback or concerns directly with your
                    therapist. However, if you do not feel comfortable doing so, you are always welcome
                    to contact Yvette Howard, LCSW, Clinical Director, for additional support or to
                    discuss your experience.
                  </p>
                  <p>
                    Please know that you are never &ldquo;stuck&rdquo; with a therapist. You are
                    welcome to explore working with another member of our team or a therapist outside
                    of Brighter Tomorrow Therapy. If you&apos;d like assistance with this process, we
                    are more than happy to provide referral options to ensure you feel fully supported
                    and safe throughout your care.
                  </p>
                </div>
                <a
                  href="mailto:director@brightertomorrowtherapy.com"
                  className="btn-primary mt-7 inline-flex"
                >
                  Email the Director
                </a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ─────────────── FEEDBACK ABOUT A SERVICE ─────────────── */}
      <section className="section bg-white">
        <div className="container-narrow text-center">
          <h2 className="display text-3xl text-ink sm:text-4xl">
            Feedback About a Service or Therapist?
          </h2>
          <a
            href={FEEDBACK_FORM}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary mt-8 inline-flex"
          >
            Provide Feedback Here
          </a>
        </div>
      </section>

      {/* ───────────────────── OFFICE MAPS ───────────────────── */}
      <section className="section bg-cream-alt pt-0">
        <div className="container-x">
          <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
            {OFFICES.map((office) => (
              <div key={office.label}>
                <h3 className="font-display text-lg font-semibold text-ink">
                  {office.label}
                </h3>
                <div className="mt-3 overflow-hidden rounded-lg border border-surface-line shadow-soft">
                  <iframe
                    loading="lazy"
                    title={office.label}
                    aria-label={office.label}
                    src={office.map}
                    className="h-[340px] w-full border-0"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
