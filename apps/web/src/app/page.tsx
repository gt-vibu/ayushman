import Link from 'next/link';
import { ArrowRight, BriefcaseBusiness, CalendarDays, Leaf, UserRound } from 'lucide-react';

export default function Home() {
  return <main className="portal-page">
    <header className="portal-header"><Link className="brand" href="/"><span className="brand-icon"><Leaf size={20}/></span>Ayushman</Link><Link className="text-link" href="/book">Explore practices <ArrowRight size={15}/></Link></header>
    <section className="portal-content"><p className="eyebrow">A BETTER WAY TO CONNECT</p><h1>Care and good work,<br/><em>in one place.</em></h1><p className="portal-intro">Find a service that fits your needs, or manage the practice and people you care for.</p>
      <div className="portal-choice-grid">
        <div className="portal-choice-card"><Link className="portal-choice" href="/book"><span className="portal-choice-icon tone-blush"><UserRound size={22}/></span><span><small>FOR CUSTOMERS</small><strong>Find and book a service</strong><em>Discover a practice, choose a service and time, then manage your appointments.</em></span><ArrowRight size={18}/></Link><Link className="portal-secondary-link" href="/customer/login">Already have an account? Sign in</Link></div>
        <div className="portal-choice-card"><Link className="portal-choice" href="/login"><span className="portal-choice-icon tone-apricot"><BriefcaseBusiness size={22}/></span><span><small>FOR PRACTITIONERS</small><strong>Open your practice workspace</strong><em>Manage your schedule, services, locations, team and customer records.</em></span><ArrowRight size={18}/></Link><Link className="portal-secondary-link" href="/login">Practitioner sign in <ArrowRight size={13}/></Link></div>
      </div>
      <div className="portal-footer"><CalendarDays size={16}/> Customer accounts keep bookings and practice records together.</div>
    </section>
  </main>;
}
