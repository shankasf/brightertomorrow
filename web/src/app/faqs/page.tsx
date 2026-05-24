"use client";

import Link from "next/link";
import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { FiChevronDown } from "react-icons/fi";
import Reveal from "@/components/Reveal";

const WINE = "#66202A";
const GOLD = "#E1B878";
const INK = "#192735";

// Verbatim from brightertomorrowtherapy.com/faqs/
const FAQS: { q: string; a: string }[] = [
  {
    q: "How do I get started with Brighter Tomorrow?",
    a: "1. Call for a free 15 min consultation with our admin!\n\n2. Schedule an appointment online, over the phone or by email to get scheduled with one of our therapists.\n\n3. Show up and get started!",
  },
  {
    q: "What happens in a phone consultation?",
    a: "The free 15-minute phone consultation is an opportunity for you to ask questions and for us to talk about the concerns that bring you to therapy and whether or not I'll be the right fit for you. Then, if you wish to proceed, we can schedule your first appointment. Whether you have questions about therapy, would like to explore the possibility of working together, or are ready to book your first appointment, contact us by email admin@brightertomorrowtherapy.com, or call 725-238-6990 to schedule your consult. We will get back to you within 24 hours and usually much sooner.",
  },
  {
    q: "What happens in the first session?",
    a: "The first session allows our team to get to know you and develop an idea of how to move forward. We'll be interested in learning more about what has brought you to the office, what issues you've been facing, and how you've been coping so far. You'll have the opportunity to ask any questions about your therapist, our training, and how we'll work together. If it is your adolescent who requires services, we'll discuss their history and current difficulties.",
  },
  {
    q: "How long is each session and how frequently do I need to attend sessions?",
    a: "We typically recommend beginning with weekly sessions for the first 6–8 weeks with sessions lasting 45-53 minutes. This allows time to establish a strong therapeutic connection and create steady progress early on. That said, we understand that work, family, and life responsibilities can sometimes impact scheduling. We never want frequency to feel like a barrier to starting care, so we're happy to discuss options that fit your availability. If you anticipate any scheduling challenges, please share that during your consultation so we can plan accordingly.\n\nSession frequency is also flexible and may shift throughout your time in therapy. Depending on your needs and goals, you and your therapist may move between weekly, biweekly, or monthly sessions. The pace of treatment is a collaborative decision designed to support your growth in the most effective way.",
  },
  {
    q: "How much does a session cost?",
    a: "Our cash rates range from $125-$150. Please contact our office for more information. Payment is made at each session with a card of your choice on file. There are affordable options with our master's-level students or a sliding scale fee.",
  },
  {
    q: "Do you offer In-Person or Telehealth services?",
    a: "We offer both! Some therapists provide strictly only telehealth, but you can find out who provides which services here.",
  },
  {
    q: "Do you take insurance?",
    a: "Currently, we are in-network with:\n\nCigna\nHealth Plan of Nevada (Commercial (PPO), Sierra Health and Life, and UMR)\nAnthem BCBS (Commercial)\nSilver Summit/Ambetter\nUnited Health Care (Medicare)\nTricare\nAetna\n\nHowever, we are currently an out-of-network provider with many other insurances. Most insurance companies cover a significant portion of the cost for “out of network” behavioral health services. Upon request, we can provide you with a monthly invoice that you can submit to your insurance company directly for reimbursement.\n\nPlease call your insurance provider to verify out-of-network coverage for outpatient mental (behavioral) health services.\n\nPlease check your coverage carefully by asking the following questions:\n\nDo I have out-of-network mental health benefits?\nDo I have a deductible and has it been met?\nHow many sessions per calendar year does my plan cover?\nHow much will I be reimbursed for out-of-network providers?\nWhat is the required documentation and to what address do I submit claims to?\n\nIf you choose to use your out-of-network benefits, you will be responsible for payment at the time of your session.",
  },
  {
    q: "What do I do if I need to cancel a session?",
    a: "If you need to cancel or make changes to your appointment, please contact your therapist at least 48 hours in advance to avoid being charged the full session fee. Video or phone sessions may be substituted for in-person sessions if you are not able to be physically present, but do not wish to cancel the session.",
  },
  {
    q: "Are sessions private and confidential?",
    a: "Your privacy and right to confidentiality are protected by the law. All communications between a client and a therapist are protected, with the exception of circumstances in which there is suspected child abuse or dependent adult/elder abuse, threat of serious bodily harm to another person, or threat of imminent harm to self. These exceptions are rare. If you are concerned about confidentiality, please bring it up with me so we can discuss your concerns further.",
  },
  {
    q: "Do you prescribe medication?",
    a: "We are not licensed to prescribe medication; however, we can make referrals to psychiatrists and other health care professionals should the need arise, and will work closely with members of your treatment team.",
  },
  {
    q: "Do you provide Emotional Support Animal (ESA) Letters?",
    a: "We do not provide ESA letters at this time. Our therapists do not have the added certification to provide this type of letter. However, we can provide you with resources of agencies who do.",
  },
  {
    q: "How do I pay and what forms of payment do you accept?",
    a: "We use a confidential electronic health records platform called JaneApp. Once you schedule a consultation or initial appointment, you will be prompted to create an account. You then have access to a client portal where you will sign consent forms, schedule and see upcoming appointments, and store/change your payment information.\n\nWe accept all major credit cards, and most FSA and HSA cards. If using FSA or HSA cards you will also need to add an additional card on file for cancellations or no-show fee. Please note that payment is due at the time of service, no late payments are accepted.",
  },
  {
    q: "I want my child/teen in therapy, will you tell me everything my kid talks to you about in session?",
    a: "The level of information shared with parents or guardians depends on a child's age, maturity, and legal rights under Nevada law.\n\nIn Nevada, minors who are 14 years of age or older may consent to outpatient mental health treatment without parental permission (NRS 129.050). While parents or guardians are often involved in financial or logistical aspects of care, we are required to respect the minor's legal right to confidentiality when they consent to their own treatment.\n\nFor younger children, we tailor confidentiality based on developmental level. With pre-teens and adolescents, we generally maintain privacy within sessions to support trust and openness, while still encouraging healthy communication between the child and their parent or guardian. For younger children, therapy typically involves greater collaboration with caregivers to ensure consistency and continuity of care at home.\n\nThere are important limits to confidentiality. We will promptly notify a parent or guardian if a child expresses intent to harm themselves, harm someone else, or discloses that they are being harmed or abused. As licensed clinicians in Nevada, we are mandated reporters and are legally required to report suspected abuse or neglect to Child Protective Services or the appropriate Nevada authorities.\n\nIf you would like updates or additional insight into your child's progress, we encourage you to reach out to their therapist to schedule a separate parent consultation. This allows us to provide meaningful feedback while maintaining the integrity of your child's therapeutic space.",
  },
];

