import { bookApiConfig } from '@/lib/books-api';
import { createSpeechHandlers } from '@/lib/speech-api';
export const runtime = 'nodejs';
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return createSpeechHandlers(bookApiConfig(), process.env.AI_ENABLED === 'true').AUDIO(request, (await params).id);
}
