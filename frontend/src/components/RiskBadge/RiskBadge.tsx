/**
 * RiskBadge — colour-coded label for a risk level.
 * Maps low/medium/high/critical to the design-system risk colours.
 */

import React from 'react';
import type { RiskLevel } from '../../api/transactions.ts';
import './RiskBadge.css';

interface Props {
  level: RiskLevel;
  score?: number;     // optional 0-100 score shown alongside
  size?: 'sm' | 'md';
}

const LABELS: Record<RiskLevel, string> = {
  low:      'Low',
  medium:   'Medium',
  high:     'High',
  critical: 'Critical',
};

export const RiskBadge: React.FC<Props> = ({ level, score, size = 'md' }) => (
  <span
    className={`risk-badge risk-badge--${level} risk-badge--${size}`}
    aria-label={`Risk: ${LABELS[level]}${score !== undefined ? `, score ${score}` : ''}`}
  >
    <span className="risk-badge__dot" aria-hidden="true" />
    <span className="risk-badge__label">{LABELS[level]}</span>
    {score !== undefined && (
      <span className="risk-badge__score mono">{score}</span>
    )}
  </span>
);
