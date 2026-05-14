import { useReducer, type ReactNode } from "react";
import { TerminalContext, initialState, reducer } from "./terminalStore";

export function TerminalProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <TerminalContext.Provider value={{ state, dispatch }}>
      {children}
    </TerminalContext.Provider>
  );
}
