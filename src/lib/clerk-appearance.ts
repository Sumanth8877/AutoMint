export const clerkThemeTokens = {
  background: '#0A0B0E',
  surface: '#121317',
  elevated: '#1C1E24',
  primary: '#3D7FFF',
  primaryHover: '#2F6BFF',
  accent: '#22D3EE',
  text: '#F4F6FB',
  secondaryText: '#C3CCDA',
  mutedText: '#8B95A7',
  border: 'rgba(255,255,255,0.08)',
  danger: '#F87171',
  success: '#34D399',
  warning: '#FBBF24',
} as const;

const baseElements = {
  rootBox: 'clerk-automint w-full',
  cardBox: 'w-full shadow-[0_28px_90px_rgba(0,0,0,0.48)]',
  card:
    'w-full border border-border bg-elevated text-text shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]',
  main: 'text-text',
  header: 'text-text',
  headerTitle: 'text-text',
  headerSubtitle: 'text-secondary',
  formHeaderTitle: 'text-text',
  formHeaderSubtitle: 'text-secondary',
  socialButtonsBlockButton:
    'border border-border bg-white/5 text-text shadow-none transition hover:border-white/15 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-primary/40',
  socialButtonsBlockButtonText: 'text-text',
  socialButtonsBlockButtonArrow: 'text-secondary',
  dividerLine: 'bg-border',
  dividerText: 'text-secondary',
  formField: 'text-text',
  formFieldLabel: 'text-secondary',
  formFieldInput:
    'border border-border bg-background/80 text-text caret-accent shadow-none placeholder:text-muted/70 focus:border-primary focus:ring-2 focus:ring-primary/25',
  formFieldInputShowPasswordButton: 'text-secondary hover:text-text',
  formFieldAction: 'text-accent hover:text-text',
  formFieldHintText: 'text-muted',
  formFieldErrorText: 'text-danger',
  formResendCodeLink: 'text-accent hover:text-text',
  formButtonPrimary:
    'bg-primary text-white shadow-lg shadow-primary/20 transition hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-accent/40',
  footer: 'bg-transparent',
  footerActionText: 'text-secondary',
  footerActionLink: 'text-accent hover:text-text',
  formHeader: 'text-text',
  identityPreviewText: 'text-text',
  identityPreviewEditButton: 'text-accent hover:text-text',
  alert: 'border border-border bg-background text-text',
  alertText: 'text-text',
  alertIcon: 'text-warning',
  alternativeMethodsBlockButton:
    'border border-border bg-white/5 text-text hover:border-white/15 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-primary/40',
  alternativeMethodsBlockButtonText: 'text-text',
  alternativeMethodsBlockButtonArrow: 'text-secondary',
  otpCodeFieldInput:
    'border border-border bg-background text-text caret-accent focus:border-primary focus:ring-2 focus:ring-primary/25',
  backupCode: 'border border-border bg-background text-text',
  badge: 'border border-border bg-white/5 text-text',
  loadingCard: 'border border-border bg-elevated text-text',
} as const;

const userMenuElements = {
  userButtonTrigger:
    'rounded-lg outline-none transition focus-visible:ring-2 focus-visible:ring-accent/45',
  userButtonAvatarBox: 'h-8 w-8 ring-1 ring-white/15',
  userButtonPopoverCard:
    'min-w-72 overflow-hidden border border-border bg-elevated text-text shadow-[0_24px_80px_rgba(0,0,0,0.58)] backdrop-blur-xl',
  userButtonPopoverFooter: 'hidden',
  userButtonPopoverActions: 'bg-elevated py-2',
  userButtonPopoverMain: 'bg-elevated text-text',
  userButtonPopoverActionButton:
    'mx-2 rounded-lg text-secondary transition hover:bg-white/8 hover:text-text focus-visible:bg-white/10 focus-visible:text-text',
  userButtonPopoverActionButtonText: 'text-sm font-medium',
  userButtonPopoverActionButtonIcon: 'text-secondary group-hover:text-accent',
  userButtonPopoverCustomItemButton:
    'mx-2 rounded-lg text-secondary transition hover:bg-white/8 hover:text-text focus-visible:bg-white/10 focus-visible:text-text',
  userPreview:
    'border-b border-border bg-gradient-to-b from-white/8 to-transparent px-4 py-4',
  userPreviewAvatarBox: 'h-10 w-10 ring-1 ring-white/15',
  userPreviewMainIdentifier: 'text-sm font-semibold text-text',
  userPreviewSecondaryIdentifier: 'text-xs font-medium text-secondary',
} as const;

