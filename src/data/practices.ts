/**
 * Practice → platform registry, and the benchmark catalogs.
 *
 * Open edX is the only LIVE catalog: it comes from the master sheet (`public/catalog-source.xlsx`).
 * Every other platform ships an INDICATIVE SAMPLE catalog — industry-benchmark scopes and hours so
 * the tool is usable on day one, explicitly not Edly delivery records. Replace a sample by loading
 * that practice's own sheet, or by adding solutions at the estimation desk.
 */
import type { Bundle, Catalog, PlatformRef, Practice, Solution } from '@/types';

/** A benchmark row, positionally: id, name, description, delivery form, deploy time, first hrs, repeat hrs, required account. */
type Row = [string, string, string, string, string, number, number, string?];

/** Sums a hours field that the domain types allow to be null; benchmark rows never are. */
const sum = (items: Solution[], pick: (item: Solution) => number | null): number =>
  items.reduce((total, item) => total + (pick(item) ?? 0), 0);

const item =
  (category: string) =>
  ([id, name, desc, form, deploy, first, repeat, account]: Row): Solution => ({
    id,
    name,
    desc,
    form,
    status: 'Sample',
    deploy,
    first,
    repeat: repeat ?? Math.round(first * 0.35),
    build: null,
    saving: null,
    account: account ?? null,
    integrations: null,
    notes: null,
    ref: null,
    category,
    subCategory: 'Benchmark'
  });

const B = (id: string, name: string, pitch: string, offerWhen: string, category: string, rows: Row[]): Bundle => {
  const items = rows.map(item(category));
  return {
    id,
    name,
    pitch,
    offerWhen,
    featureCount: items.length,
    buildHrs: null,
    firstHrs: sum(items, (x) => x.first),
    repeatHrs: sum(items, (x) => x.repeat),
    saved: null,
    noEstimate: 0,
    inDev: 0,
    accounts: null,
    pairsWith: null,
    items
  };
};

const cat = (title: string, subtitle: string, bundles: Bundle[]): Catalog => {
  const all = bundles.flatMap((bundle) => bundle.items);
  return {
    meta: {
      title,
      subtitle,
      compiled: 'benchmark',
      sample: true,
      totals: {
        features: all.length,
        buildHrs: null,
        firstHrs: sum(all, (x) => x.first),
        repeatHrs: sum(all, (x) => x.repeat),
        saved: null,
        noEstimate: 0,
        inDev: 0
      },
      notes: [
        'Indicative sample catalog — scopes and hours are industry benchmarks, not Edly delivery records.',
        'Load this practice’s own sheet, or add estimated solutions at the desk, to replace it.'
      ]
    },
    bundles
  };
};

/* ---------- EdTech ---------- */
const moodle = cat('Moodle — Solution Bundles (sample)', 'Benchmark scopes for a Moodle build. Replace with your own sheet.', [
  B('M01', 'Enrolment & Identity', 'Learners arrive through your identity provider and land in the right cohorts automatically.', 'SSO, bulk enrolment, cohort rules', 'Identity & Access', [
    ['MDL-001', 'SAML 2.0 Single Sign-On', 'Staff and learners sign in with the institutional IdP; accounts provision on first login.', 'Plugin configuration', '3–5 days', 40, 12, 'Identity provider (Azure AD, Okta)'],
    ['MDL-002', 'Bulk Enrolment & Cohort Sync', 'Nightly CSV or API sync creates users, cohorts and course enrolments.', 'Scheduled task', '1 week', 64, 20],
    ['MDL-003', 'Role & Capability Model', 'Custom roles mapped to your org structure with capability overrides per category.', 'Configuration', '2–4 days', 32, 8]
  ]),
  B('M02', 'Course Experience', 'A branded, mobile-ready course experience with the activity types your programmes need.', 'theming, accessibility, custom activities', 'Learning Experience', [
    ['MDL-010', 'Custom Boost Theme', 'Brand colours, typography, login page and dashboard layout in a child theme.', 'Theme', '1 week', 72, 24],
    ['MDL-011', 'H5P Interactive Content Pack', 'Interactive activity templates authored and wired into the course template.', 'Content build', '3–5 days', 48, 16],
    ['MDL-012', 'WCAG 2.2 AA Remediation', 'Audit and remediation of theme and core activity screens.', 'Accessibility', '2 weeks', 96, 32]
  ]),
  B('M03', 'Reporting & Compliance', 'Completion, competency and audit reporting your L&D team can run unassisted.', 'completion reports, audit trails', 'Reporting', [
    ['MDL-020', 'Configurable Report Builder Set', 'Saved reports for completion, activity and compliance with scheduled email delivery.', 'Report pack', '1 week', 56, 18],
    ['MDL-021', 'Competency Framework Import', 'Framework, learning plans and evidence upload wired to courses.', 'Configuration', '1 week', 60, 20],
    ['MDL-022', 'Warehouse Export Pipeline', 'Nightly event and completion export to your data warehouse.', 'Integration', '1–2 weeks', 80, 24, 'Warehouse account']
  ])
]);

