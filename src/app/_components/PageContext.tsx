'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

interface PageContextData {
  label: string;
  content: string;
}

const PageContext = createContext<{
  pageData: PageContextData | null;
  setPageData: (data: PageContextData | null) => void;
}>({ pageData: null, setPageData: () => {} });

export function PageContextProvider({ children }: { children: ReactNode }) {
  const [pageData, setPageData] = useState<PageContextData | null>(null);
  return (
    <PageContext.Provider value={{ pageData, setPageData }}>
      {children}
    </PageContext.Provider>
  );
}

export function usePageContext() {
  return useContext(PageContext);
}
