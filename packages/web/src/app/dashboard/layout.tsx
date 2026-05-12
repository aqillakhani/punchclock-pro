import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { DashboardShell } from './DashboardShell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get('pc_token')?.value;
  if (!token) redirect('/login');

  return <DashboardShell>{children}</DashboardShell>;
}
