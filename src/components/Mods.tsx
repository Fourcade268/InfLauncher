import React, { useEffect, useState } from 'react';
import { Package, Trash2, CheckCircle2, Clock, AlertCircle, PlusCircle, MinusCircle, RefreshCw } from 'lucide-react';
import { safeInvoke } from '../lib/utils';

interface ModInfo {
  id: string;
  title: string;
  description: string;
  preview_url: string | null;
  size: number;
  is_installed: boolean;
  is_subscribed: boolean;
  is_updating: boolean;
  download_progress: number | null;
  download_bytes: number | null;
  total_bytes: number | null;
}

interface ModsProps {
  requiredMods: {id: string, name: string}[];
}

const Mods: React.FC<ModsProps> = ({ requiredMods }) => {
  const [mods, setMods] = useState<ModInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState<Record<string, number>>({});
  const [showNotification, setShowNotification] = useState(false);
  const [renderNotification, setRenderNotification] = useState(false);
  const [isBatchUpdating, setIsBatchUpdating] = useState(false);
  const [hadActiveUpdates, setHadActiveUpdates] = useState(false);
  const [modToUnsubscribe, setModToUnsubscribe] = useState<ModInfo | null>(null);

  // Monitor for completion of batch update
  useEffect(() => {
    if (isBatchUpdating && mods.length > 0) {
      const currentlyBusy = mods.some(m => m.is_updating || m.id in processing);
      
      if (currentlyBusy) {
        setHadActiveUpdates(true);
      }

      // If we were updating and now nothing is busy, or if we clicked "Update All" and everything was already fine
      if (!currentlyBusy && (hadActiveUpdates || isBatchUpdating)) {
        // Small delay to ensure UI has settled
        const timer = setTimeout(() => {
          console.log('[Mods] Batch operation finished');
          setIsBatchUpdating(false);
          setHadActiveUpdates(false);
          
          // Animate in
          setRenderNotification(true);
          setTimeout(() => setShowNotification(true), 10);
          
          // Animate out after 3 seconds
          setTimeout(() => {
            setShowNotification(false);
            setTimeout(() => setRenderNotification(false), 500); // Wait for fade out transition
          }, 3000);
          
        }, 500);
        return () => clearTimeout(timer);
      }
    }
  }, [mods, isBatchUpdating, hadActiveUpdates, processing]);

  const handleSubscribe = async (id: string) => {
    setProcessing(prev => ({ ...prev, [id]: Date.now() }));
    await safeInvoke('subscribe_mod', { id });
    await fetchMods();
  };

  const handleConfirmUnsubscribe = async () => {
    if (!modToUnsubscribe) return;
    const id = modToUnsubscribe.id;
    console.log(`[Mods] Unsubscribing from mod ${id}...`);
    setProcessing(prev => ({ ...prev, [id]: Date.now() }));
    try {
      await safeInvoke('unsubscribe_mod', { id });
      console.log(`[Mods] Unsubscribe command sent for ${id}`);
    } catch (err) {
      console.error(`[Mods] Failed to unsubscribe from ${id}:`, err);
    }
    setModToUnsubscribe(null);
    await fetchMods();
  };

  const handleDownload = async (id: string) => {
    setProcessing(prev => ({ ...prev, [id]: Date.now() }));
    await safeInvoke('download_mod', { id });
    await fetchMods();
  };

  const handleSubscribeAll = async () => {
    setIsBatchUpdating(true);
    setHadActiveUpdates(false);
    const unsubscribed = mods.filter(m => !m.is_subscribed).map(m => m.id);
    const now = Date.now();
    setProcessing(prev => {
      const next = { ...prev };
      unsubscribed.forEach(id => next[id] = now);
      return next;
    });
    for (const id of unsubscribed) {
      await safeInvoke('subscribe_mod', { id });
    }
    await fetchMods();
  };

  const handleDownloadAll = async () => {
    setIsBatchUpdating(true);
    setHadActiveUpdates(false);
    const subscribedMods = mods.filter(m => m.is_subscribed).map(m => m.id);
    const now = Date.now();
    setProcessing(prev => {
      const next = { ...prev };
      subscribedMods.forEach(id => next[id] = now);
      return next;
    });
    for (const id of subscribedMods) {
      await safeInvoke('download_mod', { id });
    }
    await fetchMods();
  };

  const fetchMods = async (isInitial = false) => {
    if (requiredMods.length === 0) {
      setMods([]);
      return;
    }
    
    if (isInitial) setLoading(true);
    try {
      const data = await safeInvoke<ModInfo[]>('get_server_mods', { 
        modIds: requiredMods.map(m => m.id)
      });
      
      // Cleanup processing status if mod is now updating or time passed
      const now = Date.now();
      setProcessing(prev => {
        const next = { ...prev };
        let changed = false;
        for (const id in next) {
          const mod = data.find(m => m.id === id);
          // Remove if it's already updating or 5 seconds passed
          if ((mod && mod.is_updating) || (now - next[id] > 5000)) {
            delete next[id];
            changed = true;
          }
        }
        return changed ? next : prev;
      });

      // Use server names as initial titles if Steam doesn't provide them yet
      const enrichedData = data.map(mod => {
        const serverMod = requiredMods.find(rm => rm.id === mod.id);
        return {
          ...mod,
          title: mod.title.includes('Workshop Mod #') && serverMod ? serverMod.name : mod.title
        };
      });
      
      setMods(enrichedData);
    } catch (err) {
      console.error('Failed to fetch mods:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMods(true);
    
    const interval = setInterval(() => {
      fetchMods(false);
    }, 1000);
    
    return () => clearInterval(interval);
  }, [requiredMods]);

  const filteredMods = mods;

  const formatSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 relative">
      {/* Success Notification */}
      {renderNotification && (
        <div 
          className={`fixed top-8 left-[calc(50%+8rem)] z-[9999] pointer-events-none flex justify-center
            ${showNotification ? 'animate-notification-in' : 'animate-notification-out'}
          `}
        >
          <div className="bg-[#101010]/80 backdrop-blur-2xl border border-emerald-500/50 px-8 py-4 rounded-3xl flex items-center gap-4 shadow-[0_0_50px_rgba(16,185,129,0.2)]">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 flex items-center justify-center border border-emerald-500/30">
              <CheckCircle2 className="w-6 h-6 text-emerald-400" />
            </div>
            <div className="flex flex-col">
              <p className="text-white font-bold text-base tracking-tight">Обновление завершено</p>
              <p className="text-emerald-400/80 text-xs font-medium uppercase tracking-widest">Все процессы успешно выполнены</p>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Моды</h1>
        </div>
      </div>

      {requiredMods.length === 0 ? (
        <div className="bg-blue-500/10 border border-blue-500/20 rounded-2xl p-6 flex items-center gap-4 text-blue-400">
          <AlertCircle className="w-6 h-6 shrink-0" />
          <p className="text-sm">Для отображения списка модов необходимо сначала загрузить список серверов во вкладке «Серверы».</p>
        </div>
      ) : (
        <>
          {/* Stats */}
          <div className="flex flex-col md:flex-row gap-4">
            <div className="bg-white/5 border border-white/10 rounded-xl px-6 py-3 flex items-center gap-6">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-medium text-white">{mods.length}</span>
                <span className="text-xs text-white/40">модов</span>
              </div>
              <div className="w-px h-4 bg-white/10" />
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-sm font-medium text-white">{mods.filter(m => m.is_installed).length}</span>
                <span className="text-xs text-white/40">установлено</span>
              </div>
            </div>
            
            <div className="flex items-center gap-2 mt-4 md:mt-0">
              <button 
                onClick={handleSubscribeAll}
                className="flex items-center gap-2 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 px-4 py-2 rounded-xl transition-colors text-sm font-medium"
              >
                <PlusCircle className="w-4 h-4" />
                Подписаться на всё
              </button>
              <button 
                onClick={handleDownloadAll}
                className="flex items-center gap-2 bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 px-4 py-2 rounded-xl transition-colors text-sm font-medium"
              >
                <RefreshCw className="w-4 h-4" />
                Обновить всё
              </button>
            </div>
          </div>

          {/* Mods List */}
          {loading ? (
            <div className="flex flex-col gap-4">
              {[1, 2, 3, 4, 5, 6].map(i => (
                <div key={i} className="h-24 bg-white/5 rounded-2xl animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {filteredMods.map(mod => (
                <div 
                  key={mod.id}
                  className="group relative bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 rounded-xl p-3 transition-all duration-300 flex items-center gap-4"
                >
                  {/* Thumbnail */}
                  <div className="w-12 h-12 shrink-0 rounded-lg bg-white/5 flex items-center justify-center border border-white/10 overflow-hidden">
                    {mod.preview_url ? (
                      <img src={mod.preview_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Package className="w-6 h-6 text-white/20" />
                    )}
                  </div>
                  
                  {/* Text Details */}
                  <div className="flex-1 min-w-0 flex flex-col justify-center">
                    <h3 className="text-sm font-semibold text-white truncate group-hover:text-blue-400 transition-colors">
                      {mod.title}
                    </h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] text-white/30 uppercase tracking-tighter">ID: {mod.id}</span>
                      <span className="text-[10px] text-white/20">•</span>
                      <span className="text-[10px] text-white/30">{formatSize(mod.size)}</span>
                      <span className="text-[10px] text-white/20 ml-2 border-l border-white/10 pl-2">
                        {mod.id in processing && !mod.is_updating ? (
                          <span className="text-amber-400 font-bold uppercase tracking-wider flex items-center gap-1">
                            <Clock className="w-3 h-3 animate-pulse" />
                            Проверяется...
                          </span>
                        ) : mod.is_updating || (mod.is_subscribed && !mod.is_installed) ? (
                          <span className="text-blue-400 font-bold uppercase tracking-wider flex items-center gap-1">
                            <Clock className="w-3 h-3 animate-spin" />
                            {mod.download_progress != null && mod.download_bytes != null && mod.total_bytes != null 
                              ? `Загрузка: ${mod.download_progress.toFixed(1)}% (${(mod.download_bytes / 1048576).toFixed(1)}/${(mod.total_bytes / 1048576).toFixed(1)} MB)` 
                              : 'Ожидание...'}
                          </span>
                        ) : mod.is_installed ? (
                          <span className="text-emerald-400 font-bold uppercase tracking-wider flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Готов
                          </span>
                        ) : (
                          <span className="text-gray-400 font-bold uppercase tracking-wider flex items-center gap-1">
                            <Package className="w-3 h-3" /> Не установлен
                          </span>
                        )}
                      </span>
                    </div>
                    
                    {/* Progress Bar */}
                    {(mod.is_updating || (mod.is_subscribed && !mod.is_installed)) && mod.download_progress != null && (
                      <div className="mt-1.5 w-full max-w-xs h-1 bg-white/5 rounded-full overflow-hidden">
                        <div 
                          className="h-full bg-blue-500 transition-all duration-300 ease-out"
                          style={{ width: `${mod.download_progress}%` }}
                        />
                      </div>
                    )}
                  </div>
                  
                  {/* Action Buttons */}
                  <div className="flex items-center gap-2 shrink-0">
                    {mod.is_subscribed && (
                      <button 
                        onClick={() => setModToUnsubscribe(mod)}
                        disabled={mod.id in processing}
                        className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 bg-red-500/10 hover:bg-red-500/20 px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50"
                      >
                        <MinusCircle className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline font-medium">Отписаться</span>
                      </button>
                    )}
                    
                    {!mod.is_subscribed && (
                      <button 
                        onClick={() => handleSubscribe(mod.id)}
                        disabled={mod.id in processing}
                        className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 bg-blue-500/10 hover:bg-blue-500/20 px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50"
                      >
                        <PlusCircle className="w-3.5 h-3.5" />
                        <span className="hidden sm:inline font-medium">Подписаться</span>
                      </button>
                    )}

                    {mod.is_subscribed && (
                      <button 
                        onClick={() => handleDownload(mod.id)}
                        disabled={mod.id in processing}
                        className="flex items-center gap-1.5 text-xs text-emerald-400 hover:text-emerald-300 bg-emerald-500/10 hover:bg-emerald-500/20 px-2.5 py-1.5 rounded-md transition-colors disabled:opacity-50"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${mod.id in processing ? 'animate-spin' : ''}`} />
                        <span className="hidden sm:inline font-medium">Обновить</span>
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {filteredMods.length === 0 && !loading && (
            <div className="flex flex-col items-center justify-center py-20 text-white/20">
              <Package className="w-16 h-16 mb-4 opacity-10" />
              <p className="text-lg font-medium">Ни один мод не требуется</p>
              <p className="text-sm">Для текущих серверов не обнаружено внешних модификаций</p>
            </div>
          )}
        </>
      )}

      {/* Unsubscribe Confirmation Modal */}
      {modToUnsubscribe && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in">
          <div className="glass-panel border border-white/10 rounded-2xl p-8 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="w-12 h-12 bg-red-500/20 rounded-full flex items-center justify-center text-red-500 mb-6 mx-auto">
              <Trash2 size={24} />
            </div>
            <h3 className="text-lg font-bold text-white text-center mb-2">Удаление мода</h3>
            <p className="text-sm text-gray-400 text-center mb-8">
              Вы уверены, что хотите отписаться от мода <span className="text-white font-medium">"{modToUnsubscribe.title}"</span>?
            </p>
            <div className="grid grid-cols-2 gap-4">
              <button 
                onClick={() => setModToUnsubscribe(null)}
                className="px-6 py-3 rounded-xl text-sm font-bold text-gray-400 hover:text-white hover:bg-white/5 transition-colors border border-white/5"
              >
                Нет
              </button>
              <button 
                onClick={handleConfirmUnsubscribe}
                className="px-6 py-3 rounded-xl text-sm font-bold bg-red-600 hover:bg-red-500 text-white transition-colors shadow-lg shadow-red-600/20"
              >
                Да
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Mods;
