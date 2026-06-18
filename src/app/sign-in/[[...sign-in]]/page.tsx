import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-[#050816]">
      <SignIn />
    </div>
  );
}