import type { Metadata } from 'next';
import { siteName } from '@/lib/config';

export const metadata: Metadata = {
  title: 'Terms of Service',
  description: `The terms that govern your use of ${siteName}.`,
};

const UPDATED = 'June 26, 2026';

// The legal entity that operates the service. Replace with the registered
// company name (e.g. "RenovateConnect, Inc.") once formed; this string flows
// through the agreement so it only needs to change in one place.
const OPERATOR = `${siteName}`;

export default function TermsPage() {
  return (
    <main className="container">
      <h1>Terms of Service</h1>
      <p className="muted">Last updated: {UPDATED}</p>

      <p>
        These Terms of Service (the &ldquo;Terms&rdquo;) are a binding agreement
        between you and {OPERATOR} (&ldquo;{siteName},&rdquo; &ldquo;we,&rdquo;
        &ldquo;us,&rdquo; or &ldquo;our&rdquo;) and govern your access to and use
        of the {siteName} mobile application, website, and related services
        (together, the &ldquo;Service&rdquo;). By creating an account, tapping
        &ldquo;I agree,&rdquo; or otherwise using the Service, you agree to these
        Terms. If you do not agree, do not use the Service.
      </p>
      <p>
        <strong>
          Please read Section&nbsp;19 (Binding Arbitration and Class Action
          Waiver) carefully. It requires most disputes to be resolved by
          individual arbitration rather than in court, and waives your right to a
          jury trial and to participate in a class action, unless you opt out
          within 30 days.
        </strong>
      </p>

      <h2>1. Who may use the Service</h2>
      <p>
        You must be at least 18 years old and able to form a binding contract to
        use the Service. If you use the Service on behalf of a business (for
        example, as a contractor or an authorized representative of a contracting
        company), you represent that you are authorized to bind that business to
        these Terms, and &ldquo;you&rdquo; refers to both you and that business.
        The Service is intended for users in the United States; we make no
        representation that it is appropriate or available elsewhere.
      </p>

      <h2>2. What {siteName} is — and what it is not</h2>
      <p>
        {siteName} is an online marketplace and communications tool that helps
        homeowners and other property owners (&ldquo;Homeowners&rdquo;) discover,
        contact, and transact with independent renovation contractors and
        contracting companies (&ldquo;Contractors&rdquo;). {siteName} is a venue
        only.
      </p>
      <ul>
        <li>
          We are <strong>not</strong> a party to any agreement between a
          Homeowner and a Contractor, and we do not perform, supervise, manage,
          inspect, guarantee, or warrant any renovation, repair, construction, or
          other work.
        </li>
        <li>
          Contractors are independent third parties. They are{' '}
          <strong>not</strong> our employees, agents, partners, joint venturers,
          or representatives, and we do not control and are not responsible for
          their conduct, qualifications, licensing, insurance, work quality,
          timeliness, pricing, safety practices, or legal compliance.
        </li>
        <li>
          A Contractor&rsquo;s presence on the Service — including any
          &ldquo;Verified&rdquo; badge, rating, review, cost tier, sponsored
          placement, or search ranking — is not an endorsement, recommendation,
          referral, certification, or guarantee by us.
        </li>
        <li>
          You are solely responsible for evaluating, selecting, contracting with,
          and supervising any Contractor or Homeowner, and for deciding whether
          to enter into any transaction. We strongly encourage you to
          independently verify licenses, insurance, references, permits, and the
          terms of any work before you pay or begin a project.
        </li>
      </ul>

      <h2>3. Your account</h2>
      <p>
        You agree to provide accurate, current, and complete information and to
        keep it up to date. You are responsible for safeguarding your login
        credentials and for all activity under your account. Notify us promptly
        of any unauthorized use. You may delete your account at any time in the
        app (Profile &rarr; Delete account); deletion is described further in our{' '}
        <a href="/privacy">Privacy Policy</a>.
      </p>

      <h2>4. The Homeowner&ndash;Contractor relationship</h2>
      <p>
        Any contract for renovation work is solely between the Homeowner and the
        Contractor. We are not responsible for, and disclaim all liability
        arising from, those contracts, including scope, price, change orders,
        materials, workmanship, delays, abandonment, property damage, personal
        injury, code or permit compliance, warranties, liens, or disputes. You
        release {siteName} from claims, demands, and damages of every kind
        arising out of or connected with any such dispute or transaction, to the
        fullest extent permitted by law.
      </p>

      <h2>5. Verification, badges, listings, and rankings</h2>
      <p>
        Where shown, a &ldquo;Verified&rdquo; badge reflects a limited,
        point-in-time review of certain information a Contractor submitted (which
        may include identity and a license or insurance document) at or around
        the time of review. It is <strong>not</strong> an ongoing guarantee and
        does not confirm that a Contractor remains licensed or insured, that any
        document is genuine or current, or that the Contractor is competent,
        trustworthy, or suitable for your project. We may add, withhold, or
        remove a badge at our discretion and may rely on third-party sources we
        do not control. You must independently confirm a Contractor&rsquo;s
        license and insurance status with the relevant authorities (for example,
        a state licensing board) before hiring.
      </p>
      <p>
        Search results, &ldquo;Verified Pros,&rdquo; cost tiers, and similar
        features are organized using factors such as verification, ratings, and
        relevance, and are provided for convenience without any warranty.
        Sponsored placements are clearly labeled, are paid placements, and do not
        reorder or alter the organic (non-paid) results.
      </p>

      <h2>6. AI estimates and the AI assistant</h2>
      <p>
        The Service offers photo-based cost estimates and an in-app assistant
        generated by artificial intelligence. These outputs are{' '}
        <strong>informational ranges and general information only</strong>. They
        are not quotes, bids, appraisals, inspections, or professional advice of
        any kind, may be inaccurate or incomplete, and should not be relied upon
        as a substitute for a licensed professional&rsquo;s assessment. Actual
        prices, scope, and feasibility are determined solely by the Contractor
        you engage. You assume all risk of relying on any AI-generated output.
      </p>

      <h2>7. Reviews, photos, and other user content</h2>
      <p>
        The Service lets you submit content such as reviews, ratings, messages,
        photos, project details, and profile information (&ldquo;User
        Content&rdquo;). You retain ownership of your User Content. You grant{' '}
        {siteName} a worldwide, non-exclusive, royalty-free, sublicensable, and
        transferable license to host, store, reproduce, modify (for formatting
        and display), publish, and display your User Content to operate, improve,
        and promote the Service. This license survives for content that is part
        of another user&rsquo;s record (for example, a review left on a
        Contractor) even after you delete your account, except as required by
        law.
      </p>
      <p>You represent and warrant that:</p>
      <ul>
        <li>
          you own or have the rights to your User Content and to grant the
          license above;
        </li>
        <li>
          your User Content does not infringe any third party&rsquo;s
          intellectual-property, privacy, or other rights — including that any
          project photos you upload are yours to share; and
        </li>
        <li>
          your reviews reflect your genuine, firsthand experience and are not
          false, deceptive, defamatory, or paid for.
        </li>
      </ul>
      <p>
        We do not endorse and are not responsible for User Content, and we are
        not liable for any User Content provided by others. We are not obligated
        to monitor User Content but may, at our discretion, remove or refuse
        content that violates these Terms or that we believe is unlawful,
        fraudulent, or harmful. We do not condition any benefit on your writing a
        positive review and do not prohibit honest reviews.
      </p>

      <h2>8. Payments, deposits, and platform fees</h2>
      <p>
        Payment processing is provided by Stripe and is subject to the{' '}
        <a href="https://stripe.com/legal/connect-account" rel="noreferrer">
          Stripe Connected Account Agreement
        </a>{' '}
        and Stripe&rsquo;s other terms. We do not store full payment-card numbers.
      </p>
      <ul>
        <li>
          When a Homeowner accepts a quote and pays an in-app deposit, the
          deposit is collected through Stripe and directed to the Contractor, and{' '}
          {siteName} charges a platform commission. The deposit amount and our
          commission are displayed before you confirm payment.
        </li>
        <li>
          The in-app deposit is a payment facilitated between the Homeowner and
          the Contractor. {siteName} is not the seller of any renovation services
          and is not a party to the underlying contract. Contractors are
          responsible for ensuring that the deposit amount, payment terms, and
          contract comply with applicable law (including any limits on advance
          payments or down payments for home-improvement work and any required
          notices or cancellation rights).
        </li>
        <li>
          Fees and pricing may change prospectively; changes do not affect
          transactions already confirmed. You are responsible for any taxes
          associated with your transactions, other than taxes on our net income.
        </li>
      </ul>

      <h2>9. Milestone escrow and dispute assistance</h2>
      <p>
        For some projects, deposit or milestone funds may be held by our payment
        processor and released according to the schedule shown in the app (for
        example, automatic release after a set period, or earlier on Homeowner
        approval). These funds are held by a third-party payment processor, are
        not bank deposits, are not insured by the FDIC or any government agency,
        and do not earn interest for you.
      </p>
      <p>
        If a Homeowner and Contractor disagree, either may raise a dispute in the
        app, which may pause an automatic release. Any review or decision we make
        to release or refund funds is an operational application of our platform
        policies for the limited purpose of administering payments. It is{' '}
        <strong>not</strong> arbitration, mediation, a legal judgment, or a
        determination of any party&rsquo;s legal rights, and it does not limit
        either party&rsquo;s right to pursue remedies directly against the other.
        We are not an escrow agent, fiduciary, collection agent, or arbitrator,
        and we disclaim liability for any release, refund, hold, or dispute
        outcome.
      </p>

      <h2>10. Refunds and chargebacks</h2>
      <p>
        Refunds of a Homeowner deposit, where available, are processed through
        Stripe and may be initiated by the Contractor or by us in accordance with
        our policies. Platform commissions and subscription fees are generally
        non-refundable except where required by law or expressly stated. If you
        initiate a chargeback or payment dispute that we determine to be invalid,
        we may suspend your account and recover related amounts and costs.
      </p>

      <h2>11. Contractor Pro subscriptions and automatic renewal</h2>
      <p>This section applies to Contractors who purchase a paid subscription.</p>
      <ul>
        <li>
          <strong>Plans and trials.</strong> Optional Pro plans (for example,
          Sponsored and Insights) may be offered, sometimes with a free trial.
          Plan names, prices, billing intervals, and any trial length are shown
          at sign-up.
        </li>
        <li>
          <strong>Automatic renewal.</strong> Subscriptions automatically renew
          for successive periods at the then-current price, and any free trial
          automatically converts to a paid subscription unless you cancel before
          it ends. By subscribing, you authorize us and our payment processor to
          charge your payment method on a recurring basis until you cancel.
        </li>
        <li>
          <strong>How to cancel.</strong> You may cancel at any time through the
          subscription-management settings in the app or, for purchases made
          through Apple, through your Apple ID subscription settings.
          Cancellation takes effect at the end of the current billing period; you
          retain access until then. Except where required by law, fees already
          charged are not refunded.
        </li>
        <li>
          <strong>Sponsored placement.</strong> A subscription may make a
          Contractor eligible for clearly-labeled Sponsored placement. Sponsored
          placement never changes the organic search ranking and is not a
          guarantee of leads, contacts, inquiries, hires, revenue, or any
          particular result.
        </li>
      </ul>

      <h2>12. Additional terms for Contractors</h2>
      <ul>
        <li>
          <strong>Legal compliance.</strong> You represent and warrant that you
          hold and will maintain all licenses, registrations, bonds, and
          insurance required for your work, and that you will comply with all
          applicable laws, including contractor-licensing, home-improvement,
          consumer-protection, lien, permitting, building-code, and tax laws. You
          are solely responsible for your contracts with Homeowners.
        </li>
        <li>
          <strong>Accurate listings.</strong> Your profile, specialties,
          portfolio, pricing information, and any documents you submit must be
          truthful, current, and not misleading. You authorize us to display
          information derived from your listings (such as a derived cost tier).
        </li>
        <li>
          <strong>Payouts and taxes.</strong> To receive in-app payments you must
          onboard a Stripe Connect account and accept the Stripe Connected
          Account Agreement. You are responsible for your own taxes and for any
          tax reporting (including any Form 1099 obligations) related to your
          earnings.
        </li>
        <li>
          <strong>No circumvention.</strong> You may not use the Service to
          solicit users and then move an agreed in-app transaction off-platform
          to avoid fees, nor harvest user contact information for purposes outside
          the Service.
        </li>
      </ul>

      <h2>13. Additional terms for Homeowners</h2>
      <p>
        You are responsible for vetting any Contractor, for the terms of any work
        you authorize, for obtaining required permits where you are responsible,
        and for providing safe and lawful site access. Consider obtaining a
        written contract, confirming licensing and insurance, and understanding
        any advance-payment limits and cancellation rights that may apply to
        home-improvement work in your jurisdiction before you pay a deposit or
        allow work to begin.
      </p>

      <h2>14. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>
          use the Service for any unlawful, fraudulent, deceptive, harassing, or
          harmful purpose;
        </li>
        <li>
          post false reviews, impersonate others, or misrepresent your identity,
          affiliation, or qualifications;
        </li>
        <li>
          circumvent fees by moving agreed in-app payments off-platform, or
          interfere with the payment or escrow flows;
        </li>
        <li>
          scrape, crawl, harvest, reverse-engineer, or attempt to access data,
          accounts, or systems you are not authorized to access;
        </li>
        <li>
          upload malware, overload or disrupt the Service, or violate any
          person&rsquo;s privacy or intellectual-property rights; or
        </li>
        <li>
          use the Service to send unlawful, unsolicited, or harassing
          communications.
        </li>
      </ul>
      <p>
        We may investigate and may suspend or terminate accounts, remove content,
        and report activity to authorities for any violation of these Terms.
      </p>

      <h2>15. Intellectual property</h2>
      <p>
        The Service, including its software, design, text, graphics, logos, and
        trademarks, is owned by {OPERATOR} or its licensors and is protected by
        intellectual-property laws. We grant you a limited, revocable,
        non-exclusive, non-transferable license to use the Service for its
        intended purpose. You may not copy, modify, distribute, sell, or create
        derivative works from the Service except as expressly permitted.
      </p>

      <h2>16. Copyright and DMCA</h2>
      <p>
        We respect intellectual-property rights. If you believe content on the
        Service infringes your copyright, send a notice with the information
        required by the Digital Millennium Copyright Act (identification of the
        work, the allegedly infringing material and its location, your contact
        information, a good-faith statement, and a statement under penalty of
        perjury that you are authorized to act) to{' '}
        <a href="mailto:legal@renovateconnect.app">legal@renovateconnect.app</a>.
        We may remove allegedly infringing content and terminate repeat
        infringers.
      </p>

      <h2>17. Third-party services</h2>
      <p>
        The Service relies on and links to third-party services, including Stripe
        (payments), Apple (app distribution and in-app purchases), Anthropic (AI
        processing), and cloud hosting and storage providers. Your use of those
        services is subject to their terms, and we are not responsible for them.
      </p>

      <h2>18. Apple App Store</h2>
      <p>
        If you obtained the app through the Apple App Store, you acknowledge that
        these Terms are between you and {OPERATOR} only, not Apple, and that Apple
        is not responsible for the app or its content. Apple has no obligation to
        provide support or maintenance. To the extent the app fails to conform to
        any applicable warranty, you may notify Apple for a refund of the
        purchase price (if any); Apple has no other warranty obligation. Apple is
        not responsible for addressing product-liability, third-party
        intellectual-property, or consumer-protection claims relating to the app.
        You agree to comply with applicable third-party terms (including the App
        Store Terms of Service) and represent that you are not in a country
        subject to a U.S. embargo or on a U.S. prohibited-party list. Apple and
        its subsidiaries are third-party beneficiaries of these Terms and may
        enforce them against you.
      </p>

      <h2>19. Binding arbitration and class action waiver</h2>
      <p>
        <strong>
          Please read this section carefully. It affects your legal rights.
        </strong>
      </p>
      <p>
        Except for the matters described below, you and {siteName} agree that any
        dispute, claim, or controversy arising out of or relating to these Terms
        or the Service (a &ldquo;Dispute&rdquo;) will be resolved by{' '}
        <strong>binding individual arbitration</strong>, administered by a
        recognized arbitration provider under its consumer rules, rather than in
        court. The arbitration will take place in the county of your residence or
        another mutually agreed location, and judgment on the award may be entered
        in any court of competent jurisdiction. The Federal Arbitration Act
        governs the interpretation and enforcement of this section.
      </p>
      <p>
        <strong>Class action waiver.</strong> You and {siteName} agree that each
        may bring claims against the other only in an individual capacity, and not
        as a plaintiff or class member in any purported class, collective, or
        representative proceeding. The arbitrator may not consolidate more than
        one person&rsquo;s claims or preside over any form of representative or
        class proceeding.
      </p>
      <p>
        <strong>Jury trial waiver.</strong> You and {siteName} waive any right to
        a jury trial for any Dispute.
      </p>
      <p>
        <strong>Exceptions.</strong> Either party may bring an individual claim in
        small-claims court, and either party may seek injunctive or equitable
        relief in court to protect its intellectual-property rights. Nothing here
        waives rights that cannot be waived under applicable law.
      </p>
      <p>
        <strong>30-day right to opt out.</strong> You may opt out of this
        arbitration and class-action-waiver section by emailing{' '}
        <a href="mailto:legal@renovateconnect.app">legal@renovateconnect.app</a>{' '}
        within 30 days of first accepting these Terms, stating your name, account
        email, and a clear statement that you opt out of arbitration. Opting out
        does not affect any other part of these Terms.
      </p>

      <h2>20. Communications and notifications</h2>
      <p>
        By using the Service, you agree that we may send you transactional and
        service messages (such as account, payment, dispute, and security
        notices) by email, push notification, or in-app message. You can manage
        push notifications by type in the app and at the device level. Where we
        send optional or promotional messages, you may opt out using the method
        provided in the message.
      </p>

      <h2>21. Disclaimer of warranties</h2>
      <p>
        THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS
        AVAILABLE,&rdquo; WITHOUT WARRANTIES OF ANY KIND, WHETHER EXPRESS,
        IMPLIED, OR STATUTORY. TO THE FULLEST EXTENT PERMITTED BY LAW, {siteName}{' '}
        DISCLAIMS ALL IMPLIED WARRANTIES, INCLUDING MERCHANTABILITY, FITNESS FOR A
        PARTICULAR PURPOSE, TITLE, AND NON-INFRINGEMENT, AND ANY WARRANTY THAT THE
        SERVICE WILL BE UNINTERRUPTED, SECURE, ERROR-FREE, OR ACCURATE. WE MAKE NO
        WARRANTY REGARDING ANY CONTRACTOR, HOMEOWNER, USER CONTENT, AI OUTPUT, OR
        ANY GOODS OR SERVICES OBTAINED THROUGH THE SERVICE. SOME JURISDICTIONS DO
        NOT ALLOW CERTAIN DISCLAIMERS, SO SOME OF THE ABOVE MAY NOT APPLY TO YOU.
      </p>

      <h2>22. Limitation of liability</h2>
      <p>
        TO THE FULLEST EXTENT PERMITTED BY LAW, {siteName} AND ITS OFFICERS,
        DIRECTORS, EMPLOYEES, AND AGENTS WILL NOT BE LIABLE FOR ANY INDIRECT,
        INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY, OR PUNITIVE DAMAGES, OR FOR
        ANY LOSS OF PROFITS, REVENUE, DATA, GOODWILL, OR OTHER INTANGIBLE LOSSES,
        OR FOR ANY PROPERTY DAMAGE OR PERSONAL INJURY ARISING FROM RENOVATION
        WORK, ARISING OUT OF OR RELATING TO THE SERVICE, EVEN IF ADVISED OF THE
        POSSIBILITY OF SUCH DAMAGES. TO THE FULLEST EXTENT PERMITTED BY LAW, OUR
        TOTAL LIABILITY FOR ALL CLAIMS RELATING TO THE SERVICE WILL NOT EXCEED THE
        GREATER OF (A) THE TOTAL PLATFORM FEES YOU PAID US IN THE TWELVE MONTHS
        BEFORE THE EVENT GIVING RISE TO THE CLAIM, OR (B) ONE HUNDRED U.S. DOLLARS
        (US$100). THESE LIMITS DO NOT APPLY TO LIABILITY THAT CANNOT BE LIMITED
        UNDER APPLICABLE LAW. SOME JURISDICTIONS DO NOT ALLOW CERTAIN LIMITATIONS,
        SO SOME OF THE ABOVE MAY NOT APPLY TO YOU.
      </p>

      <h2>23. Indemnification</h2>
      <p>
        You agree to indemnify, defend, and hold harmless {siteName} and its
        officers, directors, employees, and agents from and against any claims,
        liabilities, damages, losses, and expenses (including reasonable
        attorneys&rsquo; fees) arising out of or related to: (a) your use of the
        Service; (b) your User Content; (c) your violation of these Terms or any
        law; (d) any transaction, contract, work, or dispute between you and
        another user; or (e) your violation of any third-party right.
      </p>

      <h2>24. Termination</h2>
      <p>
        You may stop using the Service and delete your account at any time. We may
        suspend or terminate your access at any time, with or without notice, if
        we believe you have violated these Terms or to protect the Service or its
        users. Sections that by their nature should survive termination —
        including Sections 4&ndash;10, 15&ndash;19, and 21&ndash;25 — survive.
      </p>

      <h2>25. Governing law and venue</h2>
      <p>
        These Terms are governed by the laws of the State of California, without
        regard to conflict-of-laws rules. Subject to Section&nbsp;19 (Binding
        Arbitration), any dispute not subject to arbitration will be brought
        exclusively in the state or federal courts located in San Francisco
        County, California, and you consent to their jurisdiction and venue.
      </p>

      <h2>26. Changes to the Service and these Terms</h2>
      <p>
        We may modify, suspend, or discontinue any part of the Service at any
        time. We may also update these Terms; if we make material changes, we will
        post the updated Terms here and update the date above, and where required
        we will provide additional notice. Your continued use of the Service after
        changes take effect constitutes acceptance of the updated Terms.
      </p>

      <h2>27. Force majeure</h2>
      <p>
        We are not liable for any failure or delay in performance caused by events
        beyond our reasonable control, including acts of God, natural disasters,
        outages, labor disputes, or actions of third-party providers.
      </p>

      <h2>28. General</h2>
      <p>
        These Terms, together with our <a href="/privacy">Privacy Policy</a>, are
        the entire agreement between you and {siteName} regarding the Service. If
        any provision is found unenforceable, the remaining provisions remain in
        effect, and the unenforceable provision will be limited to the minimum
        extent necessary. Our failure to enforce a provision is not a waiver. You
        may not assign these Terms without our consent; we may assign them in
        connection with a merger, acquisition, or sale of assets. Headings are for
        convenience only.
      </p>

      <h2>29. Contact</h2>
      <p>
        Questions about these Terms:{' '}
        <a href="mailto:support@renovateconnect.app">
          support@renovateconnect.app
        </a>
        . Legal and copyright notices:{' '}
        <a href="mailto:legal@renovateconnect.app">legal@renovateconnect.app</a>.
      </p>
    </main>
  );
}
