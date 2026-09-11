"use client";

import { CopilotKit } from "@copilotkit/react-core";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    // showDevConsole defaults to "auto", which renders CopilotKit's debug panel
    // on localhost — including an "update available" banner, because we pin the
    // 1.8.x line on purpose. 1.70+ is effectively CopilotKit v2: it deprecates
    // the v1 LangChainAdapter this app's tutor chat is built on and requires an
    // explicit BuiltInAgent, so taking that upgrade is a migration, not an
    // `npm install`. Turning the console off keeps the nag out of the demo.
    <CopilotKit runtimeUrl="/api/copilotkit" showDevConsole={false}>
      {children}
    </CopilotKit>
  );
}
