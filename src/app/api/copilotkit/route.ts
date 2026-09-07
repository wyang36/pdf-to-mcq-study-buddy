// CopilotKit runtime — powers the tutor chat sidebar ("explain more", "give me
// a hint"). It reuses the same provider config as the lesson agent via a
// LangChain adapter. In mock mode (no API key) there is no chat model, so we
// fall back to an empty adapter and the UI tells the user chat needs a key.

import { NextRequest } from "next/server";
import {
  CopilotRuntime,
  EmptyAdapter,
  LangChainAdapter,
  copilotRuntimeNextJSAppRouterEndpoint,
  type CopilotServiceAdapter,
} from "@copilotkit/runtime";
import { createChatModel } from "@/agent/llm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const model = await createChatModel();

  let serviceAdapter: CopilotServiceAdapter;
  if (model) {
    const chatModel = model;
    serviceAdapter = new LangChainAdapter({
      chainFn: async ({ messages, tools }) => {
        const bindable = chatModel as unknown as {
          bindTools?: (t: unknown[]) => typeof chatModel;
        };
        const withTools =
          tools && tools.length > 0 && typeof bindable.bindTools === "function"
            ? bindable.bindTools(tools)
            : chatModel;
        return withTools.stream(messages);
      },
    });
  } else {
    serviceAdapter = new EmptyAdapter();
  }

  const copilotRuntime = new CopilotRuntime();

  const { handleRequest } = copilotRuntimeNextJSAppRouterEndpoint({
    runtime: copilotRuntime,
    serviceAdapter,
    endpoint: "/api/copilotkit",
  });

  return handleRequest(req);
}
