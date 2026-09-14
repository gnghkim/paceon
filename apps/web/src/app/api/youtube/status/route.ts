import { createYouTubeHandlers, readYouTubeConfig } from '@/lib/youtube-oauth';
export const runtime = 'nodejs';
export async function GET(request: Request) { return createYouTubeHandlers(readYouTubeConfig()).STATUS(request); }
