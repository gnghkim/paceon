import { bookApiConfig } from '@/lib/books-api';
import { createAvailabilityHandler } from '@/lib/availability-api';
export const runtime = 'nodejs';
export async function PUT(request: Request) { return createAvailabilityHandler(bookApiConfig())(request); }
