import { createYouTubeHandlers, readYouTubeConfig } from '@/lib/youtube-oauth';
export const runtime = 'nodejs';
export async function POST(request: Request) { return createYouTubeHandlers(readYouTubeConfig()).DISCONNECT(request); }
