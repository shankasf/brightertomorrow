'use client';
import { useEffect } from 'react';
import { initLogger } from '@/lib/logger';

/**
 * Mount-once side-effect to install window.onerror + unhandledrejection
 * listeners. Renders nothing. Place in the root layout so uncaught browser
 * errors are captured app-wide and shipped to /admin/logs via the gateway.
 */
export function LoggerInit() {
  useEffect(() => {
    initLogger();
  }, []);
  return null;
}
