import { DarkTheme, DefaultTheme, Redirect, Slot, ThemeProvider, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';

import AppTabs from '@/components/app-tabs';
import { supabase } from '@/lib/supabase';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const pathname = usePathname();
  const [sessionReady, setSessionReady] = useState(false);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    let isActive = true;

    const initializeSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!isActive) return;
      setHasSession(Boolean(data.session));
      setSessionReady(true);
    };

    initializeSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!isActive) return;
      setHasSession(Boolean(session));
      setSessionReady(true);
    });

    return () => {
      isActive = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  if (!sessionReady) {
    return null;
  }

  const isAuthRoute = pathname === '/login' || pathname.startsWith('/login/');

  if (!hasSession && !isAuthRoute) {
    return <Redirect href="/login" />;
  }

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      {hasSession ? <AppTabs /> : <Slot />}
    </ThemeProvider>
  );
}