const totara = cat('Totara — Solution Bundles (sample)', 'Benchmark scopes for Totara Learn / Perform. Replace with your own sheet.', [
  B('T01', 'Compliance Learning', 'Recurring certifications, audit evidence and automatic reassignment.', 'regulated training, audit', 'Compliance', [
    ['TOT-001', 'Certification & Recertification Programme', 'Programme structure with recurrence, grace periods and reassignment rules.', 'Configuration', '1 week', 56, 18],
    ['TOT-002', 'Audience Rule Library', 'Dynamic audiences driven by HR attributes, with assignment automation.', 'Configuration', '3–5 days', 40, 12],
    ['TOT-003', 'Audit Evidence Pack', 'Evidence-of-learning records, sign-off workflow and export for auditors.', 'Report pack', '1 week', 52, 16]
  ]),
  B('T02', 'Performance & Competency', 'Appraisals, check-ins and competency scales linked to learning.', 'performance reviews, 360 feedback', 'Performance', [
    ['TOT-010', 'Appraisal Workflow Build', 'Multi-stage review with manager, peer and self forms.', 'Configuration', '1–2 weeks', 88, 28],
    ['TOT-011', 'Competency Scale & Assignment', 'Scales, frameworks and achievement paths tied to learning plans.', 'Configuration', '1 week', 60, 20],
    ['TOT-012', '360 Feedback Cycle', 'Feedback request cycle with anonymised reporting.', 'Configuration', '1 week', 64, 20]
  ]),
  B('T03', 'HR & Content Integration', 'Totara in step with your HRIS and content libraries.', 'HRIS sync, content libraries', 'Integration', [
    ['TOT-020', 'HRIS User & Org Sync', 'Positions, organisations and managers synced from the HR system.', 'Integration', '1–2 weeks', 96, 28, 'HRIS API access'],
    ['TOT-021', 'External Content Library Connector', 'LinkedIn Learning / Go1 catalogue surfaced inside Totara.', 'Integration', '1 week', 64, 20, 'Content vendor account'],
    ['TOT-022', 'Single Sign-On', 'SAML or OIDC sign-in with attribute mapping.', 'Configuration', '3–5 days', 40, 12, 'Identity provider']
  ])
]);

const canvas = cat('Canvas LMS — Solution Bundles (sample)', 'Benchmark scopes for Canvas. Replace with your own sheet.', [
  B('C01', 'LTI & Tool Integration', 'Your tools inside Canvas courses, grade-synced and rostered.', 'LTI 1.3, grade passback', 'Integration', [
    ['CNV-001', 'LTI 1.3 Tool Build', 'Advantage-compliant tool with deep linking and names-and-roles service.', 'Custom development', '2 weeks', 120, 36],
    ['CNV-002', 'Assignment Grade Passback', 'Scores written back to the Canvas gradebook with retry handling.', 'Integration', '1 week', 56, 18],
    ['CNV-003', 'SIS Roster Import', 'Enrolment and section import from the student information system.', 'Integration', '1–2 weeks', 80, 24, 'SIS access']
  ]),
  B('C02', 'Course Design at Scale', 'Consistent, accessible course shells rolled out across departments.', 'course templates, blueprint courses', 'Learning Experience', [
    ['CNV-010', 'Blueprint Course Template', 'Locked template with modules, rubrics and accessibility baked in.', 'Course build', '1 week', 64, 20],
    ['CNV-011', 'Branded Theme & Dashboard', 'Institution branding via the Theme Editor plus custom JS/CSS pack.', 'Theme', '3–5 days', 44, 14],
    ['CNV-012', 'Bulk Course Provisioning', 'Scripted term rollover creating and publishing course shells.', 'Automation', '1 week', 52, 16]
  ]),
  B('C03', 'Analytics & Reporting', 'Programme-level insight beyond the built-in dashboards.', 'retention analytics, at-risk learners', 'Reporting', [
    ['CNV-020', 'Canvas Data 2 Warehouse Pipeline', 'Incremental load of Canvas Data into your warehouse.', 'Integration', '2 weeks', 104, 32, 'Warehouse account'],
    ['CNV-021', 'At-Risk Learner Dashboard', 'Engagement scoring with tutor-facing alerts.', 'Dashboard', '1–2 weeks', 88, 28],
    ['CNV-022', 'Accreditation Report Pack', 'Outcomes and mastery reporting mapped to accreditation criteria.', 'Report pack', '1 week', 60, 20]
  ])
]);

const blackboard = cat('Blackboard — Solution Bundles (sample)', 'Benchmark scopes for Blackboard Learn Ultra. Replace with your own sheet.', [
  B('BB01', 'Migration & Integration', 'Move onto Ultra without losing history, and keep the surrounding systems in step.', 'Ultra migration, SIS integration', 'Migration', [
    ['BLB-001', 'Original to Ultra Course Migration', 'Course conversion with content remediation and QA sampling.', 'Migration', '2–3 weeks', 140, 44],
    ['BLB-002', 'SIS Integration Framework', 'Snapshot or REST feeds for users, courses and enrolments.', 'Integration', '2 weeks', 104, 32, 'SIS access'],
    ['BLB-003', 'Building Block / REST Extension', 'Custom tool surfaced in the Ultra course view.', 'Custom development', '2 weeks', 112, 36]
  ]),
  B('BB02', 'Assessment Integrity', 'Assessment that holds up to scrutiny at scale.', 'proctoring, originality checking', 'Assessment', [
    ['BLB-010', 'Proctoring Integration', 'Proctored test workflow with identity check and session review.', 'Integration', '1 week', 64, 20, 'Proctoring vendor'],
    ['BLB-011', 'Originality Checking Rollout', 'Similarity checking wired into assignment workflows.', 'Configuration', '3–5 days', 36, 12, 'Vendor licence'],
    ['BLB-012', 'Rubric & Grading Workflow', 'Rubric library with delegated and anonymous marking.', 'Configuration', '1 week', 52, 16]
  ]),
  B('BB03', 'Reporting & Support', 'Operational reporting and a support model that scales.', 'usage reporting, tier-1 support', 'Reporting', [
    ['BLB-020', 'Institutional Usage Dashboard', 'Adoption, activity and grading-turnaround reporting.', 'Dashboard', '1–2 weeks', 80, 24],
    ['BLB-021', 'Automated Course Audit', 'Nightly checks for unpublished content and broken links.', 'Automation', '1 week', 48, 16],
    ['BLB-022', 'Tier-1 Support Runbook & Training', 'Runbooks, macros and train-the-trainer sessions.', 'Enablement', '1 week', 40, 12]
  ])
]);

