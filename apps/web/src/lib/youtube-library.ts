export type YouTubeLibraryItem = {
  id: string;
  title: string;
  kind: 'playlist' | 'channel' | 'video';
};

export function mergeYouTubeLibraryItems(
  previous: readonly YouTubeLibraryItem[],
  incoming: readonly YouTubeLibraryItem[],
): YouTubeLibraryItem[] {
  const items = new Map<string, YouTubeLibraryItem>();
  // A playlist can contain the same video more than once, including on its first page.
  for (const item of [...previous, ...incoming]) {
    const key = `${item.kind}:${item.id}`;
    if (!items.has(key)) items.set(key, item);
  }
  return [...items.values()];
}
