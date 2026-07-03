export const clerkThemeTokens = {
  background: '#03040A',
  surface: '#080C14',
  elevated: '#101828',
  primary: '#00FF88',
  primaryHover: '#6D28D9',
  accent: '#00FF88',
  neon: '#00FF88',
  gold: '#F0A93B',
  text: '#E8F4FD',
  secondaryText: '#94A3B8',
  mutedText: '#4A5568',
  border: 'rgba(99,179,237,0.08)',
  danger: '#FF4D4D',
  success: '#00FF88',
  warning: '#F0A93B',
} as const;

const inputBase =
  'border border-[rgba(99,179,237,0.08)] bg-[#03040A]/80 text-[#E8F4FD] ' +
  'caret-[#00FF88] placeholder:text-[#4A5568]/60 ' +
  'focus:border-[#00FF88]/50 focus:ring-2 focus:ring-[#00FF88]/15 focus:outline-none transition';

const baseElements = {
  rootBox: 'clerk-automint w-full',
  cardBox: 'w-full shadow-[0_28px_90px_rgba(0,0,0,0.65)]',
  card: 'w-full border border-[rgba(99,179,237,0.10)] bg-[#101828] text-[#E8F4FD] relative overflow-hidden',
  main: 'text-[#E8F4FD]',
  header: 'text-[#E8F4FD]',
  headerTitle: 'text-[#E8F4FD] font-black tracking-tight',
  headerSubtitle: 'text-[#94A3B8]',
  formHeaderTitle: 'text-[#E8F4FD] font-black',
  formHeaderSubtitle: 'text-[#94A3B8]',
  socialButtonsBlockButton:
    'border border-[rgba(99,179,237,0.08)] bg-white/5 text-[#E8F4FD] hover:border-[#00FF88]/20 hover:bg-white/10 transition',
  socialButtonsBlockButtonText: 'text-[#E8F4FD]',
  dividerLine: 'bg-[rgba(99,179,237,0.08)]',
  dividerText: 'text-[#94A3B8]',
  formFieldLabel: 'text-[10px] font-bold uppercase tracking-[0.18em] text-[#94A3B8]',
  formFieldInput: inputBase,
  formFieldAction: 'text-[#00FF88] hover:text-[#00FF88]/80 transition',
  formFieldHintText: 'text-[#4A5568]',
  formFieldErrorText: 'text-[#FF4D4D]',
  formResendCodeLink: 'text-[#00FF88] hover:text-[#00FF88]/80',
  formButtonPrimary:
    'bg-gradient-to-r from-[#00FF88] to-[#00FF88]/80 text-white font-black uppercase tracking-widest ' +
    'shadow-[0_0_30px_rgba(0,255,136,0.25)] hover:shadow-[0_0_40px_rgba(0,255,136,0.40)] ' +
    'hover:brightness-110 transition',
  footer: 'bg-transparent border-t border-[rgba(99,179,237,0.06)]',
  footerActionText: 'text-[#94A3B8]',
  footerActionLink: 'text-[#00FF88] hover:text-[#E8F4FD] transition',
  alert: 'border border-[rgba(99,179,237,0.08)] bg-[#03040A] text-[#E8F4FD]',
  alertText: 'text-[#E8F4FD]',
  alertIcon: 'text-[#F0A93B]',
  otpCodeFieldInput: `${inputBase} text-center text-xl font-black`,
} as const;

export const clerkAppearance = {
  variables: {
    colorBackground:         '#03040A',
    colorInputBackground:    '#03040A',
    colorInputText:          '#E8F4FD',
    colorText:               '#E8F4FD',
    colorTextSecondary:      '#94A3B8',
    colorPrimary:            '#00FF88',
    colorDanger:             '#FF4D4D',
    colorSuccess:            '#00FF88',
    colorWarning:            '#F0A93B',
    colorNeutral:            '#94A3B8',
    borderRadius:            '0.75rem',
    fontFamily:              'Geist, ui-sans-serif, system-ui, sans-serif',
    fontSmoothing:           'antialiased' as const,
  },
  elements: baseElements,
};