/* ---------- App Development ---------- */
const ios = cat('iOS — Solution Bundles (sample)', 'Benchmark scopes for native iOS delivery.', [
  B('I01', 'App Foundations', 'The scaffolding every production iOS app needs before features start landing.', 'new app build, architecture', 'Foundations', [
    ['IOS-001', 'SwiftUI App Architecture', 'Modular SwiftUI app with navigation, DI and networking layer.', 'Custom development', '2 weeks', 120, 36],
    ['IOS-002', 'Authentication & Keychain', 'OAuth / OIDC sign-in, biometric unlock and secure token storage.', 'Custom development', '1 week', 64, 20, 'Identity provider'],
    ['IOS-003', 'Offline Cache & Sync', 'Local persistence with conflict-aware background sync.', 'Custom development', '1–2 weeks', 96, 32]
  ]),
  B('I02', 'Engagement & Commerce', 'The features that drive retention and revenue on iOS.', 'push, in-app purchase, deep links', 'Engagement', [
    ['IOS-010', 'Push Notifications & Deep Links', 'APNs setup, rich notifications and universal links.', 'Custom development', '3–5 days', 48, 16, 'APNs certificates'],
    ['IOS-011', 'StoreKit 2 Subscriptions', 'In-app purchase, restore, receipt validation and entitlement gating.', 'Custom development', '1–2 weeks', 88, 28, 'App Store account'],
    ['IOS-012', 'Analytics & Attribution', 'Event taxonomy wired to your analytics and attribution SDKs.', 'Integration', '3–5 days', 40, 14, 'Analytics account']
  ]),
  B('I03', 'Release Engineering', 'Ship predictably, with quality gates that catch problems before review does.', 'CI/CD, TestFlight, app review', 'Delivery', [
    ['IOS-020', 'CI/CD with Fastlane', 'Signing, build matrix and TestFlight distribution on every merge.', 'DevOps', '1 week', 56, 16],
    ['IOS-021', 'UI & Snapshot Test Suite', 'Critical-path UI tests with snapshot coverage in CI.', 'QA automation', '1 week', 64, 20],
    ['IOS-022', 'Accessibility & App Review Prep', 'VoiceOver, Dynamic Type and review-guideline remediation.', 'Accessibility', '3–5 days', 44, 14]
  ])
]);

const android = cat('Android — Solution Bundles (sample)', 'Benchmark scopes for native Android delivery.', [
  B('A01', 'App Foundations', 'A Compose codebase set up to scale past the first release.', 'new app build, architecture', 'Foundations', [
    ['AND-001', 'Compose App Architecture', 'Modular Compose app with Hilt, navigation and a networking layer.', 'Custom development', '2 weeks', 116, 36],
    ['AND-002', 'Authentication & Encrypted Storage', 'OIDC sign-in, biometric prompt and EncryptedSharedPreferences.', 'Custom development', '1 week', 60, 20, 'Identity provider'],
    ['AND-003', 'Room Cache & WorkManager Sync', 'Offline-first persistence with background sync and retry policy.', 'Custom development', '1–2 weeks', 92, 30]
  ]),
  B('A02', 'Engagement & Commerce', 'Retention and monetisation on Google Play.', 'FCM, Play Billing, dynamic links', 'Engagement', [
    ['AND-010', 'FCM Push & App Links', 'Firebase messaging, notification channels and verified app links.', 'Custom development', '3–5 days', 44, 14, 'Firebase project'],
    ['AND-011', 'Play Billing Subscriptions', 'Billing v7 purchase flow, acknowledgement and entitlement sync.', 'Custom development', '1–2 weeks', 84, 28, 'Play Console'],
    ['AND-012', 'Analytics & Crash Reporting', 'Event taxonomy plus Crashlytics and performance monitoring.', 'Integration', '2–4 days', 36, 12, 'Analytics account']
  ]),
  B('A03', 'Release Engineering', 'Play releases that are boring, in the good sense.', 'CI/CD, staged rollout, device matrix', 'Delivery', [
    ['AND-020', 'CI/CD with Gradle & Play Publisher', 'Signed bundles, tracks and staged rollout automation.', 'DevOps', '1 week', 52, 16],
    ['AND-021', 'Instrumented Test Suite', 'Espresso and Compose UI tests on a device matrix in CI.', 'QA automation', '1 week', 60, 20],
    ['AND-022', 'Accessibility & Play Policy Prep', 'TalkBack, contrast and data-safety declaration remediation.', 'Accessibility', '3–5 days', 40, 14]
  ])
]);

const cross = cat('Cross-platform — Solution Bundles (sample)', 'Benchmark scopes for React Native and Flutter delivery.', [
  B('X01', 'Shared Codebase Foundations', 'One codebase, two stores, without the usual platform surprises.', 'React Native, Flutter, one team two platforms', 'Foundations', [
    ['XPL-001', 'React Native App Scaffold', 'Typed RN app with navigation, state management and native module hooks.', 'Custom development', '2 weeks', 112, 34],
    ['XPL-002', 'Flutter App Scaffold', 'Flutter app with routing, DI and platform-channel plumbing.', 'Custom development', '2 weeks', 108, 34],
    ['XPL-003', 'Native Module Bridge', 'Bridging one platform SDK that has no cross-platform package.', 'Custom development', '1 week', 64, 20]
  ]),
  B('X02', 'Parity & Polish', 'The work that stops a cross-platform app feeling like one.', 'platform parity, performance', 'Quality', [
    ['XPL-010', 'Platform Parity Pass', 'Navigation, gestures and typography brought in line per platform.', 'Custom development', '1 week', 56, 18],
    ['XPL-011', 'Performance Profiling & Fixes', 'Startup, list and animation profiling with targeted fixes.', 'Optimisation', '1 week', 64, 20],
    ['XPL-012', 'Offline & Error-state Design', 'Consistent offline, empty and failure states across both platforms.', 'Custom development', '3–5 days', 44, 14]
  ]),
  B('X03', 'Dual-store Delivery', 'Both stores, one pipeline, one release train.', 'CI/CD, OTA updates', 'Delivery', [
    ['XPL-020', 'Unified CI/CD Pipeline', 'One pipeline producing signed iOS and Android artefacts.', 'DevOps', '1 week', 64, 20],
    ['XPL-021', 'Over-the-air Update Channel', 'CodePush or Shorebird channels with staged rollout.', 'DevOps', '3–5 days', 40, 12],
    ['XPL-022', 'Store Submission Pack', 'Metadata, screenshots and review responses for both stores.', 'Enablement', '2–4 days', 32, 10]
  ])
]);

