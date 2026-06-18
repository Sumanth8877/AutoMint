import { SignUp } from '@clerk/nextjs';

export default function SignUpPage() {
  return (
    <div className="min-h-screen bg-[#050816] flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1
            className="text-2xl font-bold text-white mb-2"
            style={{ fontFamily: 'Space Grotesk, sans-serif' }}
          >
            Create Account
          </h1>
          <p className="text-muted">Join AutoMint and start minting</p>
        </div>
        <SignUp
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