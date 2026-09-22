import type { EstimateRequest } from '@/types';

/**
 * Emailing the estimation desk.
 *
 * The desk queue is the primary channel — a submitted request appears there instantly. This is
 * the belt-and-braces copy: it opens a prefilled draft AND puts the same text on the clipboard,
 * because `mailto:` silently does nothing on machines with no mail client configured.
 */

const DESK_EMAIL = 'solutions@edly.io';

export function requestEmailBody(requests: readonly EstimateRequest[], context: { name: string; client: string }): string {
  const lines: string[] = ['Hi Edly team,', '', 'New custom estimate request from the Bundle Builder:', ''];
  lines.push(`Estimation: ${context.name}${context.client ? ` · ${context.client}` : ''}`, '');

  for (const request of requests) {
    lines.push(`${request.id} — ${request.title}`);
    if (request.details) lines.push(`Details: ${request.details}`);
    if (request.area) lines.push(`Closest area: ${request.area}`);
    if (request.urgency) lines.push(`Timeline: ${request.urgency}`);
    if (request.integrations) lines.push(`Systems: ${request.integrations}`);
    const who = [request.name, request.org, request.email].filter(Boolean).join(' · ');
    if (who) lines.push(`Requested by: ${who}`);
    lines.push('');
  }

  lines.push('Please reply with estimated hours and any scope caveats.', '', 'Thanks');
  return lines.join('\n');
}

export interface MailResult {
  copied: boolean;
  opened: boolean;
}

/** Opens a draft and copies the same text. Never throws — the desk queue already has the data. */
export async function mailRequests(requests: readonly EstimateRequest[], context: { name: string; client: string }): Promise<MailResult> {
  const body = requestEmailBody(requests, context);
  const subject = `Custom estimate request — ${context.name || 'Bundle Builder'}`;

  let copied = false;
  try {
    await navigator.clipboard.writeText(body);
    copied = true;
  } catch {
    /* clipboard needs permission or a secure context — the draft is still the main path */
  }

  let opened = false;
  try {
    /* mailto has a practical URL length limit; the clipboard copy covers the overflow */
    const href = `mailto:${DESK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.slice(0, 1800))}`;
    window.location.href = href;
    opened = true;
  } catch {
    /* no mail handler — the user pastes instead */
  }

  return { copied, opened };
}
