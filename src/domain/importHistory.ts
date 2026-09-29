/**
 * Deleting an import from its history.
 *
 * The confirmation is the file's name, typed. It is not a password and protects nothing from
 * someone who means it: `/api/state` is unauthenticated, so the sheet can be changed without this
 * screen at all. What it stops is the slip, a click on the wrong row or Enter in an empty box,
 * that would take hundreds of estimates out of the catalog every deal quotes from.
 */

/** The name as typed matches the file's, ignoring case and the spaces around it. */
export function confirmsName(typed: string, name: string): boolean {
  const wanted = name.trim().toLowerCase();
  return wanted !== '' && typed.trim().toLowerCase() === wanted;
}
