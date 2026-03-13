import { NextRequest, NextResponse } from 'next/server';

const AUTH_USER = 'predmarks';
const AUTH_PASS = 'wallofshame';

export function middleware(request: NextRequest) {
  // Allow Inngest endpoint without auth
  if (request.nextUrl.pathname === '/api/inngest') {
    return NextResponse.next();
  }

  const auth = request.headers.get('authorization');

  if (auth) {
    const [scheme, encoded] = auth.split(' ');
    if (scheme === 'Basic' && encoded) {
      const decoded = atob(encoded);
      const [user, pass] = decoded.split(':');
      if (user === AUTH_USER && pass === AUTH_PASS) {
        return NextResponse.next();
      }
    }
  }

  return new NextResponse('Unauthorized', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Predmarks"' },
  });
}

export const config = {
  matcher: ['/dashboard/:path*', '/api/:path*'],
};
