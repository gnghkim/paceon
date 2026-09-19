import { MaterialDetail } from '@/components/material-detail';
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  return <MaterialDetail id={(await params).id} />;
}
