import { NextResponse, type NextRequest } from "next/server";

// Cheap redirect for signed-out visitors. Real verification happens in the API routes.
export function middleware(req: NextRequest) {
  if (!req.cookies.get("lr_session")?.value) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/dashboard/:path*"] };
