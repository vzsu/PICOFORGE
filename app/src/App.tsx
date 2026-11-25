// App.tsx — PicoForge shell.
// P0: the main screen runs as a high-fidelity mock-up on app/src/mock/mainScreen.ts (docs/02 §1).
// The pre-P0 chat/viewport components stay in the tree until the real stores are wired in.

import { MainScreen } from "./features/main/MainScreen.tsx";

export function App() {
  return <MainScreen />;
}
