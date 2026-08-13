import type { Metadata } from 'next';
import { WaitlistLanding } from '@/components/WaitlistLanding';

export const metadata: Metadata = {
  title: 'Join the waitlist',
  description:
    'Be first to know when RenovateConnect launches in your Bay Area city — instant AI renovation estimates and licensed contractors, with no lead-selling. Contractors can claim a founding spot.',
  alternates: { canonical: '/waitlist' },
  openGraph: {
    title: 'Join the RenovateConnect waitlist',
    description:
      'Instant AI renovation estimates and licensed Bay Area contractors. Homeowners join free; contractors can claim a founding spot.',
    images: [{ url: '/img/living.jpg', width: 1000, height: 677, alt: 'A bright, modern living room' }],
  },
};

export default function WaitlistPage() {
  return <WaitlistLanding />;
}
