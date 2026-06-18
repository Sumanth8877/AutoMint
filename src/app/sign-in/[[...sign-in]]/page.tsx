import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-[#050816] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1
            className="text-2xl font-bold text-white mb-2"
            style={{ fontFamily: 'Space Grotesk, sans-serif' }}
          >
            Welcome Back
          </h1>
          <p className="text-muted">Sign in to your AutoMint dashboard</p>
        </div>
        <SignIn
          appearance={{
            elements: {
              rootBox: 'w-full',
              card: 'w-full',
            },
          }}
        />
      </div>
    </div>
  );
}