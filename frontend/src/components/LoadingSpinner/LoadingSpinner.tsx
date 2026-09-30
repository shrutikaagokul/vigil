/**
 * LoadingSpinner — lightweight inline spinner.
 * Shows when async data is loading.
 */

import React from 'react';
import './LoadingSpinner.css';

interface Props {
  size?: 'sm' | 'md' | 'lg';
  label?: string;
}

export const LoadingSpinner: React.FC<Props> = ({
  size = 'md',
  label = 'Loading…',
}) => {
  return (
    <div className={`spinner spinner--${size}`} role="status" aria-label={label}>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle
          cx="12" cy="12" r="10"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="40 20"
        />
      </svg>
      <span className="sr-only">{label}</span>
    </div>
  );
};

/** Full-page / full-panel loading state */
export const LoadingPane: React.FC<{ label?: string }> = ({
  label = 'Loading…',
}) => (
  <div className="loading-pane">
    <LoadingSpinner size="lg" label={label} />
    <p className="loading-pane__label muted">{label}</p>
  </div>
);