function FaqItem({
  q,
  a,
  open,
  onToggle,
  reduce,
}: {
  q: string;
  a: string;
  open: boolean;
  onToggle: () => void;
  reduce: boolean;
}) {
  return (
    <div
      className="overflow-hidden"
      style={{
        backgroundColor: WINE,
        color: "#F4F4F4",
        borderRadius: "30px 0 30px 30px",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-4 px-6 sm:px-8 py-5 text-left font-display font-semibold text-[15px] sm:text-[17px] leading-snug transition hover:opacity-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:#E1B878]"
      >
        <span>{q}</span>
        <motion.span
          aria-hidden
          animate={{ rotate: open ? 180 : 0 }}
          transition={
            reduce ? { duration: 0 } : { duration: 0.3, ease: [0.16, 1, 0.3, 1] }
          }
          className="shrink-0"
          style={{ color: GOLD }}
        >
          <FiChevronDown size={22} strokeWidth={2.5} />
        </motion.span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            key="content"
            initial={reduce ? false : { height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={
              reduce ? { duration: 0 } : { duration: 0.35, ease: [0.16, 1, 0.3, 1] }
            }
            className="overflow-hidden"
          >
            <div className="px-6 sm:px-8 pb-6 text-[14.5px] leading-[1.7] text-white/90 whitespace-pre-line">
              {a}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function FaqsPage() {
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const reduce = !!useReducedMotion();

  // Split FAQs into 2-column layout for desktop — preserve top-to-bottom-by-column ordering
  const mid = Math.ceil(FAQS.length / 2);
  const left = FAQS.slice(0, mid);
  const right = FAQS.slice(mid);

  const renderItem = (item: { q: string; a: string }, absIdx: number) => (
    <FaqItem
      key={item.q}
      q={item.q}
      a={item.a}
      open={openIdx === absIdx}
      onToggle={() => setOpenIdx(openIdx === absIdx ? null : absIdx)}
      reduce={reduce}
    />
  );

  return (
    <article className="bg-cream-alt">
      {/* HERO — Nevada mountain photo with navy overlay (matches .com /faqs/) */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(25,39,53,0.55), rgba(25,39,53,0.6)), url('/images/faqs/nevada-mountain.webp')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-28 sm:py-36 lg:py-44 text-center">
          <Reveal direction="up">
            <h1
              className="font-display font-bold leading-tight text-[40px] sm:text-[52px] lg:text-[60px]"
              style={{ color: "#F4F4F4" }}
            >
              <span style={{ color: GOLD }}>Frequently</span> Asked Question
            </h1>
          </Reveal>
        </div>
      </section>

      {/* ACCORDION — wine pill cards on cream-alt (matches .com layout) */}
      <section className="bg-cream-alt py-16 sm:py-20 lg:py-24">
        <div className="container-x max-w-[1180px]">
          <div className="grid md:grid-cols-2 gap-5 md:gap-6">
            <div className="space-y-5 md:space-y-6">
              {left.map((it, i) => renderItem(it, i))}
            </div>
            <div className="space-y-5 md:space-y-6">
              {right.map((it, i) => renderItem(it, mid + i))}
            </div>
          </div>
        </div>
      </section>

      {/* CTA — photo bg + navy overlay (matches .com /faqs bottom) */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage:
              "linear-gradient(rgba(25,39,53,0.7), rgba(25,39,53,0.7)), url('/images/faqs/cta-bg.jpg')",
          }}
          aria-hidden
        />
        <div className="relative container-x py-20 lg:py-28 text-center">
          <Reveal direction="up">
            <p
              className="font-script italic text-[20px] sm:text-[24px]"
              style={{ color: GOLD }}
            >
              Ready to begin your healing journey?
            </p>
            <h2 className="mt-3 font-display font-bold text-[32px] sm:text-[40px] lg:text-[45px] text-white leading-[1.15]">
              Take the first step on the path toward a{" "}
              <span style={{ color: GOLD }}>brighter tomorrow</span>!
            </h2>
            <div className="mt-8 flex justify-center">
              <Link
                href="/contact"
                className="inline-block font-display font-bold tracking-[0.15em] text-[13px] uppercase px-8 py-4 transition hover:opacity-90"
                style={{
                  backgroundColor: GOLD,
                  color: INK,
                  borderRadius: "30px 0 30px 30px",
                }}
              >
                Consultation Now
              </Link>
            </div>
          </Reveal>
        </div>
      </section>
    </article>
  );
}
