import { SignInPage } from "./SignInPage";

export default async function SignInRoute({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const params = await searchParams;
  return <SignInPage callbackUrl={params.callbackUrl ?? "/projects"} />;
}
