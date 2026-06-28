import Link from "next/link";
import { FiArrowUpRight } from "react-icons/fi";

// Repointed off JotForm to the in-house match flow at /get-scheduled.
const MATCH_URL = "/get-scheduled";

export default function MatchTrigger({
  label = "Get matched",
  className = "btn-ink mt-5 w-full justify-center",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <Link href={MATCH_URL} className={className}>
      {label} <FiArrowUpRight />
    </Link>
  );
}
