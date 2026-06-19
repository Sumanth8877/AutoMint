const baseElements = {
  cardBox: 'w-full shadow-[0_28px_90px_rgba(0,0,0,0.48)]',
  card:
    'w-full border border-border bg-elevated text-text shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
  headerTitle: 'text-text',
  headerSubtitle: 'text-muted',
  socialButtonsBlockButton:
    'border border-border bg-white/5 text-text shadow-none transition hover:border-white/15 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-primary/40',
  socialButtonsBlockButtonText: 'text-text',
  socialButtonsBlockButtonArrow: 'text-muted',
  dividerLine: 'bg-border',
  dividerText: 'text-muted',
  formFieldLabel: 'text-muted',
  formFieldInput:
    'border border-border bg-background/80 text-text caret-accent shadow-none placeholder:text-muted/70 focus:border-primary focus:ring-2 focus:ring-primary/25',
  formFieldInputShowPasswordButton: 'text-muted hover:text-text',
  formFieldAction: 'text-accent hover:text-text',
  formFieldErrorText: 'text-danger',
  formButtonPrimary:
    'bg-primary text-white shadow-lg shadow-primary/20 transition hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-accent/40',
  footer: 'bg-transparent',
  footerActionText: 'text-muted',
  footerActionLink: 'text-accent hover:text-text',
  identityPreviewText: 'text-text',
  identityPreviewEditButton: 'text-accent hover:text-text',
  alert: 'border border-border bg-background text-text',
  alertText: 'text-text',
  alertIcon: 'text-warning',
} as const;

const userMenuElements = {
  userButtonTrigger:
    'rounded-lg outline-none transition focus-visible:ring-2 focus-visible:ring-accent/45',
  userButtonAvatarBox: 'h-8 w-8 ring-1 ring-white/15',
  userButtonPopoverCard:
    'min-w-72 overflow-hidden border border-border bg-elevated text-text shadow-[0_24px_80px_rgba(0,0,0,0.58)] backdrop-blur-xl',
  userButtonPopoverFooter: 'hidden',
  userButtonPopoverActionButton:
    'mx-2 rounded-lg text-muted transition hover:bg-white/8 hover:text-text focus-visible:bg-white/10 focus-visible:text-text',
  userButtonPopoverActionButtonText: 'text-sm font-medium',
  userButtonPopoverActionButtonIcon: 'text-muted group-hover:text-accent',
  userButtonPopoverCustomItemButton:
    'mx-2 rounded-lg text-muted transition hover:bg-white/8 hover:text-text focus-visible:bg-white/10 focus-visible:text-text',
  userPreview:
    'border-b border-border bg-gradient-to-b from-white/8 to-transparent px-4 py-4',
  userPreviewAvatarBox: 'h-10 w-10 ring-1 ring-white/15',
  userPreviewMainIdentifier: 'text-sm font-semibold text-text',
  userPreviewSecondaryIdentifier: 'text-xs font-medium text-muted',
} as const;

const profileElements = {
  modalBackdrop: 'bg-background/70 backdrop-blur-sm',
  modalContent:
    'border border-border bg-elevated text-text shadow-[0_28px_90px_rgba(0,0,0,0.56)]',
  navbar: 'border-r border-border bg-background/80',
  navbarButton:
    'text-muted transition hover:bg-white/8 hover:text-text data-[active=true]:bg-primary/15 data-[active=true]:text-text',
  navbarButtonIcon: 'text-muted',
  pageScrollBox: 'bg-elevated text-text',
  profileSection: 'border-border',
  profileSectionTitle: 'text-text',
  profileSectionContent: 'text-muted',
  profileSectionPrimaryButton:
    'bg-primary text-white hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-accent/40',
  accordionTriggerButton: 'text-text hover:bg-white/8',
  accordionContent: 'text-muted',
  badge: 'border border-border bg-white/5 text-text',
} as const;

export const clerkAppearance = {
  variables: {
    colorPrimary: '#4F46E5',
    colorBackground: '#0F172A',
    colorInputBackground: '#050816',
    colorInputText: '#F8FAFC',
    colorText: '#F8FAFC',
    colorTextSecondary: '#94A3B8',
    colorNeutral: '#94A3B8',
    colorDanger: '#EF4444',
    colorSuccess: '#10B981',
    fontFamily: '"Geist", "Geist Fallback", ui-sans-serif, system-ui, sans-serif',
    fontFamilyButtons: '"Geist", "Geist Fallback", ui-sans-serif, system-ui, sans-serif',
    borderRadius: '0.5rem',
    spacingUnit: '0.95rem',
  },
  elements: {
    ...baseElements,
    ...userMenuElements,
    ...profileElements,
  },
  layout: {
    socialButtonsPlacement: 'bottom',
    socialButtonsVariant: 'blockButton',
  },
} as const;

export const clerkUserButtonAppearance = {
  ...clerkAppearance,
  elements: {
    ...clerkAppearance.elements,
    rootBox: 'flex items-center',
  },
} as const;
