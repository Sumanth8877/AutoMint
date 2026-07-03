export const clerkThemeTokens = {
  background: '#F8FAFC',
  surface: '#FFFFFF',
  elevated: '#FFFFFF',
  primary: '#4F46E5',
  primaryHover: '#4338CA',
  accent: '#4F46E5',
  gold: '#F59E0B',
  text: '#0F172A',
  secondaryText: '#475569',
  mutedText: '#94A3B8',
  border: '#E2E8F0',
  danger: '#EF4444',
  success: '#10B981',
  warning: '#F59E0B',
} as const;

const inputBase =
  'border border-[#E2E8F0] bg-[#FFFFFF] text-[#0F172A] ' +
  'caret-[#4F46E5] placeholder:text-[#94A3B8]/60 ' +
  'focus:border-[#4F46E5]/50 focus:ring-2 focus:ring-[#4F46E5]/10 focus:outline-none transition';

const baseElements = {
  rootBox: 'clerk-automint w-full',
  cardBox: 'w-full shadow-lg',
  card: 'w-full border border-[#E2E8F0] bg-[#FFFFFF] text-[#0F172A] relative overflow-hidden rounded-xl',
  main: 'text-[#0F172A]',
  header: 'text-[#0F172A]',
  headerTitle: 'text-[#0F172A] font-bold tracking-tight',
  headerSubtitle: 'text-[#475569]',
  formHeaderTitle: 'text-[#0F172A] font-bold',
  formHeaderSubtitle: 'text-[#475569]',
  socialButtonsBlockButton:
    'border border-[#E2E8F0] bg-[#F8FAFC] text-[#0F172A] hover:border-[#CBD5E1] hover:bg-[#F1F5F9] transition',
  socialButtonsBlockButtonText: 'text-[#0F172A]',
  dividerLine: 'bg-[#E2E8F0]',
  dividerText: 'text-[#94A3B8]',
  formFieldLabel: 'text-xs font-semibold uppercase tracking-wider text-[#475569]',
  formFieldInput: inputBase,
  formFieldAction: 'text-[#4F46E5] hover:text-[#4338CA] transition',
  formFieldHintText: 'text-[#94A3B8]',
  formFieldErrorText: 'text-[#EF4444]',
  formResendCodeLink: 'text-[#4F46E5] hover:text-[#4338CA]',
  formButtonPrimary:
    'bg-[#4F46E5] text-white font-semibold rounded-lg ' +
    'shadow-sm hover:bg-[#4338CA] hover:shadow-md transition',
  footer: 'bg-transparent border-t border-[#E2E8F0]',
  footerActionText: 'text-[#475569]',
  footerActionLink: 'text-[#4F46E5] hover:text-[#4338CA] transition',
  alert: 'border border-[#E2E8F0] bg-[#F8FAFC] text-[#0F172A]',
  alertText: 'text-[#0F172A]',
  alertIcon: 'text-[#F59E0B]',
  otpCodeFieldInput: `${inputBase} text-center text-xl font-bold`,
} as const;

export const clerkAppearance = {
  variables: {
    colorBackground:         '#F8FAFC',
    colorInputBackground:    '#FFFFFF',
    colorInputText:          '#0F172A',
    colorText:               '#0F172A',
    colorTextSecondary:      '#475569',
    colorPrimary:            '#4F46E5',
    colorDanger:             '#EF4444',
    colorSuccess:            '#10B981',
    colorWarning:            '#F59E0B',
    colorNeutral:            '#94A3B8',
    borderRadius:            '0.5rem',
    fontFamily:              'Geist, ui-sans-serif, system-ui, sans-serif',
    fontSmoothing:           'antialiased' as const,
  },
  elements: baseElements,
};
