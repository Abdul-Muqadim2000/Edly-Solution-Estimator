/**
 * The real edly.io navigation, mirrored so the tool wears the same chrome as the public site.
 *
 * Sales screen-share this app with clients, so the header is part of the product rather than
 * decoration. Every link points at the live site and opens in a new tab.
 */

export interface NavItem {
  label: string;
  href: string;
}

export interface NavMenu extends NavItem {
  children?: NavItem[];
}

/** The handful of links the app itself calls out — trial, demo, contact, custom work. */
export const EDLY_LINKS = {
  home: 'https://edly.io/',
  trial: 'https://panel.edly.io/trial/signup/',
  demo: 'https://edly.io/request-a-demo/',
  contact: 'https://edly.io/contact-us/',
  customSolutions: 'https://edly.io/services/open-edx-custom-solutions/'
} as const;

export const NAV_MENUS: NavMenu[] = [
  {
    label: 'Product',
    href: 'https://edly.io/edly-lms/',
    children: [
      { label: 'Edly LMS', href: 'https://edly.io/edly-lms/' },
      { label: 'Edly Studio', href: 'https://edly.io/edly-studio/' },
      { label: 'Edly Go App', href: 'https://edly.io/edly-go/' },
      { label: 'Edly Panel', href: 'https://edly.io/edly-panel/' },
      { label: 'Edly Discovery', href: 'https://edly.io/edly-discovery/' },
      { label: 'Edly Features', href: 'https://edly.io/features/' }
    ]
  },
  { label: 'Self Hosted', href: 'https://edly.io/tutor/' },
  {
    label: 'Industries',
    href: 'https://edly.io/higher-education-lms/',
    children: [
      { label: 'K12', href: 'https://edly.io/k12-lms/' },
      { label: 'Higher Education', href: 'https://edly.io/higher-education-lms/' },
      { label: 'Corporation', href: 'https://edly.io/corporate-lms/' },
      { label: 'Business', href: 'https://edly.io/business-lms/' },
      { label: 'Non Profit', href: 'https://edly.io/nonprofit-lms/' }
    ]
  },
  {
    label: 'Services',
    href: 'https://edly.io/services/',
    children: [
      { label: 'Managed Hosting', href: 'https://edly.io/services/open-edx-managed-hosting/' },
      { label: 'Open edX Installation', href: 'https://edly.io/services/open-edx-installation/' },
      { label: 'Open edX Custom Solutions', href: 'https://edly.io/services/open-edx-custom-solutions/' },
      { label: 'Instructional Design', href: 'https://edly.io/services/instructional-design/' },
      { label: 'Course Authoring', href: 'https://edly.io/services/course-authoring/' },
      { label: 'LMS Training and Support', href: 'https://edly.io/services/lms-training-support/' },
      { label: 'Data Migration', href: 'https://edly.io/services/lms-data-migration/' },
      { label: 'Totara Custom Solutions', href: 'https://edly.io/services/totara-custom-solutions/' }
    ]
  },
  {
    label: 'Resources',
    href: 'https://edly.io/resources/blog/',
    children: [
      { label: 'Our Blog', href: 'https://edly.io/resources/blog/' },
      { label: 'News and Updates', href: 'https://edly.io/resources/news-and-updates/' },
      { label: 'Guides and Whitepapers', href: 'https://edly.io/resources/guides-and-whitepapers/' },
      { label: 'Case Studies', href: 'https://edly.io/resources/case-studies/' }
    ]
  },
  { label: 'Pricing', href: 'https://edly.io/pricing-and-plans/' }
];

/** The credibility line under the hero. */
export const TEAMS_BEHIND = 'edX.org · MIT Open Learning · Philanthropy University · Toastmasters · Wikimedia';

/** Required attribution wherever the Open edX name appears. */
export const TRADEMARK = 'Open edX® is a registered trademark of edX Inc.';
