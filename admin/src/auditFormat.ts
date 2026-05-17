/** Pretty-print captured proxy bodies for the audit UI. */
export function prettifyAuditBody(raw: string | null | undefined): string {
  if (raw == null || raw.trim() === "") {
    return "(empty)";
  }

  const trimmed = raw.trim();

  const asJson = tryFormatJson(trimmed);
  if (asJson != null) {
    return asJson;
  }

  const asForm = tryFormatFormUrlEncoded(trimmed);
  if (asForm != null) {
    return asForm;
  }

  return raw;
}

function tryFormatJson(text: string): string | null {
  if (!text.startsWith("{") && !text.startsWith("[")) {
    return null;
  }
  try {
    return JSON.stringify(JSON.parse(text) as unknown, null, 2);
  } catch {
    return null;
  }
}

function tryFormatFormUrlEncoded(text: string): string | null {
  if (!text.includes("=")) {
    return null;
  }

  try {
    const params = new URLSearchParams(text);
    const lines: string[] = [];
    params.forEach((value, key) => {
      lines.push(`${key}=${value}`);
    });
    return lines.length > 0 ? lines.join("\n\n") : null;
  } catch {
    return null;
  }
}
