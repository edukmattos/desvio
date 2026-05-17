import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Landing } from './pages/Landing';
import { Signin } from './pages/Signin';
import { ProfileEdit } from './pages/ProfileEdit';
import { Signup } from './pages/Signup';
import { Search } from './pages/Search';
import { MediaManagement } from './pages/MediaManagement';
import { UserProfile } from './pages/UserProfile';
import { Chat } from './pages/Chat';
import { Matches } from './pages/Matches';
import { Visitors } from './pages/Visitors';
import { LikedMe } from './pages/LikedMe';
import { Conversations } from './pages/Conversations';
import { Notifications } from './pages/Notifications';
import { Store } from './pages/Store';
import { Privacy } from './pages/Privacy';
import { Terms } from './pages/Terms';
import { Security } from './pages/Security';
import { Contact } from './pages/Contact';
import { Moderation } from './pages/Moderation';
import { SecuritySettings } from './pages/SecuritySettings';
import { ProfileVerification } from './pages/ProfileVerification';
import { SafetyCenter } from './pages/SafetyCenter';
import { AdminDashboard } from './pages/AdminDashboard';
import { AdminAudit } from './pages/AdminAudit';
import { Toaster } from 'sonner';
import { MainLayout } from './components/layout/MainLayout';
import { AdminGuard } from './components/AdminGuard';
import { SplashScreen } from './components/ui';
import { supabase } from './lib/supabase';
import { useAuthStore } from './store/useAuthStore';
import { useNotificationStore } from './store/useNotificationStore';
import { logUserActivity } from './utils/activityLogger';
import './index.css';

function App() {
  const { setSession, setLoading, fetchUserProfile, user } = useAuthStore();
  const { fetchCounts, subscribe } = useNotificationStore();
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      if (session?.user?.id) {
        await fetchUserProfile(session.user.id);
      }
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);
      if (session?.user?.id) {
        fetchUserProfile(session.user.id);
        
        // Registrar atividades de auditoria (em segundo plano)
        if (event === 'SIGNED_IN') {
          logUserActivity(session.user.id, 'LOGIN');
        } else if (event === 'TOKEN_REFRESHED') {
          logUserActivity(session.user.id, 'SESSION_REFRESH');
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [setSession, setLoading, fetchUserProfile]);

  useEffect(() => {
    if (user?.id) {
      fetchCounts(user.id);

      // Heartbeat: Atualiza last_active a cada 2 minutos
      const updateLastActive = async () => {
        try {
          await supabase
            .from('users')
            .update({ last_active: new Date().toISOString() })
            .eq('id', user.id);
        } catch (err) {
          console.warn('[Heartbeat] Failed to update last_active:', err);
        }
      };

      // Executa imediatamente e depois em intervalo
      updateLastActive();
      const heartbeatInterval = setInterval(updateLastActive, 120_000);

      // Tenta conectar Realtime (pode falhar se WebSocket estiver bloqueado no servidor)
      const unsubscribe = subscribe(user.id);

      // Fallback: polling a cada 30s para garantir que os contadores atualizem
      // mesmo quando o WebSocket falhar (ex: proxy Easypanel sem suporte a wss://)
      const pollInterval = setInterval(() => {
        fetchCounts(user.id);
      }, 30_000);

      return () => {
        unsubscribe && unsubscribe();
        clearInterval(pollInterval);
        clearInterval(heartbeatInterval);
      };
    }
  }, [user?.id, fetchCounts, subscribe]);

  return (
    <BrowserRouter>
      {showSplash && <SplashScreen onFinish={() => setShowSplash(false)} />}
      
      <Toaster 
        theme="dark" 
        position="top-center" 
        richColors 
        closeButton
        toastOptions={{
          style: {
            background: 'rgba(20, 20, 20, 0.8)',
            backdropFilter: 'blur(12px)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            color: '#fff',
            fontFamily: 'inherit',
            fontSize: '10px',
            fontWeight: '900',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            borderRadius: '4px'
          },
        }}
      />

      <Routes>
        {/* Public Routes */}
        <Route path="/" element={<Landing />} />
        <Route path="/signin" element={<Signin />} />
        <Route path="/signup" element={<Signup />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/security" element={<Security />} />
        <Route path="/contact" element={<Contact />} />

        {/* Protected Layout Routes */}
        <Route path="/settings/security" element={<MainLayout><SecuritySettings /></MainLayout>} />
        <Route path="/profile/verify" element={<MainLayout><ProfileVerification /></MainLayout>} />
        <Route path="/safety" element={<MainLayout><SafetyCenter /></MainLayout>} />
        <Route path="/profile/edit" element={<MainLayout><ProfileEdit /></MainLayout>} />
        <Route path="/profile/media" element={<MainLayout><MediaManagement /></MainLayout>} />
        <Route path="/search" element={<MainLayout><Search /></MainLayout>} />
        <Route path="/user/:id" element={<MainLayout><UserProfile /></MainLayout>} />
        <Route path="/chat/:id" element={<MainLayout><Chat /></MainLayout>} />
        <Route path="/matches" element={<MainLayout><Matches /></MainLayout>} />
        <Route path="/likedme" element={<MainLayout><LikedMe /></MainLayout>} />
        <Route path="/visitors" element={<MainLayout><Visitors /></MainLayout>} />
        <Route path="/conversations" element={<MainLayout><Conversations /></MainLayout>} />
        <Route path="/notifications" element={<MainLayout><Notifications /></MainLayout>} />
        <Route path="/store" element={<MainLayout><Store /></MainLayout>} />

        {/* Admin Routes */}
        <Route path="/admin/dashboard" element={<AdminGuard><MainLayout><AdminDashboard /></MainLayout></AdminGuard>} />
        <Route path="/admin/moderation" element={<AdminGuard><MainLayout><Moderation /></MainLayout></AdminGuard>} />
        <Route path="/admin/audit" element={<AdminGuard><MainLayout><AdminAudit /></MainLayout></AdminGuard>} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
