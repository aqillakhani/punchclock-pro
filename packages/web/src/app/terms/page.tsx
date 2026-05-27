import Link from 'next/link';

export const metadata = {
  title: 'Terms of Service - PunchClock Pro',
  description: 'Terms of Service for PunchClock Pro',
};

export default function TermsPage() {
  return (
    <main className="flex min-h-screen flex-col bg-gradient-to-b from-brand-50 to-white p-6">
      <div className="mx-auto w-full max-w-3xl flex-1 py-12">
        <h1 className="mb-2 text-3xl font-bold text-brand-900">Terms of Service</h1>
        <p className="mb-8 text-sm text-slate-600">Last updated: 2026-05-26</p>

        <div className="space-y-8 text-slate-900">
          <section>
            <h2 className="mb-3 text-xl font-semibold text-brand-900">1. Service Provider</h2>
            <p>
              PunchClock Pro is a workforce time-tracking and scheduling application provided by
              PunchClock, Inc. ("we," "us," or "the Service Provider"). This service is provided
              exclusively to a single business organization and its employees.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-brand-900">
              2. Account Setup and Ownership
            </h2>
            <p>
              Accounts are provisioned by the business owner who initially sets up the organization.
              No public self-service signup is available. All user accounts within an organization
              are under the control and authority of the business owner.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-brand-900">3. Acceptable Use</h2>
            <p className="mb-3">
              You agree to use the Service in compliance with all applicable laws and regulations
              and commit to:
            </p>
            <ul className="space-y-2 list-inside list-disc">
              <li>
                Use the Service only for workforce management, time tracking, and scheduling
                purposes.
              </li>
              <li>
                Not attempt to gain unauthorized access to the Service or any related systems.
              </li>
              <li>Not use the Service to harass, abuse, or harm any individual or organization.</li>
              <li>
                Not attempt to reverse engineer, decompile, or extract the source code of the
                Service.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-brand-900">
              4. Disclaimer of Warranties
            </h2>
            <p>
              The Service is provided "AS IS" without warranty of any kind, express or implied. We
              do not warrant that the Service will be uninterrupted, error-free, or meet your
              specific requirements. Use of the Service is at your sole risk.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-brand-900">
              5. Limitation of Liability
            </h2>
            <p>
              To the fullest extent permitted by law, in no event shall PunchClock, Inc. be liable
              for any indirect, incidental, special, consequential, or punitive damages arising from
              your use of or inability to use the Service, even if we have been advised of the
              possibility of such damages.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-brand-900">
              6. Data Control and Privacy
            </h2>
            <p>
              The business owner is the data controller for all employee data collected through the
              Service, including names, emails, work hours, and location information. The Service
              Provider acts as a data processor. For details on data collection and handling, please
              see our Privacy Policy.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-brand-900">7. Termination</h2>
            <p>
              We may terminate or suspend access to the Service at any time, with or without cause.
              Upon termination, your right to use the Service immediately ceases. Data may be
              retained as required by law.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-brand-900">8. Governing Law</h2>
            <p>
              These Terms of Service are governed by and construed in accordance with the laws of
              the United States, and you irrevocably submit to the exclusive jurisdiction of the
              courts in that jurisdiction.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-brand-900">9. Contact</h2>
            <p>
              If you have questions about these Terms of Service, please contact us at:{' '}
              <a
                href="mailto:support@punchclock.example.com"
                className="text-brand-700 hover:underline"
              >
                support@punchclock.example.com
              </a>
            </p>
          </section>
        </div>
      </div>

      <div className="mx-auto w-full max-w-3xl border-t border-slate-200 py-6 text-center">
        <Link href="/login" className="text-sm text-brand-700 hover:underline">
          Back to Sign In
        </Link>
      </div>
    </main>
  );
}
