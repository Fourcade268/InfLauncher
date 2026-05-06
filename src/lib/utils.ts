import { invoke as tauriInvoke } from '@tauri-apps/api/core';

export async function safeInvoke<T>(command: string, args?: any): Promise<T> {
  try {
    // Check if we are in Tauri environment
    const isTauri = !!(window as any).__TAURI_INTERNALS__;
    
    if (!isTauri) {
      console.warn(`[SafeInvoke] Not in Tauri environment. Mocking "${command}"`);
      if (command === 'get_steam_user') return { steam_id: '0', persona_name: 'Browser User' } as T;
      if (command === 'query_servers') return [] as T;
    }

    return await tauriInvoke<T>(command, args);
  } catch (error) {
    console.error(`[SafeInvoke Error] Command "${command}" failed:`, error);
    throw error;
  }
}
