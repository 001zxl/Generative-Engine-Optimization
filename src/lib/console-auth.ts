import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, verifySessionToken } from "./auth";

/** Actions must enforce authentication themselves, independently of route middleware. */
export async function requireConsoleSession(): Promise<void> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!(await verifySessionToken(token))) redirect("/console/login");
}
