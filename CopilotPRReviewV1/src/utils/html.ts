// utils/html.ts

/**
 * Converts HTML to plain text.
 * Replicates the ConvertFrom-Html function from Get-AzureDevOpsWorkItems.ps1.
 */
export function htmlToText(html: string): string {
    if (!html || html.trim() === '') {
        return '';
    }

    let text = html;

    // Convert <br> tags to newlines
    text = text.replace(/<br\s*\/?>/gi, '\n');

    // Convert block-level closing tags to newlines
    text = text.replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n');

    // Remove opening block-level tags
    text = text.replace(/<(p|div|li|tr|h[1-6])[^>]*>/gi, '');

    // Strip all remaining HTML tags
    text = text.replace(/<[^>]+>/g, '');

    // Decode HTML entities
    text = decodeHtmlEntities(text);

    // Collapse 3+ consecutive blank lines into 2
    text = text.replace(/(\r?\n\s*){3,}/g, '\n\n');

    // Trim leading/trailing whitespace
    text = text.trim();

    return text;
}

function decodeHtmlEntities(text: string): string {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .replace(/&#(\d+);/g, (_, dec: string) => String.fromCharCode(parseInt(dec, 10)))
        .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}
