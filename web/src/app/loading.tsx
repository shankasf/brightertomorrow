import { BTSpinner } from '@/components/Spinner';

/**
 * Public-site route transition loading state — every page change shows the
 * BT sunrise mark while the next route's data resolves.
 */
export default function Loading() {
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-cream-alt/85 backdrop-blur-sm">
      <BTSpinner size="lg" label="Loading" />
    </div>
  );
}
