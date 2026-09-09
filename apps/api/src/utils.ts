export function transformEmail(email: string): string {
  const [localPart, _] = email.split('@');

  // Append "2039" to the local part and change the domain to "appexchange.com"
  const newLocalPart = `${localPart}${makeid(5)}`;
  const newDomain = "appexchange.co";

  // Combine the new local part with the new domain
  const transformedEmail = `${newLocalPart}@${newDomain}`;

  return transformedEmail;
}

function makeid(length: number) {
  let result = '';
  let characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let charactersLength = characters.length;
  for (let i = 0; i < length; i++) {
    result += characters.charAt(Math.floor(Math.random() * charactersLength));
  }
  return `${result}`;
}

export function extractValue(text: string, key: string): string | null {
    const pattern = new RegExp(`\\b${key}:\\s*(.+?)(?:\\n|$)`, 'i');
    const match = text.match(pattern);
    return match ? match[1].trim() : null;
}

export function removeKeyValuePairs(text: string, keys: string[]): string {
    const lines = text.split('\n');
    const filteredLines = lines.filter(line => {
        const trimmedLine = line.trim();
        return !keys.some(key => trimmedLine.startsWith(`${key}:`));
    });
    return filteredLines.join('\n').trim();
}
