import { PublicBookingFlow } from '@/components/public-booking-flow';

export default async function PracticeBookingPage({ params }: { params: Promise<{ practiceId: string }> }) {
  const { practiceId } = await params;
  return <PublicBookingFlow practiceId={practiceId}/>;
}
