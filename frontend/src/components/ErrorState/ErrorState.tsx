/**
 * ErrorState — displays a human-friendly error message.
 * Used whenever an API call fails.
 */

import React from 'react';
import { ApiError } from '../../api/client.ts';
import './ErrorState.css';

interface Props {
  error: Error | null;
  onRetry?: () => void;
  title?: string;
}

function describe(err: Error): string {
  if (err instanceof ApiError) {
    if (err.status === 0 || err.message.includes('Failed to fetch')) {
      return 'Could not reach the server. Check your connection or backend URL.';
    }
    if (err.status === 401 || err.status === 403) {
      return 'You are not authorised to view this data.';
    }
    if (err.status === 404) {
      return 'The requested resource was not found.';
    }
    if (err.status >= 500) {
      return `Server error (${err.status}). The backend may be starting up or unavailable.`;
    }
  }
  return err.message || 'An unexpected error occurred.';
}

export const ErrorState: React.FC<Props> = ({
  error,
  onRetry,
  title = 'Something went wrong',
}) => {
  if (!error) return null;
  return (
    <div className="error-state" role="alert">
      <div className="error-state__icon" aria-hidden="true">
        {/* Simple exclamation triangle */}
        <svg viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M8.57 2.5a1.65 1.65 0 0 1 2.86 0l7 12A1.65 1.65 0 0 1 17 17H3a1.65 1.65 0 0 1-1.43-2.5l7-12Z"
            stroke="currentColor" strokeWidth="1.5"
          />
          <path d="M10 7.5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          <circle cx="10" cy="13.5" r="0.75" fill="currentColor" />
        </svg>
      </div>
      <div className="error-state__body">
        <p className="error-state__title">{title}</p>
        <p className="error-state__detail">{describe(error)}</p>
        {onRetry && (
          <button
            className="error-state__retry"
            onClick={onRetry}
            type="button"
          >
            Try again
          </button>
        )}
      </div>
    </div>
  );
};
