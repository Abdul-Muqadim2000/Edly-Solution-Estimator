/**
 * Copy to the clipboard, with the fallback the source design shipped.
 *
 * `navigator.clipboard` is unavailable on plain http and can be refused without a user gesture,
 * which is exactly where a salesperson demoing off a laptop tends to be. The hidden-textarea
 * path still works there, so every copy button keeps working instead of silently doing nothing.
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* fall through to the textarea */
    }
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
