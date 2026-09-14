import { BookDetail } from "@/components/book-detail";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <BookDetail id={id} />;
}
