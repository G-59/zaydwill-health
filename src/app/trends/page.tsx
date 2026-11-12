import { redirect } from 'next/navigation';

// Everything now lives on one page; keep old links working.
export default function Page() {
  redirect('/#trends');
}
