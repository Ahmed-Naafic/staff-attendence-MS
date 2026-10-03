/**
 * Reduces a User-Agent header to a browser name with major version and a device / operating
 * system, for display in the audit log. Best effort: unknown agents show "Unknown".
 */
export function describeUserAgent(ua) {
  if (!ua) return { browser: 'Unknown', device: 'Unknown' };
  const version = (pattern) => ua.match(pattern)?.[1];
  const browser =
    (version(/Edg\/(\d+)/) && `Edge ${version(/Edg\/(\d+)/)}`) ||
    (version(/Firefox\/(\d+)/) && `Firefox ${version(/Firefox\/(\d+)/)}`) ||
    (version(/Chrome\/(\d+)/) && `Chrome ${version(/Chrome\/(\d+)/)}`) ||
    (/Safari\//.test(ua) && version(/Version\/(\d+)/) && `Safari ${version(/Version\/(\d+)/)}`) ||
    'Unknown';
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Mac OS X/.test(ua)
            ? 'macOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : 'Unknown';
  return { browser, device };
}
