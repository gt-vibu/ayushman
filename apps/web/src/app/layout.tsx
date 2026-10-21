import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Instrument_Serif, Inter, Plus_Jakarta_Sans } from 'next/font/google';
import './globals.css';
import './design-system.css';
import './booking.css';
import './responsive.css';
import { CustomerSessionProvider } from '@/lib/customer-session';
import { PracticeProvider } from '@/lib/practice-context';

const bodyFont = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-body' });
const headingFont = Plus_Jakarta_Sans({ subsets: ['latin'], display: 'swap', variable: '--font-heading' });
const editorialFont = Instrument_Serif({ subsets: ['latin'], weight: '400', display: 'swap', variable: '--font-editorial' });

export const metadata: Metadata = {
  title: 'Ayushman Practice',
  description: 'Practice management for service professionals.',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: `try{document.documentElement.dataset.theme=localStorage.getItem('ayushman-theme')==='dark'?'dark':'light'}catch{document.documentElement.dataset.theme='light'}` }}/></head><body className={`${bodyFont.variable} ${headingFont.variable} ${editorialFont.variable}`}><CustomerSessionProvider><PracticeProvider>{children}</PracticeProvider></CustomerSessionProvider></body></html>;
}
