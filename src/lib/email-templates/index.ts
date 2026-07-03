import { escapeHtml } from './utils';

type TaskEmailDetails = {
  taskName: string;
  collectionName: string;
  chain: string;
  timestamp: string;
  status: string;
  contractAddress?: string;
  txHash?: string;
  reason?: string;
};

type EmailType = 'mintScheduled' | 'mintSuccess' | 'mintFailed' | 'systemErrors';

const STATUS_CONFIG: Record<EmailType, { emoji: string; color: string; label: string; bgAccent: string }> = {
  mintScheduled: { emoji: '📋', color: '#3b82f6', label: 'Scheduled', bgAccent: '#1e3a5f' },
  mintSuccess:   { emoji: '🏆', color: '#22c55e', label: 'Success',   bgAccent: '#14532d' },
  mintFailed:    { emoji: '❌', color: '#ef4444', label: 'Failed',    bgAccent: '#7f1d1d' },
  systemErrors:  { emoji: '⚠️', color: '#f59e0b', label: 'Error',     bgAccent: '#78350f' },
};

function row(label: string, value: string | undefined) {
  if (!value) return '';
  return `
    <tr>
      <td style="border-top:1px solid #20283a;padding:12px 0;color:#8ea0c4;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;width:120px;vertical-align:top;">${escapeHtml(label)}</td>
      <td style="border-top:1px solid #20283a;padding:12px 0;color:#f8fafc;font-size:14px;text-align:right;word-break:break-all;">${escapeHtml(value)}</td>
    </tr>`;
}

export function renderEmailTemplate(
  type: EmailType,
  heading: string,
  preview: string,
  details: TaskEmailDetails,
) {
  const config = STATUS_CONFIG[type];

  const detailRows = [
    row('Collection', details.collectionName),
    row('Chain', details.chain),
    row('Status', details.status),
    row('Contract', details.contractAddress),
    row('Transaction', details.txHash),
    row('Timestamp', details.timestamp),
    row('Reason', details.reason),
  ].join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${escapeHtml(heading)}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:AllowPNG/><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#070a15;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-text-size-adjust:none;">
  <!-- Preview text -->
  <div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
    ${escapeHtml(preview)}
    ${'\u200C\u00A0'.repeat(30)}
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#070a15;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">

          <!-- Logo -->
          <tr>
            <td style="padding-bottom:24px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding-right:10px;vertical-align:middle;">
                    <div style="width:28px;height:28px;background:#22d3ee;border-radius:6px;text-align:center;line-height:28px;font-size:14px;font-weight:bold;color:#070a15;">A</div>
                  </td>
                  <td style="vertical-align:middle;">
                    <span style="font-size:14px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;">AutoMint</span>
                    <span style="font-size:10px;font-weight:600;color:#22d3ee;text-transform:uppercase;letter-spacing:0.08em;margin-left:6px;">NFT Intelligence</span>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Card -->
          <tr>
            <td style="background-color:#101626;border:1px solid #20283a;border-radius:12px;overflow:hidden;">
              <!-- Status banner -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color:${config.bgAccent};padding:16px 24px;border-bottom:1px solid #20283a;">
                    <table role="presentation" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="vertical-align:middle;padding-right:10px;font-size:24px;">${config.emoji}</td>
                        <td style="vertical-align:middle;">
                          <span style="display:inline-block;background-color:${config.color};color:#ffffff;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;padding:3px 10px;border-radius:4px;">${config.label}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- Content -->
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding:24px;">
                    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;line-height:1.3;color:#ffffff;">${escapeHtml(heading)}</h1>
                    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#a8b3cf;">${escapeHtml(preview)}</p>

                    <!-- Details table -->
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      ${detailRows}
                    </table>

                    <!-- CTA button -->
                    <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:24px;">
                      <tr>
                        <td style="background-color:#22d3ee;border-radius:8px;">
                          <a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://automint.app'}/dashboard" style="display:inline-block;padding:10px 24px;color:#070a15;font-size:13px;font-weight:700;text-decoration:none;letter-spacing:0.01em;">View Dashboard →</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 0 0;text-align:center;">
              <p style="margin:0;font-size:11px;color:#4a5568;line-height:1.5;">
                AutoMint · NFT Intelligence<br />
                You're receiving this because you enabled email notifications.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
