import Link from 'next/link';

export const metadata = {
  title: 'Privacy Policy - PunchClock Pro',
  description: 'Privacy Policy for PunchClock Pro',
};

export default function PrivacyPage() {
  return (
    <main className="flex min-h-screen flex-col bg-gradient-to-b from-brand-50 to-white p-6">
      <div className="mx-auto w-full max-w-3xl flex-1 py-12">
        <h1 className="mb-2 text-3xl font-bold text-brand-900">Privacy Policy</h1>
        <p className="mb-8 text-sm text-slate-600">Last updated: 2026-05-26</p>

        <div className="space-y-8 text-slate-900">
          <section>
            <h2 className="mb-3 text-xl font-semibold text-brand-900">1. Overview</h2>
            <p>
              PunchClock Pro ("Service") is committed to protecting the privacy of employee and
              organizational data. This Privacy Policy explains what information we collect, how we
              use it, and how we protect it.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-brand-900">2. Data We Collect</h2>
            <p className="mb-3">PunchClock Pro collects the following types of information:</p>
            <ul className="space-y-2 list-inside list-disc">
              <li>
                <strong>Employee Information:</strong> Names, email addresses, phone numbers, and
                employee identification numbers.
              </li>
              <li>
                <strong>Time and Attendance Data:</strong> Clock-in and clock-out times, hours
                worked, and work schedules.
              </li>
              <li>
                <strong>Location Information:</strong> GPS coordinates and IP addresses at the time
                of clock-in or clock-out (when enabled).
              </li>
              <li>
                <strong>Uploaded Documents:</strong> Certifications, licenses, training
                documentation, and other employment-related files.
              </li>
              <li>
                <strong>System Usage Data:</strong> Login activity, feature usage, and error logs
                for service improvement and support.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-brand-900">3. How We Use Your Data</h2>
            <p className="mb-3">We use collected data for the following purposes:</p>
            <ul className="space-y-2 list-inside list-disc">
              <li>
                <strong>Time Tracking and Payroll:</strong> Recording work hours and supporting
                accurate payroll processing.
              </li>
              <li>
                <strong>Scheduling:</strong> Creating and managing employee work schedules.
              </li>
              <li>
                <strong>Compliance and Auditing:</strong> Maintaining records for labor law
                compliance and internal audits.
              </li>
              <li>
                <strong>Analytics and Reporting:</strong> Generating workforce insights, reports,
                and business intelligence for the organization.
              </li>
              <li>
                <strong>Customer Support:</strong> Assisting with service issues and technical
                support.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-brand-900">4. Data Sharing</h2>
            <p>
              Your data is not sold, shared, or rented to third parties for marketing purposes.
              Within your organization, data is accessible to:
            </p>
            <ul className="space-y-2 list-inside list-disc">
              <li>The business owner and managers with appropriate permissions.</li>
              <li>Employees who have authorized access to their own records.</li>
            </ul>
            <p className="mt-3">
              We may disclose data if required by law or court order, and we may engage service
              providers (hosting, analytics) under strict data processing agreements.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-brand-900">5. Data Retention</h2>
            <p>
              The business owner controls data retention policies. By default, operational data
              (time logs, schedules) is retained for approximately 365 days. Audit logs and employee
              documents may be retained longer as determined by the owner or as required by law. You
              may request deletion of your personal data by contacting your organization
              administrator.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-brand-900">6. Security</h2>
            <p className="mb-3">We implement industry-standard security measures:</p>
            <ul className="space-y-2 list-inside list-disc">
              <li>
                <strong>Encryption in Transit:</strong> All data transmitted over the internet uses
                HTTPS encryption.
              </li>
              <li>
                <strong>Encryption at Rest:</strong> Sensitive data is encrypted when stored on our
                servers.
              </li>
              <li>
                <strong>Password Security:</strong> Passwords are hashed using strong cryptographic
                algorithms and are never stored in plain text.
              </li>
              <li>
                <strong>PIN Security:</strong> Personal identification numbers are hashed and
                securely managed.
              </li>
              <li>
                <strong>Access Controls:</strong> Only authorized personnel with a legitimate
                business need have access to personal data.
              </li>
            </ul>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-brand-900">7. Your Rights</h2>
            <p className="mb-3">Depending on your location, you may have the right to:</p>
            <ul className="space-y-2 list-inside list-disc">
              <li>Access the personal data we hold about you.</li>
              <li>Correct inaccurate information.</li>
              <li>Request deletion of your data (subject to legal retention requirements).</li>
              <li>Object to certain types of data processing.</li>
            </ul>
            <p className="mt-3">
              To exercise any of these rights, contact your organization administrator or reach out
              to us directly.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-brand-900">8. Third-Party Services</h2>
            <p>
              We use third-party service providers for hosting, analytics, and support. These
              providers are contractually obligated to keep your data confidential and use it only
              as necessary to provide services to us.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-brand-900">9. Changes to This Policy</h2>
            <p>
              We may update this Privacy Policy from time to time. Changes will be posted with an
              updated "Last updated" date. Your continued use of the Service constitutes acceptance
              of changes.
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xl font-semibold text-brand-900">10. Contact</h2>
            <p>
              If you have questions or concerns about this Privacy Policy or our privacy practices,
              please contact us at:{' '}
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
