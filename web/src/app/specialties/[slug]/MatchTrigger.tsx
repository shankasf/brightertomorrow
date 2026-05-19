import { FiArrowUpRight } from "react-icons/fi";

const JOTFORM_MATCH_URL = "https://form.jotform.com/253014448330448";

export default function MatchTrigger({
  label = "Get matched",
  className = "btn-ink mt-5 w-full justify-center",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <a
      href={JOTFORM_MATCH_URL}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
    >
      {label} <FiArrowUpRight />
    </a>
  );
}
