'use client';

import { Activity } from 'lucide-react';
import { EmptyState, PageHeader } from '@/components/app-shell';

export default function ReportsPage() {
  return <><PageHeader eyebrow="PRACTICE INSIGHTS" title="Reports" description="Reporting will use verified appointment and financial data once the reporting endpoints are defined."/><section className="section-card resource-card"><EmptyState title="Reports are not connected yet" description="No revenue, ratings, or performance metrics are fabricated in this scaffold." icon={Activity}/></section></>;
}
