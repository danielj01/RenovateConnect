import type { Metadata } from 'next';
import { siteName } from '@/lib/config';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: `How ${siteName} collects, uses, and protects your information.`,
};

const UPDATED = 'June 11, 2026';

export default function PrivacyPage() {
  return (
    <main className="container">
      <h1>Privacy Policy</h1>
      <p className="muted">Last updated: {UPDATED}</p>

      <p>
        <strong>Your privacy, simply put.</strong> We never sell your
        information. Contractors only reach you when <em>you</em> contact them
        first — never by paying us. Any market data we share with pros is
        anonymized and grouped (city-level at most), so it can never point back
        to you. You can delete your account and data anytime.
      </p>

      <h2>What we collect, and why</h2>
      <ul>
        <li>
          <strong>Name and email</strong> — to create your account and to
          introduce you to contractors <em>you</em> choose to contact.
        </li>
        <li>
          <strong>Photos you upload</strong> — to generate AI renovation
          estimates and in messages you send. Photos appear only in
          conversations you start.
        </li>
        <li>
          <strong>Approximate location</strong> — for &ldquo;near me&rdquo;
          search, only while you search and only with your permission. Denying
          location keeps the app fully usable.
        </li>
        <li>
          <strong>Saved searches and estimates</strong> — to personalize the app
          and to power aggregate, anonymized demand trends.
        </li>
        <li>
          <strong>Device and usage data</strong> (including a push-notification
          token) — for reliability and the notifications you turn on.
        </li>
        <li>
          <strong>Payments</strong> — deposits and subscriptions are processed
          by Stripe. We never see or store full card numbers.
        </li>
      </ul>

      <h2>What contractors can and cannot see</h2>
      <p>
        A contractor only sees your details when you message them, request a
        quote, or book them — never before, and never by paying us. Your phone
        number, email, exact location, and search history are never exposed to
        contractors. Your contact info is not sold as a &ldquo;lead.&rdquo;
      </p>
      <p>
        Contractors on the paid Insights plan see only aggregated,
        de-identified market trends — counts by category, project type, and
        city. Every figure is a bucket of at least five people; anything smaller
        is hidden entirely, so no number can be traced back to you.
      </p>

      <h2>AI processing</h2>
      <p>
        Photo estimates and the in-app assistant are powered by Anthropic&rsquo;s
        Claude models. Photos and messages you submit for an estimate are sent
        to Anthropic for processing under our service agreement; they are not
        used to train models and are not shared with contractors unless you
        send them in a chat.
      </p>

      <h2>Where your data lives</h2>
      <p>
        Account data is stored in a managed PostgreSQL database; photos are
        stored in private cloud object storage (Amazon S3). Both are encrypted
        in transit. We retain your data while your account is active.
      </p>

      <h2>Your controls</h2>
      <ul>
        <li>
          <strong>Delete your account</strong> anytime in the app (Profile →
          Delete account). This removes your account and associated data.
        </li>
        <li>
          <strong>Location is opt-in</strong> and used only while you search.
        </li>
        <li>
          <strong>Notifications</strong> can be turned off per type.
        </li>
      </ul>

      <h2>Your rights</h2>
      <p>
        Depending on where you live (for example under the CCPA/CPRA in
        California or the GDPR in Europe), you may have rights to access,
        correct, delete, or port your personal information, and to opt out of
        sale or sharing. We do not sell or share personal information as those
        laws define it. To exercise any right, use the in-app deletion flow or
        email us.
      </p>

      <h2>Children</h2>
      <p>
        {siteName} is not directed to children under 13, and we do not knowingly
        collect their information.
      </p>

      <h2>Changes and contact</h2>
      <p>
        If we make material changes to this policy we will update this page and
        the date above. Questions or requests:{' '}
        <a href="mailto:privacy@renovateconnect.app">
          privacy@renovateconnect.app
        </a>
        .
      </p>
    </main>
  );
}
