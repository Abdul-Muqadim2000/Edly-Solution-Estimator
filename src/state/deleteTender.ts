import type { Tender } from '@/types';
import type { Action } from '@/state/reducer';
import { heldDocs } from '@/domain/tender';
import { tenderDiscard } from '@/api/client';

/**
 * Deletes a tender, from its card on the hub or from its own screen, and asks Anthropic to delete
 * the files still held there. The tender goes first, so it leaves at the click rather than after a
 * round trip. A file that will not delete expires on its own within 72 hours, and nothing here could
 * do better with the error than that, so it is not shown. The estimation made from the tender, its
 * desk requests and its sales and legal items stay: they are records of their own by then.
 */
export async function deleteTender(tender: Tender, dispatch: (action: Action) => void, now: number): Promise<void> {
  const fileIds = heldDocs(tender.docs, now).map((doc) => doc.fileId);
  dispatch({ type: 'deleteTender', id: tender.id });
  await tenderDiscard(fileIds).catch(() => []);
}
