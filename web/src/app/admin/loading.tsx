import { BTSpinner } from '@/components/Spinner';

/**
 * Admin route transition state — matches the navy admin shell ambient gradient
 * so it doesn't flash a bright white screen during nav.
 */
export default function AdminLoading() {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-gradient-to-br from-[#192735] via-[#1f2c3c] to-[#253A4D]">
      <BTSpinner size="lg" label="Loading" />
    </div>
  );
}
