"use client";

import { useParams } from 'next/navigation';
import { PublicBookingFlow } from '@/components/public-booking-flow';

export default function PracticeBookingPage() {
  const params = useParams<{ practiceId: string }>();
  return <PublicBookingFlow practiceId={params.practiceId}/>;
}