/* ---------- Web Development ---------- */
const react = cat('React / Next.js — Solution Bundles (sample)', 'Benchmark scopes for modern web app delivery.', [
  B('R01', 'Application Foundations', 'A Next.js codebase with the decisions that are expensive to change already made.', 'new web app, design system', 'Foundations', [
    ['WEB-001', 'Next.js App Router Scaffold', 'Typed app with routing, server actions, error and loading states.', 'Custom development', '1–2 weeks', 88, 28],
    ['WEB-002', 'Design System & Component Library', 'Tokens, primitives and documented components in Storybook.', 'Custom development', '2 weeks', 120, 40],
    ['WEB-003', 'Auth & Session Management', 'OIDC sign-in, session refresh and role-based route guards.', 'Custom development', '1 week', 64, 20, 'Identity provider']
  ]),
  B('R02', 'Data & Integration', 'The app talking to everything else in the estate.', 'APIs, CMS, payments', 'Integration', [
    ['WEB-010', 'API Layer & Caching Strategy', 'Typed client, revalidation rules and optimistic updates.', 'Custom development', '1 week', 72, 24],
    ['WEB-011', 'Headless CMS Integration', 'Content models, preview mode and editorial workflow.', 'Integration', '1 week', 64, 20, 'CMS account'],
    ['WEB-012', 'Payments & Checkout', 'Stripe checkout, webhooks and subscription state handling.', 'Integration', '1 week', 68, 22, 'Stripe account']
  ]),
  B('R03', 'Performance & Launch', 'Fast, accessible and observable in production.', 'Core Web Vitals, SEO, accessibility', 'Quality', [
    ['WEB-020', 'Core Web Vitals Optimisation', 'Image, font and bundle work against measured field data.', 'Optimisation', '1 week', 60, 20],
    ['WEB-021', 'WCAG 2.2 AA Audit & Fixes', 'Audit, remediation and an automated accessibility gate in CI.', 'Accessibility', '1–2 weeks', 88, 28],
    ['WEB-022', 'Observability & Error Tracking', 'Tracing, logging and error reporting with alerting.', 'DevOps', '3–5 days', 40, 14, 'Observability account']
  ])
]);

const django = cat('Django / Python — Solution Bundles (sample)', 'Benchmark scopes for Python backend delivery.', [
  B('D01', 'Service Foundations', 'A Django service with the operational basics in place from day one.', 'new backend, API-first', 'Foundations', [
    ['DJG-001', 'Django Project & API Scaffold', 'DRF or Ninja API with settings, migrations and test harness.', 'Custom development', '1–2 weeks', 80, 26],
    ['DJG-002', 'Auth, Permissions & Audit Trail', 'Token and session auth, object permissions and an audit log.', 'Custom development', '1 week', 64, 20],
    ['DJG-003', 'Async Task Pipeline', 'Celery workers, scheduling, retries and dead-letter handling.', 'Custom development', '1 week', 56, 18]
  ]),
  B('D02', 'Data & Reporting', 'Getting data in, out and in front of people.', 'imports, exports, admin reporting', 'Data', [
    ['DJG-010', 'Bulk Import & Validation Framework', 'Validated CSV/API ingestion with error reporting to users.', 'Custom development', '1 week', 64, 20],
    ['DJG-011', 'Admin & Internal Tooling', 'Tailored Django admin with inlines, actions and safeguards.', 'Custom development', '3–5 days', 44, 14],
    ['DJG-012', 'Reporting & Export Endpoints', 'Parameterised reports with async export to file storage.', 'Custom development', '1 week', 56, 18]
  ]),
  B('D03', 'Scale & Hardening', 'Holding up under real traffic and real audits.', 'performance, security review', 'Reliability', [
    ['DJG-020', 'Query & Cache Optimisation', 'Profiling, index work and a caching layer for hot paths.', 'Optimisation', '1 week', 60, 20],
    ['DJG-021', 'Security Hardening Pass', 'OWASP review, rate limiting, secrets and dependency policy.', 'Security', '1 week', 64, 20],
    ['DJG-022', 'Load Test & Capacity Plan', 'Scripted load profiles with a capacity and scaling plan.', 'QA automation', '3–5 days', 48, 16]
  ])
]);

const wordpress = cat('WordPress & Headless CMS — Solution Bundles (sample)', 'Benchmark scopes for marketing and content platforms.', [
  B('W01', 'Site Build', 'A marketing site the content team can run without developers.', 'new site, block editor', 'Build', [
    ['WPR-001', 'Custom Block Theme', 'Block theme with patterns, templates and editorial guardrails.', 'Theme', '1–2 weeks', 88, 28],
    ['WPR-002', 'Content Model & Custom Post Types', 'Post types, taxonomies and field groups modelled to the content.', 'Configuration', '3–5 days', 44, 14],
    ['WPR-003', 'Multilingual Setup', 'Translation workflow, hreflang and language switcher.', 'Configuration', '1 week', 56, 18, 'Translation plugin licence']
  ]),
  B('W02', 'Headless & Integration', 'WordPress as the content back end for a decoupled front end.', 'headless, front-end framework', 'Integration', [
    ['WPR-010', 'Headless API Layer', 'REST or GraphQL schema, preview and on-demand revalidation.', 'Custom development', '1 week', 72, 24],
    ['WPR-011', 'CRM & Forms Integration', 'Form handling wired to the CRM with spam and consent controls.', 'Integration', '3–5 days', 40, 14, 'CRM account'],
    ['WPR-012', 'Commerce Integration', 'WooCommerce or Shopify catalogue and checkout handoff.', 'Integration', '1 week', 68, 22, 'Commerce account']
  ]),
  B('W03', 'Performance, SEO & Care', 'Fast, findable and looked after.', 'Core Web Vitals, SEO, maintenance', 'Quality', [
    ['WPR-020', 'Performance & Caching Setup', 'Object and page caching, image pipeline and CDN rules.', 'Optimisation', '3–5 days', 44, 14, 'CDN account'],
    ['WPR-021', 'Technical SEO Pass', 'Schema, sitemaps, redirects and Search Console remediation.', 'SEO', '3–5 days', 40, 12],
    ['WPR-022', 'Security & Backup Regime', 'Hardening, WAF rules, monitored backups and restore drill.', 'DevOps', '2–4 days', 32, 12, 'Hosting / WAF account']
  ])
]);

