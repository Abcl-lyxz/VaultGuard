import { useEffect, useState } from "react";

const cache = new Map<string, string | null>();

export function useFavicon(url: string | null | undefined): string | null {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!url) { setSrc(null); return; }
    let hostname: string;
    try {
      hostname = new URL(url).hostname;
    } catch {
      setSrc(null);
      return;
    }
    if (cache.has(hostname)) { setSrc(cache.get(hostname)!); return; }
    const faviconUrl = `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
    const img = new Image();
    img.onload  = () => { cache.set(hostname, faviconUrl); setSrc(faviconUrl); };
    img.onerror = () => { cache.set(hostname, null); setSrc(null); };
    img.src = faviconUrl;
  }, [url]);

  return src;
}
