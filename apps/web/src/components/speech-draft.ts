export type SpeechDraft = { id: string; blob: Blob; reference: string; sessionId: string; seconds: number };
const signedOut = new Set<string>();
export function allowSpeechDrafts(owner: string) { signedOut.delete(owner); }
export async function clearSpeechDrafts(owner: string) {
  signedOut.add(owner);
  window.dispatchEvent(new CustomEvent('paceon:speech-signout', { detail: owner }));
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('paceon-speech-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try { await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite');
    const cursor = tx.objectStore('drafts').openCursor();
    cursor.onsuccess = () => { const item = cursor.result; if (!item) return; if (String(item.key).startsWith(`${owner}:`)) item.delete(); item.continue(); };
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  }); } finally { db.close(); }
}
export async function speechDraftStorage(key: string, value?: SpeechDraft | null): Promise<SpeechDraft | null> {
  if (signedOut.has(key.split(':')[0]!)) return null;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('paceon-speech-drafts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    if (signedOut.has(key.split(':')[0]!)) return null;
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('drafts', value === undefined ? 'readonly' : 'readwrite');
      const store = tx.objectStore('drafts');
      const request = value === undefined ? store.get(key) : value === null ? store.delete(key) : store.put(value, key);
      tx.oncomplete = () => resolve(value === undefined ? request.result ?? null : value);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
