'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { logout } from '../login/actions';

export function Nav() {
  const pathname = usePathname();

  function navLink(href: string, label: string) {
    const isActive = href === '/'
      ? pathname === '/' || pathname.startsWith('/dashboard/markets')
      : pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        className={`text-sm ${isActive ? 'text-gray-900 font-medium' : 'text-gray-600 hover:text-gray-900'}`}
      >
        {label}
      </Link>
    );
  }

  return (
    <nav className="bg-white border-b border-gray-200 px-4 md:px-6 py-3 overflow-x-auto">
      <div className="flex items-center gap-4 md:gap-6 min-w-max">
        <Link href="/" className="text-lg font-bold text-gray-900">
          Predmarks
        </Link>

        {navLink('/dashboard/topics', 'Temas')}
        {navLink('/dashboard/mercados', 'Mercados')}
        {navLink('/dashboard/signals', 'Señales')}
        {navLink('/dashboard/rules', 'Reglas')}
        {navLink('/dashboard/activity', 'Log')}
        {navLink('/dashboard/analytics', 'Analytics')}
        {navLink('/dashboard/usage', 'Uso')}

        <form action={logout} className="ml-auto">
          <button
            type="submit"
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Salir
          </button>
        </form>
      </div>
    </nav>
  );
}