/* ---------- Data & Analytics ---------- */
const databricks = cat('Databricks — Solution Bundles (sample)', 'Benchmark scopes for lakehouse delivery on Databricks.', [
  B('DB01', 'Lakehouse Foundation', 'Workspace, governance and the medallion layers everything else builds on.', 'new lakehouse, Unity Catalog', 'Platform', [
    ['DBX-001', 'Workspace & Unity Catalog Setup', 'Workspaces, catalogs, external locations and access model.', 'Platform build', '1 week', 72, 24, 'Cloud subscription'],
    ['DBX-002', 'Medallion Architecture Build', 'Bronze, silver and gold layers with Delta tables and expectations.', 'Data engineering', '2 weeks', 128, 40],
    ['DBX-003', 'Ingestion Framework', 'Auto Loader and CDC ingestion with schema evolution handling.', 'Data engineering', '1–2 weeks', 96, 30]
  ]),
  B('DB02', 'Transformation & Quality', 'Pipelines you can trust, with tests that fail loudly.', 'DLT, dbt, data quality', 'Engineering', [
    ['DBX-010', 'Delta Live Tables Pipelines', 'Declarative pipelines with expectations and lineage.', 'Data engineering', '1–2 weeks', 104, 32],
    ['DBX-011', 'dbt on Databricks', 'dbt project, models, tests and CI-run documentation.', 'Data engineering', '1 week', 80, 26],
    ['DBX-012', 'Data Quality & Observability', 'Freshness, volume and schema monitors with alerting.', 'Data engineering', '1 week', 64, 20]
  ]),
  B('DB03', 'Analytics & ML Enablement', 'Turning the lakehouse into something the business uses.', 'BI, feature store, MLflow', 'Enablement', [
    ['DBX-020', 'SQL Warehouse & BI Connectivity', 'Serverless warehouses, semantic views and BI tool connection.', 'Platform build', '3–5 days', 48, 16, 'BI tool account'],
    ['DBX-021', 'Feature Store & MLflow Setup', 'Feature tables, experiment tracking and model registry.', 'ML engineering', '1 week', 72, 24],
    ['DBX-022', 'Cost & Performance Tuning', 'Cluster policies, photon tuning and spend reporting.', 'Optimisation', '3–5 days', 52, 16]
  ])
]);

const snowflake = cat('Snowflake — Solution Bundles (sample)', 'Benchmark scopes for Snowflake platform delivery.', [
  B('SN01', 'Platform Foundation', 'Accounts, roles and warehouses set up so cost and access stay controllable.', 'new Snowflake account, RBAC', 'Platform', [
    ['SNW-001', 'Account, RBAC & Warehouse Design', 'Role hierarchy, warehouse sizing and resource monitors.', 'Platform build', '1 week', 64, 20, 'Snowflake account'],
    ['SNW-002', 'Ingestion with Snowpipe & Streams', 'Continuous load, streams and tasks with error handling.', 'Data engineering', '1–2 weeks', 88, 28],
    ['SNW-003', 'Environment & CI Promotion', 'Dev/test/prod separation with schema change management in CI.', 'DevOps', '1 week', 60, 20]
  ]),
  B('SN02', 'Modelling & Governance', 'A model the business recognises, governed well enough to open up.', 'dbt, data sharing, masking', 'Engineering', [
    ['SNW-010', 'dbt Modelling Layer', 'Staging through marts with tests and documentation.', 'Data engineering', '2 weeks', 112, 36],
    ['SNW-011', 'Masking & Row Access Policies', 'Column masking, row policies and tag-based governance.', 'Security', '1 week', 64, 20],
    ['SNW-012', 'Secure Data Sharing', 'Reader accounts or listings for partner data exchange.', 'Platform build', '3–5 days', 44, 14]
  ]),
  B('SN03', 'Consumption & Cost', 'Getting value out without a runaway bill.', 'BI, cost control, apps', 'Enablement', [
    ['SNW-020', 'BI Semantic Layer', 'Curated views and metrics wired to the BI tool.', 'Data engineering', '1 week', 68, 22, 'BI tool account'],
    ['SNW-021', 'Streamlit in Snowflake App', 'Internal data app on governed data.', 'Custom development', '1 week', 72, 24],
    ['SNW-022', 'Credit Optimisation Review', 'Query and warehouse tuning with a spend dashboard.', 'Optimisation', '3–5 days', 48, 16]
  ])
]);

