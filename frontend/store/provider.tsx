"use client";

import { useEffect } from "react";
import { setupListeners } from "@reduxjs/toolkit/query";
import { Provider } from "react-redux";
import { store } from "./index";
interface ReduxProviderProps {
  children: React.ReactNode;
}

export function ReduxProvider({
  children,
}: ReduxProviderProps) {
  useEffect(() => setupListeners(store.dispatch), []);

  return (
    <Provider store={store}>
      {children}
    </Provider>
  );
}
