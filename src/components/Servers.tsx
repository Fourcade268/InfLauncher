import React, { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { RefreshCw, Server, Lock, Gift, Copy, Check } from 'lucide-react';
import { safeInvoke } from '../lib/utils';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ServerInfo {
  name: string;
  map: string;
  players: number;
  max_players: number;
  ping: number;
  ip: string;
  port: number;
  mods: string[];
  is_online: boolean;
  custom_status?: string | null;
  is_locked: boolean;
}

interface Proxy {
  name: string;
  ip: string;
}

interface ServersProps {
  servers: ServerInfo[];
  onServersUpdate: (servers: ServerInfo[]) => void;
  proxies: Proxy[];
  onProxiesUpdate: (proxies: Proxy[]) => void;
  selectedProxy: Proxy | null;
  onProxyChange: (proxy: Proxy | null) => void;
  proxyPings: Record<string, number>;
  onPingsUpdate: (pings: Record<string, number> | ((prev: Record<string, number>) => Record<string, number>)) => void;
  directIp: string;
  onDirectIpUpdate: (ip: string) => void;
  promoCode: string | null;
  onPromoUpdate: (promo: string | null) => void;
}

const Servers: React.FC<ServersProps> = ({
  servers, onServersUpdate,
  proxies, onProxiesUpdate,
  selectedProxy, onProxyChange,
  proxyPings, onPingsUpdate,
  directIp, onDirectIpUpdate,
  promoCode, onPromoUpdate
}) => {
  const [loading, setLoading] = useState(false);
  const [missingModsServer, setMissingModsServer] = useState<ServerInfo | null>(null);
  const [missingModsList, setMissingModsList] = useState<any[]>([]);
  const [isProxyOpen, setIsProxyOpen] = useState(false);
  const [launchingServer, setLaunchingServer] = useState<string | null>(null);
  const [isDayzRunning, setIsDayzRunning] = useState(false);
  const [dots, setDots] = useState('');
  const [copiedPromo, setCopiedPromo] = useState(false);

  const refreshStatus = async (forceLoading = false) => {
    if (forceLoading) setLoading(true);
    
    const githubUrl = `https://raw.githubusercontent.com/Fourcade268/InfLauncher/refs/heads/main/servers.json?t=${Date.now()}`;
    const cfUrl = `https://inflauncher.pages.dev/servers.json?t=${Date.now()}`;
    const jsdelivrUrl = `https://cdn.jsdelivr.net/gh/Fourcade268/InfLauncher@main/servers.json?t=${Date.now()}`;
    const localUrl = `${window.location.origin}/servers.json`;
    
    const urls = directIp ? [githubUrl, jsdelivrUrl, cfUrl, localUrl] : [localUrl, githubUrl, jsdelivrUrl, cfUrl];

    for (const serverListUrl of urls) {
      try {
        const data = await safeInvoke<ServerInfo[]>('query_servers', {
          serverListUrl,
          overrideIp: selectedProxy?.ip || null
        });

        if (data && data.length > 0) {
          onServersUpdate(data);
          // Ping current targets
          if (directIp) pingTarget(directIp, 'direct');
          proxies.forEach(p => pingTarget(p.ip, p.ip));
          if (forceLoading) setLoading(false);
          return; // Success
        }
      } catch (err) {
        console.warn(`Failed to refresh status from ${serverListUrl}:`, err);
      }
    }
    
    if (forceLoading) setLoading(false);
  };

  const fetchServers = async () => {
    setLoading(true);
    const githubUrl = `https://raw.githubusercontent.com/Fourcade268/InfLauncher/refs/heads/main/servers.json?t=${Date.now()}`;
    const cfUrl = `https://inflauncher.pages.dev/servers.json?t=${Date.now()}`;
    const jsdelivrUrl = `https://cdn.jsdelivr.net/gh/Fourcade268/InfLauncher@main/servers.json?t=${Date.now()}`;
    const localUrl = '/servers.json';
    
    const urls = [githubUrl, jsdelivrUrl, cfUrl, localUrl];
    let config = null;

    for (const url of urls) {
      try {
        const response = await fetch(url, {
          ...(url.startsWith('http') ? { cache: 'no-store' } : {}),
          signal: AbortSignal.timeout(3000)
        });
        config = await response.json();
        if (config) break;
      } catch (e) {
        console.warn(`Failed to fetch config from ${url}:`, e);
      }
    }


    if (config) {
      onProxiesUpdate(config.Proxies || []);
      onDirectIpUpdate(config.DirectIP);

      if (config.promo) {
        try {
          onPromoUpdate(atob(config.promo));
        } catch (e) {
          console.error('Failed to decrypt promo code:', e);
          onPromoUpdate(null);
        }
      } else {
        onPromoUpdate(null);
      }

      // 2. Refresh statuses using new config
      await refreshStatus(false);
    } else {
      console.error('Failed to load any server configuration');
    }
    setLoading(false);
  };

  const pingTarget = async (ip: string, key: string) => {
    try {
      const rtt = await safeInvoke<number>('ping_target', { ip });
      onPingsUpdate(prev => ({ ...prev, [key]: rtt }));
    } catch (e) {
      onPingsUpdate(prev => ({ ...prev, [key]: -1 }));
    }
  };


  useEffect(() => {
    if (servers.length === 0) {
      fetchServers();
    }

    // Auto-refresh only status every 60s
    const interval = setInterval(() => {
      refreshStatus(false);
    }, 60000);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (selectedProxy) {
      refreshStatus(true);
    }
  }, [selectedProxy]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await listen<boolean>('dayz-status-changed', (event) => {
        setIsDayzRunning(event.payload);
      });
    };
    setupListener();

    // Initial check
    safeInvoke<boolean>('check_dayz_running').then(setIsDayzRunning);

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Dots animation and 10s timer for launching
  useEffect(() => {
    let dotsInterval: any;
    let timer: any;

    if (launchingServer) {
      dotsInterval = setInterval(() => {
        setDots(prev => {
          if (prev === '...') return '';
          if (prev === '..') return '...';
          if (prev === '.') return '..';
          return '.';
        });
      }, 500);

      timer = setTimeout(() => {
        setLaunchingServer(null);
        setDots('');
      }, 10000);
    }

    return () => {
      clearInterval(dotsInterval);
      clearTimeout(timer);
    };
  }, [launchingServer]);

  const filteredServers = servers;

  const longestProxyName = React.useMemo(() => {
    if (proxies.length === 0) return 'Не выбрано';
    const names = ['Не выбрано', ...proxies.map(p => p.name)];
    return names.reduce((a, b) => a.length > b.length ? a : b);
  }, [proxies]);

  const handlePlay = async (server: ServerInfo) => {
    if (launchingServer) return;

    const dayzPath = localStorage.getItem('dayz_path') || '';
    const isPathValid = await safeInvoke<boolean>('validate_dayz_path', { path: dayzPath });
    
    if (!dayzPath || !isPathValid) {
      window.dispatchEvent(new CustomEvent('highlight-settings'));
      return;
    }

    const nickname = localStorage.getItem('userNickname')?.trim() || '';
    if (!nickname || nickname.toLowerCase() === 'survivor') {
      window.dispatchEvent(new CustomEvent('require-nickname'));
      return;
    }

    // Set launching state immediately to block multi-clicks
    const serverKey = `${server.ip}:${server.port}`;
    setLaunchingServer(serverKey);

    try {
      // 1. Double check if game is already running
      const isRunning = await safeInvoke<boolean>('check_dayz_running');
      if (isRunning) {
        alert("Игра уже запущена!");
        setLaunchingServer(null);
        return;
      }

      // 2. Validate mods
      const modIds = server.mods.map((m: any) => typeof m === 'string' ? m : m.id);
      const modStatuses = await safeInvoke<any[]>('get_server_mods', { modIds });
      const missing = modStatuses.filter(m => !m.is_installed || m.is_updating);

      if (missing.length > 0) {
        setMissingModsList(missing);
        setMissingModsServer(server);
        setLaunchingServer(null); // Unlock if mods are missing
        return;
      }

      const params = localStorage.getItem('launch_params') || '';
      const finalParams = `-name=${nickname} ${params}`.trim();
      const launchIp = selectedProxy ? selectedProxy.ip : directIp;

      // 3. Launch
      await safeInvoke('launch_game', {
        dayzPath: dayzPath,
        ip: launchIp,
        port: server.port,
        customParams: finalParams,
        modIds: modIds
      });

      window.dispatchEvent(new CustomEvent('dayz-starting'));
      // Note: launchingServer will be cleared by the 10s timer in useEffect
    } catch (e) {
      alert(e);
      setLaunchingServer(null);
    }
  };

  const handleAcceptMods = async () => {
    if (!missingModsServer) return;

    // Switch to mods tab immediately so the user can see progress
    window.dispatchEvent(new CustomEvent('switch-tab', { detail: 'mods' }));

    // Subscribe and download all missing
    for (const m of missingModsList) {
      if (!m.is_subscribed) {
        await safeInvoke('subscribe_mod', { id: m.id });
      }
    }

    setMissingModsServer(null);
  };

  return (
    <div className="p-8 animate-in fade-in slide-in-from-bottom-4 duration-500 min-h-full flex flex-col">
      {/* Content Area (Header + Servers) */}
      <div className="flex-1">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-3xl font-bold text-white mb-2">Серверы</h2>
            <p className="text-gray-400">Выберите сервер для подключения</p>
          </div>
          <div className="flex items-center gap-4">
            {/* Proxy Selector */}
            <div className="relative w-fit">
              <button
                onClick={() => setIsProxyOpen(!isProxyOpen)}
                className="relative flex flex-col items-start bg-white/5 border border-white/10 rounded-xl px-4 py-2 hover:bg-white/10 transition-all text-left"
              >
                <div className="invisible h-0 overflow-hidden whitespace-nowrap pr-2 text-sm font-medium">
                  {longestProxyName} • 999 ms
                </div>
                <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wider mb-0.5">Прокси сервер</span>
                <div className="flex items-center justify-between w-full gap-4">
                  <span className="text-sm text-white font-medium truncate">
                    {selectedProxy ? selectedProxy.name : 'Не выбрано'}
                  </span>
                  {((selectedProxy && proxyPings[selectedProxy.ip] !== undefined) || (!selectedProxy && proxyPings['direct'] !== undefined)) && (
                    <span className={cn(
                      "text-[10px] font-bold whitespace-nowrap",
                      (selectedProxy ? proxyPings[selectedProxy.ip] : proxyPings['direct']) === -1 ? "text-red-500" : "text-green-500"
                    )}>
                      • {(selectedProxy ? proxyPings[selectedProxy.ip] : proxyPings['direct']) === -1 ? 'offline' : `${selectedProxy ? proxyPings[selectedProxy.ip] : proxyPings['direct']} ms`}
                    </span>
                  )}
                </div>
              </button>

              {isProxyOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setIsProxyOpen(false)} />
                  <div className="dropdown-panel absolute top-full left-0 right-0 mt-2 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl z-50 py-2 animate-in fade-in slide-in-from-top-2 duration-200">
                    <button
                      onClick={() => { onProxyChange(null); setIsProxyOpen(false); }}
                      className={cn(
                        "w-full px-4 py-2 text-left text-sm hover:bg-white/5 transition-colors flex justify-between items-center gap-4",
                        !selectedProxy ? "text-fluent-accent" : "text-white"
                      )}
                    >
                      <span className="truncate">Не выбрано</span>
                      {proxyPings['direct'] !== undefined && (
                        <span className={cn(
                          "text-[10px] font-bold whitespace-nowrap",
                          proxyPings['direct'] === -1 ? "text-red-500" : "text-green-500"
                        )}>
                          • {proxyPings['direct'] === -1 ? 'offline' : `${proxyPings['direct']} ms`}
                        </span>
                      )}
                    </button>
                    <div className="h-[1px] bg-white/5 my-1 mx-2" />
                    {proxies.map(proxy => (
                      <button
                        key={proxy.ip}
                        onClick={() => { onProxyChange(proxy); setIsProxyOpen(false); }}
                        className={cn(
                          "w-full px-4 py-2 text-left text-sm hover:bg-white/5 transition-colors flex justify-between items-center gap-4",
                          selectedProxy?.ip === proxy.ip ? "text-fluent-accent" : "text-white"
                        )}
                      >
                        <span className="truncate">{proxy.name}</span>
                        {proxyPings[proxy.ip] !== undefined && (
                          <span className={cn(
                            "text-[10px] font-bold whitespace-nowrap",
                            proxyPings[proxy.ip] === -1 ? "text-red-500" : "text-green-500"
                          )}>
                            • {proxyPings[proxy.ip] === -1 ? 'offline' : `${proxyPings[proxy.ip]} ms`}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>

            <button
              onClick={fetchServers}
              disabled={loading}
              className={`p-2 rounded-full hover:bg-white/10 transition-colors text-gray-400 hover:text-white ${loading ? 'animate-spin' : ''}`}
            >
              <RefreshCw size={20} />
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {loading && servers.length === 0 ? (
            [1, 2, 3].map(i => (
              <div key={i} className="glass p-4 rounded-xl flex items-center justify-between opacity-50 animate-pulse">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-white/5 rounded-lg"></div>
                  <div className="space-y-2">
                    <div className="w-32 h-4 bg-white/10 rounded"></div>
                    <div className="w-48 h-3 bg-white/5 rounded"></div>
                  </div>
                </div>
              </div>
            ))
          ) : filteredServers.length > 0 ? (
            filteredServers.map((server, index) => {
              const isLaunchingThis = launchingServer === `${server.ip}:${server.port}`;
              let buttonText: React.ReactNode = 'Играть';
              if (isLaunchingThis) {
                buttonText = `Запуск${dots}`;
              } else if (server.is_locked) {
                buttonText = <Lock size={18} className="mx-auto" />;
              } else if (!server.is_online) {
                buttonText = 'Недоступен';
              } else if (isDayzRunning) {
                buttonText = 'В игре';
              }

              return (
                <div key={`${server.ip}-${index}`} className={cn(
                  "glass p-4 rounded-xl flex items-center justify-between group transition-all duration-300",
                  server.is_online ? "hover:border-white/20" : "opacity-60 grayscale-[0.5]"
                )}>
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-12 h-12 bg-white/5 rounded-lg flex items-center justify-center transition-colors",
                      server.is_online ? "text-fluent-accent" : "text-gray-500"
                    )}>
                      <Server size={24} />
                    </div>
                    <div>
                      <h3 className={cn(
                        "font-semibold transition-colors",
                        server.is_online ? "text-white group-hover:text-fluent-accent" : "text-gray-400"
                      )}>
                        {server.name}
                      </h3>
                      <p className="text-sm text-gray-500">{server.map}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-8">
                    <div className="text-right">
                      <div className="text-white font-medium">
                        {server.is_online ? `${server.players}/${server.max_players}` : '— / —'}
                      </div>
                      <div className={cn(
                        "flex items-center justify-end gap-1 text-xs font-bold uppercase tracking-wider",
                        server.custom_status ? "text-yellow-500" : server.is_online ? "text-green-500" : "text-red-500"
                      )}>
                        <div className={cn(
                          "w-1.5 h-1.5 rounded-full",
                          server.custom_status ? "bg-yellow-500 animate-pulse" : server.is_online ? "bg-green-500 animate-pulse" : "bg-red-500"
                        )} />
                        <span>{server.custom_status || (server.is_online ? 'Online' : 'Offline')}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => !server.is_locked && server.is_online && !isDayzRunning && handlePlay(server)}
                      disabled={server.is_locked || !server.is_online || !!launchingServer || isDayzRunning}
                      className={cn(
                        "bg-fluent-accent hover:bg-blue-600 text-white px-6 h-10 rounded-lg font-medium transition-all shadow-lg shadow-fluent-accent/20 w-[150px] flex items-center justify-center",
                        (server.is_locked || !server.is_online || isDayzRunning) && "bg-gray-700 opacity-50 cursor-not-allowed shadow-none",
                        isLaunchingThis && "opacity-80 cursor-default bg-blue-700"
                      )}
                    >
                      {buttonText}
                    </button>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-12 text-gray-500">
              {loading ? 'Загрузка...' : 'Серверы не найдены, попробуйте изменить прокси сервер или обновить список.'}
            </div>
          )}
        </div>
      </div>

      {/* Promo Code Block (Sticky at Bottom) */}
      {promoCode && (
        <div className="mt-auto pt-8 animate-in fade-in slide-in-from-bottom-4 duration-700 delay-300">
          <div className="relative overflow-hidden group">
            <div className="absolute inset-0 bg-gradient-to-r from-blue-600/5 via-fluent-accent/5 to-blue-600/5 opacity-50" />
            <div className="relative glass border border-white/10 rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500 to-fluent-accent flex items-center justify-center shadow-lg shadow-blue-500/20 shrink-0">
                  <Gift className="w-6 h-6 text-white animate-bounce" style={{ animationDuration: '3s' }} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-white leading-tight">Бонусный Промокод</h3>
                  <p className="text-sm text-gray-400">Используйте этот код на сайте для получения бонусов!</p>
                </div>
              </div>
              <div className="flex items-center gap-2 w-full md:w-auto">
                <div className="flex-1 md:flex-none bg-black/40 border border-white/10 rounded-lg px-4 py-2 font-mono text-lg text-fluent-accent font-bold tracking-widest min-w-[140px] text-center">
                  {promoCode}
                </div>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(promoCode);
                    setCopiedPromo(true);
                    setTimeout(() => setCopiedPromo(false), 2000);
                  }}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition-all duration-300 shadow-lg text-sm",
                    copiedPromo 
                      ? "bg-emerald-500 text-white shadow-emerald-500/20" 
                      : "bg-white/10 hover:bg-white/20 text-white hover:scale-105 active:scale-95"
                  )}
                >
                  {copiedPromo ? (
                    <><Check size={16} />Скопировано</>
                  ) : (
                    <><Copy size={16} />Копировать</>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Missing Mods Modal */}
      {missingModsServer && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 max-w-md w-full shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-xl font-bold text-white mb-2">Отсутствуют моды</h3>
            <p className="text-sm text-gray-400 mb-6">
              Для игры на сервере <span className="text-white font-medium">{missingModsServer.name}</span> необходимо установить или обновить {missingModsList.length} модов.
              Хотите подписаться на них сейчас?
            </p>
            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={() => setMissingModsServer(null)}
                className="px-4 py-2 rounded-xl text-sm font-medium text-gray-400 hover:text-white hover:bg-white/5 transition-colors"
              >
                Отказаться
              </button>
              <button
                onClick={handleAcceptMods}
                className="px-6 py-2 rounded-xl text-sm font-medium bg-fluent-accent hover:bg-blue-600 text-white transition-colors shadow-lg shadow-fluent-accent/20"
              >
                Принять
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Servers;
