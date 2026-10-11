import { DarkTheme, DefaultTheme, Redirect, Stack, ThemeProvider, usePathname } from 'expo-router';
import { useEffect, useState } from 'react';
import { useColorScheme } from 'react-native';

import { Colors } from '@/constants/theme';
import { supabase } from '@/lib/supabase';

// React Navigation paints screens with its theme's background (a light gray by default), which shows
// around the tab screens' margins. Use the app's own backgrounds instead.
const LightNavTheme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: Colors.light.background } };
const DarkNavTheme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: Colors.dark.background } };

export default function RootLayout() {
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
    <ThemeProvider value={colorScheme === 'dark' ? DarkNavTheme : LightNavTheme}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="upload" options={{ headerShown: true, title: 'Add to closet', headerBackTitle: 'Closet' }} />
        <Stack.Screen name="login/index" />
      </Stack>
    </ThemeProvider>
  );
}