const bi = cat('BI & Visualization — Solution Bundles (sample)', 'Benchmark scopes for Power BI, Tableau and Looker work.', [
  B('BI01', 'Reporting Foundation', 'A governed semantic model instead of a sprawl of one-off reports.', 'new BI rollout, semantic model', 'Foundations', [
    ['BIV-001', 'Semantic Model Build', 'Star-schema model with measures, hierarchies and row-level security.', 'Data modelling', '1–2 weeks', 88, 28],
    ['BIV-002', 'Executive Dashboard Suite', 'Three to five boardroom dashboards to an agreed design system.', 'Dashboard', '1–2 weeks', 96, 30],
    ['BIV-003', 'Gateway & Refresh Architecture', 'Scheduled and incremental refresh with monitoring.', 'Platform build', '3–5 days', 44, 14, 'BI tenant']
  ]),
  B('BI02', 'Self-service Enablement', 'Analysts answering their own questions, safely.', 'self-service, certified datasets', 'Enablement', [
    ['BIV-010', 'Certified Dataset Programme', 'Certification process, naming standards and workspace model.', 'Governance', '1 week', 56, 18],
    ['BIV-011', 'Report Template & Theme Pack', 'Branded templates, theme file and accessibility defaults.', 'Dashboard', '3–5 days', 40, 14],
    ['BIV-012', 'Analyst Training & Handover', 'Workshops, documentation and office-hours handover.', 'Enablement', '3–5 days', 36, 12]
  ]),
  B('BI03', 'Advanced Analytics', 'Beyond descriptive reporting.', 'forecasting, embedded analytics', 'Advanced', [
    ['BIV-020', 'Forecasting & What-if Models', 'Scenario parameters and forecast measures in the model.', 'Data modelling', '1 week', 64, 20],
    ['BIV-021', 'Embedded Analytics in Product', 'Embedded reports with tenant isolation and row-level security.', 'Custom development', '1–2 weeks', 96, 30, 'BI capacity / licence'],
    ['BIV-022', 'Usage Audit & Rationalisation', 'Usage telemetry and a retire-or-keep plan for legacy reports.', 'Governance', '3–5 days', 40, 14]
  ])
]);

/* ---------- AI / ML ---------- */
const llm = cat('LLM & RAG Applications — Solution Bundles (sample)', 'Benchmark scopes for generative AI delivery.', [
  B('L01', 'Retrieval Foundations', 'The retrieval layer that decides whether the answers are any good.', 'RAG, document assistant', 'Foundations', [
    ['LLM-001', 'Document Ingestion & Chunking Pipeline', 'Parsing, chunking, embedding and incremental reindexing.', 'Data engineering', '1–2 weeks', 96, 30, 'Model provider account'],
    ['LLM-002', 'Vector Store & Hybrid Retrieval', 'Vector plus keyword retrieval with reranking and filters.', 'Custom development', '1 week', 72, 24],
    ['LLM-003', 'Grounded Answer Service', 'Prompt orchestration with citations and refusal handling.', 'Custom development', '1–2 weeks', 88, 28]
  ]),
  B('L02', 'Product Surface', 'Making it something people actually use.', 'chat UI, assistants, agents', 'Product', [
    ['LLM-010', 'Chat Interface with Streaming', 'Streaming responses, history, feedback capture and citations.', 'Custom development', '1 week', 76, 24],
    ['LLM-011', 'Tool-calling Agent', 'Function calling into internal APIs with guardrails.', 'Custom development', '1–2 weeks', 104, 32],
    ['LLM-012', 'Human-in-the-loop Review Queue', 'Escalation, review and correction workflow.', 'Custom development', '1 week', 68, 22]
  ]),
  B('L03', 'Evaluation & Safety', 'Knowing it works, and keeping it that way.', 'evals, guardrails, cost control', 'Assurance', [
    ['LLM-020', 'Evaluation Harness & Golden Set', 'Curated test set with automated scoring in CI.', 'QA automation', '1 week', 72, 24],
    ['LLM-021', 'Safety & PII Guardrails', 'Input/output filtering, redaction and abuse monitoring.', 'Security', '1 week', 64, 20],
    ['LLM-022', 'Token Cost & Latency Optimisation', 'Caching, routing and model-tier selection against measured spend.', 'Optimisation', '3–5 days', 52, 16]
  ])
]);

const vision = cat('Computer Vision — Solution Bundles (sample)', 'Benchmark scopes for vision model delivery.', [
  B('V01', 'Data & Labelling', 'Most vision projects are won or lost here.', 'dataset build, annotation', 'Data', [
    ['CVN-001', 'Dataset & Annotation Pipeline', 'Collection, labelling workflow, QA sampling and versioning.', 'Data engineering', '1–2 weeks', 96, 30, 'Annotation tool account'],
    ['CVN-002', 'Augmentation & Synthetic Data', 'Augmentation strategy and synthetic generation for rare classes.', 'ML engineering', '1 week', 64, 20],
    ['CVN-003', 'Baseline Model & Metrics', 'Baseline training run with an agreed metric and error analysis.', 'ML engineering', '1 week', 72, 24]
  ]),
  B('V02', 'Model Delivery', 'From notebook to something callable.', 'detection, OCR, inference API', 'Delivery', [
    ['CVN-010', 'Detection or Segmentation Model', 'Training, tuning and evaluation to the target metric.', 'ML engineering', '2 weeks', 128, 40],
    ['CVN-011', 'OCR & Document Extraction', 'Layout-aware extraction with confidence scoring.', 'ML engineering', '1–2 weeks', 104, 32],
    ['CVN-012', 'Inference API & Batch Scoring', 'GPU-backed service plus batch pipeline with autoscaling.', 'ML engineering', '1 week', 80, 26, 'Cloud GPU quota']
  ]),
  B('V03', 'Edge & Monitoring', 'Running where the cameras are, and noticing when it drifts.', 'edge deployment, drift monitoring', 'Operations', [
    ['CVN-020', 'Edge Deployment & Quantisation', 'Model export, quantisation and on-device benchmarking.', 'ML engineering', '1–2 weeks', 88, 28],
    ['CVN-021', 'Drift & Quality Monitoring', 'Prediction monitoring, drift alerts and a retraining trigger.', 'MLOps', '1 week', 64, 20],
    ['CVN-022', 'Review & Correction Tooling', 'Operator UI for reviewing and correcting predictions.', 'Custom development', '1 week', 72, 24]
  ])
]);

