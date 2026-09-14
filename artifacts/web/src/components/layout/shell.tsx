import React from 'react';
import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { Sidebar } from './sidebar';
import { Header } from './header';
import { SidebarProvider } from './sidebar-context';

export function Shell({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  useEffect(() => {
    const main = document.querySelector<HTMLElement>('.app-shell-main');
    main?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location]);

  return (
    <SidebarProvider>
      <div className="app-shell flex h-screen overflow-hidden bg-background w-full">
        <Sidebar />
        <div className="flex flex-col flex-1 min-w-0 transition-all duration-300">
          <Header />
          <main className="app-shell-main flex-1 overflow-y-auto p-4 md:p-6 lg:p-8">
            <div className="mx-auto max-w-7xl">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
