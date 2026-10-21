import { redirect } from 'next/navigation';

export default async function LegacyPracticeBookingRoute({ params }: { params: Promise<{ practiceId: string }> }) {
  const { practiceId } = await params;
  redirect(`/book?practiceId=${encodeURIComponent(practiceId)}`);
}