const mlops = cat('MLOps Platform — Solution Bundles (sample)', 'Benchmark scopes for productionising machine learning.', [
  B('O01', 'Training Platform', 'Reproducible training instead of notebooks on someone\u2019s laptop.', 'experiment tracking, pipelines', 'Platform', [
    ['MLO-001', 'Experiment Tracking & Registry', 'Tracking server, model registry and promotion workflow.', 'MLOps', '1 week', 64, 20, 'Cloud subscription'],
    ['MLO-002', 'Training Pipeline Orchestration', 'Parameterised, scheduled pipelines with lineage.', 'MLOps', '1–2 weeks', 96, 30],
    ['MLO-003', 'Feature Store Build', 'Offline and online feature serving with point-in-time correctness.', 'MLOps', '1–2 weeks', 104, 32]
  ]),
  B('O02', 'Serving & Reliability', 'Models behind an SLA.', 'inference, canary, rollback', 'Delivery', [
    ['MLO-010', 'Model Serving Infrastructure', 'Containerised serving with autoscaling and versioned endpoints.', 'MLOps', '1 week', 80, 26],
    ['MLO-011', 'Canary & Shadow Deployment', 'Traffic splitting, shadow scoring and automated rollback.', 'MLOps', '1 week', 64, 20],
    ['MLO-012', 'Batch Scoring Pipeline', 'Scheduled scoring with backfill and idempotent writes.', 'MLOps', '3–5 days', 52, 16]
  ]),
  B('O03', 'Governance', 'Explainable, monitored and auditable.', 'model governance, monitoring', 'Assurance', [
    ['MLO-020', 'Monitoring & Drift Detection', 'Data and prediction drift monitors with alert routing.', 'MLOps', '1 week', 68, 22],
    ['MLO-021', 'Explainability & Bias Reporting', 'Feature attribution and fairness reporting per release.', 'ML engineering', '1 week', 64, 20],
    ['MLO-022', 'Model Documentation & Audit Pack', 'Model cards, approval records and audit evidence.', 'Governance', '3–5 days', 40, 14]
  ])
]);

/* ---------- Cloud & DevOps ---------- */
const aws = cat('AWS Foundations — Solution Bundles (sample)', 'Benchmark scopes for AWS landing zone and migration work.', [
  B('AW01', 'Landing Zone', 'Accounts, identity and guardrails before workloads land.', 'new AWS estate, multi-account', 'Platform', [
    ['AWS-001', 'Multi-account Landing Zone', 'Organisations, SSO, SCPs and network baseline as code.', 'Platform build', '2 weeks', 120, 36, 'AWS account'],
    ['AWS-002', 'Network & Connectivity Design', 'VPCs, transit gateway, private endpoints and DNS.', 'Platform build', '1–2 weeks', 88, 28],
    ['AWS-003', 'Security Baseline & Logging', 'GuardDuty, Config, CloudTrail and centralised log archive.', 'Security', '1 week', 72, 24]
  ]),
  B('AW02', 'Workload Delivery', 'Getting applications on, and keeping them cheap.', 'containers, serverless, migration', 'Delivery', [
    ['AWS-010', 'ECS or EKS Workload Platform', 'Cluster, ingress, autoscaling and deployment pattern.', 'Platform build', '1–2 weeks', 104, 32],
    ['AWS-011', 'Serverless Application Stack', 'Lambda, API Gateway and event-driven integration as code.', 'Custom development', '1 week', 76, 24],
    ['AWS-012', 'Lift-and-shift Migration Wave', 'Assessment, replication and cutover for one workload wave.', 'Migration', '2 weeks', 112, 34]
  ]),
  B('AW03', 'Operate & Optimise', 'Running it without surprises on the invoice.', 'observability, FinOps, resilience', 'Operations', [
    ['AWS-020', 'Observability Stack', 'Metrics, logs, traces and actionable alerting.', 'DevOps', '1 week', 68, 22],
    ['AWS-021', 'FinOps Review & Savings Plan', 'Rightsizing, commitment strategy and a cost dashboard.', 'Optimisation', '3–5 days', 52, 16],
    ['AWS-022', 'Backup & DR Runbook', 'Backup policy, restore testing and a documented DR drill.', 'Reliability', '1 week', 60, 20]
  ])
]);

const k8s = cat('Kubernetes Platform — Solution Bundles (sample)', 'Benchmark scopes for internal platform delivery on Kubernetes.', [
  B('K01', 'Cluster Foundations', 'A cluster that is safe to hand to product teams.', 'new platform, GitOps', 'Platform', [
    ['K8S-001', 'Production Cluster Build', 'Cluster, node pools, ingress, storage and DNS as code.', 'Platform build', '1–2 weeks', 96, 30, 'Cloud subscription'],
    ['K8S-002', 'GitOps Delivery with Argo CD', 'App-of-apps structure, environments and promotion flow.', 'DevOps', '1 week', 72, 24],
    ['K8S-003', 'Secrets & Certificate Management', 'External secrets, cert-manager and rotation policy.', 'Security', '3–5 days', 48, 16]
  ]),
  B('K02', 'Developer Experience', 'Teams shipping without raising a ticket.', 'self-service, golden paths', 'Enablement', [
    ['K8S-010', 'Service Template & Golden Path', 'Scaffold, pipeline and manifests for a new service in a day.', 'DevOps', '1 week', 64, 20],
    ['K8S-011', 'Preview Environments', 'Per-pull-request environments with automatic teardown.', 'DevOps', '1 week', 68, 22],
    ['K8S-012', 'Platform Docs & Onboarding', 'Runbooks, paved-road docs and team onboarding sessions.', 'Enablement', '3–5 days', 36, 12]
  ]),
  B('K03', 'Reliability & Security', 'Surviving contact with production.', 'SLOs, policy, autoscaling', 'Operations', [
    ['K8S-020', 'Observability & SLO Framework', 'Prometheus, Grafana, tracing and error-budget alerting.', 'DevOps', '1–2 weeks', 88, 28],
    ['K8S-021', 'Policy & Admission Control', 'OPA or Kyverno policies, image signing and admission gates.', 'Security', '1 week', 64, 20],
    ['K8S-022', 'Autoscaling & Cost Controls', 'HPA, cluster autoscaler, requests tuning and spend reporting.', 'Optimisation', '3–5 days', 52, 16]
  ])
]);

