import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const replaceMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    replace: replaceMock,
    push: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// Import AFTER vi.mock so the mocked module is in place
import SignupPage from '@/app/signup/page';

describe('SignupPage', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    replaceMock.mockReset();
    fetchMock = vi.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    // Clear any pc_token cookie set by a prior test
    document.cookie = 'pc_token=; Path=/; Max-Age=0; SameSite=Lax';
  });

  async function fillForm(user: ReturnType<typeof userEvent.setup>) {
    await user.type(screen.getByLabelText(/organization name/i), 'Acme Co');
    await user.type(screen.getByLabelText(/first name/i), 'Ada');
    await user.type(screen.getByLabelText(/last name/i), 'Lovelace');
    await user.type(screen.getByLabelText(/^email$/i), 'ada@acme.test');
    await user.type(screen.getByLabelText(/^password$/i), 'password123');
    await user.type(screen.getByLabelText(/confirm password/i), 'password123');
  }

  it('submits the form, stores the token, and redirects to /dashboard', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({
        success: true,
        data: { token: 'test-token', organizationId: 'org-1', userId: 'user-1' },
      }),
    });
    const user = userEvent.setup();
    render(<SignupPage />);
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /create organization/i }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/auth\/signup$/);
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      organizationName: 'Acme Co',
      ownerFirstName: 'Ada',
      ownerLastName: 'Lovelace',
      ownerEmail: 'ada@acme.test',
      ownerPassword: 'password123',
    });
    expect(typeof body.timezone).toBe('string');
    expect(body.timezone.length).toBeGreaterThan(0);
    expect(document.cookie).toContain('pc_token=test-token');
    expect(replaceMock).toHaveBeenCalledWith('/dashboard');
  });

  it('shows the already-bootstrapped message and a sign-in link on FORBIDDEN', async () => {
    fetchMock.mockResolvedValueOnce({
      json: async () => ({
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Bootstrap signup is only available before any organization exists',
        },
      }),
    });
    const user = userEvent.setup();
    render(<SignupPage />);
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /create organization/i }));

    expect(
      screen.getByText('An organization is already set up. Please sign in instead.'),
    ).toBeInTheDocument();
    const signInLink = screen.getByRole('link', { name: /sign in/i });
    expect(signInLink).toHaveAttribute('href', '/login');
    expect(replaceMock).not.toHaveBeenCalled();
    expect(document.cookie).not.toContain('pc_token=test-token');
  });

  it('shows a local error and does not call the API on password mismatch', async () => {
    const user = userEvent.setup();
    render(<SignupPage />);
    await user.type(screen.getByLabelText(/organization name/i), 'Acme Co');
    await user.type(screen.getByLabelText(/first name/i), 'Ada');
    await user.type(screen.getByLabelText(/last name/i), 'Lovelace');
    await user.type(screen.getByLabelText(/^email$/i), 'ada@acme.test');
    await user.type(screen.getByLabelText(/^password$/i), 'password123');
    await user.type(screen.getByLabelText(/confirm password/i), 'differentpw');
    await user.click(screen.getByRole('button', { name: /create organization/i }));

    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
