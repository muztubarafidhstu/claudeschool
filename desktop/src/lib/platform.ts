/** Thin platform layer: Tauri desktop in production, plain browser for demos/dev. */
export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<T>(cmd, args);
}

/** fetch that bypasses webview CORS in the desktop app. */
export async function httpFetch(url: string, init?: RequestInit): Promise<Response> {
  if (isTauri) {
    const { fetch } = await import('@tauri-apps/plugin-http');
    return fetch(url, init);
  }
  return fetch(url, init);
}

export async function saveTextFile(defaultName: string, content: string, mime = 'text/plain'): Promise<boolean> {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    const ext = defaultName.split('.').pop() ?? 'txt';
    const path = await save({ defaultPath: defaultName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return false;
    await writeTextFile(path, content);
    return true;
  }
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = defaultName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return true;
}

export function pickTextFile(accept = '.json'): Promise<string | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = async () => resolve(input.files?.[0] ? await input.files[0].text() : null);
    input.click();
  });
}

export async function openExternal(url: string) {
  if (isTauri) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    return openUrl(url);
  }
  window.open(url, '_blank');
}

export async function getMachineId(): Promise<string> {
  if (isTauri) return invoke<string>('machine_id');
  let id = localStorage.getItem('sd_browser_machine');
  if (!id) {
    const b = crypto.getRandomValues(new Uint8Array(6));
    id = 'HW-' + Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('').toUpperCase();
    localStorage.setItem('sd_browser_machine', id);
  }
  return id;
}
