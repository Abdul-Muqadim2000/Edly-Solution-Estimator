import { useState } from 'react';
import { mailRequests } from '@/lib/mail';
import { useApp } from '@/state/AppProvider';
import { color, font } from '@/theme';
import { Button, Field, Modal, Row, Select, Spacer, TextArea } from '@/components/ui';

/** Sales asks for something the catalog does not cover. It lands on the estimation desk. */
export function RequestModal({ onClose }: { onClose: () => void }): JSX.Element {
  const { dispatch, catalog } = useApp();
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [area, setArea] = useState('');
  const [urgency, setUrgency] = useState('');
  const [integrations, setIntegrations] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [org, setOrg] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  const submit = (): void => {
    if (!title.trim() || !details.trim()) {
      setError('Describe what you need — a short title plus details help the team estimate accurately.');
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError('A valid work email is needed so the team can reply with the estimate.');
      return;
    }
    const input = {
        title: title.trim(),
        details: details.trim(),
        area,
        urgency,
        integrations: integrations.trim(),
      name: name.trim(),
      email: email.trim(),
      org: org.trim()
    };
    dispatch({ type: 'addRequest', input });
    setSent(true);
    /* the desk already has it; the email is a courtesy copy for the team's inbox */
    void mailRequests(
      [{ ...input, id: 'new', plat: '', estId: '', estName: '', client: '', at: '' }],
      { name: input.title, client: input.org }
    ).finally(() => onClose());
  };

  const header = (
    <>
      <div style={{ fontFamily: font.display, fontSize: 20, fontWeight: 700 }}>Request a custom estimate</div>
      <div style={{ fontSize: 13, color: color.muted, lineHeight: 1.55, marginTop: 4 }}>
        Not in our pre-built catalog? Describe it — Edly’s solutions team reviews every request and returns an estimate,
        typically within 2 business days.
      </div>
    </>
  );

  return (
    <Modal title={header} onClose={onClose} width={620} padding="26px 28px">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 20 }}>
        <Field label="What do you need?" value={title} onChange={setTitle} placeholder="e.g. Zoom attendance synced back to the gradebook" />
        <TextArea
          label="Details for estimation"
          value={details}
          onChange={setDetails}
          placeholder="Who uses it, current workflow, systems involved, scale (learners / courses), any deadline…"
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14 }}>
          <Select
            label="Closest area"
            value={area}
            options={[
              { value: '', label: 'Choose the closest area…' },
              ...catalog.bundles.map((bundle) => ({ value: bundle.name, label: bundle.name })),
              { value: 'Something new — not in any bundle', label: 'Something new — not in any bundle' }
            ]}
            onChange={setArea}
          />
          <Select
            label="Timeline"
            value={urgency}
            options={[
              { value: '', label: 'When do you need it?' },
              { value: 'Exploring — no date yet', label: 'Exploring — no date yet' },
              { value: 'This quarter', label: 'This quarter' },
              { value: 'ASAP — active project', label: 'ASAP — active project' }
            ]}
            onChange={setUrgency}
          />
        </div>
        <Field
          label="Systems / integrations involved (optional)"
          value={integrations}
          onChange={setIntegrations}
          placeholder="e.g. Salesforce, Azure AD, Stripe, internal HR system"
        />
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 14 }}>
          <Field label="Your name" value={name} onChange={setName} placeholder="Full name" />
          <Field label="Work email" value={email} onChange={setEmail} placeholder="you@company.com" />
          <Field label="Organization" value={org} onChange={setOrg} placeholder="Company / institution" />
        </div>
        {error ? (
          <div style={{ fontSize: 12.5, fontWeight: 600, color: color.redInk, background: color.redWash, borderRadius: 8, padding: '9px 12px' }}>{error}</div>
        ) : null}
        <Row gap={10} style={{ marginTop: 2 }}>
          <Button tone="primary" onClick={submit} style={{ borderRadius: 9, padding: '12px 22px', fontSize: 13 }}>
            Submit request
          </Button>
          <Button onClick={onClose} style={{ borderRadius: 9, padding: '11px 18px', fontSize: 13, fontWeight: 600 }}>
            Cancel
          </Button>
          <Spacer />
          <span style={{ fontSize: 11.5, color: color.faint }}>
            {sent
              ? 'Copied to your clipboard — if no mail app appeared, just paste it.'
              : 'Submit opens a prefilled email (and copies it) — just press Send'}
          </span>
        </Row>
      </div>
    </Modal>
  );
}
