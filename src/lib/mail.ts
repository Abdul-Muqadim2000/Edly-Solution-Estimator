import type { EstimateRequest } from '@/types';
import { copyText } from '@/lib/clipboard';

/**
 * Emailing the estimation desk.
 *
 * The desk queue is the primary channel — a submitted request appears there instantly. This is
 * the belt-and-braces copy: it opens a prefilled draft AND puts the same text on the clipboard,
 * because `mailto:` silently does nothing on machines with no mail client configured.
 */

/*
 * The `window.location.href` quoted in both bodies below is now a real deep link — the router
 * keeps the address bar on the open estimation — so "Bundle link:" lands the reader on the deal
 * the request came from rather than on the sign-in screen. It carries ids only, never hours.
 */

/** Where estimate requests go. The source design made this configurable; this is its default. */
export const DESK_EMAIL = 'sales@edly.io';

/** One freshly submitted request — the note that goes out the moment sales presses Submit. */
export function singleRequestEmail(request: EstimateRequest): { subject: string; body: string } {
  const lines = [
    'Hi Edly team,',
    '',
    'New custom estimate request from the Bundle Builder:',
    '',
    `${request.id} — ${request.title}`,
    `Details: ${request.details}`
  ];
  if (request.area) lines.push(`Closest area: ${request.area}`);
  if (request.integrations) lines.push(`Systems: ${request.integrations}`);
  if (request.urgency) lines.push(`Timeline: ${request.urgency}`);
  lines.push('', `Bundle link: ${window.location.href}`, '', (request.name || '') + (request.org ? ` · ${request.org}` : ''), request.email || '');
  return { subject: `Estimate request ${request.id} — ${request.title}`, body: lines.join('\n') };
}

/** The whole open estimation's outstanding requests, chased in one mail. */
export function requestEmailBody(
  requests: readonly EstimateRequest[],
  context: { name: string; client: string; selected?: number; hours?: string }
): string {
  const lines: string[] = ['Hi Edly team,', '', 'Please estimate the following custom Open edX work:', ''];

  for (const request of requests) {
    lines.push(`${request.id} — ${request.title}`);
    lines.push(`  Details: ${request.details}`);
    if (request.area) lines.push(`  Closest area: ${request.area}`);
    if (request.integrations) lines.push(`  Systems: ${request.integrations}`);
    if (request.urgency) lines.push(`  Timeline: ${request.urgency}`);
    lines.push('');
  }

  if (context.selected) {
    lines.push(`Alongside our selected bundle: ${context.selected} solutions, ${context.hours ?? ''} h — ${window.location.href}`, '');
  }

  const last = requests[requests.length - 1];
  if (last) lines.push((last.name || '') + (last.org ? ` · ${last.org}` : ''), last.email || '');
  return lines.join('\n');
}

export interface MailResult {
  copied: boolean;
  opened: boolean;
}

/**
 * Opens a draft and copies the same text. Never throws — the desk queue already has the data.
 *
 * The draft is opened through a temporary anchor rather than by assigning `location.href`: a
 * `mailto:` navigation on the window can tear down the SPA in some browsers, and losing the
 * workspace to send an email is not a trade worth making.
 */
export async function openMail(subject: string, body: string): Promise<MailResult> {
  let opened = false;
  try {
    const link = document.createElement('a');
    link.href = `mailto:${DESK_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    link.target = '_blank';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    opened = true;
  } catch {
    /* no mail handler — the user pastes instead */
  }
  const copied = await copyText(`To: ${DESK_EMAIL}\nSubject: ${subject}\n\n${body}`);
  return { copied, opened };
}

export async function mailRequests(
  requests: readonly EstimateRequest[],
  context: { name: string; client: string; selected?: number; hours?: string }
): Promise<MailResult> {
  if (requests.length === 0) return { copied: false, opened: false };
  const body = requestEmailBody(requests, context);
  return openMail(`Custom estimate request — ${requests.map((request) => request.id).join(', ')}`, body);
}

/** Mails one request on submission, as the source does 150ms after it lands in the queue. */
export async function mailOne(request: EstimateRequest): Promise<MailResult> {
  const { subject, body } = singleRequestEmail(request);
  return openMail(subject, body);
}