const profileElements = {
  modalBackdrop: 'bg-background/70 backdrop-blur-sm',
  modalContent:
    'border border-border bg-elevated text-text shadow-[0_28px_90px_rgba(0,0,0,0.56)]',
  modalCloseButton: 'text-secondary hover:bg-white/8 hover:text-text focus-visible:ring-2 focus-visible:ring-accent/40',
  navbar: 'border-r border-border bg-background/90 text-secondary',
  navbarButton:
    'text-secondary transition hover:bg-white/8 hover:text-text data-[active=true]:bg-primary/15 data-[active=true]:text-text',
  navbarButtonText: 'text-inherit',
  navbarButtonIcon: 'text-secondary',
  navbarMobileMenuButton: 'text-secondary hover:bg-white/8 hover:text-text',
  pageScrollBox: 'bg-elevated text-text',
  profilePage: 'bg-elevated text-text',
  profileSection: 'border-border',
  profileSectionHeader: 'text-text',
  profileSectionTitle: 'text-text',
  profileSectionContent: 'text-secondary',
  profileSectionItem: 'border-border text-text',
  profileSectionItemList: 'divide-border',
  profileSectionItemListItem: 'border-border text-text',
  profileSectionItemListItemTitle: 'text-text',
  profileSectionItemListItemDescription: 'text-secondary',
  profileSectionItemListItemDetails: 'text-secondary',
  profileSectionPrimaryButton:
    'bg-primary text-white hover:bg-primary-hover focus-visible:ring-2 focus-visible:ring-accent/40',
  profileSectionSecondaryButton:
    'border border-border bg-white/5 text-text hover:border-white/15 hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-accent/40',
  accordionTriggerButton: 'text-text hover:bg-white/8 focus-visible:ring-2 focus-visible:ring-accent/40',
  accordionContent: 'text-secondary',
  accordionItem: 'border-border',
  pageTitle: 'text-text',
  pageDescription: 'text-secondary',
  menuButton: 'text-secondary hover:bg-white/8 hover:text-text',
  menuList: 'border border-border bg-elevated text-text shadow-[0_18px_60px_rgba(0,0,0,0.42)]',
  menuItem: 'text-secondary hover:bg-white/8 hover:text-text focus-visible:bg-white/10 focus-visible:text-text',
  table: 'text-secondary',
  tableHead: 'text-muted',
  tableRow: 'border-border text-secondary',
  tableCell: 'text-secondary',
  verificationLinkStatusBadge: 'border border-border bg-white/5 text-secondary',
  formFieldSuccessText: 'text-success',
  formFieldWarningText: 'text-warning',
  avatarImageActionsUpload: 'text-accent hover:text-text',
  avatarImageActionsRemove: 'text-danger hover:text-text',
  connectedAccount: 'border-border text-text',
  connectedAccountName: 'text-text',
  connectedAccountIdentifier: 'text-secondary',
  sessionListItem: 'border-border text-text',
  sessionListItemText: 'text-text',
  sessionListItemDescription: 'text-secondary',
  badge: 'border border-border bg-white/5 text-text',
} as const;

export const clerkAppearance = {
  variables: {
    colorPrimary: clerkThemeTokens.primary,
    colorPrimaryForeground: clerkThemeTokens.text,
    colorForeground: clerkThemeTokens.text,
    colorBackground: clerkThemeTokens.elevated,
    colorInput: clerkThemeTokens.background,
    colorInputForeground: clerkThemeTokens.text,
    colorMuted: clerkThemeTokens.surface,
    colorMutedForeground: clerkThemeTokens.secondaryText,
    colorNeutral: 'white',
    colorBorder: clerkThemeTokens.border,
    colorRing: clerkThemeTokens.accent,
    colorShadow: '#000000',
    colorModalBackdrop: 'rgba(10, 11, 14, 0.74)',
    colorDanger: clerkThemeTokens.danger,
    colorSuccess: clerkThemeTokens.success,
    colorWarning: clerkThemeTokens.warning,
    fontFamily: '"Geist", "Geist Fallback", ui-sans-serif, system-ui, sans-serif',
    fontFamilyButtons: '"Geist", "Geist Fallback", ui-sans-serif, system-ui, sans-serif',
    fontFamilyMono: '"Geist Mono", "Geist Mono Fallback", ui-monospace, monospace',
    fontSize: '0.875rem',
    borderRadius: '0.5rem',
    spacing: '0.95rem',
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
