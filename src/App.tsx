import { useState, useEffect, useMemo } from 'react';
import Sidebar from './components/Sidebar';
import Servers from './components/Servers';
import Mods from './components/Mods';
import Settings from './components/Settings';
import { AlertTriangle, Power, CheckCircle2, RefreshCw } from 'lucide-react';
import { safeInvoke } from './lib/utils';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

import { listen } from '@tauri-apps/api/event';
import { check } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

function App() {
  const [activeTab, setActiveTab] = useState('servers');
  const [servers, setServers] = useState<any[]>([]);
  const [proxies, setProxies] = useState<any[]>([]);
  const [selectedProxy, setSelectedProxy] = useState<any>(null);
  const [proxyPings, setProxyPings] = useState<Record<string, number>>({});
  const [directIp, setDirectIp] = useState('');
  const [dayzStatus, setDayzStatus] = useState<'idle' | 'starting' | 'running'>('idle');
  const [isKillModalOpen, setIsKillModalOpen] = useState(false);

  // Update state
  const [updateInfo, setUpdateInfo] = useState<any>(null);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    const checkForUpdates = async () => {
      console.log('[DEBUG] Checking for updates...');
      try {
        const update = await check();
        console.log('[DEBUG] Update check result:', update);
        if (update) {
          setUpdateInfo(update);
        } else {
          console.log('[DEBUG] No updates found.');
        }
      } catch (e) {
        console.error('[DEBUG] Failed to check for updates:', e);
      }
    };

    checkForUpdates();

    const applyTheme = () => {
      const storedTheme = localStorage.getItem('theme') || 'system';
      const root = window.document.documentElement;

      const isDark =
        storedTheme === 'dark' ||
        (storedTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

      if (isDark) {
        root.classList.remove('light');
      } else {
        root.classList.add('light');
      }
    };

    applyTheme();
    window.addEventListener('theme-change', applyTheme);
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', applyTheme);

    const handleSwitchTab = (e: any) => {
      if (e.detail) setActiveTab(e.detail);
    };
    window.addEventListener('switch-tab', handleSwitchTab);

    // Disable right-click context menu
    const handleContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    window.addEventListener('contextmenu', handleContextMenu);

    // Disable F12 and DevTools shortcuts
    const handleKeyDown = (e: KeyboardEvent) => {
      if (
        e.key === 'F12' ||
        (e.ctrlKey && e.shiftKey && (e.code === 'KeyI' || e.code === 'KeyJ' || e.code === 'KeyC')) ||
        (e.ctrlKey && e.code === 'KeyU')
      ) {
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    const handleDayzStarting = () => {
      setDayzStatus('starting');
    };
    window.addEventListener('dayz-starting', handleDayzStarting);

    // Listen for DayZ status events from Rust
    let unlisten: (() => void) | undefined;
    const setupListener = async () => {
      unlisten = await listen<boolean>('dayz-status-changed', (event) => {
        const isRunning = event.payload;
        if (isRunning) {
          setDayzStatus(current => {
            if (current === 'starting') {
              setTimeout(() => setDayzStatus('running'), 2000);
              return 'starting';
            }
            return 'running';
          });
        } else {
          setDayzStatus(current => current === 'starting' ? 'starting' : 'idle');
        }
      });
    };
    setupListener();

    // Initial check
    safeInvoke<boolean>('check_dayz_running').then(isRunning => {
      if (isRunning) setDayzStatus('running');
    });

    return () => {
      window.removeEventListener('theme-change', applyTheme);
      mediaQuery.removeEventListener('change', applyTheme);
      window.removeEventListener('switch-tab', handleSwitchTab);
      window.removeEventListener('contextmenu', handleContextMenu);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('dayz-starting', handleDayzStarting);
      if (unlisten) unlisten();
    };
  }, []);

  const [isInitialProxyLoadDone, setIsInitialProxyLoadDone] = useState(false);
  const [promoCode, setPromoCode] = useState<string | null>(null);

  // Save selected proxy to localStorage
  useEffect(() => {
    // Only save if we have already finished the initial restoration from memory
    if (isInitialProxyLoadDone && proxies.length > 0) {
      if (selectedProxy) {
        localStorage.setItem('selectedProxyIp', selectedProxy.ip);
      } else {
        localStorage.removeItem('selectedProxyIp');
      }
    }
  }, [selectedProxy, isInitialProxyLoadDone, proxies.length]);

  // Load selected proxy from localStorage when proxies are loaded
  useEffect(() => {
    if (proxies.length > 0 && !isInitialProxyLoadDone) {
      const savedIp = localStorage.getItem('selectedProxyIp');
      if (savedIp) {
        const proxy = proxies.find((p: any) => p.ip === savedIp);
        if (proxy) setSelectedProxy(proxy);
      }
      setIsInitialProxyLoadDone(true);
    }
  }, [proxies, isInitialProxyLoadDone]);

  const handleForceKill = async () => {
    try {
      await safeInvoke('kill_dayz');
      setDayzStatus('idle');
      setIsKillModalOpen(false);
    } catch (e) {
    }
  };

  // Collect all unique mod objects from all servers
  const allMods = useMemo(() => {
    const modMap = new Map();
    servers.forEach(s => {
      (s.mods || []).forEach((m: { id: string, name: string }) => {
        if (!modMap.has(m.id)) modMap.set(m.id, m);
      });
    });
    return Array.from(modMap.values());
  }, [servers]);

  const renderContent = () => {
    console.log('[DEBUG] Required mods:', allMods);

    switch (activeTab) {
      case 'servers':
        return (
          <Servers
            servers={servers}
            onServersUpdate={setServers}
            proxies={proxies}
            onProxiesUpdate={setProxies}
            selectedProxy={selectedProxy}
            onProxyChange={setSelectedProxy}
            proxyPings={proxyPings}
            onPingsUpdate={setProxyPings}
            directIp={directIp}
            onDirectIpUpdate={setDirectIp}
            promoCode={promoCode}
            onPromoUpdate={setPromoCode}
          />
        );
      case 'mods':
        return <Mods requiredMods={allMods} />;
      case 'settings':
        return <Settings />;
      default:
        return (
          <Servers
            servers={servers}
            onServersUpdate={setServers}
            proxies={proxies}
            onProxiesUpdate={setProxies}
            selectedProxy={selectedProxy}
            onProxyChange={setSelectedProxy}
            proxyPings={proxyPings}
            onPingsUpdate={setProxyPings}
            directIp={directIp}
            onDirectIpUpdate={setDirectIp}
            promoCode={promoCode}
            onPromoUpdate={setPromoCode}
          />
        );
    }
  };

  const handleUpdate = async () => {
    if (!updateInfo) return;
    setIsUpdating(true);
    try {
      let downloaded = 0;
      let total = 0;
      await updateInfo.downloadAndInstall((event: any) => {
        switch (event.event) {
          case 'Started':
            total = event.data.contentLength || 0;
            break;
          case 'Progress':
            downloaded += event.data.chunkLength;
            if (total > 0) setUpdateProgress(Math.round((downloaded / total) * 100));
            break;
        }
      });
      await relaunch();
    } catch (e) {
      console.error('Update failed:', e);
      setIsUpdating(false);
    }
  };

  return (
    <div className="flex w-full h-screen bg-[#0a0a0a] text-white selection:bg-fluent-accent/30 overflow-hidden">
      {/* Background Decor */}
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none overflow-hidden -z-10">
        <div className="absolute -top-[10%] -left-[10%] w-[40%] h-[40%] bg-fluent-accent/10 blur-[120px] rounded-full"></div>
        <div className="absolute top-[60%] -right-[5%] w-[30%] h-[30%] bg-blue-600/5 blur-[100px] rounded-full"></div>
      </div>

      <Sidebar activeTab={activeTab} setActiveTab={setActiveTab} />

      <main className="flex-1 h-screen relative flex flex-col min-w-0">
        <div className="flex-1 overflow-y-auto overflow-x-hidden p-8">
          {renderContent()}
        </div>

        {/* Update Modal */}
        {updateInfo && (
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-md animate-in fade-in">
            <div className="glass-panel border border-white/10 rounded-2xl p-8 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="flex items-center justify-center text-emerald-500 mb-6 mx-auto animate-spin">
                <RefreshCw size={32} />
              </div>
              <h3 className="text-2xl font-bold text-white text-center mb-2">Доступно обновление</h3>
              <p className="text-gray-400 text-center mb-6">
                Версия <span className="text-white font-bold">{updateInfo.version}</span> готова к установке.
              </p>

              {isUpdating ? (
                <div className="space-y-4">
                  <div className="h-2 bg-white/5 rounded-full overflow-hidden border border-white/5">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-300 shadow-[0_0_15px_rgba(16,185,129,0.5)]"
                      style={{ width: `${updateProgress}%` }}
                    ></div>
                  </div>
                  <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest text-gray-500">
                    <span>Загрузка...</span>
                    <span>{updateProgress}%</span>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setUpdateInfo(null)}
                    className="px-6 py-3 rounded-xl text-sm font-bold text-gray-400 hover:text-white hover:bg-white/5 transition-colors border border-white/5"
                  >
                    Позже
                  </button>
                  <button
                    onClick={handleUpdate}
                    className="px-6 py-3 rounded-xl text-sm font-bold bg-emerald-500 hover:bg-emerald-600 text-white transition-colors shadow-lg shadow-emerald-500/20"
                  >
                    Обновить
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className={`
          fixed bottom-8 left-64 right-0 z-30 transition-all duration-700 ease-in-out flex justify-center pointer-events-none px-8
          ${dayzStatus !== 'idle' ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8 scale-95'}
        `}>
          <div className={cn(
            "w-full glass-panel px-10 py-3 rounded-3xl flex items-center justify-between shadow-2xl pointer-events-auto border transition-all duration-500",
            dayzStatus === 'starting'
              ? "shadow-[0_0_50px_rgba(245,158,11,0.15)]"
              : "shadow-[0_0_50px_rgba(16,185,129,0.15)]"
          )}>
            <div className="flex items-center gap-6">
              <div className={cn(
                "w-10 h-10 rounded-xl flex items-center justify-center border transition-all duration-500",
                dayzStatus === 'starting'
                  ? "bg-amber-500/20 border-amber-500/30 text-amber-400"
                  : "bg-emerald-500/20 border-emerald-500/30 text-emerald-400"
              )}>
                {dayzStatus === 'starting' ? (
                  <div className="relative">
                    <Power size={18} className="animate-pulse" />
                    <div className="absolute -top-1 -right-1 w-2 h-2 bg-amber-500 rounded-full animate-ping"></div>
                  </div>
                ) : (
                  <CheckCircle2 size={18} />
                )}
              </div>
              <div className="flex flex-col justify-center">
                <span className="text-white font-black text-sm tracking-tight uppercase leading-none mb-1">
                  {dayzStatus === 'starting' ? 'Инициализация DayZ' : 'DayZ Запущен'}
                </span>
                <span className={cn(
                  "text-[9px] font-bold uppercase tracking-[0.2em] opacity-70 leading-none",
                  dayzStatus === 'starting' ? "text-amber-400" : "text-emerald-400"
                )}>
                  {dayzStatus === 'starting' ? 'Подготовка...' : 'Приятной игры!'}
                </span>
              </div>
            </div>

            <div className="w-[1px] h-6 bg-white/10 mx-2"></div>

            <button
              onClick={() => setIsKillModalOpen(true)}
              className="group flex items-center gap-2.5 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl text-[11px] font-black transition-all border border-red-500/20 hover:border-red-500/40"
            >
              <Power size={14} className="group-hover:scale-110 transition-transform" />
              ЗАКРЫТЬ ИГРУ
            </button>
          </div>
        </div>

        {/* Force Kill Confirmation Modal */}
        {isKillModalOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
            <div className="glass-panel border border-white/10 rounded-2xl p-8 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200">
              <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center text-red-500 mb-6 mx-auto">
                <AlertTriangle size={24} />
              </div>
              <h3 className="text-lg font-bold text-white text-center mb-2">Завершение процесса</h3>
              <p className="text-sm text-gray-400 text-center mb-8">
                Вы уверены, что хотите принудительно завершить процесс DayZ?
              </p>
              <div className="grid grid-cols-2 gap-4">
                <button
                  onClick={() => setIsKillModalOpen(false)}
                  className="px-6 py-3 rounded-xl text-sm font-bold text-gray-400 hover:text-white hover:bg-white/5 transition-colors border border-white/5"
                >
                  Нет
                </button>
                <button
                  onClick={handleForceKill}
                  className="px-6 py-3 rounded-xl text-sm font-bold bg-red-600 hover:bg-red-500 text-white transition-colors shadow-lg shadow-red-600/20"
                >
                  Да
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