const cicd = cat('CI/CD & IaC — Solution Bundles (sample)', 'Benchmark scopes for delivery pipeline and infrastructure-as-code work.', [
  B('CI01', 'Pipeline Foundations', 'One way to build, test and ship, used by every team.', 'CI/CD rollout, build times', 'Delivery', [
    ['CID-001', 'Reusable Pipeline Library', 'Shared workflows for build, test, scan and deploy.', 'DevOps', '1–2 weeks', 88, 28],
    ['CID-002', 'Build Caching & Parallelisation', 'Cache strategy and test sharding against measured build times.', 'Optimisation', '3–5 days', 48, 16],
    ['CID-003', 'Release Automation & Versioning', 'Semantic versioning, changelogs and artefact promotion.', 'DevOps', '3–5 days', 44, 14]
  ]),
  B('CI02', 'Infrastructure as Code', 'Infrastructure that is reviewable and reproducible.', 'Terraform, modules, drift', 'Platform', [
    ['CID-010', 'Terraform Module Library', 'Versioned modules with examples and automated tests.', 'DevOps', '1–2 weeks', 96, 30],
    ['CID-011', 'State, Environments & Drift Detection', 'Remote state, workspace strategy and scheduled drift checks.', 'DevOps', '1 week', 64, 20],
    ['CID-012', 'Policy as Code Gates', 'Plan-time policy checks and cost estimation in pull requests.', 'Security', '3–5 days', 48, 16]
  ]),
  B('CI03', 'Supply Chain Security', 'Knowing what you shipped and what is in it.', 'SBOM, signing, scanning', 'Assurance', [
    ['CID-020', 'Dependency & Container Scanning', 'Scanning in CI with triage workflow and SLAs.', 'Security', '3–5 days', 44, 14],
    ['CID-021', 'SBOM & Artefact Signing', 'SBOM generation, signing and verification at deploy time.', 'Security', '1 week', 60, 20],
    ['CID-022', 'Secrets Hygiene Programme', 'Secret scanning, rotation runbooks and developer training.', 'Security', '3–5 days', 40, 14]
  ])
]);

/* ------------------------------------------------------------------ registry */

/** `live: true` marks the one platform whose catalog comes from the master sheet. */
export const PRACTICES: Practice[] = [
  {
    id: 'edtech',
    name: 'EdTech / LMS',
    blurb: 'Learning platforms, course delivery and everything around them.',
    icon: '◫',
    platforms: [
      { id: 'openedx', name: 'Open edX', live: true, note: 'Client-proven catalog from the master sales sheet' },
      { id: 'moodle', name: 'Moodle', catalog: moodle },
      { id: 'totara', name: 'Totara', catalog: totara },
      { id: 'canvas', name: 'Canvas', catalog: canvas },
      { id: 'blackboard', name: 'Blackboard', catalog: blackboard }
    ]
  },
  {
    id: 'appdev',
    name: 'App Development',
    blurb: 'Native and cross-platform mobile products.',
    icon: '▤',
    platforms: [
      { id: 'ios', name: 'iOS', catalog: ios },
      { id: 'android', name: 'Android', catalog: android },
      { id: 'crossplat', name: 'Cross-platform', catalog: cross }
    ]
  },
  {
    id: 'webdev',
    name: 'Web Development',
    blurb: 'Web applications, portals and content platforms.',
    icon: '▦',
    platforms: [
      { id: 'react', name: 'React / Next.js', catalog: react },
      { id: 'django', name: 'Django / Python', catalog: django },
      { id: 'wordpress', name: 'WordPress & Headless CMS', catalog: wordpress }
    ]
  },
  {
    id: 'data',
    name: 'Data & Analytics',
    blurb: 'Lakehouse, warehouse and the reporting on top.',
    icon: '◨',
    platforms: [
      { id: 'databricks', name: 'Databricks', catalog: databricks },
      { id: 'snowflake', name: 'Snowflake', catalog: snowflake },
      { id: 'bi', name: 'BI & Visualization', catalog: bi }
    ]
  },
  {
    id: 'aiml',
    name: 'AI / ML',
    blurb: 'Generative AI, vision models and the platform to run them.',
    icon: '◐',
    platforms: [
      { id: 'llm', name: 'LLM & RAG Applications', catalog: llm },
      { id: 'vision', name: 'Computer Vision', catalog: vision },
      { id: 'mlops', name: 'MLOps Platform', catalog: mlops }
    ]
  },
  {
    id: 'cloud',
    name: 'Cloud & DevOps',
    blurb: 'Landing zones, platforms and delivery pipelines.',
    icon: '◇',
    platforms: [
      { id: 'aws', name: 'AWS Foundations', catalog: aws },
      { id: 'k8s', name: 'Kubernetes Platform', catalog: k8s },
      { id: 'cicd', name: 'CI/CD & IaC', catalog: cicd }
    ]
  }
];

/** Flat platform lookup, built once — every screen resolves a platform id on render. */
const byPlatformId = new Map<string, PlatformRef>(
  PRACTICES.flatMap((practice) => practice.platforms.map((platform): [string, PlatformRef] => [platform.id, { practice, platform }]))
);

export function findPlatform(id: string): PlatformRef | null {
  return byPlatformId.get(id) ?? null;
}

/** True only for the platform backed by the master sheet; everything else is labelled *Sample*. */
export function isLiveCatalog(id: string): boolean {
  return findPlatform(id)?.platform.live === true;
}

/** The shipped benchmark catalog for a platform, before anything loaded or added is layered on. */
export function benchmarkCatalog(id: string): Catalog | null {
  return findPlatform(id)?.platform.catalog ?? null;
}
