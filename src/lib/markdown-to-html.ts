import { marked } from 'marked';

/**
 * Convert newsletter markdown to inline-styled HTML email.
 * Matches the style contract from the newsletter writer prompt:
 * inline-styled, mobile-responsive, dark text on light background, self-contained.
 */
export function markdownToEmailHtml(markdown: string): string {
  const bodyHtml = marked.parse(markdown, { async: false }) as string;

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;line-height:1.6;">
<div style="max-width:600px;margin:0 auto;padding:32px 24px;background-color:#ffffff;">
${bodyHtml}
</div>
</body>
</html>`;
}
