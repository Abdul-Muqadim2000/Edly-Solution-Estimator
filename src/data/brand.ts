/**
 * The tool's own name and brand files.
 *
 * Quotient is what sales and the desk work in. What a client is shown stays Edly's: the edly.io
 * header, hero and footer while presenting, the printed quote and the Excel sheet. So the logo
 * here goes on the working screens, and nowhere a client reads as coming from Edly.
 *
 * The paths are relative on purpose. They resolve against the `<base href>` in index.html, like
 * the catalog sheet, so a deep link such as /p/openedx/e/acme still finds them.
 */

export const PRODUCT_NAME = 'Quotient';

export const BRAND_FILES = {
  /** The full lockup, for light surfaces. 198 by 43. */
  logo: 'brand/quotient-logo.svg',
  /** The Q alone. Square. */
  mark: 'brand/quotient-mark.svg'
} as const;

/** The lockup's width for a given height, so the image reserves its space before it loads. */
export const LOGO_ASPECT = 198 / 43;
