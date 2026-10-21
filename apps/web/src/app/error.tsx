'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('Ayushman page error', error); }, [error]);
  return <main className="route-error-page"><section className="route-error-card"><span className="route-error-icon"><AlertTriangle size={22}/></span><p className="eyebrow">THIS PAGE COULD NOT LOAD</p><h1>Let’s get you back on track.</h1><p>Your information is safe. Try loading this page again, or return to the booking home.</p>{error.digest && <small>Reference · {error.digest}</small>}<div><button className="button button-primary" type="button" onClick={reset}><RotateCcw size={15}/> Try again</button><Link className="button button-secondary" href="/book">Go to booking</Link></div></section></main>;
}
