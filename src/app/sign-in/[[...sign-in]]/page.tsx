import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div className="min-h-screen bg-[#050816] flex items-center justify-center p-4 relative overflow-hidden">
      {/* Background Glows */}
      <div
        className="absolute top-[-200px] left-[-200px] w-[600px] h-[600px] rounded-full pointer-events-none"
        style={{
          background: 'rgba(59,130,246,0.15)',
          filter: 'blur(120px)',
        }}
      />
      <div
        className="absolute bottom-[-300px] right-[-200px] w-[700px] h-[700px] rounded-full pointer-events-none"
        style={{
          background: 'rgba(124,58,237,0.12)',
          filter: 'blur(150px)',
        }}
      />

      <div className="w-full max-w-[420px] relative z-10">
        {/* Heading */}
        <div className="text-center mb-10">
          <h1
            className="text-5xl font-bold text-white mb-3"
            style={{ fontFamily: 'Space Grotesk, sans-serif' }}
          >
            Welcome Back
          </h1>
          <p className="text-lg text-slate-400">
            Sign in to your AutoMint dashboard
          </p>
        </div>

        {/* Clerk Sign In */}
        <SignIn
          appearance={{
            variables: {
              colorPrimary: '#3B82F6',
              colorBackground: 'rgba(17,24,39,0.85)',
              colorText: '#FFFFFF',
              colorTextSecondary: '#94A3B8',
              colorNeutral: '#CBD5E1',
              borderRadius: '14px',
              fontFamily: 'Inter, sans-serif',
              fontSize: '14px',
            } as any,
            elements: {
              rootBox: 'w-full',
              card: {
                padding: '32px',
                borderRadius: '24px',
                border: '1px solid rgba(59,130,246,0.15)',
                background: 'rgba(17,24,39,0.85)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                boxShadow: '0 0 40px rgba(59,130,246,0.15)',
                width: '100%',
              },
              headerTitle: {
                color: '#FFFFFF',
                fontWeight: '700',
                fontSize: '22px',
                fontFamily: 'Space Grotesk, sans-serif',
              },
              headerSubtitle: {
                color: '#94A3B8',
                fontSize: '14px',
              },
              socialButtonsBlockButton: {
                background: 'rgba(11,17,32,0.8)',
                border: '1px solid rgba(59,130,246,0.1)',
                color: '#FFFFFF',
                borderRadius: '14px',
                height: '48px',
                fontWeight: '500',
                transition: 'all 200ms',
              },
              socialButtonsBlockButton__google: {
                background: 'rgba(11,17,32,0.8)',
                border: '1px solid rgba(59,130,246,0.1)',
                color: '#FFFFFF',
                borderRadius: '14px',
                height: '48px',
              },
              dividerLine: {
                background: 'rgba(59,130,246,0.1)',
              },
              dividerText: {
                color: '#94A3B8',
              },
              formFieldLabel: {
                color: '#CBD5E1',
                fontWeight: '500',
                fontSize: '13px',
                marginBottom: '6px',
              },
              formFieldInput: {
                background: 'rgba(255,255,255,0.04)',
                border: '1px solid rgba(59,130,246,0.1)',
                color: '#FFFFFF',
                borderRadius: '14px',
                height: '48px',
                padding: '0 16px',
                fontSize: '14px',
                transition: 'all 200ms',
              },
              formFieldInput__focused: {
                border: '1px solid #3B82F6',
                boxShadow: '0 0 0 4px rgba(59,130,246,0.15)',
              },
              formButtonPrimary: {
                background: 'linear-gradient(90deg, #2563EB, #3B82F6)',
                height: '48px',
                borderRadius: '14px',
                color: '#FFFFFF',
                fontWeight: '600',
                fontSize: '15px',
                boxShadow: '0 0 25px rgba(59,130,246,0.35)',
                transition: 'all 200ms',
                marginTop: '8px',
              },
              formButtonPrimary__hovering: {
                transform: 'scale(1.02)',
                boxShadow: '0 0 35px rgba(59,130,246,0.45)',
              },
              footer: {
                display: 'none',
              },
              footerActionLink: {
                color: '#3B82F6',
                fontWeight: '500',
              },
              identityPreviewText: {
                color: '#FFFFFF',
              },
              identityPreviewEditButton: {
                color: '#3B82F6',
              },
              formFieldError: {
                color: '#EF4444',
                fontSize: '12px',
              },
              formFieldWarning: {
                color: '#F59E0B',
                fontSize: '12px',
              },
              formFieldInputShowPasswordButton: {
                color: '#94A3B8',
              },
              alert: {
                background: 'rgba(239,68,68,0.1)',
                border: '1px solid rgba(239,68,68,0.2)',
                borderRadius: '14px',
                color: '#EF4444',
              },
              // Hide Clerk branding / dev badge
              badge: {
                display: 'none',
              },
              headerSubtitle__signIn: {
                display: 'none',
              },
            },
          }}
        />
      </div>
    </div>
  );
}