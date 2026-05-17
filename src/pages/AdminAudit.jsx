import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { GlassCard, Loading } from '../components/ui';
import { toast } from 'sonner';

export function AdminAudit() {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchActivities = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('login_activity')
        .select(`
          id,
          created_at,
          activity_type,
          ip_address,
          user_agent,
          location,
          user_id,
          users (
            name,
            email
          )
        `)
        .order('created_at', { ascending: false })
        .limit(100);

      if (error) throw error;
      setActivities(data || []);
    } catch (err) {
      console.error('[Audit] Error fetching logs:', err);
      toast.error('Erro ao carregar logs de auditoria');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchActivities();
  }, []);

  return (
    <div className="max-w-[100%] mx-auto">
      {/* Title Header */}
      <div className="flex items-center gap-6 mb-12 px-4">
        <h1 className="text-[10px] font-black uppercase tracking-[0.4em] text-[#FF5500] whitespace-nowrap">
          LOGS DE AUDITORIA
        </h1>
        <div className="h-[1px] flex-1 bg-[#FF5500]"></div>
      </div>

      <main className="max-w-6xl mx-auto">
        <div className="flex justify-end mb-6">
            <button 
                onClick={fetchActivities}
                className="flex items-center gap-2 px-4 py-2 rounded border border-white/10 hover:border-white/20 transition-all text-[10px] font-black uppercase tracking-widest"
            >
                <span className="material-symbols-outlined text-sm">refresh</span>
                Atualizar
            </button>
        </div>

        {loading ? (
            <div className="flex justify-center py-20"><Loading /></div>
        ) : (
            <div className="overflow-x-auto rounded border border-white/5 bg-white/[0.02]">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-white/5 bg-white/5">
                            <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-primary">Data/Hora</th>
                            <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-primary">Usuário</th>
                            <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-primary">Evento</th>
                            <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-primary">IP</th>
                            <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-primary">Localização</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03]">
                        {activities.map((log) => (
                            <tr key={log.id} className="hover:bg-white/[0.01] transition-colors">
                                <td className="px-6 py-4 text-[10px] text-white/60 whitespace-nowrap">
                                    {new Date(log.created_at).toLocaleString('pt-BR')}
                                </td>
                                <td className="px-6 py-4">
                                    <p className="text-xs font-bold text-white">{log.users?.name || 'N/A'}</p>
                                    <p className="text-[10px] text-on-surface-variant">{log.users?.email || log.user_id}</p>
                                </td>
                                <td className="px-6 py-4">
                                    <span className={`px-2 py-0.5 rounded text-[9px] font-black uppercase tracking-widest ${
                                        log.activity_type === 'LOGIN' ? 'bg-green-500/10 text-green-500' : 'bg-blue-500/10 text-blue-500'
                                    }`}>
                                        {log.activity_type}
                                    </span>
                                </td>
                                <td className="px-6 py-4 text-xs font-mono text-on-surface-variant">
                                    {log.ip_address}
                                </td>
                                <td className="px-6 py-4 text-[10px] text-on-surface-variant max-w-xs truncate">
                                    {log.location?.city || 'Localização Oculta'}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        )}
      </main>
    </div>
  );
}
