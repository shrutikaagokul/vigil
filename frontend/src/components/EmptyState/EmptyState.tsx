/**
 * EmptyState — shown when a data list returns zero results.
 */

import React from 'react';
import './EmptyState.css';

interface Props {
  title?: string;
  description?: string;
  action?: React.ReactNode;
}

export const EmptyState: React.FC<Props> = ({
  title = 'Nothing here yet',
  description,
  action,
}) => (
  <div className="empty-state">
    {/* Simple magnifying glass / file icon */}
    <svg
      className="empty-state__icon"
      viewBox="0 0 40 40"
      fill="none"
      aria-hidden="true"
    >
      <rect x="6" y="4" width="22" height="28" rx="3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 12h10M12 17h10M12 22h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="30" cy="31" r="5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M34 35l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
    <p className="empty-state__title">{title}</p>
    {description && (
      <p className="empty-state__description">{description}</p>
    )}
    {action && <div className="empty-state__action">{action}</div>}
  </div>
);
