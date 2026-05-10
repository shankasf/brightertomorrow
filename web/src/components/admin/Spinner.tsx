'use client';
/**
 * Re-export of the shared brand spinner so admin/* imports keep working.
 * The canonical source lives at `@/components/Spinner` and is used
 * across the public site too — every wait state shows the BT sunrise mark.
 */
export {
  BTSpinner,
  InlineSpinner,
  BTMark,
  LoadingScreen,
  FullScreenSpinner,
} from '@/components/Spinner';
