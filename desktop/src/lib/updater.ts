import { isTauri } from './platform';

/** Tauri auto-updater: checks https://school.rafid0.com/api/v1/updates/{{target}}/{{arch}}/{{current_version}}. */
export async function checkForUpdates() {
  if (!isTauri || import.meta.env.DEV) return;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) return;
    const { ask } = await import('@tauri-apps/plugin-dialog');
    const yes = await ask(`ScholarDesk Pro ${update.version} is available.\n\n${update.body ?? ''}\n\nInstall now? The app will restart.`, { title: 'Update available', kind: 'info' });
    if (!yes) return;
    await update.downloadAndInstall();
    const { relaunch } = await import('@tauri-apps/plugin-process');
    await relaunch();
  } catch (e) {
    console.warn('Update check failed', e);
  }
}
